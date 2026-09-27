import { AppError } from '../errors';
import { addMonths, daysBetween, isValidDate } from './dates';

export interface ScheduleLine {
  seq: number;
  due_date: string;
  amount: number; // minor units
}

export type PlanType = 'equal' | 'custom' | 'balloon';

export interface PlanInput {
  plan_type: PlanType;
  total: number; // amount to schedule (minor units)
  count?: number; // equal/balloon
  first_due_date?: string; // equal/balloon
  interval_months?: number; // default 1
  rounding?: number; // minor units, equal plan; default 100 (whole currency unit)
  regular_amount?: number; // balloon: amount of each regular installment
  lines?: { due_date: string; amount: number }[]; // custom
}

const err = (msg: string) => new AppError('INVALID_SCHEDULE', msg);

/**
 * Equal installments. Amounts are rounded down to `rounding`; the difference is added to the
 * last installment so the schedule always sums exactly to the total.
 */
export function equalSchedule(total: number, count: number, firstDue: string, intervalMonths = 1, rounding = 100): ScheduleLine[] {
  if (!Number.isSafeInteger(total) || total <= 0) throw err('المبلغ الممول يجب أن يكون أكبر من صفر.');
  if (!Number.isInteger(count) || count < 1 || count > 360) throw err('عدد الأقساط يجب أن يكون بين 1 و 360.');
  if (!isValidDate(firstDue)) throw err('تاريخ أول قسط غير صحيح.');
  const r = Math.max(1, Math.floor(rounding));
  let base = Math.floor(total / count / r) * r;
  if (base <= 0) base = Math.floor(total / count);
  if (base <= 0) throw err('المبلغ صغير جداً بالنسبة لعدد الأقساط.');
  const lines: ScheduleLine[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({ seq: i + 1, due_date: addMonths(firstDue, i * intervalMonths), amount: base });
  }
  lines[count - 1].amount = total - base * (count - 1);
  return lines;
}

/** N-1 regular installments followed by a final (balloon) installment carrying the rest. */
export function balloonSchedule(total: number, count: number, regular: number, firstDue: string, intervalMonths = 1): ScheduleLine[] {
  if (!Number.isSafeInteger(total) || total <= 0) throw err('المبلغ الممول يجب أن يكون أكبر من صفر.');
  if (!Number.isInteger(count) || count < 2 || count > 360) throw err('نظام الدفعة الأخيرة يتطلب قسطين على الأقل.');
  if (!Number.isSafeInteger(regular) || regular <= 0) throw err('قيمة القسط الدوري يجب أن تكون أكبر من صفر.');
  if (!isValidDate(firstDue)) throw err('تاريخ أول قسط غير صحيح.');
  const balloon = total - regular * (count - 1);
  if (balloon <= 0) throw err('مجموع الأقساط الدورية يتجاوز المبلغ الممول؛ لا يتبقى مبلغ للدفعة الأخيرة.');
  const lines: ScheduleLine[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({ seq: i + 1, due_date: addMonths(firstDue, i * intervalMonths), amount: i === count - 1 ? balloon : regular });
  }
  return lines;
}

/** Validates a user-defined schedule. Blocks save if the total does not match exactly. */
export function customSchedule(total: number, lines: { due_date: string; amount: number }[]): ScheduleLine[] {
  if (!Array.isArray(lines) || lines.length === 0) throw err('يجب إدخال قسط واحد على الأقل.');
  if (lines.length > 360) throw err('عدد الأقساط كبير جداً.');
  let prev = '';
  let s = 0;
  const out: ScheduleLine[] = lines.map((l, i) => {
    if (!isValidDate(l.due_date)) throw err(`تاريخ القسط رقم ${i + 1} غير صحيح.`);
    if (!Number.isSafeInteger(l.amount) || l.amount <= 0) throw err(`قيمة القسط رقم ${i + 1} يجب أن تكون أكبر من صفر.`);
    if (prev && l.due_date < prev) throw err(`تاريخ القسط رقم ${i + 1} يسبق تاريخ القسط السابق.`);
    prev = l.due_date;
    s += l.amount;
    return { seq: i + 1, due_date: l.due_date, amount: l.amount };
  });
  if (s !== total) {
    throw new AppError('SCHEDULE_TOTAL_MISMATCH', 'مجموع الأقساط لا يساوي المبلغ المطلوب جدولته. لا يمكن الحفظ.', {
      expected: total,
      actual: s,
      difference: total - s,
    });
  }
  return out;
}

export function buildSchedule(p: PlanInput): ScheduleLine[] {
  switch (p.plan_type) {
    case 'equal':
      return equalSchedule(p.total, p.count ?? 0, p.first_due_date ?? '', p.interval_months ?? 1, p.rounding ?? 100);
    case 'balloon':
      return balloonSchedule(p.total, p.count ?? 0, p.regular_amount ?? 0, p.first_due_date ?? '', p.interval_months ?? 1);
    case 'custom':
      return customSchedule(p.total, p.lines ?? []);
    default:
      throw err('نوع نظام التقسيط غير معروف.');
  }
}

export type InstallmentStatus = 'paid' | 'overdue' | 'partially_paid' | 'due_today' | 'not_due' | 'cancelled';

export interface InstallmentState {
  amount: number;
  paid_amount: number;
  waived_amount?: number;
  due_date: string;
  is_cancelled?: number | boolean;
}

export function remainingOf(i: InstallmentState): number {
  return i.amount - i.paid_amount - (i.waived_amount ?? 0);
}

/**
 * Status rules (BUSINESS_RULES.md §Overdue):
 *  cancelled → paid (remaining = 0) → overdue (due < today & remaining > 0)
 *  → partially paid (paid > 0) → due today → not due.
 */
export function installmentStatus(i: InstallmentState, today: string): InstallmentStatus {
  if (i.is_cancelled) return 'cancelled';
  const rem = remainingOf(i);
  if (rem <= 0) return 'paid';
  if (i.due_date < today) return 'overdue';
  if (i.paid_amount > 0) return 'partially_paid';
  if (i.due_date === today) return 'due_today';
  return 'not_due';
}

export function daysOverdue(i: InstallmentState, today: string): number {
  if (i.is_cancelled || remainingOf(i) <= 0 || i.due_date >= today) return 0;
  return daysBetween(i.due_date, today);
}

/** SQL expression computing the same status inside queries (keep in sync with installmentStatus). */
export const SQL_INSTALLMENT_STATUS = (alias = 'i', todayParam = ':today') => `CASE
  WHEN ${alias}.is_cancelled = 1 THEN 'cancelled'
  WHEN ${alias}.amount - ${alias}.paid_amount - ${alias}.waived_amount <= 0 THEN 'paid'
  WHEN ${alias}.due_date < ${todayParam} THEN 'overdue'
  WHEN ${alias}.paid_amount > 0 THEN 'partially_paid'
  WHEN ${alias}.due_date = ${todayParam} THEN 'due_today'
  ELSE 'not_due' END`;

export interface Allocation {
  installment_id: number;
  amount: number;
}

/** Oldest-first allocation of a payment across outstanding installments. */
export function allocateFifo(
  items: { id: number; due_date: string; seq: number; remaining: number }[],
  amount: number,
): { allocations: Allocation[]; unallocated: number } {
  const sorted = [...items].filter((x) => x.remaining > 0).sort((a, b) => (a.due_date === b.due_date ? a.seq - b.seq : a.due_date < b.due_date ? -1 : 1));
  const allocations: Allocation[] = [];
  let left = amount;
  for (const it of sorted) {
    if (left <= 0) break;
    const a = Math.min(left, it.remaining);
    allocations.push({ installment_id: it.id, amount: a });
    left -= a;
  }
  return { allocations, unallocated: left };
}
