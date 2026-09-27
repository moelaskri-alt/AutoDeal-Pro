import { describe, expect, it } from 'vitest';
import { equalSchedule, balloonSchedule, customSchedule, installmentStatus, daysOverdue, allocateFifo } from '../../src/core/calc/installments';
import { addMonths, daysBetween } from '../../src/core/calc/dates';
import { marginPct } from '../../src/core/calc/money';
import { M } from './helpers';

const sum = (l: { amount: number }[]) => l.reduce((a, b) => a + b.amount, 0);

describe('installment schedule calculations', () => {
  it('§35 equal: 900,000 over 12 → 12 × 75,000 = 900,000', () => {
    const s = equalSchedule(M(900000), 12, '2026-02-01');
    expect(s).toHaveLength(12);
    expect(s.every((l) => l.amount === M(75000))).toBe(true);
    expect(sum(s)).toBe(M(900000));
    expect(s[11].due_date).toBe('2027-01-01');
  });

  it('equal with remainder: 1,000,000 over 24 sums exactly; last absorbs rounding', () => {
    const s = equalSchedule(M(1000000), 24, '2026-01-31');
    expect(sum(s)).toBe(M(1000000));
    expect(s[0].amount).toBe(M(41666));
    expect(s[23].amount).toBe(M(1000000) - M(41666) * 23);
    expect(s[1].due_date).toBe('2026-02-28'); // month-end clamp
    expect(s[2].due_date).toBe('2026-03-31');
  });

  it('balloon: 23 × 30,000 + final 310,000 = 1,000,000', () => {
    const s = balloonSchedule(M(1000000), 24, M(30000), '2026-01-01');
    expect(s.slice(0, 23).every((l) => l.amount === M(30000))).toBe(true);
    expect(s[23].amount).toBe(M(310000));
    expect(sum(s)).toBe(M(1000000));
  });

  it('balloon rejects regular payments exceeding total', () => {
    expect(() => balloonSchedule(M(100000), 12, M(10000), '2026-01-01')).toThrow();
  });

  it('§36 custom schedule matching the total is accepted', () => {
    const amounts = [100000, 50000, 100000, 150000, 200000, 300000];
    const s = customSchedule(
      M(900000),
      amounts.map((a, i) => ({ due_date: addMonths('2026-01-01', i), amount: M(a) })),
    );
    expect(sum(s)).toBe(M(900000));
  });

  it('§36 custom schedule not matching the total is BLOCKED', () => {
    expect(() =>
      customSchedule(M(900000), [
        { due_date: '2026-01-01', amount: M(100000) },
        { due_date: '2026-02-01', amount: M(50000) },
      ]),
    ).toThrowError(/لا يساوي/);
  });

  it('custom schedule allows multiple payments in the same month but not out-of-order dates', () => {
    expect(
      customSchedule(M(3000), [
        { due_date: '2026-01-05', amount: M(1000) },
        { due_date: '2026-01-20', amount: M(2000) },
      ]),
    ).toHaveLength(2);
    expect(() =>
      customSchedule(M(3000), [
        { due_date: '2026-02-05', amount: M(1000) },
        { due_date: '2026-01-20', amount: M(2000) },
      ]),
    ).toThrow();
  });

  it('rejects zero/negative amounts', () => {
    expect(() => customSchedule(M(1000), [{ due_date: '2026-01-05', amount: -M(1000) }])).toThrow();
    expect(() => equalSchedule(0, 12, '2026-01-01')).toThrow();
  });
});

describe('§37 installment status & overdue logic', () => {
  const inst = (due: string, amount: number, paid: number) => ({ due_date: due, amount, paid_amount: paid, waived_amount: 0 });
  it('due < today and remaining > 0 → OVERDUE with days', () => {
    expect(installmentStatus(inst('2026-06-01', 100, 0), '2026-06-15')).toBe('overdue');
    expect(daysOverdue(inst('2026-06-01', 100, 0), '2026-06-15')).toBe(14);
  });
  it('partial & overdue → overdue', () => {
    expect(installmentStatus(inst('2026-06-01', 100, 40), '2026-06-15')).toBe('overdue');
  });
  it('fully paid → PAID even if past due', () => {
    expect(installmentStatus(inst('2026-06-01', 100, 100), '2026-06-15')).toBe('paid');
    expect(daysOverdue(inst('2026-06-01', 100, 100), '2026-06-15')).toBe(0);
  });
  it('partial not yet due → PARTIALLY PAID', () => {
    expect(installmentStatus(inst('2026-07-01', 100, 40), '2026-06-15')).toBe('partially_paid');
  });
  it('due today / not due', () => {
    expect(installmentStatus(inst('2026-06-15', 100, 0), '2026-06-15')).toBe('due_today');
    expect(installmentStatus(inst('2026-06-16', 100, 0), '2026-06-15')).toBe('not_due');
  });
});

describe('allocation & helpers', () => {
  it('FIFO allocates oldest first and never over-allocates', () => {
    const r = allocateFifo(
      [
        { id: 2, due_date: '2026-02-01', seq: 2, remaining: 100 },
        { id: 1, due_date: '2026-01-01', seq: 1, remaining: 50 },
      ],
      120,
    );
    expect(r.allocations).toEqual([
      { installment_id: 1, amount: 50 },
      { installment_id: 2, amount: 70 },
    ]);
    expect(r.unallocated).toBe(0);
  });
  it('margin %', () => {
    expect(marginPct(M(150000), M(1200000))).toBe(12.5);
    expect(marginPct(M(87000), M(1350000))).toBe(6.44);
  });
  it('dates', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });
});
