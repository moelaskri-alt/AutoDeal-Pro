import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminCtx, api, freshDb, M } from './helpers';
import { seedDemo } from '../../src/core/seed/demo';
import { getDashboard } from '../../src/core/services/dashboard';
import { runReport, REPORTS } from '../../src/core/services/reports';
import { Db } from '../../src/core/db/database';
import { ensureSecurity, buildCtx } from '../../src/core/services/users';
import { createBackup, restoreBackup } from '../../src/core/backup';
import { addMonths } from '../../src/core/calc/dates';

describe('§32 demo dataset', () => {
  it('loads the required demo data through the services', () => {
    const db = freshDb();
    const ctx = adminCtx(db, '2026-09-27');
    const r = seedDemo(db, ctx);
    expect(r.vehicles).toBe(20);
    expect(db.scalar(`SELECT COUNT(*) FROM vehicles WHERE condition = 'new'`)).toBe(10);
    expect(db.scalar(`SELECT COUNT(*) FROM vehicles WHERE condition = 'used'`)).toBe(10);
    expect(db.scalar('SELECT COUNT(*) FROM customers')).toBeGreaterThanOrEqual(5);
    expect(db.scalar('SELECT COUNT(*) FROM leads')).toBeGreaterThanOrEqual(5);
    expect(db.scalar('SELECT COUNT(*) FROM purchases')).toBeGreaterThanOrEqual(5);
    expect(db.scalar(`SELECT COUNT(*) FROM vehicle_expenses WHERE source_type = 'manual'`)).toBeGreaterThanOrEqual(10);
    expect(db.scalar(`SELECT COUNT(*) FROM sales WHERE sale_type = 'cash'`)).toBe(2);
    expect(db.scalar(`SELECT COUNT(*) FROM sales WHERE sale_type LIKE '%installments'`)).toBe(3);
    expect(db.scalar(`SELECT COUNT(*) FROM installment_contracts WHERE plan_type = 'equal'`)).toBe(1);
    expect(db.scalar(`SELECT COUNT(*) FROM installment_contracts WHERE plan_type = 'custom'`)).toBe(1);
    expect(db.scalar(`SELECT COUNT(*) FROM trade_ins WHERE status = 'accepted'`)).toBe(1);
    // custom contract has a partial AND an overdue installment
    const cid = db.scalar<number>(`SELECT id FROM installment_contracts WHERE plan_type = 'custom'`);
    const k = api(db, ctx)('installments.contract', { id: cid });
    expect(k.schedule.some((i: any) => i.status === 'overdue' && i.paid_amount > 0)).toBe(true);
    // every report runs on real data
    for (const rep of REPORTS) {
      const out = runReport(db, ctx, { id: rep.id, filters: {} });
      expect(Array.isArray(out.rows), rep.id).toBe(true);
    }
    const dash = getDashboard(db, ctx);
    expect(dash.inventory.in_stock).toBe(15);
    expect(dash.receivables.overdue).toBeGreaterThan(0);
    expect(() => seedDemo(db, ctx)).toThrow();
  });
});

describe('§61 final demo scenario (service level)', () => {
  it('BMW: buy 1,200,000 + 63,000 costs → sell 1,350,000 with 350,000 upfront, 24 months, payments, overdue, backup/restore', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-demo-'));
    const dbPath = path.join(dir, 'autodeal.db');
    let db = new Db(dbPath);
    ensureSecurity(db);
    const ctx = buildCtx(db, 1);
    ctx.today = '2026-01-05';
    let call = api(db, ctx);

    // 1-2 Add used BMW, purchase for 1,200,000
    const p = call('purchases.create', {
      purchase_date: '2026-01-05', purchase_price: M(1200000), supplier: { name: 'بائع فرد', supplier_type: 'individual' }, status: 'preparation', paid_amount: M(1200000),
      vehicle: { condition: 'used', brand: 'BMW', model: '520i', model_year: 2020, vin: 'WBAJA5105LBK00001', mileage: 70000, asking_price: M(1450000), min_price: M(1330000) },
    });
    // 3 Add 63,000 direct costs
    for (const [category, amount] of [['maintenance', 25000], ['bodywork', 18000], ['tires', 12000], ['transport', 5000], ['detailing', 3000]] as const) {
      call('costs.create', { vehicle_id: p.vehicle_id, expense_date: '2026-01-06', category, amount: M(amount) });
    }
    call('vehicles.update', { ...db.get('SELECT * FROM vehicles WHERE id = ?', [p.vehicle_id]), status: 'available' });
    // 4 Actual cost
    expect(call('costs.card', { vehicle_id: p.vehicle_id }).totals.actual_cost).toBe(M(1263000));
    // 5-7 customer, quotation 1,400,000, reservation
    const c = call('customers.create', { name: 'عميل العرض التجريبي', phone: '01000000001', national_id: '29001011234599' });
    const q = call('quotations.create', { customer_id: c.id, vehicle_id: p.vehicle_id, asking_price: M(1450000), discount: M(50000), quote_date: '2026-01-10', payment_method: 'installments' });
    expect(call('quotations.get', { id: q.id }).final_price).toBe(M(1400000));
    ctx.today = '2026-01-12';
    const r = call('reservations.create', { customer_id: c.id, vehicle_id: p.vehicle_id, quotation_id: q.id, amount: M(50000), reservation_date: '2026-01-12', expiry_date: '2026-01-20' });
    expect(r.receipt_no).toBeTruthy();
    // 8-11 sell 1,350,000, 350,000 upfront (50,000 deposit + 300,000 down), remaining 1,000,000 over 24 months
    const s = call('sales.create', {
      customer_id: c.id, vehicle_id: p.vehicle_id, quotation_id: q.id, sale_type: 'installments', sale_date: '2026-01-15', list_price: M(1450000), discount: M(100000),
      down_payment: M(300000), plan: { plan_type: 'equal', count: 24, first_due_date: '2026-02-15' },
    });
    expect(s.selling_price).toBe(M(1350000));
    expect(s.reservation_credit + s.down_payment).toBe(M(350000));
    expect(s.financed_amount).toBe(M(1000000));
    const k = call('installments.contract', { id: s.contract_id });
    expect(k.schedule).toHaveLength(24);
    expect(k.schedule.reduce((a: number, i: any) => a + i.amount, 0)).toBe(M(1000000));
    // 12 first payment, 13 partial payment on another installment
    call('payments.create', { contract_id: s.contract_id, amount: k.schedule[0].amount, pay_date: '2026-02-15' });
    call('payments.create', { contract_id: s.contract_id, amount: M(20000), pay_date: '2026-03-15', mode: 'manual', installment_ids: [k.schedule[1].id] });
    // 14 make an installment overdue (time passes)
    ctx.today = '2026-04-20';
    const k2 = call('installments.contract', { id: s.contract_id });
    expect(k2.schedule[0].status).toBe('paid');
    expect(k2.schedule[1].status).toBe('overdue');
    expect(k2.schedule[2].status).toBe('overdue');
    const expectedRemaining = M(1000000) - k.schedule[0].amount - M(20000);
    expect(k2.contract.remaining).toBe(expectedRemaining);
    // 15 customer statement, 16 installment report
    const st = call('customers.statement', { id: c.id });
    expect(st.closing).toBe(expectedRemaining);
    const inst = call('reports.run', { id: 'installment_schedule', filters: {} });
    expect(inst.totals.amount).toBe(M(1000000));
    // 17-18 vehicle profitability & gross profit 87,000
    const prof = call('reports.run', { id: 'vehicle_profitability', filters: {} });
    expect(prof.rows[0].actual_cost).toBe(M(1263000));
    expect(prof.rows[0].gross_profit).toBe(M(87000));
    expect(prof.rows[0].margin).toBe(6.44);
    // 19 dashboard
    const dash = call('dashboard.get');
    expect(dash.sales.all.profit).toBe(M(87000));
    expect(dash.receivables.outstanding).toBe(expectedRemaining);
    expect(dash.receivables.overdue).toBeGreaterThan(0);
    // 20-23 backup, damage, restore, reopen, verify
    const b = createBackup(db, path.join(dir, 'backups'), 'manual', 1);
    call('expenses.create', { expense_date: '2026-04-20', category: 'rent', description: 'بعد النسخة', amount: M(1) });
    const res = restoreBackup(db, dbPath, b.file, path.join(dir, 'backups'), 1);
    res.db.close();
    db = new Db(dbPath); // reopen application
    const ctx2 = buildCtx(db, 1);
    ctx2.today = '2026-04-20';
    call = api(db, ctx2);
    expect(db.scalar('SELECT COUNT(*) FROM expenses')).toBe(0);
    expect(call('reports.run', { id: 'vehicle_profitability', filters: {} }).rows[0].gross_profit).toBe(M(87000));
    expect(call('customers.statement', { id: c.id }).closing).toBe(expectedRemaining);
    expect(call('installments.contract', { id: s.contract_id }).schedule[1].paid_amount).toBe(M(20000));
    expect(addMonths('2026-02-15', 23)).toBe(k.schedule[23].due_date);
    db.close();
  });
});
