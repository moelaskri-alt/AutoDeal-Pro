/**
 * Performance test (master prompt §43): 50,000 vehicles, 100,000+ payments, 100,000 expenses.
 * Data is bulk-inserted with SQL (fast), then the real service queries used by the UI are timed.
 * Run with: npx vitest run --config vitest.perf.config.ts
 */
import { describe, expect, it } from 'vitest';
import { freshDb, adminCtx } from '../unit/helpers';
import { callApi } from '../../src/core/api';
import { addDays, addMonths } from '../../src/core/calc/dates';

const N_VEH = 50000;
const N_CUST = 20000;
const N_SALES = 25000;
const N_EXP = 100000;

describe('performance with large datasets', () => {
  it('keeps list/report/dashboard queries fast', () => {
    const db = freshDb();
    const ctx = adminCtx(db, '2026-09-27');
    const t0 = Date.now();
    db.tx(() => {
      db.run(`INSERT INTO suppliers(name, supplier_type) VALUES ('مورد', 'dealer')`);
      const brands = ['Toyota', 'Hyundai', 'Kia', 'Nissan', 'BMW', 'Mercedes', 'Chery', 'MG', 'Renault', 'Skoda'];
      for (let i = 1; i <= N_VEH; i++) {
        const acq = addDays('2023-01-01', i % 1000);
        db.run(
          `INSERT INTO vehicles(id, stock_no, condition, brand, model, model_year, vin, mileage, status, acquisition_date, supplier_id, asking_price, min_price)
           VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          [
            i,
            `STK-${i}`,
            i % 2 ? 'new' : 'used',
            brands[i % 10],
            `M${i % 37}`,
            2015 + (i % 11),
            `VIN${String(i).padStart(12, '0')}`,
            (i * 13) % 200000,
            'available',
            acq,
            50000000 + i,
            45000000,
          ],
        );
        db.run(`INSERT INTO vehicle_expenses(expense_no, vehicle_id, expense_date, category, amount, source_type) VALUES (?,?,?,?,?,?)`, [
          `VC-P-${i}`,
          i,
          acq,
          'purchase',
          40000000,
          'purchase',
        ]);
        db.run(`INSERT INTO vehicle_expenses(expense_no, vehicle_id, expense_date, category, amount) VALUES (?,?,?,?,?)`, [
          `VC-M-${i}`,
          i,
          acq,
          'maintenance',
          1500000,
        ]);
      }
      for (let i = 1; i <= N_CUST; i++)
        db.run(`INSERT INTO customers(id, code, name, phone) VALUES (?,?,?,?)`, [i, `C-${i}`, `عميل رقم ${i}`, `010${String(i).padStart(8, '0')}`]);
      let payId = 0;
      for (let s = 1; s <= N_SALES; s++) {
        const cust = ((s - 1) % N_CUST) + 1;
        const date = addDays('2024-01-01', s % 900);
        db.run(
          `INSERT INTO sales(id, sale_no, customer_id, vehicle_id, sale_date, sale_type, list_price, discount, selling_price, fees, total_contract_value, down_payment, financed_amount, salesperson_id)
           VALUES (?,?,?,?,?,'installments',50000000,0,50000000,0,50000000,14000000,36000000,1)`,
          [s, `SL-${s}`, cust, s, date],
        );
        db.run(
          `INSERT INTO installment_contracts(id, contract_no, sale_id, customer_id, financed_amount, plan_type, installments_count, first_due_date) VALUES (?,?,?,?,36000000,'equal',12,?)`,
          [s, `IC-${s}`, s, cust, addMonths(date, 1)],
        );
        for (let k = 0; k < 12; k++)
          db.run(`INSERT INTO installments(contract_id, seq, due_date, amount) VALUES (?,?,?,3000000)`, [s, k + 1, addMonths(date, k + 1)]);
        // 4 paid installments per contract → 100,000 payments + allocations
        for (let k = 0; k < 4; k++) {
          payId++;
          db.run(
            `INSERT INTO payments(id, receipt_no, customer_id, sale_id, contract_id, kind, pay_date, amount, method) VALUES (?,?,?,?,?,'installment',?,3000000,'cash')`,
            [payId, `RC-${payId}`, cust, s, s, addMonths(date, k + 1)],
          );
          db.run(
            `INSERT INTO payment_allocations(payment_id, installment_id, amount) VALUES (?, (SELECT id FROM installments WHERE contract_id = ? AND seq = ?), 3000000)`,
            [payId, s, k + 1],
          );
        }
      }
      db.run('UPDATE vehicles SET status = ? WHERE id <= ?', ['sold', N_SALES]);
      for (let i = 1; i <= N_EXP; i++)
        db.run(`INSERT INTO expenses(expense_no, expense_date, category, description, amount) VALUES (?,?,?,?,?)`, [
          `EX-${i}`,
          addDays('2023-01-01', i % 1300),
          'office',
          `مصروف ${i}`,
          10000 + i,
        ]);
    });
    db.exec('ANALYZE');
    const seedMs = Date.now() - t0;
    expect(db.scalar('SELECT COUNT(*) FROM payments')).toBe(100000);

    const timings: Record<string, number> = {};
    const time = (name: string, method: string, args: any) => {
      const s = performance.now();
      const r: any = callApi(db, ctx, method, args);
      timings[name] = Math.round(performance.now() - s);
      return r;
    };
    time('vehicles.list page 1', 'vehicles.list', { page: 1, pageSize: 25, filters: {} });
    time('vehicles.list in-stock sorted by cost', 'vehicles.list', {
      page: 3,
      pageSize: 25,
      sort: 'actual_cost',
      dir: 'desc',
      filters: { status: 'in_stock' },
    });
    time('vehicles.list search', 'vehicles.list', { search: 'VIN0000000499', filters: {} });
    time('payments.list page 1', 'payments.list', { page: 1, pageSize: 25 });
    time('payments.list date range', 'payments.list', { page: 10, pageSize: 25, filters: { from: '2025-01-01', to: '2025-03-31' } });
    time('installments overdue', 'installments.list', { page: 1, pageSize: 25, filters: { status: 'overdue' } });
    time('contracts list', 'installments.contracts', { page: 1, pageSize: 25 });
    time('customers.list (balances)', 'customers.list', { page: 1, pageSize: 25 });
    time('expenses.list', 'expenses.list', { page: 50, pageSize: 25 });
    time('sales.list', 'sales.list', { page: 1, pageSize: 25 });
    time('dashboard', 'dashboard.get', {});
    time('report vehicle_profitability (month)', 'reports.run', { id: 'vehicle_profitability', filters: { from: '2025-06-01', to: '2025-06-30' } });
    time('report receivables_aging', 'reports.run', { id: 'receivables_aging', filters: {} });
    time('customer 360', 'customers.get', { id: 5 });
    time('contract detail', 'installments.contract', { id: 77 });
    console.log(`seed ${seedMs}ms`, JSON.stringify(timings, null, 2));
    for (const [k, v] of Object.entries(timings)) {
      const limit = k.startsWith('report receivables') || k === 'dashboard' ? 3000 : 1500;
      expect(v, k).toBeLessThan(limit);
    }
  });
});
