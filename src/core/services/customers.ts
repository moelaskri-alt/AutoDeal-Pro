import type { Db } from '../db/database';
import { type Ctx, can, requirePerm, today } from '../context';
import { fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, diff, nextNo, paged, type ListParams, type QuerySpec } from './common';
import { SQL_INSTALLMENT_STATUS } from '../calc/installments';
import { localDateTime } from '../calc/dates';

function validateCustomer(input: any) {
  const nid = V.str(input.national_id, 'الرقم القومي', { max: 20 });
  if (nid && !/^[0-9A-Za-z]{5,20}$/.test(nid)) fail('VALIDATION', 'الرقم القومي يجب أن يتكون من أرقام فقط.');
  return {
    name: V.reqStr(input.name, 'اسم العميل', 120),
    phone: V.phone(input.phone),
    phone2: V.phone(input.phone2, 'رقم الهاتف الإضافي'),
    national_id: nid,
    address: V.str(input.address, 'العنوان', { max: 300 }),
    email: V.email(input.email),
    customer_type: V.oneOf(input.customer_type, ['individual', 'company'] as const, 'نوع العميل', 'individual'),
    notes: V.str(input.notes, 'ملاحظات', { max: 2000 }),
  };
}

export function insertCustomer(db: Db, ctx: Ctx, input: any): { id: number; code: string } {
  const c = validateCustomer(input);
  if (c.national_id && db.scalar('SELECT COUNT(*) FROM customers WHERE national_id = ? AND deleted_at IS NULL', [c.national_id])) {
    fail('DUPLICATE', 'الرقم القومي مسجل مسبقاً لعميل آخر.');
  }
  const code = nextNo(db, 'customer', today(ctx));
  const id = db.run(
    `INSERT INTO customers(code, name, phone, phone2, national_id, address, email, customer_type, notes, created_by)
     VALUES (:code,:name,:phone,:phone2,:national_id,:address,:email,:customer_type,:notes,:created_by)`,
    { ...c, code, created_by: ctx.user.id || null },
  ).lastId;
  audit(db, ctx, { action: 'create', module: 'customers', record_type: 'customer', record_id: id, label: `${code} ${c.name}`, new: c });
  return { id, code };
}

export function createCustomer(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'customers.manage');
  return db.tx(() => insertCustomer(db, ctx, input));
}

export function updateCustomer(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'customers.manage');
  const id = V.id(input.id, 'العميل');
  const old = db.get<any>('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'العميل غير موجود.');
  const c = validateCustomer(input);
  if (c.national_id && db.scalar('SELECT COUNT(*) FROM customers WHERE national_id = ? AND deleted_at IS NULL AND id <> ?', [c.national_id, id])) {
    fail('DUPLICATE', 'الرقم القومي مسجل مسبقاً لعميل آخر.');
  }
  return db.tx(() => {
    db.run(
      `UPDATE customers SET name=:name, phone=:phone, phone2=:phone2, national_id=:national_id, address=:address, email=:email,
         customer_type=:customer_type, notes=:notes, updated_at=:now WHERE id=:id`,
      { ...c, now: localDateTime(), id },
    );
    const d = diff(old, c);
    if (d) audit(db, ctx, { action: 'update', module: 'customers', record_type: 'customer', record_id: id, label: old.code, ...d });
    return { id };
  });
}

export function deleteCustomer(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'customers.delete');
  const id = V.id(input.id, 'العميل');
  const old = db.get<any>('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'العميل غير موجود.');
  const tx =
    db.scalar<number>('SELECT COUNT(*) FROM sales WHERE customer_id = ?', [id]) +
    db.scalar<number>('SELECT COUNT(*) FROM payments WHERE customer_id = ?', [id]) +
    db.scalar<number>('SELECT COUNT(*) FROM reservations WHERE customer_id = ?', [id]) +
    db.scalar<number>('SELECT COUNT(*) FROM quotations WHERE customer_id = ?', [id]) +
    db.scalar<number>('SELECT COUNT(*) FROM trade_ins WHERE customer_id = ?', [id]);
  if (tx) fail('IN_USE', 'لا يمكن حذف العميل لأن لديه معاملات مسجلة (عروض أسعار أو حجوزات أو مبيعات أو مدفوعات).');
  return db.tx(() => {
    db.run('UPDATE customers SET deleted_at = ? WHERE id = ?', [localDateTime(), id]);
    audit(db, ctx, { action: 'delete', module: 'customers', record_type: 'customer', record_id: id, label: `${old.code} ${old.name}`, old });
    return { ok: true };
  });
}

/** Outstanding balance per customer = remaining of active installments. */
const BALANCE_SQL = `COALESCE((SELECT SUM(i.amount - i.paid_amount - i.waived_amount) FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id
   WHERE ic.customer_id = c.id AND ic.status = 'active' AND i.is_cancelled = 0), 0)`;
const OVERDUE_SQL = `COALESCE((SELECT SUM(i.amount - i.paid_amount - i.waived_amount) FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id
   WHERE ic.customer_id = c.id AND ic.status = 'active' AND i.is_cancelled = 0 AND i.due_date < :today), 0)`;

export function listCustomers(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'customers.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: `c.id, c.code, c.name, c.phone, c.national_id, c.customer_type, c.address, c.email, c.created_at,
             (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status = 'active') AS sales_count,
             ${BALANCE_SQL} AS balance, ${OVERDUE_SQL} AS overdue`,
    from: 'customers c',
    where: ['c.deleted_at IS NULL'],
    params: { today: today(ctx) },
    sortable: { name: 'c.name', code: 'c.code', balance: 'balance', overdue: 'overdue', created_at: 'c.created_at' },
    defaultSort: 'c.id DESC',
  };
  addSearch(q, p.search, ['c.name', 'c.code', 'c.phone', 'c.phone2', 'c.national_id', 'c.email']);
  addEq(q, 'c.customer_type', 'customer_type', f.customer_type);
  if (f.debtors) q.where.push(`${BALANCE_SQL} > 0`);
  if (f.overdue) q.where.push(`${OVERDUE_SQL} > 0`);
  return paged(db, q, p);
}

/** Lightweight lookup for select boxes. */
export function lookupCustomers(db: Db, ctx: Ctx, input: { search?: string } = {}) {
  requirePerm(ctx, 'customers.view');
  const s = `%${(input.search ?? '').trim()}%`;
  return db.all(
    `SELECT id, code, name, phone, national_id FROM customers WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ? OR code LIKE ? OR national_id LIKE ?) ORDER BY name LIMIT 50`,
    [s, s, s, s],
  );
}

/** Customer 360 view. */
export function getCustomer(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'customers.view');
  const id = V.id(input.id, 'العميل');
  const t = today(ctx);
  const customer = db.get<any>(`SELECT c.*, ${BALANCE_SQL} AS balance, ${OVERDUE_SQL} AS overdue FROM customers c WHERE c.id = :id`, { id, today: t });
  if (!customer) fail('NOT_FOUND', 'العميل غير موجود.');
  const leads = db.all(
    `SELECT l.id, l.status, l.source, l.interest, l.created_at, v.stock_no, v.brand, v.model, v.model_year FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id WHERE l.customer_id = ? AND l.deleted_at IS NULL ORDER BY l.id DESC`,
    [id],
  );
  const quotations = db.all(
    `SELECT q.id, q.quote_no, q.quote_date, q.final_price, q.status, q.valid_until, v.stock_no, v.brand, v.model, v.model_year FROM quotations q JOIN vehicles v ON v.id = q.vehicle_id WHERE q.customer_id = ? ORDER BY q.id DESC`,
    [id],
  );
  const reservations = db.all(
    `SELECT r.id, r.reservation_no, r.reservation_date, r.expiry_date, r.amount, r.status, v.stock_no, v.brand, v.model FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? ORDER BY r.id DESC`,
    [id],
  );
  const sales = db.all(
    `SELECT s.id, s.sale_no, s.sale_date, s.sale_type, s.total_contract_value, s.financed_amount, s.status, v.stock_no, v.brand, v.model, v.model_year, ic.id AS contract_id, ic.contract_no
     FROM sales s JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN installment_contracts ic ON ic.sale_id = s.id WHERE s.customer_id = ? ORDER BY s.id DESC`,
    [id],
  );
  const payments = db.all(
    `SELECT p.id, p.receipt_no, p.pay_date, p.kind, p.amount, p.method, p.status, p.reference FROM payments p WHERE p.customer_id = ? ORDER BY p.pay_date DESC, p.id DESC`,
    [id],
  );
  const installments = db.all(
    `SELECT i.id, i.seq, i.due_date, i.amount, i.paid_amount, i.waived_amount, i.amount - i.paid_amount - i.waived_amount AS remaining,
            ${SQL_INSTALLMENT_STATUS('i')} AS status,
            CASE WHEN i.due_date < :today AND i.amount - i.paid_amount - i.waived_amount > 0 THEN CAST(julianday(:today) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue,
            ic.contract_no, ic.id AS contract_id
     FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id
     WHERE ic.customer_id = :id AND i.is_cancelled = 0 AND ic.status <> 'cancelled' ORDER BY i.due_date, i.seq`,
    { id, today: t },
  );
  const tradeIns = db.all(
    `SELECT t.id, t.trade_no, t.brand, t.model, t.model_year, t.trade_in_value, t.status, t.eval_date FROM trade_ins t WHERE t.customer_id = ? ORDER BY t.id DESC`,
    [id],
  );
  const summary = {
    total_purchases: sales.filter((s: any) => s.status === 'active').reduce((a: number, s: any) => a + s.total_contract_value, 0),
    total_paid: payments.filter((p: any) => p.status === 'valid' && p.kind !== 'refund').reduce((a: number, p: any) => a + p.amount, 0),
    balance: customer.balance,
    overdue: customer.overdue,
    overdue_count: installments.filter((i: any) => i.status === 'overdue').length,
  };
  return { customer, leads, quotations, reservations, sales, payments, installments, tradeIns, summary };
}

/**
 * Customer statement (ledger). Debits: sale contract value, refunds. Credits: trade-in value,
 * all valid payments and early-settlement waivers. Running balance > 0 means the customer owes.
 */
export function customerStatement(db: Db, ctx: Ctx, input: { id: number; from?: string; to?: string }) {
  requirePerm(ctx, 'customers.view');
  const id = V.id(input.id, 'العميل');
  const customer = db.get<any>('SELECT id, code, name, phone, national_id, address FROM customers WHERE id = ?', [id]);
  if (!customer) fail('NOT_FOUND', 'العميل غير موجود.');
  const KIND: Record<string, string> = {
    reservation: 'عربون حجز',
    down_payment: 'دفعة مقدمة',
    cash_sale: 'سداد نقدي',
    installment: 'تحصيل قسط',
    early_settlement: 'سداد مبكر',
    refund: 'رد مبلغ للعميل',
  };
  const rows: { date: string; ref: string; description: string; debit: number; credit: number; order: number }[] = [];
  for (const s of db.all<any>(
    `SELECT s.*, v.brand, v.model, v.model_year, v.stock_no FROM sales s JOIN vehicles v ON v.id = s.vehicle_id WHERE s.customer_id = ? AND s.status = 'active'`,
    [id],
  )) {
    rows.push({ date: s.sale_date, ref: s.sale_no, description: `بيع سيارة ${s.brand} ${s.model} ${s.model_year} (${s.stock_no})`, debit: s.total_contract_value, credit: 0, order: 1 });
    if (s.trade_in_value > 0) rows.push({ date: s.sale_date, ref: s.sale_no, description: 'قيمة سيارة الاستبدال', debit: 0, credit: s.trade_in_value, order: 2 });
  }
  for (const p of db.all<any>(
    `SELECT p.* FROM payments p LEFT JOIN sales s ON s.id = p.sale_id WHERE p.customer_id = ? AND p.status = 'valid' AND (p.sale_id IS NULL OR s.status = 'active')`,
    [id],
  )) {
    if (p.kind === 'refund') rows.push({ date: p.pay_date, ref: p.receipt_no, description: KIND.refund, debit: p.amount, credit: 0, order: 3 });
    else rows.push({ date: p.pay_date, ref: p.receipt_no, description: KIND[p.kind] ?? 'دفعة', debit: 0, credit: p.amount, order: 3 });
  }
  for (const w of db.all<any>(
    `SELECT ic.contract_no, COALESCE(ic.settled_at, date('now')) AS d, SUM(i.waived_amount) AS w FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id
     WHERE ic.customer_id = ? AND i.waived_amount > 0 GROUP BY ic.id`,
    [id],
  )) {
    rows.push({ date: String(w.d).slice(0, 10), ref: w.contract_no, description: 'خصم سداد مبكر', debit: 0, credit: w.w, order: 4 });
  }
  rows.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
  let bal = 0;
  let opening = 0;
  const out: any[] = [];
  for (const r of rows) {
    bal += r.debit - r.credit;
    if (input.from && r.date < input.from) {
      opening = bal;
      continue;
    }
    if (input.to && r.date > input.to) continue;
    out.push({ ...r, balance: bal });
  }
  const totalDebit = out.reduce((a, r) => a + r.debit, 0);
  const totalCredit = out.reduce((a, r) => a + r.credit, 0);
  return { customer, opening, rows: out, totalDebit, totalCredit, closing: opening + totalDebit - totalCredit };
}

// ------------------------------------------------------------------ leads (CRM)

export const LEAD_STATUSES = ['new', 'contacted', 'interested', 'negotiating', 'reserved', 'won', 'lost'] as const;
export const LEAD_SOURCES = ['walk_in', 'facebook', 'instagram', 'website', 'referral', 'advertisement', 'other'] as const;

function validateLead(input: any) {
  return {
    name: V.reqStr(input.name, 'الاسم', 120),
    phone: V.phone(input.phone),
    customer_id: V.optId(input.customer_id),
    source: V.oneOf(input.source, LEAD_SOURCES, 'مصدر العميل', 'walk_in'),
    status: V.oneOf(input.status, LEAD_STATUSES, 'الحالة', 'new'),
    vehicle_id: V.optId(input.vehicle_id),
    interest: V.str(input.interest, 'الاهتمام', { max: 300 }),
    budget: input.budget === undefined || input.budget === null || input.budget === '' ? null : V.money(input.budget, 'الميزانية', { allowZero: true }),
    assigned_to: V.optId(input.assigned_to),
    next_follow_up: V.date(input.next_follow_up, 'موعد المتابعة القادم', false),
    lost_reason: V.str(input.lost_reason, 'سبب الخسارة', { max: 300 }),
    notes: V.str(input.notes, 'ملاحظات', { max: 2000 }),
  };
}

export function listLeads(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'leads.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: `l.*, v.stock_no, v.brand, v.model, v.model_year, u.full_name AS assigned_name, c.code AS customer_code,
             (SELECT COUNT(*) FROM follow_ups fu WHERE fu.lead_id = l.id) AS follow_ups_count`,
    from: 'leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN customers c ON c.id = l.customer_id',
    where: ['l.deleted_at IS NULL'],
    params: {},
    sortable: { created_at: 'l.created_at', name: 'l.name', status: 'l.status', next_follow_up: 'l.next_follow_up' },
    defaultSort: 'l.id DESC',
  };
  addSearch(q, p.search, ['l.name', 'l.phone', 'l.interest', 'v.brand', 'v.model']);
  addEq(q, 'l.status', 'status', f.status);
  addEq(q, 'l.source', 'source', f.source);
  addEq(q, 'l.assigned_to', 'assigned_to', f.assigned_to);
  addDateRange(q, 'date(l.created_at)', f.from, f.to);
  if (f.due_follow_up) {
    q.where.push(`l.next_follow_up IS NOT NULL AND l.next_follow_up <= :today AND l.status NOT IN ('won','lost')`);
    q.params.today = today(ctx);
  }
  return paged(db, q, p);
}

export function getLead(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'leads.view');
  const id = V.id(input.id, 'العميل المحتمل');
  const lead = db.get<any>(
    `SELECT l.*, v.stock_no, v.brand, v.model, v.model_year, u.full_name AS assigned_name FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = ? AND l.deleted_at IS NULL`,
    [id],
  );
  if (!lead) fail('NOT_FOUND', 'العميل المحتمل غير موجود.');
  const followUps = db.all(`SELECT f.*, u.full_name AS user_name FROM follow_ups f LEFT JOIN users u ON u.id = f.created_by WHERE f.lead_id = ? ORDER BY f.follow_date DESC, f.id DESC`, [id]);
  return { lead, followUps };
}

export function createLead(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'leads.manage');
  const l = validateLead(input);
  return db.tx(() => {
    const id = db.run(
      `INSERT INTO leads(name, phone, customer_id, source, status, vehicle_id, interest, budget, assigned_to, next_follow_up, lost_reason, notes, created_by)
       VALUES (:name,:phone,:customer_id,:source,:status,:vehicle_id,:interest,:budget,:assigned_to,:next_follow_up,:lost_reason,:notes,:created_by)`,
      { ...l, created_by: ctx.user.id || null },
    ).lastId;
    audit(db, ctx, { action: 'create', module: 'leads', record_type: 'lead', record_id: id, label: l.name, new: l });
    return { id };
  });
}

export function updateLead(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'leads.manage');
  const id = V.id(input.id, 'العميل المحتمل');
  const old = db.get<any>('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'العميل المحتمل غير موجود.');
  const l = validateLead(input);
  if (l.status === 'lost' && !l.lost_reason) fail('VALIDATION', 'يرجى إدخال سبب خسارة العميل.');
  return db.tx(() => {
    db.run(
      `UPDATE leads SET name=:name, phone=:phone, customer_id=:customer_id, source=:source, status=:status, vehicle_id=:vehicle_id, interest=:interest,
         budget=:budget, assigned_to=:assigned_to, next_follow_up=:next_follow_up, lost_reason=:lost_reason, notes=:notes, updated_at=:now WHERE id=:id`,
      { ...l, now: localDateTime(), id },
    );
    const d = diff(old, l);
    if (d) audit(db, ctx, { action: 'update', module: 'leads', record_type: 'lead', record_id: id, label: l.name, ...d });
    return { id };
  });
}

export function deleteLead(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'leads.manage');
  const id = V.id(input.id, 'العميل المحتمل');
  const old = db.get<any>('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'العميل المحتمل غير موجود.');
  return db.tx(() => {
    db.run('UPDATE leads SET deleted_at = ? WHERE id = ?', [localDateTime(), id]);
    audit(db, ctx, { action: 'delete', module: 'leads', record_type: 'lead', record_id: id, label: old.name, old });
    return { ok: true };
  });
}

export function addFollowUp(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'leads.manage');
  const lead_id = V.id(input.lead_id, 'العميل المحتمل');
  const lead = db.get<any>('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL', [lead_id]);
  if (!lead) fail('NOT_FOUND', 'العميل المحتمل غير موجود.');
  const f = {
    follow_date: V.reqDate(input.follow_date ?? today(ctx), 'تاريخ المتابعة'),
    method: V.oneOf(input.method, ['call', 'visit', 'whatsapp', 'message', 'email', 'other'] as const, 'وسيلة المتابعة', 'call'),
    notes: V.reqStr(input.notes, 'نتيجة المتابعة', 2000),
    next_follow_up: V.date(input.next_follow_up, 'موعد المتابعة القادم', false),
  };
  const newStatus = input.status ? V.oneOf(input.status, LEAD_STATUSES, 'الحالة') : lead.status === 'new' ? 'contacted' : lead.status;
  return db.tx(() => {
    const id = db.run('INSERT INTO follow_ups(lead_id, follow_date, method, notes, next_follow_up, created_by) VALUES (?,?,?,?,?,?)', [
      lead_id,
      f.follow_date,
      f.method,
      f.notes,
      f.next_follow_up,
      ctx.user.id || null,
    ]).lastId;
    db.run('UPDATE leads SET next_follow_up = ?, status = ?, updated_at = ? WHERE id = ?', [f.next_follow_up, newStatus, localDateTime(), lead_id]);
    audit(db, ctx, { action: 'follow_up', module: 'leads', record_type: 'lead', record_id: lead_id, label: lead.name, new: { ...f, status: newStatus } });
    return { id };
  });
}

/** Creates a customer from a lead (or links the existing one) so it can be quoted/reserved/sold. */
export function convertLeadToCustomer(db: Db, ctx: Ctx, input: { id: number; national_id?: string; address?: string }) {
  requirePerm(ctx, 'leads.manage');
  requirePerm(ctx, 'customers.manage');
  const id = V.id(input.id, 'العميل المحتمل');
  const lead = db.get<any>('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!lead) fail('NOT_FOUND', 'العميل المحتمل غير موجود.');
  if (lead.customer_id) return { customer_id: lead.customer_id };
  return db.tx(() => {
    const c = insertCustomer(db, ctx, { name: lead.name, phone: lead.phone, national_id: input.national_id, address: input.address, notes: lead.notes });
    db.run('UPDATE leads SET customer_id = ?, updated_at = ? WHERE id = ?', [c.id, localDateTime(), id]);
    return { customer_id: c.id };
  });
}

export function canViewCustomers(ctx: Ctx) {
  return can(ctx, 'customers.view');
}
