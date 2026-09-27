import type { Db } from '../db/database';
import { type Ctx, can, requirePerm, today } from '../context';
import { addDays, addMonths } from '../calc/dates';
import { marginPct } from '../calc/money';
import { getSettingNum } from './common';
import { expireStale } from './sales';

const IN_STOCK = `('available','reserved','preparation','maintenance','returned')`;

/** Every figure is computed live from the database (no cached or hard-coded numbers). */
export function getDashboard(db: Db, ctx: Ctx) {
  requirePerm(ctx, 'dashboard.view');
  expireStale(db, ctx);
  const t = today(ctx);
  const monthStart = t.slice(0, 8) + '01';
  const fin = can(ctx, 'reports.financial') || can(ctx, 'costs.view');
  const P = { today: t, monthStart, d7: addDays(t, 7) };

  const inv = db.get<any>(
    `SELECT
       SUM(CASE WHEN v.status = 'available' THEN 1 ELSE 0 END) AS available,
       SUM(CASE WHEN v.status = 'reserved' THEN 1 ELSE 0 END) AS reserved,
       SUM(CASE WHEN v.status IN ('preparation','maintenance') THEN 1 ELSE 0 END) AS in_preparation,
       SUM(CASE WHEN v.status IN ('sold','delivered') THEN 1 ELSE 0 END) AS sold,
       SUM(CASE WHEN v.status IN ${IN_STOCK} THEN 1 ELSE 0 END) AS in_stock,
       SUM(CASE WHEN v.status IN ${IN_STOCK} AND v.condition = 'new' THEN 1 ELSE 0 END) AS new_in_stock,
       SUM(CASE WHEN v.status IN ${IN_STOCK} AND v.condition = 'used' THEN 1 ELSE 0 END) AS used_in_stock,
       SUM(CASE WHEN v.status IN ${IN_STOCK} THEN c.actual_cost ELSE 0 END) AS inventory_cost,
       SUM(CASE WHEN v.status IN ${IN_STOCK} THEN v.asking_price ELSE 0 END) AS inventory_asking
     FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id WHERE v.deleted_at IS NULL`,
  );

  const salesAgg = (where: string) =>
    db.get<any>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(s.selling_price),0) AS revenue, COALESCE(SUM(vc.actual_cost),0) AS cost
       FROM sales s JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id WHERE s.status = 'active' AND ${where}`,
      P,
    );
  const todaySales = salesAgg('s.sale_date = :today');
  const monthSales = salesAgg('s.sale_date >= :monthStart AND s.sale_date <= :today');
  const allSales = salesAgg('1=1');

  const OPEN = `i.is_cancelled = 0 AND ic.status = 'active' AND i.amount - i.paid_amount - i.waived_amount > 0`;
  const REM = 'i.amount - i.paid_amount - i.waived_amount';
  const rec = db.get<any>(
    `SELECT COALESCE(SUM(${REM}),0) AS outstanding,
       COALESCE(SUM(CASE WHEN i.due_date = :today THEN ${REM} END),0) AS due_today,
       SUM(CASE WHEN i.due_date = :today THEN 1 ELSE 0 END) AS due_today_count,
       COALESCE(SUM(CASE WHEN i.due_date > :today AND i.due_date <= :d7 THEN ${REM} END),0) AS due_7,
       SUM(CASE WHEN i.due_date > :today AND i.due_date <= :d7 THEN 1 ELSE 0 END) AS due_7_count,
       COALESCE(SUM(CASE WHEN i.due_date < :today THEN ${REM} END),0) AS overdue,
       SUM(CASE WHEN i.due_date < :today THEN 1 ELSE 0 END) AS overdue_count,
       COUNT(DISTINCT CASE WHEN i.due_date < :today THEN ic.customer_id END) AS overdue_customers
     FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id WHERE ${OPEN}`,
    P,
  );
  const collectedMonth = db.scalar<number>(
    `SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'valid' AND kind <> 'refund' AND pay_date >= :monthStart AND pay_date <= :today`,
    P,
  );
  const collectedToday = db.scalar<number>(`SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'valid' AND kind <> 'refund' AND pay_date = :today`, P);

  const agingRows = db.all<any>(
    `SELECT CASE WHEN d <= 30 THEN '0-30' WHEN d <= 60 THEN '31-60' WHEN d <= 90 THEN '61-90' WHEN d <= 120 THEN '91-120' ELSE '120+' END AS bucket,
            COUNT(*) AS count, SUM(cost) AS value
     FROM (SELECT CAST(julianday(:today) - julianday(v.acquisition_date) AS INTEGER) AS d, c.actual_cost AS cost
           FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id WHERE v.deleted_at IS NULL AND v.status IN ${IN_STOCK})
     GROUP BY bucket`,
    P,
  );
  const buckets = ['0-30', '31-60', '61-90', '91-120', '120+'].map((b) => {
    const r = agingRows.find((x) => x.bucket === b);
    return { bucket: b, count: r?.count ?? 0, value: fin ? (r?.value ?? 0) : null };
  });
  const threshold = getSettingNum(db, 'aging_threshold_days');
  const staleCount = db.scalar<number>(
    `SELECT COUNT(*) FROM vehicles v WHERE v.deleted_at IS NULL AND v.status IN ${IN_STOCK} AND julianday(:today) - julianday(v.acquisition_date) > :th`,
    { today: t, th: threshold },
  );

  // Last 12 months series
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(addMonths(monthStart, -i).slice(0, 7));
  const from12 = months[0] + '-01';
  const salesByMonth = db.all<any>(
    `SELECT substr(s.sale_date,1,7) AS m, COUNT(*) AS count, SUM(s.selling_price) AS revenue, SUM(s.selling_price - vc.actual_cost) AS profit
     FROM sales s JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id WHERE s.status = 'active' AND s.sale_date >= ? GROUP BY m`,
    [from12],
  );
  const collByMonth = db.all<any>(
    `SELECT substr(pay_date,1,7) AS m, SUM(amount) AS collected FROM payments WHERE status = 'valid' AND kind <> 'refund' AND pay_date >= ? GROUP BY m`,
    [from12],
  );
  const dueByMonth = db.all<any>(
    `SELECT substr(i.due_date,1,7) AS m, SUM(i.amount) AS due, SUM(i.paid_amount) AS paid FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id
     WHERE i.is_cancelled = 0 AND ic.status <> 'cancelled' AND i.due_date >= ? AND i.due_date <= ? GROUP BY m`,
    [from12, t],
  );
  const series = months.map((m) => {
    const s = salesByMonth.find((x) => x.m === m);
    const c = collByMonth.find((x) => x.m === m);
    const d = dueByMonth.find((x) => x.m === m);
    return {
      month: m,
      count: s?.count ?? 0,
      revenue: s?.revenue ?? 0,
      profit: fin ? (s?.profit ?? 0) : null,
      collected: c?.collected ?? 0,
      installments_due: d?.due ?? 0,
      installments_paid: d?.paid ?? 0,
    };
  });
  const byBrand = db
    .all<any>(
      `SELECT v.brand, COUNT(*) AS count, SUM(c.actual_cost) AS value FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id
     WHERE v.deleted_at IS NULL AND v.status IN ${IN_STOCK} GROUP BY v.brand ORDER BY count DESC, v.brand LIMIT 10`,
    )
    .map((r) => ({ ...r, value: fin ? r.value : null }));

  const alerts = {
    reservations_expiring: db.all(
      `SELECT r.id, r.reservation_no, r.expiry_date, c.name AS customer_name, v.brand, v.model, v.stock_no FROM reservations r JOIN customers c ON c.id = r.customer_id JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.status = 'active' AND r.expiry_date <= :d3 ORDER BY r.expiry_date LIMIT 10`,
      { d3: addDays(t, 3) },
    ),
    follow_ups_due: db.scalar<number>(
      `SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND status NOT IN ('won','lost') AND next_follow_up IS NOT NULL AND next_follow_up <= ?`,
      [t],
    ),
    top_overdue: db.all(
      `SELECT c.id AS customer_id, c.name AS customer_name, c.phone, ic.id AS contract_id, ic.contract_no, SUM(${REM}) AS overdue, MIN(i.due_date) AS oldest_due,
              CAST(julianday(:today) - julianday(MIN(i.due_date)) AS INTEGER) AS days_overdue
       FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id JOIN customers c ON c.id = ic.customer_id
       WHERE ${OPEN} AND i.due_date < :today GROUP BY ic.id ORDER BY overdue DESC LIMIT 5`,
      P,
    ),
  };

  const k = (x: any) => ({
    count: x.count,
    revenue: x.revenue,
    cost: fin ? x.cost : null,
    profit: fin ? x.revenue - x.cost : null,
    margin: fin ? marginPct(x.revenue - x.cost, x.revenue) : null,
    average: x.count ? Math.round(x.revenue / x.count) : 0,
  });
  return {
    today: t,
    financial: fin,
    inventory: {
      available: inv.available ?? 0,
      reserved: inv.reserved ?? 0,
      in_preparation: inv.in_preparation ?? 0,
      sold: inv.sold ?? 0,
      in_stock: inv.in_stock ?? 0,
      new_in_stock: inv.new_in_stock ?? 0,
      used_in_stock: inv.used_in_stock ?? 0,
      inventory_cost: fin ? (inv.inventory_cost ?? 0) : null,
      inventory_asking: inv.inventory_asking ?? 0,
      stale_count: staleCount,
      aging_threshold: threshold,
    },
    sales: { today: k(todaySales), month: k(monthSales), all: k(allSales) },
    receivables: {
      ...rec,
      due_today_count: rec.due_today_count ?? 0,
      due_7_count: rec.due_7_count ?? 0,
      overdue_count: rec.overdue_count ?? 0,
      collected_month: collectedMonth,
      collected_today: collectedToday,
    },
    aging: buckets,
    series,
    byBrand,
    alerts,
  };
}
