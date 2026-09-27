import { describe, expect, it } from 'vitest';
import { adminCtx, api, freshDb, M, newCustomer, purchaseVehicle, userCtx } from './helpers';
import { runReport } from '../../src/core/services/reports';
import { getDashboard } from '../../src/core/services/dashboard';

describe('§34 accounting: cost → profit consistency', () => {
  it('Purchase 1,000,000 + costs 50,000 = 1,050,000; sell 1,200,000 → profit 150,000, margin 12.5% everywhere', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(1000000), asking: M(1250000), min: M(1150000) });
    call('costs.create', { vehicle_id: v.vehicle_id, expense_date: '2026-01-12', category: 'maintenance', amount: M(30000) });
    call('costs.create', { vehicle_id: v.vehicle_id, expense_date: '2026-01-13', category: 'paint', amount: M(20000) });

    const card = call('costs.card', { vehicle_id: v.vehicle_id });
    expect(card.totals.acquisition_cost).toBe(M(1000000));
    expect(card.totals.direct_costs).toBe(M(50000));
    expect(card.totals.actual_cost).toBe(M(1050000));

    const c = newCustomer(db, ctx);
    const sale = call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(1200000), sale_date: '2026-06-01' });
    expect(sale.financed_amount).toBe(0);
    expect(sale.down_payment).toBe(M(1200000));

    const s = call('sales.get', { id: sale.id });
    expect(s.profit.actual_cost).toBe(M(1050000));
    expect(s.profit.gross_profit).toBe(M(150000));
    expect(s.profit.gross_margin).toBe(12.5);

    const card2 = call('costs.card', { vehicle_id: v.vehicle_id });
    expect(card2.totals.gross_profit).toBe(M(150000));
    expect(card2.totals.gross_margin).toBe(12.5);

    const vg = call('vehicles.get', { id: v.vehicle_id });
    expect(vg.pricing.actual_profit).toBe(M(150000));
    expect(vg.vehicle.status).toBe('sold');

    const dash = getDashboard(db, ctx);
    expect(dash.sales.all.profit).toBe(M(150000));
    expect(dash.sales.all.margin).toBe(12.5);
    expect(dash.sales.month.revenue).toBe(M(1200000));

    const rep = runReport(db, ctx, { id: 'vehicle_profitability', filters: {} });
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0].actual_cost).toBe(M(1050000));
    expect(rep.rows[0].gross_profit).toBe(M(150000));
    expect(rep.rows[0].margin).toBe(12.5);
    expect(rep.totals.margin).toBe(12.5);
  });
});

describe('§35 installment sale + partial payment', () => {
  it('1,200,000 − 300,000 down = 900,000 over 12 × 75,000; pay 50,000 → partially paid, remaining 25,000', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(1000000), asking: M(1200000) });
    const c = newCustomer(db, ctx);
    const sale = call('sales.create', {
      customer_id: c.id,
      vehicle_id: v.vehicle_id,
      sale_type: 'installments',
      list_price: M(1200000),
      down_payment: M(300000),
      sale_date: '2026-06-01',
      plan: { plan_type: 'equal', count: 12, first_due_date: '2026-07-01' },
    });
    expect(sale.total_contract_value).toBe(M(1200000));
    expect(sale.financed_amount).toBe(M(900000));
    const k = call('installments.contract', { id: sale.contract_id });
    expect(k.schedule).toHaveLength(12);
    expect(k.schedule.reduce((a: number, i: any) => a + i.amount, 0)).toBe(M(900000));
    expect(k.schedule.every((i: any) => i.amount === M(75000))).toBe(true);

    const p = call('payments.create', { contract_id: sale.contract_id, amount: M(50000), pay_date: '2026-06-10', method: 'cash' });
    expect(p.allocations).toEqual([{ installment_id: k.schedule[0].id, amount: M(50000) }]);
    const k2 = call('installments.contract', { id: sale.contract_id });
    const first = k2.schedule[0];
    expect(first.paid_amount).toBe(M(50000));
    expect(first.remaining).toBe(M(25000));
    expect(first.status).toBe('partially_paid');
    expect(k2.contract.remaining).toBe(M(850000));

    // full payment of the rest of installment 1 → PAID
    call('payments.create', { contract_id: sale.contract_id, amount: M(25000), pay_date: '2026-06-12', method: 'cash', mode: 'manual', installment_ids: [first.id] });
    const k3 = call('installments.contract', { id: sale.contract_id });
    expect(k3.schedule[0].status).toBe('paid');
    expect(k3.contract.remaining).toBe(M(825000));

    // Customer balance, dashboard & reports agree
    const cust = call('customers.get', { id: c.id });
    expect(cust.customer.balance).toBe(M(825000));
    const st = call('customers.statement', { id: c.id });
    expect(st.closing).toBe(M(825000));
    expect(getDashboard(db, ctx).receivables.outstanding).toBe(M(825000));
  });

  it('manual allocation larger than the chosen installment is blocked unless spill-over is allowed', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000) });
    const c = newCustomer(db, ctx);
    const sale = call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'installments', list_price: M(120000), down_payment: M(20000), sale_date: '2026-06-01', plan: { plan_type: 'equal', count: 4, first_due_date: '2026-07-01' } });
    const k = call('installments.contract', { id: sale.contract_id });
    const second = k.schedule[1];
    expect(() => call('payments.create', { contract_id: sale.contract_id, amount: M(30000), mode: 'manual', installment_ids: [second.id], pay_date: '2026-06-15' })).toThrowError(/أكبر من المتبقي/);
    const r = call('payments.create', { contract_id: sale.contract_id, amount: M(30000), mode: 'manual', installment_ids: [second.id], allow_spillover: true, pay_date: '2026-06-15' });
    expect(r.allocations[0]).toEqual({ installment_id: second.id, amount: M(25000) });
    expect(r.allocations[1].amount).toBe(M(5000));
    // Overpaying the whole contract is always blocked
    expect(() => call('payments.create', { contract_id: sale.contract_id, amount: M(1000000), pay_date: '2026-06-15' })).toThrowError(/يتجاوز الرصيد/);
  });
});

describe('§36 custom installments', () => {
  it('custom 900,000 schedule saves; mismatched schedule blocks the whole sale (atomic)', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(1000000) });
    const c = newCustomer(db, ctx);
    const base = { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'installments', list_price: M(1200000), down_payment: M(300000), sale_date: '2026-06-01' };
    const bad = [100000, 50000, 100000, 150000, 200000, 200000].map((a, i) => ({ due_date: `2026-${String(7 + i).padStart(2, '0')}-01`, amount: M(a) }));
    expect(() => call('sales.create', { ...base, plan: { plan_type: 'custom', lines: bad } })).toThrowError(/لا يساوي/);
    expect(db.scalar('SELECT COUNT(*) FROM sales')).toBe(0);
    expect(call('vehicles.get', { id: v.vehicle_id }).vehicle.status).toBe('available');

    const good = [100000, 50000, 100000, 150000, 200000, 300000].map((a, i) => ({ due_date: `2026-${String(7 + i).padStart(2, '0')}-01`, amount: M(a) }));
    const sale = call('sales.create', { ...base, plan: { plan_type: 'custom', lines: good } });
    const k = call('installments.contract', { id: sale.contract_id });
    expect(k.schedule.map((i: any) => i.amount)).toEqual(good.map((g) => g.amount));
    expect(k.contract.financed_amount).toBe(M(900000));
  });
});

describe('§37 overdue', () => {
  it('installment past due with remaining shows OVERDUE with days overdue; paid shows PAID', () => {
    const db = freshDb();
    const ctx = adminCtx(db, '2026-09-20');
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000) });
    const c = newCustomer(db, ctx);
    const sale = call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'installments', list_price: M(130000), down_payment: M(10000), sale_date: '2026-06-01', plan: { plan_type: 'equal', count: 12, first_due_date: '2026-07-01' } });
    call('payments.create', { contract_id: sale.contract_id, amount: M(10000), pay_date: '2026-07-01' }); // pays #1 fully
    call('payments.create', { contract_id: sale.contract_id, amount: M(4000), pay_date: '2026-08-01' }); // partial #2
    const k = call('installments.contract', { id: sale.contract_id });
    expect(k.schedule[0].status).toBe('paid');
    expect(k.schedule[1].status).toBe('overdue');
    expect(k.schedule[1].days_overdue).toBe(50); // 2026-08-01 → 2026-09-20
    expect(k.schedule[2].status).toBe('overdue'); // 2026-09-01
    expect(k.schedule[2].days_overdue).toBe(19);
    expect(k.schedule[3].status).toBe('not_due');
    expect(k.contract.overdue_amount).toBe(M(6000 + 10000));
    const d = getDashboard(db, ctx);
    expect(d.receivables.overdue).toBe(M(16000));
    expect(d.receivables.overdue_count).toBe(2);
    const rep = runReport(db, ctx, { id: 'overdue_installments', filters: {} });
    expect(rep.totals.remaining).toBe(M(16000));
  });
});

describe('§28 validation rules', () => {
  it('cannot sell or reserve a SOLD vehicle (service + DB guard)', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000) });
    const c = newCustomer(db, ctx);
    call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(120000), sale_date: '2026-06-01' });
    expect(() => call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(120000) })).toThrowError(/مباعة/);
    expect(() => call('reservations.create', { customer_id: c.id, vehicle_id: v.vehicle_id, amount: M(1000) })).toThrowError(/مباعة/);
    // DB-level trigger even if the service is bypassed
    expect(() =>
      db.run(`INSERT INTO reservations(reservation_no, customer_id, vehicle_id, reservation_date, expiry_date) VALUES ('X', ?, ?, '2026-06-01', '2026-06-05')`, [c.id, v.vehicle_id]),
    ).toThrow(/VEHICLE_ALREADY_SOLD/);
  });

  it('duplicate VIN / engine number rejected', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    call('vehicles.create', { condition: 'new', brand: 'Kia', model: 'Sportage', model_year: 2025, vin: 'ABC123456789', engine_no: 'ENG1' });
    expect(() => call('vehicles.create', { condition: 'new', brand: 'Kia', model: 'Sportage', model_year: 2025, vin: 'abc123456789' })).toThrowError(/VIN/);
    expect(() => call('vehicles.create', { condition: 'new', brand: 'Kia', model: 'Sportage', model_year: 2025, vin: 'XYZ99999999', engine_no: 'eng1' })).toThrowError(/المحرك/);
  });

  it('negative / zero amounts rejected', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(1000) });
    expect(() => call('costs.create', { vehicle_id: v.vehicle_id, expense_date: '2026-01-01', category: 'paint', amount: -M(5) })).toThrowError(/سالبة/);
    expect(() => call('expenses.create', { expense_date: '2026-01-01', category: 'rent', description: 'x', amount: 0 })).toThrowError(/أكبر من صفر/);
  });

  it('selling below minimum price requires permission, confirmation and reason; override is audited', () => {
    const db = freshDb();
    const admin = adminCtx(db);
    const sales = userCtx(db, 'sales');
    const v = purchaseVehicle(db, admin, { price: M(100000), asking: M(150000), min: M(140000) });
    const c = newCustomer(db, admin);
    const base = { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(150000), discount: M(20000), sale_date: '2026-06-01' };
    expect(() => api(db, sales)('sales.create', base)).toThrowError(/ليس لديك صلاحية/);
    expect(() => api(db, admin)('sales.create', base)).toThrowError(/تحذير/);
    expect(() => api(db, admin)('sales.create', { ...base, confirm_below_min: true })).toThrowError(/سبب/);
    const s = api(db, admin)('sales.create', { ...base, confirm_below_min: true, override_reason: 'عميل مميز' });
    const log = db.get<any>(`SELECT * FROM audit_logs WHERE action = 'override_min_price' AND record_id = ?`, [String(s.id)]);
    expect(log).toBeTruthy();
    expect(log.details).toContain('عميل مميز');
  });

  it('cannot delete a customer with transactions; cannot cancel a sale with collections', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000) });
    const c = newCustomer(db, ctx);
    const sale = call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'installments', list_price: M(120000), down_payment: M(20000), sale_date: '2026-06-01', plan: { plan_type: 'equal', count: 4, first_due_date: '2026-07-01' } });
    expect(() => call('customers.delete', { id: c.id })).toThrowError(/معاملات/);
    call('payments.create', { contract_id: sale.contract_id, amount: M(1000), pay_date: '2026-06-10' });
    expect(() => call('sales.cancel', { id: sale.id, reason: 'x' })).toThrowError(/أقساط محصلة/);
    expect(() => call('vehicles.delete', { id: v.vehicle_id })).toThrowError(/بيع/);
    const c2 = newCustomer(db, ctx, 'عميل بدون معاملات');
    expect(call('customers.delete', { id: c2.id }).ok).toBe(true);
  });

  it('reservation deposit is credited at sale; vehicle reserved for another customer cannot be sold', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000), asking: M(130000) });
    const a = newCustomer(db, ctx, 'أ');
    const b = newCustomer(db, ctx, 'ب');
    const r = call('reservations.create', { customer_id: a.id, vehicle_id: v.vehicle_id, amount: M(5000), reservation_date: '2026-06-01', expiry_date: '2026-06-30' });
    expect(call('vehicles.get', { id: v.vehicle_id }).vehicle.status).toBe('reserved');
    expect(() => call('reservations.create', { customer_id: b.id, vehicle_id: v.vehicle_id })).toThrowError(/محجوزة/);
    expect(() => call('sales.create', { customer_id: b.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(130000) })).toThrowError(/محجوزة لعميل آخر/);
    const s = call('sales.create', { customer_id: a.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(130000), sale_date: '2026-06-05' });
    expect(s.reservation_credit).toBe(M(5000));
    expect(s.down_payment).toBe(M(125000));
    expect(call('reservations.get', { id: r.id }).status).toBe('converted');
    expect(call('customers.statement', { id: a.id }).closing).toBe(0);
  });

  it('reservations expire automatically and free the vehicle; cancellation with refund', () => {
    const db = freshDb();
    const ctx = adminCtx(db, '2026-06-01');
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000), asking: M(130000) });
    const v2 = purchaseVehicle(db, ctx, { price: M(100000), asking: M(130000) });
    const a = newCustomer(db, ctx);
    const r = call('reservations.create', { customer_id: a.id, vehicle_id: v.vehicle_id, amount: M(2000), reservation_date: '2026-06-01', expiry_date: '2026-06-03' });
    const r2 = call('reservations.create', { customer_id: a.id, vehicle_id: v2.vehicle_id, amount: M(3000), reservation_date: '2026-06-01', expiry_date: '2026-06-30' });
    ctx.today = '2026-06-10';
    call('reservations.list', {});
    expect(call('reservations.get', { id: r.id }).status).toBe('expired');
    expect(call('vehicles.get', { id: v.vehicle_id }).vehicle.status).toBe('available');
    expect(() => call('reservations.cancel', { id: r2.id, reason: 'x', refund_amount: M(5000) })).toThrowError(/يتجاوز/);
    call('reservations.cancel', { id: r2.id, reason: 'تراجع العميل', refund_amount: M(3000) });
    expect(call('vehicles.get', { id: v2.vehicle_id }).vehicle.status).toBe('available');
    const st = call('customers.statement', { id: a.id });
    expect(st.closing).toBe(-M(2000)); // expired deposit still held as customer credit
  });
});

describe('§21 trade-in', () => {
  it('trade-in + installments: trade-in vehicle enters inventory with trade-in value as cost', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(800000), asking: M(1000000) });
    const c = newCustomer(db, ctx);
    const t = call('tradeins.create', {
      customer_id: c.id, brand: 'Hyundai', model: 'Elantra', model_year: 2018, vin: 'TRADEIN0000001', mileage: 90000,
      market_value: M(350000), trade_in_value: M(300000), expected_prep_cost: M(20000), expected_selling_price: M(360000),
    });
    const ti = call('tradeins.get', { id: t.id });
    expect(ti.expected_total_cost).toBe(M(320000));
    expect(ti.expected_profit).toBe(M(40000));
    const s = call('sales.create', {
      customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'trade_in_installments', list_price: M(1000000), trade_in_id: t.id,
      down_payment: M(100000), sale_date: '2026-06-01', plan: { plan_type: 'balloon', count: 12, regular_amount: M(40000), first_due_date: '2026-07-01' },
    });
    expect(s.trade_in_value).toBe(M(300000));
    expect(s.financed_amount).toBe(M(600000));
    const nv = call('vehicles.get', { id: s.trade_in_vehicle_id });
    expect(nv.vehicle.acquisition_type).toBe('trade_in');
    expect(nv.vehicle.actual_cost).toBe(M(300000));
    expect(nv.vehicle.status).toBe('preparation');
    const k = call('installments.contract', { id: s.contract_id });
    expect(k.schedule[11].amount).toBe(M(600000 - 40000 * 11));
    // statement: 1,000,000 − 300,000 trade-in − 100,000 down = 600,000
    expect(call('customers.statement', { id: c.id }).closing).toBe(M(600000));
    // resell the trade-in: actual profit shows in report
    call('costs.create', { vehicle_id: s.trade_in_vehicle_id, expense_date: '2026-06-05', category: 'detailing', amount: M(15000) });
    const c2 = newCustomer(db, ctx, 'مشتري الاستبدال');
    call('sales.create', { customer_id: c2.id, vehicle_id: s.trade_in_vehicle_id, sale_type: 'cash', list_price: M(370000), sale_date: '2026-06-10' });
    const rep = runReport(db, ctx, { id: 'tradein_report', filters: {} });
    expect(rep.rows[0].actual_cost).toBe(M(315000));
    expect(rep.rows[0].actual_profit).toBe(M(55000));
  });

  it('inline trade-in within cash sale', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(500000) });
    const c = newCustomer(db, ctx);
    const s = call('sales.create', {
      customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'trade_in_cash', list_price: M(600000), sale_date: '2026-06-01',
      trade_in: { brand: 'Toyota', model: 'Corolla', model_year: 2015, trade_in_value: M(200000), expected_selling_price: M(240000) },
    });
    expect(s.down_payment).toBe(M(400000));
    expect(s.financed_amount).toBe(0);
    expect(db.scalar(`SELECT COUNT(*) FROM trade_ins WHERE status = 'accepted'`)).toBe(1);
  });
});

describe('§17 reschedule, early settlement, void, cancel', () => {
  function setup(today = '2026-06-15') {
    const db = freshDb();
    const ctx = adminCtx(db, today);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000) });
    const c = newCustomer(db, ctx);
    const sale = call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'installments', list_price: M(130000), down_payment: M(10000), sale_date: '2026-06-01', plan: { plan_type: 'equal', count: 12, first_due_date: '2026-07-01' } });
    return { db, ctx, call, sale, c, v };
  }

  it('reschedule keeps total outstanding, stores old/new schedule and audit trail', () => {
    const { db, call, sale } = setup();
    call('payments.create', { contract_id: sale.contract_id, amount: M(15000), pay_date: '2026-06-10' }); // #1 paid, #2 partial 5,000
    const before = call('installments.contract', { id: sale.contract_id }).contract.remaining;
    expect(before).toBe(M(105000));
    const r = call('installments.reschedule', { contract_id: sale.contract_id, reason: 'ظروف العميل', plan: { plan_type: 'equal', count: 6, first_due_date: '2026-08-01' } });
    expect(r.outstanding).toBe(M(105000));
    const k = call('installments.contract', { id: sale.contract_id });
    expect(k.contract.remaining).toBe(M(105000));
    const active = k.schedule.filter((i: any) => !i.is_cancelled);
    expect(active.filter((i: any) => i.status !== 'paid')).toHaveLength(6);
    expect(k.schedule.find((i: any) => i.seq === 2).status).toBe('paid'); // closed at its paid amount
    expect(k.reschedules).toHaveLength(1);
    expect(JSON.parse(k.reschedules[0].old_schedule).length).toBe(12);
    expect(db.scalar(`SELECT COUNT(*) FROM audit_logs WHERE action = 'reschedule'`)).toBe(1);
    // sum of all paid + remaining = financed
    const paid = k.schedule.reduce((a: number, i: any) => a + i.paid_amount, 0);
    expect(paid + k.contract.remaining).toBe(M(120000));
  });

  it('early settlement with discount settles the contract; voiding it restores the balance', () => {
    const { call, sale, c } = setup();
    const es = call('installments.earlySettlement', { contract_id: sale.contract_id, discount: M(5000), pay_date: '2026-06-20' });
    expect(es.amount).toBe(M(115000));
    const k = call('installments.contract', { id: sale.contract_id });
    expect(k.contract.status).toBe('settled');
    expect(k.contract.remaining).toBe(0);
    expect(call('customers.statement', { id: c.id }).closing).toBe(0);
    call('payments.void', { id: es.id, reason: 'شيك مرتجع' });
    const k2 = call('installments.contract', { id: sale.contract_id });
    expect(k2.contract.status).toBe('active');
    expect(k2.contract.remaining).toBe(M(120000));
  });

  it('cancel sale without collections refunds the down payment and returns the vehicle', () => {
    const { call, sale, v, c } = setup();
    const r = call('sales.cancel', { id: sale.id, reason: 'تراجع العميل' });
    expect(r.refunded).toBe(M(10000));
    expect(call('vehicles.get', { id: v.vehicle_id }).vehicle.status).toBe('available');
    expect(call('customers.statement', { id: c.id }).closing).toBe(0);
    expect(call('installments.contract', { id: sale.contract_id }).contract.status).toBe('cancelled');
    // the vehicle can be sold again
    const again = call('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(125000), sale_date: '2026-06-16' });
    expect(again.id).toBeGreaterThan(sale.id);
  });
});
