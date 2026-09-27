import type { Db } from '../db/database';
import { type Ctx, can, requirePerm, today } from '../context';
import { fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, paged, type ListParams, type QuerySpec } from './common';
import { insertCostLine } from './vehicles';
import { localDateTime } from '../calc/dates';
import { marginPct } from '../calc/money';

/** Direct cost categories users can record manually (acquisition lines are created by purchases/trade-ins). */
export const MANUAL_COST_CATEGORIES = [
  'transport',
  'customs',
  'registration',
  'maintenance',
  'parts',
  'bodywork',
  'paint',
  'tires',
  'detailing',
  'insurance',
  'accessories',
  'other',
] as const;
const PAY_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'credit', 'other'] as const;

function validateLine(input: any) {
  return {
    vehicle_id: V.id(input.vehicle_id, 'السيارة'),
    expense_date: V.reqDate(input.expense_date, 'التاريخ'),
    category: V.oneOf(input.category, MANUAL_COST_CATEGORIES, 'نوع التكلفة'),
    description: V.str(input.description, 'الوصف', { max: 300 }),
    amount: V.money(input.amount, 'المبلغ'),
    supplier_id: V.optId(input.supplier_id),
    payment_method: V.oneOf(input.payment_method, PAY_METHODS, 'طريقة الدفع', 'cash'),
    notes: V.str(input.notes, 'ملاحظات', { max: 1000 }),
  };
}

export function createCost(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'costs.manage');
  const l = validateLine(input);
  const v = db.get<any>('SELECT id, stock_no, status FROM vehicles WHERE id = ? AND deleted_at IS NULL', [l.vehicle_id]);
  if (!v) fail('NOT_FOUND', 'السيارة غير موجودة.');
  return db.tx(() => {
    const id = insertCostLine(db, ctx, l);
    audit(db, ctx, { action: 'create', module: 'costs', record_type: 'vehicle_expense', record_id: id, label: v.stock_no, new: l });
    return { id };
  });
}

export function updateCost(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'costs.manage');
  const id = V.id(input.id, 'التكلفة');
  const old = db.get<any>('SELECT * FROM vehicle_expenses WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'بند التكلفة غير موجود.');
  if (old.source_type !== 'manual' || old.category === 'purchase' || old.category === 'trade_in') {
    fail('LOCKED', 'هذا البند مُنشأ تلقائياً من عملية شراء/استبدال ولا يمكن تعديله من هنا.');
  }
  const l = validateLine({ ...input, vehicle_id: old.vehicle_id });
  return db.tx(() => {
    db.run(
      `UPDATE vehicle_expenses SET expense_date=?, category=?, description=?, amount=?, supplier_id=?, payment_method=?, notes=?, updated_at=? WHERE id=?`,
      [l.expense_date, l.category, l.description, l.amount, l.supplier_id, l.payment_method, l.notes, localDateTime(), id],
    );
    audit(db, ctx, {
      action: 'update',
      module: 'costs',
      record_type: 'vehicle_expense',
      record_id: id,
      label: old.expense_no,
      old: { amount: old.amount, category: old.category, expense_date: old.expense_date, description: old.description },
      new: { amount: l.amount, category: l.category, expense_date: l.expense_date, description: l.description },
    });
    return { id };
  });
}

export function deleteCost(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'costs.manage');
  const id = V.id(input.id, 'التكلفة');
  const old = db.get<any>('SELECT * FROM vehicle_expenses WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'بند التكلفة غير موجود.');
  if (old.source_type !== 'manual' || old.category === 'purchase' || old.category === 'trade_in') {
    fail('LOCKED', 'لا يمكن حذف تكلفة الاقتناء الأساسية للسيارة.');
  }
  return db.tx(() => {
    db.run('UPDATE vehicle_expenses SET deleted_at = ? WHERE id = ?', [localDateTime(), id]);
    audit(db, ctx, { action: 'delete', module: 'costs', record_type: 'vehicle_expense', record_id: id, label: old.expense_no, old });
    return { ok: true };
  });
}

export function listCosts(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'costs.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: `e.id, e.expense_no, e.expense_date, e.category, e.description, e.amount, e.payment_method, e.source_type, e.notes,
             v.id AS vehicle_id, v.stock_no, v.brand, v.model, v.model_year, s.name AS supplier_name`,
    from: 'vehicle_expenses e JOIN vehicles v ON v.id = e.vehicle_id LEFT JOIN suppliers s ON s.id = e.supplier_id',
    where: ['e.deleted_at IS NULL'],
    params: {},
    sortable: { expense_date: 'e.expense_date', amount: 'e.amount', category: 'e.category', stock_no: 'v.stock_no' },
    defaultSort: 'e.expense_date DESC, e.id DESC',
    totals: 'COUNT(*) AS count, SUM(e.amount) AS amount',
  };
  addSearch(q, p.search, ['e.expense_no', 'e.description', 'v.stock_no', 'v.brand', 'v.model', 's.name']);
  addEq(q, 'e.vehicle_id', 'vehicle_id', f.vehicle_id);
  addEq(q, 'e.category', 'category', f.category);
  addEq(q, 'v.brand', 'brand', f.brand);
  if (f.exclude_acquisition) q.where.push(`e.category NOT IN ('purchase','trade_in')`);
  addDateRange(q, 'e.expense_date', f.from, f.to);
  return paged(db, q, p);
}

/** The Cost Card: every direct cost line + category totals + pricing/profit figures. */
export function costCard(db: Db, ctx: Ctx, input: { vehicle_id: number }) {
  requirePerm(ctx, 'costs.view');
  const id = V.id(input.vehicle_id, 'السيارة');
  const v = db.get<any>(
    `SELECT v.*, c.actual_cost, c.acquisition_cost, c.direct_costs, s.selling_price, s.sale_no, s.sale_date,
            CAST(julianday(COALESCE(s.sale_date, :today)) - julianday(v.acquisition_date) AS INTEGER) AS days_in_stock
     FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id
     LEFT JOIN sales s ON s.vehicle_id = v.id AND s.status = 'active' WHERE v.id = :id`,
    { id, today: today(ctx) },
  );
  if (!v) fail('NOT_FOUND', 'السيارة غير موجودة.');
  const lines = db.all(
    `SELECT e.id, e.expense_no, e.expense_date, e.category, e.description, e.amount, e.payment_method, e.source_type, e.notes, s.name AS supplier_name
     FROM vehicle_expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
     WHERE e.vehicle_id = ? AND e.deleted_at IS NULL ORDER BY CASE WHEN e.category IN ('purchase','trade_in') THEN 0 ELSE 1 END, e.expense_date, e.id`,
    [id],
  );
  const byCategory = db.all(
    `SELECT category, SUM(amount) AS amount, COUNT(*) AS count FROM vehicle_expenses WHERE vehicle_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY amount DESC`,
    [id],
  );
  const profit = v.selling_price != null ? v.selling_price - v.actual_cost : null;
  return {
    vehicle: v,
    lines,
    byCategory,
    totals: {
      acquisition_cost: v.acquisition_cost,
      direct_costs: v.direct_costs,
      actual_cost: v.actual_cost,
      asking_price: v.asking_price,
      min_price: v.min_price,
      expected_profit: v.asking_price ? v.asking_price - v.actual_cost : null,
      expected_margin: v.asking_price ? marginPct(v.asking_price - v.actual_cost, v.asking_price) : null,
      selling_price: v.selling_price,
      gross_profit: profit,
      gross_margin: profit != null ? marginPct(profit, v.selling_price) : null,
    },
    canManage: can(ctx, 'costs.manage'),
  };
}
