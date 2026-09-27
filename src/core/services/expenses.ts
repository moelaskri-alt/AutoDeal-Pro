import type { Db } from '../db/database';
import { type Ctx, requirePerm } from '../context';
import { fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, nextNo, paged, type ListParams, type QuerySpec } from './common';
import { localDateTime } from '../calc/dates';

/** General overhead & sale-related expenses. Vehicle direct costs live in vehicle_expenses (costs.ts). */
export const EXPENSE_CATEGORIES = ['rent', 'salaries', 'electricity', 'marketing', 'transportation', 'maintenance', 'office', 'commission', 'other'] as const;
const PAY_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const;

function validateExpense(db: Db, input: any) {
  const scope = V.oneOf(input.scope, ['general', 'sale'] as const, 'نوع المصروف', 'general');
  const sale_id = scope === 'sale' ? V.id(input.sale_id, 'عملية البيع') : null;
  if (sale_id && !db.scalar(`SELECT COUNT(*) FROM sales WHERE id = ? AND status = 'active'`, [sale_id])) fail('NOT_FOUND', 'عملية البيع غير موجودة أو ملغاة.');
  return {
    expense_date: V.reqDate(input.expense_date, 'التاريخ'),
    scope,
    category: V.oneOf(input.category, EXPENSE_CATEGORIES, 'البند'),
    description: V.reqStr(input.description, 'الوصف', 300),
    amount: V.money(input.amount, 'المبلغ'),
    sale_id,
    payee: V.str(input.payee, 'المستفيد', { max: 120 }),
    payment_method: V.oneOf(input.payment_method, PAY_METHODS, 'طريقة الدفع', 'cash'),
    notes: V.str(input.notes, 'ملاحظات', { max: 1000 }),
  };
}

export function createExpense(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'expenses.manage');
  const e = validateExpense(db, input);
  return db.tx(() => {
    const expense_no = nextNo(db, 'expense', e.expense_date);
    const id = db.run(
      `INSERT INTO expenses(expense_no, expense_date, scope, category, description, amount, sale_id, payee, payment_method, notes, created_by)
       VALUES (:expense_no,:expense_date,:scope,:category,:description,:amount,:sale_id,:payee,:payment_method,:notes,:created_by)`,
      { ...e, expense_no, created_by: ctx.user.id || null },
    ).lastId;
    audit(db, ctx, { action: 'create', module: 'expenses', record_type: 'expense', record_id: id, label: expense_no, new: e });
    return { id, expense_no };
  });
}

export function updateExpense(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'expenses.manage');
  const id = V.id(input.id, 'المصروف');
  const old = db.get<any>('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'المصروف غير موجود.');
  const e = validateExpense(db, input);
  return db.tx(() => {
    db.run(
      `UPDATE expenses SET expense_date=:expense_date, scope=:scope, category=:category, description=:description, amount=:amount, sale_id=:sale_id,
         payee=:payee, payment_method=:payment_method, notes=:notes, updated_at=:now WHERE id=:id`,
      { ...e, now: localDateTime(), id },
    );
    audit(db, ctx, { action: 'update', module: 'expenses', record_type: 'expense', record_id: id, label: old.expense_no, old, new: e });
    return { id };
  });
}

export function deleteExpense(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'expenses.manage');
  const id = V.id(input.id, 'المصروف');
  const old = db.get<any>('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'المصروف غير موجود.');
  return db.tx(() => {
    db.run('UPDATE expenses SET deleted_at = ? WHERE id = ?', [localDateTime(), id]);
    audit(db, ctx, { action: 'delete', module: 'expenses', record_type: 'expense', record_id: id, label: old.expense_no, old });
    return { ok: true };
  });
}

export function listExpenses(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'expenses.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: `e.*, s.sale_no, u.full_name AS created_by_name`,
    from: 'expenses e LEFT JOIN sales s ON s.id = e.sale_id LEFT JOIN users u ON u.id = e.created_by',
    where: ['e.deleted_at IS NULL'],
    params: {},
    sortable: { expense_date: 'e.expense_date', amount: 'e.amount', category: 'e.category' },
    defaultSort: 'e.expense_date DESC, e.id DESC',
    totals: 'COUNT(*) AS count, SUM(e.amount) AS amount',
  };
  addSearch(q, p.search, ['e.expense_no', 'e.description', 'e.payee', 's.sale_no']);
  addEq(q, 'e.category', 'category', f.category);
  addEq(q, 'e.scope', 'scope', f.scope);
  addEq(q, 'e.payment_method', 'payment_method', f.payment_method);
  addDateRange(q, 'e.expense_date', f.from, f.to);
  return paged(db, q, p);
}
