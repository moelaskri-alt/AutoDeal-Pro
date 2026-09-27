import type { Db } from '../db/database';
import { type Ctx, requirePerm, today } from '../context';
import { AppError, fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, nextNo, paged, type ListParams, type QuerySpec, getSettingNum } from './common';
import { allocateFifo, buildSchedule, SQL_INSTALLMENT_STATUS, type PlanInput, type ScheduleLine, type Allocation } from '../calc/installments';
import { addDays, localDateTime } from '../calc/dates';

const PAY_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const;

/** Validates plan input coming from the UI and builds the schedule for `total`. */
export function planFromInput(db: Db, raw: any, total: number): { plan: PlanInput; lines: ScheduleLine[] } {
  if (!raw || typeof raw !== 'object') fail('VALIDATION', 'يرجى تحديد نظام التقسيط.');
  const plan_type = V.oneOf(raw.plan_type, ['equal', 'custom', 'balloon'] as const, 'نظام التقسيط');
  const plan: PlanInput = { plan_type, total };
  if (plan_type === 'custom') {
    if (!Array.isArray(raw.lines)) fail('VALIDATION', 'يرجى إدخال جدول الأقساط.');
    plan.lines = raw.lines.map((l: any) => ({ due_date: l.due_date, amount: Number(l.amount) }));
  } else {
    plan.count = V.int(raw.count, 'عدد الأقساط', { min: plan_type === 'balloon' ? 2 : 1, max: 360, required: true }) as number;
    plan.first_due_date = V.reqDate(raw.first_due_date, 'تاريخ أول قسط');
    plan.interval_months = V.int(raw.interval_months ?? 1, 'الفترة بين الأقساط (بالشهور)', { min: 1, max: 12 }) ?? 1;
    if (plan_type === 'equal') plan.rounding = V.int(raw.rounding ?? getSettingNum(db, 'installment_rounding'), 'التقريب', { min: 1, max: 1000000 }) ?? 100;
    if (plan_type === 'balloon') plan.regular_amount = V.money(raw.regular_amount, 'قيمة القسط الدوري');
  }
  return { plan, lines: buildSchedule(plan) };
}

/** Preview a schedule without saving (used by the sale wizard and the reschedule dialog). */
export function previewSchedule(db: Db, ctx: Ctx, input: { total: number; plan: any }) {
  if (!ctx.perms.has('sales.create') && !ctx.perms.has('installments.manage')) requirePerm(ctx, 'sales.create');
  const total = V.money(input.total, 'المبلغ الممول');
  const { lines } = planFromInput(db, input.plan, total);
  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}

/** Creates a contract + schedule. Called inside the sale transaction. */
export function insertContract(db: Db, ctx: Ctx, sale: { id: number; customer_id: number; sale_date: string }, financed: number, rawPlan: any) {
  const { plan, lines } = planFromInput(db, rawPlan, financed);
  const contract_no = nextNo(db, 'contract', sale.sale_date);
  const id = db.run(
    `INSERT INTO installment_contracts(contract_no, sale_id, customer_id, financed_amount, plan_type, installments_count, first_due_date, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      contract_no,
      sale.id,
      sale.customer_id,
      financed,
      plan.plan_type,
      lines.length,
      lines[0].due_date,
      V.str(rawPlan.notes, 'ملاحظات', { max: 1000 }),
      ctx.user.id || null,
    ],
  ).lastId;
  for (const l of lines) {
    db.run('INSERT INTO installments(contract_id, seq, due_date, amount, schedule_version) VALUES (?,?,?,?,1)', [id, l.seq, l.due_date, l.amount]);
  }
  const check = db.scalar<number>('SELECT SUM(amount) FROM installments WHERE contract_id = ?', [id]);
  if (check !== financed) throw new AppError('SCHEDULE_TOTAL_MISMATCH', 'مجموع الأقساط لا يساوي المبلغ الممول.');
  return { id, contract_no, lines };
}

const CONTRACT_SELECT = `ic.id, ic.contract_no, ic.sale_id, ic.customer_id, ic.financed_amount, ic.plan_type, ic.installments_count, ic.first_due_date,
  ic.status, ic.schedule_version, ic.created_at, ic.settled_at, ic.notes,
  c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
  s.sale_no, s.sale_date, s.total_contract_value, s.down_payment, v.stock_no, v.brand, v.model, v.model_year, u.full_name AS salesperson,
  COALESCE((SELECT SUM(i.paid_amount) FROM installments i WHERE i.contract_id = ic.id), 0) AS paid,
  COALESCE((SELECT SUM(i.waived_amount) FROM installments i WHERE i.contract_id = ic.id AND i.is_cancelled = 0), 0) AS waived,
  COALESCE((SELECT SUM(i.amount - i.paid_amount - i.waived_amount) FROM installments i WHERE i.contract_id = ic.id AND i.is_cancelled = 0), 0) AS remaining,
  COALESCE((SELECT SUM(i.amount - i.paid_amount - i.waived_amount) FROM installments i WHERE i.contract_id = ic.id AND i.is_cancelled = 0 AND i.due_date < :today), 0) AS overdue_amount,
  (SELECT COUNT(*) FROM installments i WHERE i.contract_id = ic.id AND i.is_cancelled = 0 AND i.due_date < :today AND i.amount - i.paid_amount - i.waived_amount > 0) AS overdue_count,
  (SELECT MIN(i.due_date) FROM installments i WHERE i.contract_id = ic.id AND i.is_cancelled = 0 AND i.amount - i.paid_amount - i.waived_amount > 0) AS next_due_date`;

const CONTRACT_FROM = `installment_contracts ic JOIN customers c ON c.id = ic.customer_id JOIN sales s ON s.id = ic.sale_id
  JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN users u ON u.id = s.salesperson_id`;

export function listContracts(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'installments.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: CONTRACT_SELECT,
    from: CONTRACT_FROM,
    where: [],
    params: { today: today(ctx) },
    sortable: {
      contract_no: 'ic.contract_no',
      customer_name: 'c.name',
      remaining: 'remaining',
      overdue_amount: 'overdue_amount',
      next_due_date: 'next_due_date',
      sale_date: 's.sale_date',
    },
    defaultSort: 'ic.id DESC',
    totals: 'COUNT(*) AS count, SUM(financed_amount) AS financed_amount, SUM(paid) AS paid, SUM(remaining) AS remaining, SUM(overdue_amount) AS overdue_amount',
    groupBy: 'ic.id',
  };
  addSearch(q, p.search, ['ic.contract_no', 'c.name', 'c.phone', 's.sale_no', 'v.stock_no', 'v.brand', 'v.model']);
  addEq(q, 'ic.status', 'status', f.status);
  addEq(q, 'ic.customer_id', 'customer_id', f.customer_id);
  addEq(q, 's.salesperson_id', 'salesperson_id', f.salesperson_id);
  addDateRange(q, 's.sale_date', f.from, f.to);
  if (f.overdue)
    q.where.push(
      `EXISTS (SELECT 1 FROM installments i WHERE i.contract_id = ic.id AND i.is_cancelled = 0 AND i.due_date < :today AND i.amount - i.paid_amount - i.waived_amount > 0)`,
    );
  return paged(db, q, p);
}

export function getContract(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'installments.view');
  const id = V.id(input.id, 'العقد');
  const t = today(ctx);
  const contract = db.get<any>(`SELECT ${CONTRACT_SELECT}, c.national_id, c.address AS customer_address FROM ${CONTRACT_FROM} WHERE ic.id = :id`, {
    id,
    today: t,
  });
  if (!contract) fail('NOT_FOUND', 'العقد غير موجود.');
  const schedule = db.all(
    `SELECT i.id, i.seq, i.due_date, i.amount, i.paid_amount, i.waived_amount, i.is_cancelled, i.schedule_version, i.paid_at, i.notes,
            i.amount - i.paid_amount - i.waived_amount AS remaining, ${SQL_INSTALLMENT_STATUS('i')} AS status,
            CASE WHEN i.is_cancelled = 0 AND i.due_date < :today AND i.amount - i.paid_amount - i.waived_amount > 0
                 THEN CAST(julianday(:today) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue
     FROM installments i WHERE i.contract_id = :id ORDER BY i.is_cancelled, i.due_date, i.seq`,
    { id, today: t },
  );
  const payments = db.all(
    `SELECT p.id, p.receipt_no, p.pay_date, p.kind, p.amount, p.method, p.reference, p.status, p.void_reason, u.full_name AS user_name,
            (SELECT GROUP_CONCAT(i.seq, '، ') FROM payment_allocations a JOIN installments i ON i.id = a.installment_id WHERE a.payment_id = p.id) AS installments
     FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.contract_id = ? OR (p.sale_id = ? AND p.kind IN ('down_payment','reservation'))
     ORDER BY p.pay_date, p.id`,
    [id, contract.sale_id],
  );
  const reschedules = db.all(
    `SELECT r.*, u.full_name AS user_name FROM reschedules r LEFT JOIN users u ON u.id = r.user_id WHERE r.contract_id = ? ORDER BY r.id DESC`,
    [id],
  );
  return { contract, schedule, payments, reschedules };
}

/** Installment-level list used by the collections screen (due today / next 7 days / overdue ...). */
export function listInstallments(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'installments.view');
  const f = p.filters ?? {};
  const t = today(ctx);
  const q: QuerySpec = {
    select: `i.id, i.seq, i.due_date, i.amount, i.paid_amount, i.waived_amount, i.amount - i.paid_amount - i.waived_amount AS remaining,
             ${SQL_INSTALLMENT_STATUS('i')} AS status,
             CASE WHEN i.due_date < :today AND i.amount - i.paid_amount - i.waived_amount > 0 THEN CAST(julianday(:today) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue,
             ic.id AS contract_id, ic.contract_no, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
             v.brand, v.model, v.stock_no, u.full_name AS salesperson`,
    from: `installments i JOIN installment_contracts ic ON ic.id = i.contract_id JOIN customers c ON c.id = ic.customer_id
           JOIN sales s ON s.id = ic.sale_id JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN users u ON u.id = s.salesperson_id`,
    where: ['i.is_cancelled = 0', "ic.status <> 'cancelled'"],
    params: { today: t },
    sortable: { due_date: 'i.due_date', remaining: 'remaining', customer_name: 'c.name', days_overdue: 'days_overdue', amount: 'i.amount' },
    defaultSort: 'i.due_date, i.seq',
    totals: 'COUNT(*) AS count, SUM(i.amount) AS amount, SUM(i.paid_amount) AS paid_amount, SUM(i.amount - i.paid_amount - i.waived_amount) AS remaining',
  };
  addSearch(q, p.search, ['c.name', 'c.phone', 'ic.contract_no', 'v.stock_no']);
  addEq(q, 'ic.customer_id', 'customer_id', f.customer_id);
  addEq(q, 'ic.id', 'contract_id', f.contract_id);
  addEq(q, 's.salesperson_id', 'salesperson_id', f.salesperson_id);
  addDateRange(q, 'i.due_date', f.from, f.to);
  const OPEN = 'i.amount - i.paid_amount - i.waived_amount > 0';
  switch (f.status) {
    case 'overdue':
      q.where.push(`i.due_date < :today AND ${OPEN}`);
      break;
    case 'due_today':
      q.where.push(`i.due_date = :today AND ${OPEN}`);
      break;
    case 'next7':
      q.where.push(`i.due_date >= :today AND i.due_date <= :d7 AND ${OPEN}`);
      q.params.d7 = addDays(t, 7);
      break;
    case 'open':
      q.where.push(OPEN);
      break;
    case 'partially_paid':
      q.where.push(`i.paid_amount > 0 AND ${OPEN}`);
      break;
    case 'paid':
      q.where.push(`i.amount - i.paid_amount - i.waived_amount <= 0`);
      break;
    case 'not_due':
      q.where.push(`i.due_date > :today AND ${OPEN}`);
      break;
  }
  return paged(db, q, p);
}

// ------------------------------------------------------------------ payments

export function insertPayment(
  db: Db,
  ctx: Ctx,
  p: {
    customer_id: number;
    sale_id?: number | null;
    contract_id?: number | null;
    reservation_id?: number | null;
    kind: string;
    pay_date: string;
    amount: number;
    method: string;
    reference?: string | null;
    notes?: string | null;
  },
): { id: number; receipt_no: string } {
  const receipt_no = nextNo(db, 'receipt', p.pay_date);
  const id = db.run(
    `INSERT INTO payments(receipt_no, customer_id, sale_id, contract_id, reservation_id, kind, pay_date, amount, method, reference, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      receipt_no,
      p.customer_id,
      p.sale_id ?? null,
      p.contract_id ?? null,
      p.reservation_id ?? null,
      p.kind,
      p.pay_date,
      p.amount,
      p.method,
      p.reference ?? null,
      p.notes ?? null,
      ctx.user.id || null,
    ],
  ).lastId;
  return { id, receipt_no };
}

function openInstallments(db: Db, contractId: number) {
  return db.all<{ id: number; seq: number; due_date: string; remaining: number }>(
    `SELECT id, seq, due_date, amount - paid_amount - waived_amount AS remaining FROM installments
     WHERE contract_id = ? AND is_cancelled = 0 AND amount - paid_amount - waived_amount > 0 ORDER BY due_date, seq`,
    [contractId],
  );
}

function refreshContractStatus(db: Db, contractId: number, payDate: string) {
  const rem = db.scalar<number>('SELECT COALESCE(SUM(amount - paid_amount - waived_amount),0) FROM installments WHERE contract_id = ? AND is_cancelled = 0', [
    contractId,
  ]);
  db.run(
    `UPDATE installments SET paid_at = CASE WHEN amount - paid_amount - waived_amount <= 0 THEN COALESCE(paid_at, ?) ELSE NULL END WHERE contract_id = ?`,
    [payDate, contractId],
  );
  if (rem <= 0) db.run(`UPDATE installment_contracts SET status = 'settled', settled_at = ? WHERE id = ? AND status = 'active'`, [payDate, contractId]);
  else db.run(`UPDATE installment_contracts SET status = 'active', settled_at = NULL WHERE id = ? AND status = 'settled'`, [contractId]);
  return rem;
}

/**
 * Records a collection against a contract.
 *  - mode 'auto' (default): oldest outstanding installment first.
 *  - mode 'manual': the chosen installments (in the given order); any surplus is rejected unless
 *    allow_spillover=true, in which case it continues oldest-first (advance payment on later installments).
 * A payment may never exceed the contract's outstanding balance.
 */
export function recordPayment(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'payments.create');
  const contract_id = V.id(input.contract_id, 'العقد');
  const amount = V.money(input.amount, 'المبلغ');
  const pay_date = V.reqDate(input.pay_date ?? today(ctx), 'تاريخ التحصيل');
  const method = V.oneOf(input.method, PAY_METHODS, 'طريقة الدفع', 'cash');
  const reference = V.str(input.reference, 'المرجع', { max: 80 });
  if ((method === 'cheque' || method === 'bank_transfer') && !reference) fail('VALIDATION', 'يرجى إدخال رقم الشيك / التحويل في خانة المرجع.');
  const notes = V.str(input.notes, 'ملاحظات', { max: 1000 });
  const mode = V.oneOf(input.mode, ['auto', 'manual'] as const, 'طريقة التوزيع', 'auto');
  const contract = db.get<any>('SELECT * FROM installment_contracts WHERE id = ?', [contract_id]);
  if (!contract) fail('NOT_FOUND', 'العقد غير موجود.');
  if (contract.status !== 'active') fail('VALIDATION', contract.status === 'settled' ? 'هذا العقد مسدد بالكامل.' : 'هذا العقد ملغي.');

  return db.tx(() => {
    const open = openInstallments(db, contract_id);
    const outstanding = open.reduce((a, i) => a + i.remaining, 0);
    if (amount > outstanding) {
      throw new AppError('OVERPAYMENT', `المبلغ (${amount / 100}) يتجاوز الرصيد المتبقي على العقد (${outstanding / 100}).`, { outstanding });
    }
    let allocations: Allocation[] = [];
    if (mode === 'manual') {
      const ids: number[] = Array.isArray(input.installment_ids) ? input.installment_ids.map(Number) : [];
      if (!ids.length) fail('VALIDATION', 'يرجى اختيار القسط المراد السداد عليه.');
      let left = amount;
      for (const iid of ids) {
        const inst = open.find((o) => o.id === iid);
        if (!inst) fail('VALIDATION', 'القسط المحدد غير موجود أو مسدد بالكامل.');
        if (left <= 0) break;
        const a = Math.min(left, inst!.remaining);
        allocations.push({ installment_id: iid, amount: a });
        left -= a;
      }
      if (left > 0) {
        if (!input.allow_spillover) {
          throw new AppError('OVERPAYMENT', 'المبلغ أكبر من المتبقي على القسط المحدد. فعّل خيار "توزيع الزيادة على الأقساط التالية" أو عدّل المبلغ.');
        }
        const rest = open.filter((o) => !ids.includes(o.id));
        const r = allocateFifo(rest, left);
        allocations = allocations.concat(r.allocations);
        left = r.unallocated;
      }
      if (left > 0) fail('OVERPAYMENT', 'تعذر توزيع كامل المبلغ على الأقساط.');
    } else {
      const r = allocateFifo(open, amount);
      if (r.unallocated > 0) fail('OVERPAYMENT', 'تعذر توزيع كامل المبلغ على الأقساط.');
      allocations = r.allocations;
    }
    const pay = insertPayment(db, ctx, {
      customer_id: contract.customer_id,
      sale_id: contract.sale_id,
      contract_id,
      kind: 'installment',
      pay_date,
      amount,
      method,
      reference,
      notes,
    });
    for (const a of allocations)
      db.run('INSERT INTO payment_allocations(payment_id, installment_id, amount) VALUES (?,?,?)', [pay.id, a.installment_id, a.amount]);
    const remaining = refreshContractStatus(db, contract_id, pay_date);
    audit(db, ctx, {
      action: 'payment',
      module: 'payments',
      record_type: 'payment',
      record_id: pay.id,
      label: `${pay.receipt_no} / ${contract.contract_no}`,
      new: { amount, pay_date, method, mode, allocations },
    });
    return { id: pay.id, receipt_no: pay.receipt_no, allocations, contract_remaining: remaining };
  });
}

/** Early settlement: pays the full outstanding balance, optionally with a settlement discount (waiver). */
export function earlySettlement(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'payments.create');
  const contract_id = V.id(input.contract_id, 'العقد');
  const discount = V.optMoney(input.discount, 'خصم السداد المبكر');
  if (discount > 0) requirePerm(ctx, 'installments.manage');
  const pay_date = V.reqDate(input.pay_date ?? today(ctx), 'تاريخ السداد');
  const method = V.oneOf(input.method, PAY_METHODS, 'طريقة الدفع', 'cash');
  const reference = V.str(input.reference, 'المرجع', { max: 80 });
  const contract = db.get<any>('SELECT * FROM installment_contracts WHERE id = ?', [contract_id]);
  if (!contract) fail('NOT_FOUND', 'العقد غير موجود.');
  if (contract.status !== 'active') fail('VALIDATION', 'لا يمكن السداد المبكر لعقد غير نشط.');
  return db.tx(() => {
    const open = openInstallments(db, contract_id);
    const outstanding = open.reduce((a, i) => a + i.remaining, 0);
    if (discount >= outstanding) fail('VALIDATION', 'قيمة الخصم يجب أن تكون أقل من الرصيد المتبقي.');
    const amount = outstanding - discount;
    const pay = insertPayment(db, ctx, {
      customer_id: contract.customer_id,
      sale_id: contract.sale_id,
      contract_id,
      kind: 'early_settlement',
      pay_date,
      amount,
      method,
      reference,
      notes: V.str(input.notes, 'ملاحظات', { max: 1000 }) ?? (discount ? `خصم سداد مبكر: ${discount / 100}` : null),
    });
    const { allocations } = allocateFifo(open, amount);
    for (const a of allocations)
      db.run('INSERT INTO payment_allocations(payment_id, installment_id, amount) VALUES (?,?,?)', [pay.id, a.installment_id, a.amount]);
    if (discount > 0) {
      db.run(
        'UPDATE installments SET waived_amount = waived_amount + (amount - paid_amount - waived_amount) WHERE contract_id = ? AND is_cancelled = 0 AND amount - paid_amount - waived_amount > 0',
        [contract_id],
      );
    }
    refreshContractStatus(db, contract_id, pay_date);
    audit(db, ctx, {
      action: 'early_settlement',
      module: 'installments',
      record_type: 'contract',
      record_id: contract_id,
      label: contract.contract_no,
      new: { outstanding, discount, amount, receipt: pay.receipt_no },
    });
    return { id: pay.id, receipt_no: pay.receipt_no, amount, discount };
  });
}

export function voidPayment(db: Db, ctx: Ctx, input: { id: number; reason: string }) {
  requirePerm(ctx, 'payments.void');
  const id = V.id(input.id, 'الدفعة');
  const reason = V.reqStr(input.reason, 'سبب الإلغاء', 300);
  const p = db.get<any>('SELECT * FROM payments WHERE id = ?', [id]);
  if (!p) fail('NOT_FOUND', 'الدفعة غير موجودة.');
  if (p.status === 'voided') fail('VALIDATION', 'هذه الدفعة ملغاة بالفعل.');
  if (!['installment', 'early_settlement'].includes(p.kind)) {
    fail('VALIDATION', 'دفعات الحجز والمقدم والسداد النقدي تُلغى من خلال إلغاء الحجز أو إلغاء البيع.');
  }
  return db.tx(() => {
    const allocs = db.all('SELECT installment_id, amount FROM payment_allocations WHERE payment_id = ?', [id]);
    db.run('DELETE FROM payment_allocations WHERE payment_id = ?', [id]);
    if (p.kind === 'early_settlement') db.run('UPDATE installments SET waived_amount = 0 WHERE contract_id = ?', [p.contract_id]);
    db.run(`UPDATE payments SET status = 'voided', void_reason = ?, voided_at = ? WHERE id = ?`, [reason, localDateTime(), id]);
    refreshContractStatus(db, p.contract_id, p.pay_date);
    audit(db, ctx, {
      action: 'void',
      module: 'payments',
      record_type: 'payment',
      record_id: id,
      label: p.receipt_no,
      old: { ...p, allocations: allocs },
      details: reason,
    });
    return { ok: true };
  });
}

export function listPayments(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'payments.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: `p.id, p.receipt_no, p.pay_date, p.kind, p.amount, p.method, p.reference, p.status, p.notes, p.void_reason,
             c.id AS customer_id, c.name AS customer_name, ic.contract_no, s.sale_no, r.reservation_no, u.full_name AS user_name`,
    from: `payments p JOIN customers c ON c.id = p.customer_id LEFT JOIN installment_contracts ic ON ic.id = p.contract_id
           LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN reservations r ON r.id = p.reservation_id LEFT JOIN users u ON u.id = p.created_by`,
    where: [],
    params: {},
    sortable: { pay_date: 'p.pay_date', amount: 'p.amount', customer_name: 'c.name', receipt_no: 'p.receipt_no' },
    defaultSort: 'p.pay_date DESC, p.id DESC',
    totals: `COUNT(*) AS count, SUM(CASE WHEN p.status = 'valid' AND p.kind <> 'refund' THEN p.amount ELSE 0 END) AS collected,
             SUM(CASE WHEN p.status = 'valid' AND p.kind = 'refund' THEN p.amount ELSE 0 END) AS refunded`,
  };
  addSearch(q, p.search, ['p.receipt_no', 'c.name', 'c.phone', 'p.reference', 'ic.contract_no', 's.sale_no']);
  addEq(q, 'p.customer_id', 'customer_id', f.customer_id);
  addEq(q, 'p.contract_id', 'contract_id', f.contract_id);
  addEq(q, 'p.kind', 'kind', f.kind);
  addEq(q, 'p.method', 'method', f.method);
  addEq(q, 'p.status', 'pstatus', f.status);
  addEq(q, 's.salesperson_id', 'salesperson_id', f.salesperson_id);
  addDateRange(q, 'p.pay_date', f.from, f.to);
  return paged(db, q, p);
}

export function getPayment(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'payments.view');
  const id = V.id(input.id, 'الدفعة');
  const payment = db.get<any>(
    `SELECT p.*, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone, c.national_id, ic.contract_no, s.sale_no, r.reservation_no,
            v.brand, v.model, v.model_year, v.stock_no, u.full_name AS user_name
     FROM payments p JOIN customers c ON c.id = p.customer_id LEFT JOIN installment_contracts ic ON ic.id = p.contract_id
     LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN reservations r ON r.id = p.reservation_id
     LEFT JOIN vehicles v ON v.id = COALESCE(s.vehicle_id, r.vehicle_id) LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?`,
    [id],
  );
  if (!payment) fail('NOT_FOUND', 'الدفعة غير موجودة.');
  const allocations = db.all(
    `SELECT a.amount, i.seq, i.due_date, i.amount AS installment_amount FROM payment_allocations a JOIN installments i ON i.id = a.installment_id WHERE a.payment_id = ? ORDER BY i.seq`,
    [id],
  );
  const contractRemaining = payment.contract_id
    ? db.scalar<number>('SELECT COALESCE(SUM(amount - paid_amount - waived_amount),0) FROM installments WHERE contract_id = ? AND is_cancelled = 0', [
        payment.contract_id,
      ])
    : null;
  return { payment, allocations, contractRemaining };
}

/**
 * Reschedules the outstanding balance of a contract. Unpaid installments are cancelled; partially
 * paid ones are closed at their paid amount; a new schedule for the outstanding total is created.
 * Old and new schedules are stored in `reschedules` and the audit log.
 */
export function reschedule(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'installments.manage');
  const contract_id = V.id(input.contract_id, 'العقد');
  const reason = V.reqStr(input.reason, 'سبب إعادة الجدولة', 500);
  const contract = db.get<any>('SELECT * FROM installment_contracts WHERE id = ?', [contract_id]);
  if (!contract) fail('NOT_FOUND', 'العقد غير موجود.');
  if (contract.status !== 'active') fail('VALIDATION', 'لا يمكن إعادة جدولة عقد غير نشط.');
  return db.tx(() => {
    const oldSchedule = db.all<any>(
      'SELECT id, seq, due_date, amount, paid_amount, waived_amount FROM installments WHERE contract_id = ? AND is_cancelled = 0 ORDER BY due_date, seq',
      [contract_id],
    );
    const open = oldSchedule.filter((i) => i.amount - i.paid_amount - i.waived_amount > 0);
    const outstanding = open.reduce((a, i) => a + (i.amount - i.paid_amount - i.waived_amount), 0);
    if (outstanding <= 0) fail('VALIDATION', 'لا يوجد رصيد متبقٍ لإعادة جدولته.');
    const { plan, lines } = planFromInput(db, input.plan, outstanding);
    const version = contract.schedule_version + 1;
    for (const i of open) {
      if (i.paid_amount > 0 || i.waived_amount > 0) {
        db.run(`UPDATE installments SET amount = paid_amount + waived_amount, notes = ? WHERE id = ?`, [
          `أعيدت جدولة المتبقي (${(i.amount - i.paid_amount - i.waived_amount) / 100}) - إصدار ${version}`,
          i.id,
        ]);
      } else {
        db.run('UPDATE installments SET is_cancelled = 1, notes = ? WHERE id = ?', [`ملغي بإعادة الجدولة - إصدار ${version}`, i.id]);
      }
    }
    const maxSeq = db.scalar<number>('SELECT COALESCE(MAX(seq),0) FROM installments WHERE contract_id = ?', [contract_id]);
    lines.forEach((l, idx) => {
      db.run('INSERT INTO installments(contract_id, seq, due_date, amount, schedule_version) VALUES (?,?,?,?,?)', [
        contract_id,
        maxSeq + idx + 1,
        l.due_date,
        l.amount,
        version,
      ]);
    });
    const activeCount = db.scalar<number>('SELECT COUNT(*) FROM installments WHERE contract_id = ? AND is_cancelled = 0', [contract_id]);
    db.run('UPDATE installment_contracts SET schedule_version = ?, plan_type = ?, installments_count = ? WHERE id = ?', [
      version,
      plan.plan_type,
      activeCount,
      contract_id,
    ]);
    const newRemaining = refreshContractStatus(db, contract_id, today(ctx));
    if (newRemaining !== outstanding) throw new AppError('SCHEDULE_TOTAL_MISMATCH', 'الجدول الجديد لا يساوي الرصيد المتبقي.');
    const newSchedule = lines.map((l, idx) => ({ ...l, seq: maxSeq + idx + 1 }));
    db.run(
      'INSERT INTO reschedules(contract_id, reschedule_date, reason, old_schedule, new_schedule, from_version, to_version, user_id) VALUES (?,?,?,?,?,?,?,?)',
      [contract_id, today(ctx), reason, JSON.stringify(oldSchedule), JSON.stringify(newSchedule), contract.schedule_version, version, ctx.user.id || null],
    );
    audit(db, ctx, {
      action: 'reschedule',
      module: 'installments',
      record_type: 'contract',
      record_id: contract_id,
      label: contract.contract_no,
      old: oldSchedule,
      new: newSchedule,
      details: reason,
    });
    return { ok: true, outstanding, version, lines: newSchedule };
  });
}
