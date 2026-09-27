import type { Db } from '../db/database';
import { type Ctx, can, requirePerm, today } from '../context';
import { fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, nextNo, paged, type ListParams, type QuerySpec } from './common';
import { assertUniqueIdentifiers, insertCostLine, insertVehicle, validateVehicleFields } from './vehicles';
import { marginPct } from '../calc/money';

function validateTradeIn(input: any) {
  const vf = validateVehicleFields({ ...input, condition: 'used' });
  const r = {
    customer_id: V.id(input.customer_id, 'العميل'),
    brand: vf.brand,
    model: vf.model,
    trim: vf.trim,
    model_year: vf.model_year,
    color: vf.color,
    vin: vf.vin,
    engine_no: vf.engine_no,
    plate_no: vf.plate_no,
    mileage: vf.mileage,
    condition_grade: V.oneOf(input.condition_grade, ['excellent', 'good', 'fair', 'poor'] as const, 'حالة السيارة', 'good'),
    condition_notes: V.str(input.condition_notes, 'ملاحظات الحالة', { max: 1000 }),
    market_value: V.optMoney(input.market_value, 'القيمة السوقية التقديرية'),
    trade_in_value: V.money(input.trade_in_value, 'قيمة الاستبدال'),
    expected_prep_cost: V.optMoney(input.expected_prep_cost, 'تكلفة التجهيز المتوقعة'),
    expected_selling_price: V.optMoney(input.expected_selling_price, 'سعر البيع المتوقع'),
    eval_date: V.reqDate(input.eval_date, 'تاريخ التقييم'),
    notes: V.str(input.notes, 'ملاحظات', { max: 2000 }),
  };
  return r;
}

/** Expected Total Cost = trade-in value + expected preparation; Expected Profit = expected selling price − expected total cost. */
export function tradeInExpectations(t: { trade_in_value: number; expected_prep_cost: number; expected_selling_price: number }) {
  const expected_total_cost = t.trade_in_value + t.expected_prep_cost;
  const expected_profit = t.expected_selling_price - expected_total_cost;
  return { expected_total_cost, expected_profit, expected_margin: marginPct(expected_profit, t.expected_selling_price) };
}

export function createTradeIn(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'tradeins.manage');
  const t = validateTradeIn({ ...input, eval_date: input.eval_date ?? today(ctx) });
  if (!db.scalar('SELECT COUNT(*) FROM customers WHERE id = ? AND deleted_at IS NULL', [t.customer_id])) fail('NOT_FOUND', 'العميل غير موجود.');
  assertUniqueIdentifiers(db, t.vin, t.engine_no);
  return db.tx(() => {
    const trade_no = nextNo(db, 'tradein', t.eval_date);
    const id = db.run(
      `INSERT INTO trade_ins(trade_no, customer_id, brand, model, trim, model_year, color, vin, engine_no, plate_no, mileage, condition_grade, condition_notes,
         market_value, trade_in_value, expected_prep_cost, expected_selling_price, eval_date, notes, created_by)
       VALUES (:trade_no,:customer_id,:brand,:model,:trim,:model_year,:color,:vin,:engine_no,:plate_no,:mileage,:condition_grade,:condition_notes,
         :market_value,:trade_in_value,:expected_prep_cost,:expected_selling_price,:eval_date,:notes,:created_by)`,
      { ...t, trade_no, created_by: ctx.user.id || null },
    ).lastId;
    audit(db, ctx, { action: 'create', module: 'tradeins', record_type: 'trade_in', record_id: id, label: trade_no, new: { ...t, ...tradeInExpectations(t) } });
    return { id, trade_no };
  });
}

export function updateTradeIn(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'tradeins.manage');
  const id = V.id(input.id, 'الاستبدال');
  const old = db.get<any>('SELECT * FROM trade_ins WHERE id = ?', [id]);
  if (!old) fail('NOT_FOUND', 'عملية الاستبدال غير موجودة.');
  if (old.status !== 'evaluated') fail('LOCKED', 'لا يمكن تعديل استبدال تم قبوله أو رفضه.');
  const t = validateTradeIn({ ...input, customer_id: old.customer_id });
  assertUniqueIdentifiers(db, t.vin, t.engine_no);
  return db.tx(() => {
    db.run(
      `UPDATE trade_ins SET brand=:brand, model=:model, trim=:trim, model_year=:model_year, color=:color, vin=:vin, engine_no=:engine_no, plate_no=:plate_no,
         mileage=:mileage, condition_grade=:condition_grade, condition_notes=:condition_notes, market_value=:market_value, trade_in_value=:trade_in_value,
         expected_prep_cost=:expected_prep_cost, expected_selling_price=:expected_selling_price, eval_date=:eval_date, notes=:notes WHERE id=:id`,
      { ...t, id },
    );
    audit(db, ctx, { action: 'update', module: 'tradeins', record_type: 'trade_in', record_id: id, label: old.trade_no, old, new: t });
    return { id };
  });
}

export function rejectTradeIn(db: Db, ctx: Ctx, input: { id: number; reason?: string }) {
  requirePerm(ctx, 'tradeins.manage');
  const id = V.id(input.id, 'الاستبدال');
  const old = db.get<any>('SELECT * FROM trade_ins WHERE id = ?', [id]);
  if (!old) fail('NOT_FOUND', 'عملية الاستبدال غير موجودة.');
  if (old.status !== 'evaluated') fail('VALIDATION', 'لا يمكن رفض استبدال تم قبوله.');
  return db.tx(() => {
    db.run(`UPDATE trade_ins SET status = 'rejected', notes = COALESCE(notes || ' | ', '') || ? WHERE id = ?`, [`مرفوض: ${input.reason ?? ''}`, id]);
    audit(db, ctx, { action: 'reject', module: 'tradeins', record_type: 'trade_in', record_id: id, label: old.trade_no, details: input.reason ?? null });
    return { ok: true };
  });
}

/**
 * Accepts a trade-in as part of a sale: the vehicle is created in inventory (used, under preparation)
 * with the trade-in value as its acquisition cost. Must be called inside the sale transaction.
 */
export function acceptTradeInForSale(
  db: Db,
  ctx: Ctx,
  tradeInId: number,
  saleId: number,
  saleDate: string,
  customerId: number,
): { vehicle_id: number; value: number } {
  const t = db.get<any>('SELECT * FROM trade_ins WHERE id = ?', [tradeInId]);
  if (!t) fail('NOT_FOUND', 'عملية الاستبدال غير موجودة.');
  if (t.status !== 'evaluated') fail('VALIDATION', 'عملية الاستبدال مستخدمة أو مرفوضة بالفعل.');
  if (t.customer_id !== customerId) fail('VALIDATION', 'سيارة الاستبدال تخص عميلاً آخر.');
  const vf = validateVehicleFields({ ...t, condition: 'used', notes: t.condition_notes });
  const v = insertVehicle(db, ctx, vf, {
    status: 'preparation',
    acquisition_type: 'trade_in',
    acquisition_date: saleDate,
    asking_price: t.expected_selling_price,
    min_price: 0,
  });
  insertCostLine(db, ctx, {
    vehicle_id: v.id,
    expense_date: saleDate,
    category: 'trade_in',
    description: `قيمة استبدال - ${t.trade_no}`,
    amount: t.trade_in_value,
    source_type: 'trade_in',
    source_id: t.id,
  });
  db.run(`UPDATE trade_ins SET status = 'accepted', vehicle_id = ?, sale_id = ? WHERE id = ?`, [v.id, saleId, t.id]);
  audit(db, ctx, {
    action: 'accept',
    module: 'tradeins',
    record_type: 'trade_in',
    record_id: t.id,
    label: `${t.trade_no} → ${v.stock_no}`,
    new: { vehicle_id: v.id, sale_id: saleId },
  });
  return { vehicle_id: v.id, value: t.trade_in_value };
}

const TI_SELECT = (fin: boolean) => `t.*, c.name AS customer_name, c.phone AS customer_phone, s.sale_no, v.stock_no, v.status AS vehicle_status,
  t.trade_in_value + t.expected_prep_cost AS expected_total_cost,
  t.expected_selling_price - (t.trade_in_value + t.expected_prep_cost) AS expected_profit,
  ${fin ? 'vc.actual_cost' : 'NULL'} AS actual_cost, rs.selling_price AS actual_selling_price, rs.sale_no AS resale_no,
  ${fin ? 'CASE WHEN rs.id IS NOT NULL THEN rs.selling_price - vc.actual_cost END' : 'NULL'} AS actual_profit`;
const TI_FROM = `trade_ins t JOIN customers c ON c.id = t.customer_id LEFT JOIN sales s ON s.id = t.sale_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN v_vehicle_cost vc ON vc.vehicle_id = t.vehicle_id LEFT JOIN sales rs ON rs.vehicle_id = t.vehicle_id AND rs.status = 'active'`;

export function listTradeIns(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'tradeins.view');
  const f = p.filters ?? {};
  const fin = can(ctx, 'costs.view');
  const q: QuerySpec = {
    select: TI_SELECT(fin),
    from: TI_FROM,
    where: [],
    params: {},
    sortable: { eval_date: 't.eval_date', trade_in_value: 't.trade_in_value', customer_name: 'c.name', expected_profit: 'expected_profit' },
    defaultSort: 't.id DESC',
    totals: 'COUNT(*) AS count, SUM(t.trade_in_value) AS trade_in_value',
  };
  addSearch(q, p.search, ['t.trade_no', 't.brand', 't.model', 't.vin', 'c.name']);
  addEq(q, 't.status', 'status', f.status);
  addEq(q, 't.customer_id', 'customer_id', f.customer_id);
  addEq(q, 't.brand', 'brand', f.brand);
  addDateRange(q, 't.eval_date', f.from, f.to);
  return paged(db, q, p);
}

export function getTradeIn(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'tradeins.view');
  const row = db.get<any>(`SELECT ${TI_SELECT(can(ctx, 'costs.view'))} FROM ${TI_FROM} WHERE t.id = ?`, [V.id(input.id, 'الاستبدال')]);
  if (!row) fail('NOT_FOUND', 'عملية الاستبدال غير موجودة.');
  return row;
}
