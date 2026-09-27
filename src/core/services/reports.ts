import type { Db } from '../db/database';
import { type Ctx, requirePerm, today } from '../context';
import { fail } from '../errors';
import { getSettingNum } from './common';
import { SQL_INSTALLMENT_STATUS } from '../calc/installments';
import { marginPct } from '../calc/money';

export type ColType = 'text' | 'money' | 'int' | 'date' | 'pct' | 'status';
export interface Column {
  key: string;
  label: string;
  type?: ColType;
  total?: boolean;
}
export type FilterKey = 'date' | 'brand' | 'customer' | 'salesperson' | 'condition' | 'category' | 'supplier' | 'vstatus' | 'sale_type';

export interface ReportDef {
  id: string;
  group: string;
  title: string;
  description: string;
  financial?: boolean;
  filters: FilterKey[];
  columns: Column[];
  run: (db: Db, f: ReportFilters, ctx: Ctx) => any[];
}

export interface ReportFilters {
  from?: string;
  to?: string;
  brand?: string;
  customer_id?: number;
  salesperson_id?: number;
  condition?: string;
  category?: string;
  supplier_id?: number;
  vstatus?: string;
  sale_type?: string;
}

const IN_STOCK = `('available','reserved','preparation','maintenance','returned')`;

/** Builds WHERE fragments + params from the common filters. */
function w(f: ReportFilters, map: Partial<Record<keyof ReportFilters | 'date', string>>, base: string[] = []) {
  const where = [...base];
  const params: Record<string, unknown> = {};
  if (map.date && f.from) {
    where.push(`${map.date} >= :from`);
    params.from = f.from;
  }
  if (map.date && f.to) {
    where.push(`${map.date} <= :to`);
    params.to = f.to;
  }
  const eq = (k: keyof ReportFilters) => {
    const col = map[k];
    const val = f[k];
    if (col && val !== undefined && val !== null && val !== '' && val !== 'all') {
      where.push(`${col} = :${k}`);
      params[k] = val;
    }
  };
  (['brand', 'customer_id', 'salesperson_id', 'condition', 'category', 'supplier_id', 'vstatus', 'sale_type'] as const).forEach(eq);
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

const withMargin = (rows: any[], profitKey = 'gross_profit', revenueKey = 'selling_price') =>
  rows.map((r) => ({ ...r, margin: marginPct(r[profitKey] ?? 0, r[revenueKey] ?? 0) }));

const VEH_COLS: Column[] = [
  { key: 'stock_no', label: 'رقم المخزون' },
  { key: 'vehicle', label: 'السيارة' },
  { key: 'model_year', label: 'السنة', type: 'int' },
  { key: 'condition', label: 'الحالة', type: 'status' },
];
const vehLabel = `v.brand || ' ' || v.model || COALESCE(' ' || v.trim, '')`;

export const REPORTS: ReportDef[] = [
  // ------------------------------------------------------------ Inventory
  {
    id: 'inventory_current',
    group: 'المخزون',
    title: 'المخزون الحالي',
    description: 'كل السيارات الموجودة في المعرض مع التكلفة والسعر والربح المتوقع وأيام التخزين.',
    financial: true,
    filters: ['brand', 'condition', 'vstatus'],
    columns: [
      ...VEH_COLS,
      { key: 'color', label: 'اللون' },
      { key: 'vin', label: 'رقم الشاسيه' },
      { key: 'status', label: 'حالة المخزون', type: 'status' },
      { key: 'days', label: 'أيام بالمخزون', type: 'int' },
      { key: 'actual_cost', label: 'التكلفة الفعلية', type: 'money', total: true },
      { key: 'asking_price', label: 'السعر المطلوب', type: 'money', total: true },
      { key: 'min_price', label: 'الحد الأدنى', type: 'money', total: true },
      { key: 'expected_profit', label: 'الربح المتوقع', type: 'money', total: true },
      { key: 'margin', label: 'الهامش المتوقع %', type: 'pct' },
    ],
    run: (db, f, ctx) => {
      const { where, params } = w(f, { brand: 'v.brand', condition: 'v.condition', vstatus: 'v.status' }, ['v.deleted_at IS NULL', `v.status IN ${IN_STOCK}`]);
      return db
        .all<any>(
          `SELECT v.stock_no, ${vehLabel} AS vehicle, v.model_year, v.condition, v.color, v.vin, v.status,
                  CAST(julianday(:today) - julianday(v.acquisition_date) AS INTEGER) AS days, c.actual_cost, v.asking_price, v.min_price,
                  CASE WHEN v.asking_price > 0 THEN v.asking_price - c.actual_cost END AS expected_profit
           FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id ${where} ORDER BY v.brand, v.model, v.stock_no`,
          { ...params, today: today(ctx) },
        )
        .map((r) => ({ ...r, margin: r.asking_price ? marginPct(r.expected_profit, r.asking_price) : null }));
    },
  },
  {
    id: 'inventory_by_brand',
    group: 'المخزون',
    title: 'المخزون حسب الماركة',
    description: 'عدد السيارات وقيمتها بالتكلفة وبسعر البيع لكل ماركة.',
    financial: true,
    filters: ['condition'],
    columns: [
      { key: 'brand', label: 'الماركة' },
      { key: 'count', label: 'العدد', type: 'int', total: true },
      { key: 'new_count', label: 'جديدة', type: 'int', total: true },
      { key: 'used_count', label: 'مستعملة', type: 'int', total: true },
      { key: 'cost', label: 'القيمة بالتكلفة', type: 'money', total: true },
      { key: 'asking', label: 'القيمة بسعر البيع', type: 'money', total: true },
      { key: 'avg_days', label: 'متوسط أيام التخزين', type: 'int' },
    ],
    run: (db, f, ctx) => {
      const { where, params } = w(f, { condition: 'v.condition' }, ['v.deleted_at IS NULL', `v.status IN ${IN_STOCK}`]);
      return db.all(
        `SELECT v.brand, COUNT(*) AS count, SUM(v.condition = 'new') AS new_count, SUM(v.condition = 'used') AS used_count, SUM(c.actual_cost) AS cost,
                SUM(v.asking_price) AS asking, CAST(AVG(julianday(:today) - julianday(v.acquisition_date)) AS INTEGER) AS avg_days
         FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id ${where} GROUP BY v.brand ORDER BY count DESC`,
        { ...params, today: today(ctx) },
      );
    },
  },
  {
    id: 'inventory_by_model',
    group: 'المخزون',
    title: 'المخزون حسب الموديل',
    description: 'تفصيل المخزون لكل ماركة وموديل وسنة.',
    financial: true,
    filters: ['brand', 'condition'],
    columns: [
      { key: 'brand', label: 'الماركة' },
      { key: 'model', label: 'الموديل' },
      { key: 'model_year', label: 'السنة', type: 'int' },
      { key: 'count', label: 'العدد', type: 'int', total: true },
      { key: 'cost', label: 'القيمة بالتكلفة', type: 'money', total: true },
      { key: 'asking', label: 'القيمة بسعر البيع', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { brand: 'v.brand', condition: 'v.condition' }, ['v.deleted_at IS NULL', `v.status IN ${IN_STOCK}`]);
      return db.all(
        `SELECT v.brand, v.model, v.model_year, COUNT(*) AS count, SUM(c.actual_cost) AS cost, SUM(v.asking_price) AS asking
         FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id ${where} GROUP BY v.brand, v.model, v.model_year ORDER BY v.brand, v.model, v.model_year`,
        params,
      );
    },
  },
  {
    id: 'inventory_aging',
    group: 'المخزون',
    title: 'أعمار المخزون (السيارات الراكدة)',
    description: 'عدد الأيام منذ استلام كل سيارة مع شرائح 0-30 / 31-60 / 61-90 / 91-120 / +120 وتمييز السيارات التي تجاوزت الحد المسموح.',
    financial: true,
    filters: ['brand', 'condition'],
    columns: [
      ...VEH_COLS,
      { key: 'acquisition_date', label: 'تاريخ الاستلام', type: 'date' },
      { key: 'days', label: 'أيام بالمخزون', type: 'int' },
      { key: 'bucket', label: 'الشريحة' },
      { key: 'over_limit', label: 'تجاوز الحد' },
      { key: 'actual_cost', label: 'التكلفة الفعلية', type: 'money', total: true },
      { key: 'asking_price', label: 'السعر المطلوب', type: 'money', total: true },
    ],
    run: (db, f, ctx) => {
      const th = getSettingNum(db, 'aging_threshold_days');
      const { where, params } = w(f, { brand: 'v.brand', condition: 'v.condition' }, ['v.deleted_at IS NULL', `v.status IN ${IN_STOCK}`]);
      return db
        .all<any>(
          `SELECT v.stock_no, ${vehLabel} AS vehicle, v.model_year, v.condition, v.acquisition_date,
                  CAST(julianday(:today) - julianday(v.acquisition_date) AS INTEGER) AS days, c.actual_cost, v.asking_price
           FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id ${where} ORDER BY days DESC`,
          { ...params, today: today(ctx) },
        )
        .map((r) => ({
          ...r,
          bucket: r.days <= 30 ? '0-30' : r.days <= 60 ? '31-60' : r.days <= 90 ? '61-90' : r.days <= 120 ? '91-120' : '120+',
          over_limit: r.days > th ? `نعم (> ${th} يوم)` : 'لا',
        }));
    },
  },
  {
    id: 'inventory_value',
    group: 'المخزون',
    title: 'قيمة المخزون',
    description: 'إجمالي قيمة المخزون حسب الحالة ونوع السيارة (جديدة/مستعملة).',
    financial: true,
    filters: ['brand'],
    columns: [
      { key: 'status', label: 'حالة المخزون', type: 'status' },
      { key: 'condition', label: 'النوع', type: 'status' },
      { key: 'count', label: 'العدد', type: 'int', total: true },
      { key: 'acquisition_cost', label: 'تكلفة الاقتناء', type: 'money', total: true },
      { key: 'direct_costs', label: 'التكاليف المباشرة', type: 'money', total: true },
      { key: 'actual_cost', label: 'التكلفة الفعلية', type: 'money', total: true },
      { key: 'asking', label: 'بسعر البيع', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { brand: 'v.brand' }, ['v.deleted_at IS NULL', `v.status IN ${IN_STOCK}`]);
      return db.all(
        `SELECT v.status, v.condition, COUNT(*) AS count, SUM(c.acquisition_cost) AS acquisition_cost, SUM(c.direct_costs) AS direct_costs,
                SUM(c.actual_cost) AS actual_cost, SUM(v.asking_price) AS asking
         FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id ${where} GROUP BY v.status, v.condition ORDER BY v.status, v.condition`,
        params,
      );
    },
  },
  // ------------------------------------------------------------ Purchases
  {
    id: 'purchases_by_date',
    group: 'المشتريات',
    title: 'المشتريات حسب التاريخ',
    description: 'كل عمليات الشراء في الفترة مع المدفوع والمتبقي للموردين.',
    financial: true,
    filters: ['date', 'supplier', 'brand'],
    columns: [
      { key: 'purchase_date', label: 'التاريخ', type: 'date' },
      { key: 'purchase_no', label: 'رقم الشراء' },
      { key: 'supplier', label: 'المورد' },
      { key: 'stock_no', label: 'رقم المخزون' },
      { key: 'vehicle', label: 'السيارة' },
      { key: 'purchase_price', label: 'سعر الشراء', type: 'money', total: true },
      { key: 'paid', label: 'المدفوع', type: 'money', total: true },
      { key: 'balance', label: 'المتبقي', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 'p.purchase_date', supplier_id: 'p.supplier_id', brand: 'v.brand' });
      return db.all(
        `SELECT p.purchase_date, p.purchase_no, s.name AS supplier, v.stock_no, ${vehLabel} || ' ' || v.model_year AS vehicle, p.purchase_price,
                COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id),0) AS paid,
                p.purchase_price - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id),0) AS balance
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN vehicles v ON v.id = p.vehicle_id ${where} ORDER BY p.purchase_date, p.id`,
        params,
      );
    },
  },
  {
    id: 'purchases_by_supplier',
    group: 'المشتريات',
    title: 'المشتريات حسب المورد',
    description: 'عدد وقيمة المشتريات والرصيد المستحق لكل مورد.',
    financial: true,
    filters: ['date'],
    columns: [
      { key: 'supplier', label: 'المورد' },
      { key: 'supplier_type', label: 'النوع', type: 'status' },
      { key: 'count', label: 'عدد السيارات', type: 'int', total: true },
      { key: 'total', label: 'إجمالي المشتريات', type: 'money', total: true },
      { key: 'paid', label: 'المدفوع', type: 'money', total: true },
      { key: 'balance', label: 'الرصيد المستحق', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 'p.purchase_date' });
      return db.all(
        `SELECT s.name AS supplier, s.supplier_type, COUNT(*) AS count, SUM(p.purchase_price) AS total,
                SUM(COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id),0)) AS paid,
                SUM(p.purchase_price - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id),0)) AS balance
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id ${where} GROUP BY s.id ORDER BY total DESC`,
        params,
      );
    },
  },
  {
    id: 'purchase_cost',
    group: 'المشتريات',
    title: 'تكلفة المشتريات',
    description: 'سعر الشراء + التكاليف المباشرة = التكلفة الفعلية لكل سيارة مشتراة.',
    financial: true,
    filters: ['date', 'brand', 'supplier'],
    columns: [
      { key: 'purchase_date', label: 'تاريخ الشراء', type: 'date' },
      { key: 'stock_no', label: 'رقم المخزون' },
      { key: 'vehicle', label: 'السيارة' },
      { key: 'purchase_price', label: 'سعر الشراء', type: 'money', total: true },
      { key: 'direct_costs', label: 'التكاليف المباشرة', type: 'money', total: true },
      { key: 'actual_cost', label: 'التكلفة الفعلية', type: 'money', total: true },
      { key: 'status', label: 'الحالة', type: 'status' },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 'p.purchase_date', brand: 'v.brand', supplier_id: 'p.supplier_id' });
      return db.all(
        `SELECT p.purchase_date, v.stock_no, ${vehLabel} || ' ' || v.model_year AS vehicle, p.purchase_price, c.direct_costs, c.actual_cost, v.status
         FROM purchases p JOIN vehicles v ON v.id = p.vehicle_id JOIN v_vehicle_cost c ON c.vehicle_id = v.id ${where} ORDER BY p.purchase_date`,
        params,
      );
    },
  },
  // ------------------------------------------------------------ Sales
  {
    id: 'sales_by_date',
    group: 'المبيعات',
    title: 'المبيعات حسب التاريخ',
    description: 'تفاصيل كل عمليات البيع في الفترة.',
    filters: ['date', 'brand', 'customer', 'salesperson', 'sale_type'],
    columns: [
      { key: 'sale_date', label: 'التاريخ', type: 'date' },
      { key: 'sale_no', label: 'رقم البيع' },
      { key: 'customer', label: 'العميل' },
      { key: 'vehicle', label: 'السيارة' },
      { key: 'sale_type', label: 'طريقة البيع', type: 'status' },
      { key: 'salesperson', label: 'مندوب المبيعات' },
      { key: 'selling_price', label: 'سعر البيع', type: 'money', total: true },
      { key: 'fees', label: 'الرسوم', type: 'money', total: true },
      { key: 'total_contract_value', label: 'قيمة العقد', type: 'money', total: true },
      { key: 'down_payment', label: 'المقدم/النقدي', type: 'money', total: true },
      { key: 'financed_amount', label: 'المقسط', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(
        f,
        { date: 's.sale_date', brand: 'v.brand', customer_id: 's.customer_id', salesperson_id: 's.salesperson_id', sale_type: 's.sale_type' },
        ["s.status = 'active'"],
      );
      return db.all(
        `SELECT s.sale_date, s.sale_no, c.name AS customer, ${vehLabel} || ' ' || v.model_year AS vehicle, s.sale_type, u.full_name AS salesperson,
                s.selling_price, s.fees, s.total_contract_value, s.down_payment + s.reservation_credit AS down_payment, s.financed_amount
         FROM sales s JOIN customers c ON c.id = s.customer_id JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN users u ON u.id = s.salesperson_id
         ${where} ORDER BY s.sale_date, s.id`,
        params,
      );
    },
  },
  {
    id: 'sales_by_salesperson',
    group: 'المبيعات',
    title: 'المبيعات حسب مندوب المبيعات',
    description: 'عدد وقيمة وأرباح المبيعات لكل مندوب.',
    filters: ['date', 'brand'],
    columns: [
      { key: 'salesperson', label: 'مندوب المبيعات' },
      { key: 'count', label: 'عدد السيارات', type: 'int', total: true },
      { key: 'selling_price', label: 'إجمالي المبيعات', type: 'money', total: true },
      { key: 'average', label: 'متوسط البيع', type: 'money' },
      { key: 'gross_profit', label: 'مجمل الربح', type: 'money', total: true },
      { key: 'margin', label: 'الهامش %', type: 'pct' },
    ],
    run: (db, f, ctx) => {
      const { where, params } = w(f, { date: 's.sale_date', brand: 'v.brand' }, ["s.status = 'active'"]);
      const fin = ctx.perms.has('reports.financial');
      return withMargin(
        db.all<any>(
          `SELECT COALESCE(u.full_name, 'غير محدد') AS salesperson, COUNT(*) AS count, SUM(s.selling_price) AS selling_price,
                  CAST(AVG(s.selling_price) AS INTEGER) AS average, SUM(s.selling_price - vc.actual_cost) AS gross_profit
           FROM sales s JOIN vehicles v ON v.id = s.vehicle_id JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id LEFT JOIN users u ON u.id = s.salesperson_id
           ${where} GROUP BY s.salesperson_id ORDER BY selling_price DESC`,
          params,
        ),
      ).map((r) => (fin ? r : { ...r, gross_profit: null, margin: null }));
    },
  },
  {
    id: 'sales_by_brand',
    group: 'المبيعات',
    title: 'المبيعات حسب الماركة',
    description: 'عدد وقيمة وأرباح المبيعات لكل ماركة.',
    filters: ['date', 'condition'],
    columns: [
      { key: 'brand', label: 'الماركة' },
      { key: 'count', label: 'العدد', type: 'int', total: true },
      { key: 'selling_price', label: 'إجمالي المبيعات', type: 'money', total: true },
      { key: 'gross_profit', label: 'مجمل الربح', type: 'money', total: true },
      { key: 'margin', label: 'الهامش %', type: 'pct' },
      { key: 'avg_days', label: 'متوسط أيام البيع', type: 'int' },
    ],
    run: (db, f, ctx) => {
      const { where, params } = w(f, { date: 's.sale_date', condition: 'v.condition' }, ["s.status = 'active'"]);
      const fin = ctx.perms.has('reports.financial');
      return withMargin(
        db.all<any>(
          `SELECT v.brand, COUNT(*) AS count, SUM(s.selling_price) AS selling_price, SUM(s.selling_price - vc.actual_cost) AS gross_profit,
                  CAST(AVG(julianday(s.sale_date) - julianday(v.acquisition_date)) AS INTEGER) AS avg_days
           FROM sales s JOIN vehicles v ON v.id = s.vehicle_id JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id ${where} GROUP BY v.brand ORDER BY selling_price DESC`,
          params,
        ),
      ).map((r) => (fin ? r : { ...r, gross_profit: null, margin: null }));
    },
  },
  {
    id: 'sales_by_customer',
    group: 'المبيعات',
    title: 'المبيعات حسب العميل',
    description: 'إجمالي مشتريات كل عميل والمدفوع والرصيد.',
    filters: ['date'],
    columns: [
      { key: 'customer', label: 'العميل' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'count', label: 'عدد السيارات', type: 'int', total: true },
      { key: 'total_contract_value', label: 'قيمة العقود', type: 'money', total: true },
      { key: 'balance', label: 'الرصيد المستحق', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 's.sale_date' }, ["s.status = 'active'"]);
      return db.all(
        `SELECT c.name AS customer, c.phone, COUNT(*) AS count, SUM(s.total_contract_value) AS total_contract_value,
                COALESCE((SELECT SUM(i.amount - i.paid_amount - i.waived_amount) FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id
                          WHERE ic.customer_id = c.id AND ic.status = 'active' AND i.is_cancelled = 0),0) AS balance
         FROM sales s JOIN customers c ON c.id = s.customer_id ${where} GROUP BY c.id ORDER BY total_contract_value DESC`,
        params,
      );
    },
  },
  // ------------------------------------------------------------ Profitability
  {
    id: 'vehicle_profitability',
    group: 'الربحية',
    title: 'ربحية السيارات',
    description: 'لكل سيارة مباعة: تكلفة الشراء + التكاليف المباشرة = التكلفة الفعلية، ثم سعر البيع − التكلفة الفعلية = مجمل الربح والهامش.',
    financial: true,
    filters: ['date', 'brand', 'salesperson', 'customer', 'sale_type', 'condition'],
    columns: [
      { key: 'sale_date', label: 'تاريخ البيع', type: 'date' },
      { key: 'stock_no', label: 'رقم المخزون' },
      { key: 'vehicle', label: 'السيارة' },
      { key: 'acquisition_cost', label: 'تكلفة الشراء', type: 'money', total: true },
      { key: 'direct_costs', label: 'التكاليف المباشرة', type: 'money', total: true },
      { key: 'actual_cost', label: 'التكلفة الفعلية', type: 'money', total: true },
      { key: 'selling_price', label: 'سعر البيع', type: 'money', total: true },
      { key: 'gross_profit', label: 'مجمل الربح', type: 'money', total: true },
      { key: 'margin', label: 'الهامش %', type: 'pct' },
      { key: 'days', label: 'أيام بالمخزون', type: 'int' },
      { key: 'salesperson', label: 'المندوب' },
      { key: 'customer', label: 'العميل' },
      { key: 'sale_type', label: 'طريقة الدفع', type: 'status' },
    ],
    run: (db, f) => {
      const { where, params } = w(
        f,
        {
          date: 's.sale_date',
          brand: 'v.brand',
          salesperson_id: 's.salesperson_id',
          customer_id: 's.customer_id',
          sale_type: 's.sale_type',
          condition: 'v.condition',
        },
        ["s.status = 'active'"],
      );
      return withMargin(
        db.all<any>(
          `SELECT s.sale_date, v.stock_no, ${vehLabel} || ' ' || v.model_year AS vehicle, vc.acquisition_cost, vc.direct_costs, vc.actual_cost, s.selling_price,
                  s.selling_price - vc.actual_cost AS gross_profit, CAST(julianday(s.sale_date) - julianday(v.acquisition_date) AS INTEGER) AS days,
                  u.full_name AS salesperson, c.name AS customer, s.sale_type
           FROM sales s JOIN vehicles v ON v.id = s.vehicle_id JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id JOIN customers c ON c.id = s.customer_id
           LEFT JOIN users u ON u.id = s.salesperson_id ${where} ORDER BY s.sale_date, s.id`,
          params,
        ),
      );
    },
  },
  {
    id: 'sales_profitability',
    group: 'الربحية',
    title: 'ربحية المبيعات الشهرية',
    description: 'المبيعات والتكلفة ومجمل الربح ومصروفات البيع والمصروفات العامة وصافي الربح لكل شهر.',
    financial: true,
    filters: ['date'],
    columns: [
      { key: 'month', label: 'الشهر' },
      { key: 'count', label: 'عدد المبيعات', type: 'int', total: true },
      { key: 'revenue', label: 'المبيعات', type: 'money', total: true },
      { key: 'cost', label: 'تكلفة المبيعات', type: 'money', total: true },
      { key: 'gross_profit', label: 'مجمل الربح', type: 'money', total: true },
      { key: 'margin', label: 'الهامش %', type: 'pct' },
      { key: 'sale_expenses', label: 'مصروفات البيع', type: 'money', total: true },
      { key: 'general_expenses', label: 'مصروفات عامة', type: 'money', total: true },
      { key: 'net_profit', label: 'صافي الربح', type: 'money', total: true },
    ],
    run: (db, f) => {
      const s = w(f, { date: 's.sale_date' }, ["s.status = 'active'"]);
      const e = w(f, { date: 'e.expense_date' }, ['e.deleted_at IS NULL']);
      const sales = db.all<any>(
        `SELECT substr(s.sale_date,1,7) AS month, COUNT(*) AS count, SUM(s.selling_price) AS revenue, SUM(vc.actual_cost) AS cost
         FROM sales s JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id ${s.where} GROUP BY month`,
        s.params,
      );
      const exps = db.all<any>(
        `SELECT substr(e.expense_date,1,7) AS month, SUM(CASE WHEN e.scope = 'sale' THEN e.amount ELSE 0 END) AS sale_expenses,
                SUM(CASE WHEN e.scope = 'general' THEN e.amount ELSE 0 END) AS general_expenses
         FROM expenses e ${e.where} GROUP BY month`,
        e.params,
      );
      const months = [...new Set([...sales.map((x) => x.month), ...exps.map((x) => x.month)])].sort();
      return months.map((m) => {
        const a = sales.find((x) => x.month === m) ?? { count: 0, revenue: 0, cost: 0 };
        const b = exps.find((x) => x.month === m) ?? { sale_expenses: 0, general_expenses: 0 };
        const gp = a.revenue - a.cost;
        return {
          month: m,
          count: a.count,
          revenue: a.revenue,
          cost: a.cost,
          gross_profit: gp,
          margin: marginPct(gp, a.revenue),
          sale_expenses: b.sale_expenses,
          general_expenses: b.general_expenses,
          net_profit: gp - b.sale_expenses - b.general_expenses,
        };
      });
    },
  },
  {
    id: 'gross_margin',
    group: 'الربحية',
    title: 'هامش الربح الإجمالي',
    description: 'هامش الربح حسب الماركة ونوع السيارة وطريقة البيع.',
    financial: true,
    filters: ['date'],
    columns: [
      { key: 'brand', label: 'الماركة' },
      { key: 'condition', label: 'النوع', type: 'status' },
      { key: 'sale_type', label: 'طريقة البيع', type: 'status' },
      { key: 'count', label: 'العدد', type: 'int', total: true },
      { key: 'selling_price', label: 'المبيعات', type: 'money', total: true },
      { key: 'actual_cost', label: 'التكلفة الفعلية', type: 'money', total: true },
      { key: 'gross_profit', label: 'مجمل الربح', type: 'money', total: true },
      { key: 'margin', label: 'الهامش %', type: 'pct' },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 's.sale_date' }, ["s.status = 'active'"]);
      return withMargin(
        db.all<any>(
          `SELECT v.brand, v.condition, s.sale_type, COUNT(*) AS count, SUM(s.selling_price) AS selling_price, SUM(vc.actual_cost) AS actual_cost,
                  SUM(s.selling_price - vc.actual_cost) AS gross_profit
           FROM sales s JOIN vehicles v ON v.id = s.vehicle_id JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id ${where}
           GROUP BY v.brand, v.condition, s.sale_type ORDER BY v.brand`,
          params,
        ),
      );
    },
  },
  // ------------------------------------------------------------ Installments
  {
    id: 'installment_schedule',
    group: 'الأقساط والتحصيل',
    title: 'جدول الأقساط',
    description: 'كل الأقساط المستحقة خلال الفترة بحالاتها.',
    filters: ['date', 'customer', 'salesperson'],
    columns: [
      { key: 'due_date', label: 'تاريخ الاستحقاق', type: 'date' },
      { key: 'contract_no', label: 'رقم العقد' },
      { key: 'customer', label: 'العميل' },
      { key: 'seq', label: 'رقم القسط', type: 'int' },
      { key: 'amount', label: 'قيمة القسط', type: 'money', total: true },
      { key: 'paid_amount', label: 'المدفوع', type: 'money', total: true },
      { key: 'remaining', label: 'المتبقي', type: 'money', total: true },
      { key: 'status', label: 'الحالة', type: 'status' },
      { key: 'days_overdue', label: 'أيام التأخير', type: 'int' },
    ],
    run: (db, f, ctx) => instRows(db, f, ctx, ''),
  },
  {
    id: 'due_installments',
    group: 'الأقساط والتحصيل',
    title: 'الأقساط المستحقة',
    description: 'الأقساط غير المسددة المستحقة خلال الفترة (افتراضياً حتى اليوم).',
    filters: ['date', 'customer', 'salesperson'],
    columns: [
      { key: 'due_date', label: 'تاريخ الاستحقاق', type: 'date' },
      { key: 'contract_no', label: 'رقم العقد' },
      { key: 'customer', label: 'العميل' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'seq', label: 'رقم القسط', type: 'int' },
      { key: 'amount', label: 'قيمة القسط', type: 'money', total: true },
      { key: 'paid_amount', label: 'المدفوع', type: 'money', total: true },
      { key: 'remaining', label: 'المتبقي', type: 'money', total: true },
      { key: 'status', label: 'الحالة', type: 'status' },
    ],
    run: (db, f, ctx) => instRows(db, { ...f, to: f.to || today(ctx) }, ctx, 'AND i.amount - i.paid_amount - i.waived_amount > 0'),
  },
  {
    id: 'overdue_installments',
    group: 'الأقساط والتحصيل',
    title: 'الأقساط المتأخرة',
    description: 'الأقساط التي تجاوزت تاريخ استحقاقها ولم تُسدد بالكامل مع عدد أيام التأخير.',
    filters: ['customer', 'salesperson'],
    columns: [
      { key: 'due_date', label: 'تاريخ الاستحقاق', type: 'date' },
      { key: 'contract_no', label: 'رقم العقد' },
      { key: 'customer', label: 'العميل' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'seq', label: 'رقم القسط', type: 'int' },
      { key: 'amount', label: 'قيمة القسط', type: 'money', total: true },
      { key: 'paid_amount', label: 'المدفوع', type: 'money', total: true },
      { key: 'remaining', label: 'المتأخر', type: 'money', total: true },
      { key: 'days_overdue', label: 'أيام التأخير', type: 'int' },
    ],
    run: (db, f, ctx) =>
      instRows(db, { ...f, from: undefined, to: undefined }, ctx, 'AND i.due_date < :today AND i.amount - i.paid_amount - i.waived_amount > 0').sort(
        (a, b) => b.days_overdue - a.days_overdue,
      ),
  },
  {
    id: 'collection_report',
    group: 'الأقساط والتحصيل',
    title: 'تقرير التحصيل',
    description: 'كل المبالغ المحصلة في الفترة حسب النوع وطريقة الدفع.',
    filters: ['date', 'customer', 'salesperson'],
    columns: [
      { key: 'pay_date', label: 'التاريخ', type: 'date' },
      { key: 'receipt_no', label: 'رقم الإيصال' },
      { key: 'customer', label: 'العميل' },
      { key: 'kind', label: 'النوع', type: 'status' },
      { key: 'method', label: 'طريقة الدفع', type: 'status' },
      { key: 'reference', label: 'المرجع' },
      { key: 'ref_doc', label: 'العقد/البيع' },
      { key: 'amount', label: 'المبلغ', type: 'money', total: true },
      { key: 'user', label: 'المستخدم' },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 'p.pay_date', customer_id: 'p.customer_id', salesperson_id: 's.salesperson_id' }, ["p.status = 'valid'"]);
      return db
        .all<any>(
          `SELECT p.pay_date, p.receipt_no, c.name AS customer, p.kind, p.method, p.reference, COALESCE(ic.contract_no, s.sale_no, r.reservation_no) AS ref_doc,
                  p.amount, u.full_name AS user
           FROM payments p JOIN customers c ON c.id = p.customer_id LEFT JOIN installment_contracts ic ON ic.id = p.contract_id
           LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN reservations r ON r.id = p.reservation_id LEFT JOIN users u ON u.id = p.created_by
           ${where} ORDER BY p.pay_date, p.id`,
          params,
        )
        .map((r) => (r.kind === 'refund' ? { ...r, amount: -r.amount } : r));
    },
  },
  {
    id: 'receivables_aging',
    group: 'الأقساط والتحصيل',
    title: 'أعمار المديونيات',
    description: 'الرصيد المستحق لكل عميل موزعاً على شرائح التأخير.',
    filters: ['customer', 'salesperson'],
    columns: [
      { key: 'customer', label: 'العميل' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'not_due', label: 'غير مستحق', type: 'money', total: true },
      { key: 'd0_30', label: 'متأخر 1-30', type: 'money', total: true },
      { key: 'd31_60', label: '31-60', type: 'money', total: true },
      { key: 'd61_90', label: '61-90', type: 'money', total: true },
      { key: 'd90', label: 'أكثر من 90', type: 'money', total: true },
      { key: 'total', label: 'إجمالي الرصيد', type: 'money', total: true },
    ],
    run: (db, f, ctx) => {
      const { where, params } = w(f, { customer_id: 'ic.customer_id', salesperson_id: 's.salesperson_id' }, [
        "ic.status = 'active'",
        'i.is_cancelled = 0',
        'i.amount - i.paid_amount - i.waived_amount > 0',
      ]);
      return db.all(
        `SELECT c.name AS customer, c.phone,
           SUM(CASE WHEN d <= 0 THEN rem ELSE 0 END) AS not_due,
           SUM(CASE WHEN d BETWEEN 1 AND 30 THEN rem ELSE 0 END) AS d0_30,
           SUM(CASE WHEN d BETWEEN 31 AND 60 THEN rem ELSE 0 END) AS d31_60,
           SUM(CASE WHEN d BETWEEN 61 AND 90 THEN rem ELSE 0 END) AS d61_90,
           SUM(CASE WHEN d > 90 THEN rem ELSE 0 END) AS d90,
           SUM(rem) AS total
         FROM (SELECT ic.customer_id, i.amount - i.paid_amount - i.waived_amount AS rem, CAST(julianday(:today) - julianday(i.due_date) AS INTEGER) AS d
               FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id JOIN sales s ON s.id = ic.sale_id ${where}) x
         JOIN customers c ON c.id = x.customer_id GROUP BY c.id ORDER BY total DESC`,
        { ...params, today: today(ctx) },
      );
    },
  },
  {
    id: 'contracts_summary',
    group: 'الأقساط والتحصيل',
    title: 'ملخص عقود التقسيط',
    description: 'كل عقد: المبلغ الممول والمحصل والمتبقي والمتأخر.',
    filters: ['date', 'customer', 'salesperson'],
    columns: [
      { key: 'contract_no', label: 'رقم العقد' },
      { key: 'customer', label: 'العميل' },
      { key: 'vehicle', label: 'السيارة' },
      { key: 'sale_date', label: 'تاريخ البيع', type: 'date' },
      { key: 'financed_amount', label: 'المبلغ الممول', type: 'money', total: true },
      { key: 'paid', label: 'المحصل', type: 'money', total: true },
      { key: 'remaining', label: 'المتبقي', type: 'money', total: true },
      { key: 'overdue', label: 'المتأخر', type: 'money', total: true },
      { key: 'status', label: 'الحالة', type: 'status' },
    ],
    run: (db, f, ctx) => {
      const { where, params } = w(f, { date: 's.sale_date', customer_id: 'ic.customer_id', salesperson_id: 's.salesperson_id' }, ["ic.status <> 'cancelled'"]);
      return db.all(
        `SELECT ic.contract_no, c.name AS customer, ${vehLabel} || ' ' || v.model_year AS vehicle, s.sale_date, ic.financed_amount,
           (SELECT COALESCE(SUM(paid_amount),0) FROM installments WHERE contract_id = ic.id) AS paid,
           (SELECT COALESCE(SUM(amount - paid_amount - waived_amount),0) FROM installments WHERE contract_id = ic.id AND is_cancelled = 0) AS remaining,
           (SELECT COALESCE(SUM(amount - paid_amount - waived_amount),0) FROM installments WHERE contract_id = ic.id AND is_cancelled = 0 AND due_date < :today) AS overdue,
           ic.status
         FROM installment_contracts ic JOIN sales s ON s.id = ic.sale_id JOIN customers c ON c.id = ic.customer_id JOIN vehicles v ON v.id = s.vehicle_id
         ${where} ORDER BY s.sale_date`,
        { ...params, today: today(ctx) },
      );
    },
  },
  // ------------------------------------------------------------ Expenses
  {
    id: 'expense_by_category',
    group: 'المصروفات',
    title: 'المصروفات حسب البند',
    description: 'المصروفات العامة ومصروفات البيع حسب البند (بدون التكاليف المباشرة للسيارات).',
    financial: true,
    filters: ['date'],
    columns: [
      { key: 'category', label: 'البند', type: 'status' },
      { key: 'scope', label: 'النوع', type: 'status' },
      { key: 'count', label: 'العدد', type: 'int', total: true },
      { key: 'amount', label: 'المبلغ', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 'e.expense_date' }, ['e.deleted_at IS NULL']);
      return db.all(
        `SELECT e.category, e.scope, COUNT(*) AS count, SUM(e.amount) AS amount FROM expenses e ${where} GROUP BY e.category, e.scope ORDER BY amount DESC`,
        params,
      );
    },
  },
  {
    id: 'expense_by_vehicle',
    group: 'المصروفات',
    title: 'التكاليف المباشرة حسب السيارة',
    description: 'التكاليف المباشرة (صيانة، سمكرة، دهان، إطارات ...) المسجلة على كل سيارة – بدون سعر الشراء.',
    financial: true,
    filters: ['date', 'brand', 'category'],
    columns: [
      { key: 'stock_no', label: 'رقم المخزون' },
      { key: 'vehicle', label: 'السيارة' },
      { key: 'count', label: 'عدد البنود', type: 'int', total: true },
      { key: 'amount', label: 'إجمالي التكاليف المباشرة', type: 'money', total: true },
      { key: 'actual_cost', label: 'التكلفة الفعلية الكلية', type: 'money', total: true },
      { key: 'status', label: 'الحالة', type: 'status' },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 'e.expense_date', brand: 'v.brand', category: 'e.category' }, [
        'e.deleted_at IS NULL',
        "e.category NOT IN ('purchase','trade_in')",
      ]);
      return db.all(
        `SELECT v.stock_no, ${vehLabel} || ' ' || v.model_year AS vehicle, COUNT(*) AS count, SUM(e.amount) AS amount, vc.actual_cost, v.status
         FROM vehicle_expenses e JOIN vehicles v ON v.id = e.vehicle_id JOIN v_vehicle_cost vc ON vc.vehicle_id = v.id ${where}
         GROUP BY v.id ORDER BY amount DESC`,
        params,
      );
    },
  },
  {
    id: 'monthly_expenses',
    group: 'المصروفات',
    title: 'المصروفات الشهرية',
    description: 'المصروفات العامة ومصروفات البيع والتكاليف المباشرة للسيارات لكل شهر (كلٌ منفصل).',
    financial: true,
    filters: ['date'],
    columns: [
      { key: 'month', label: 'الشهر' },
      { key: 'general', label: 'مصروفات عامة', type: 'money', total: true },
      { key: 'sale', label: 'مصروفات بيع', type: 'money', total: true },
      { key: 'vehicle_direct', label: 'تكاليف مباشرة للسيارات', type: 'money', total: true },
      { key: 'total_overhead', label: 'إجمالي المصروفات التشغيلية', type: 'money', total: true },
    ],
    run: (db, f) => {
      const a = w(f, { date: 'e.expense_date' }, ['e.deleted_at IS NULL']);
      const b = w(f, { date: 'e.expense_date' }, ['e.deleted_at IS NULL', "e.category NOT IN ('purchase','trade_in')"]);
      const g = db.all<any>(
        `SELECT substr(e.expense_date,1,7) AS month, SUM(CASE WHEN scope='general' THEN amount ELSE 0 END) AS general, SUM(CASE WHEN scope='sale' THEN amount ELSE 0 END) AS sale
         FROM expenses e ${a.where} GROUP BY month`,
        a.params,
      );
      const v = db.all<any>(
        `SELECT substr(e.expense_date,1,7) AS month, SUM(e.amount) AS vehicle_direct FROM vehicle_expenses e ${b.where} GROUP BY month`,
        b.params,
      );
      const months = [...new Set([...g.map((x) => x.month), ...v.map((x) => x.month)])].sort();
      return months.map((m) => {
        const x = g.find((r) => r.month === m) ?? { general: 0, sale: 0 };
        const y = v.find((r) => r.month === m) ?? { vehicle_direct: 0 };
        return { month: m, general: x.general, sale: x.sale, vehicle_direct: y.vehicle_direct, total_overhead: x.general + x.sale };
      });
    },
  },
  // ------------------------------------------------------------ Trade-in
  {
    id: 'tradein_report',
    group: 'الاستبدال',
    title: 'سيارات الاستبدال (الربح المتوقع والفعلي)',
    description: 'كل سيارات الاستبدال: قيمة الاستبدال، التكلفة المتوقعة والفعلية، الربح المتوقع والفعلي.',
    financial: true,
    filters: ['date', 'brand', 'customer'],
    columns: [
      { key: 'trade_no', label: 'رقم الاستبدال' },
      { key: 'eval_date', label: 'التاريخ', type: 'date' },
      { key: 'customer', label: 'العميل' },
      { key: 'vehicle', label: 'السيارة' },
      { key: 'status', label: 'الحالة', type: 'status' },
      { key: 'trade_in_value', label: 'قيمة الاستبدال', type: 'money', total: true },
      { key: 'expected_total_cost', label: 'التكلفة المتوقعة', type: 'money', total: true },
      { key: 'expected_selling_price', label: 'سعر البيع المتوقع', type: 'money', total: true },
      { key: 'expected_profit', label: 'الربح المتوقع', type: 'money', total: true },
      { key: 'actual_cost', label: 'التكلفة الفعلية', type: 'money', total: true },
      { key: 'actual_selling_price', label: 'سعر البيع الفعلي', type: 'money', total: true },
      { key: 'actual_profit', label: 'الربح الفعلي', type: 'money', total: true },
    ],
    run: (db, f) => {
      const { where, params } = w(f, { date: 't.eval_date', brand: 't.brand', customer_id: 't.customer_id' });
      return db.all(
        `SELECT t.trade_no, t.eval_date, c.name AS customer, t.brand || ' ' || t.model || ' ' || t.model_year AS vehicle, t.status, t.trade_in_value,
                t.trade_in_value + t.expected_prep_cost AS expected_total_cost, t.expected_selling_price,
                t.expected_selling_price - t.trade_in_value - t.expected_prep_cost AS expected_profit,
                vc.actual_cost, rs.selling_price AS actual_selling_price, CASE WHEN rs.id IS NOT NULL THEN rs.selling_price - vc.actual_cost END AS actual_profit
         FROM trade_ins t JOIN customers c ON c.id = t.customer_id LEFT JOIN v_vehicle_cost vc ON vc.vehicle_id = t.vehicle_id
         LEFT JOIN sales rs ON rs.vehicle_id = t.vehicle_id AND rs.status = 'active' ${where} ORDER BY t.eval_date`,
        params,
      );
    },
  },
];

function instRows(db: Db, f: ReportFilters, ctx: Ctx, extra: string) {
  const { where, params } = w(f, { date: 'i.due_date', customer_id: 'ic.customer_id', salesperson_id: 's.salesperson_id' }, [
    'i.is_cancelled = 0',
    "ic.status <> 'cancelled'",
  ]);
  return db.all<any>(
    `SELECT i.due_date, ic.contract_no, c.name AS customer, c.phone, i.seq, i.amount, i.paid_amount, i.amount - i.paid_amount - i.waived_amount AS remaining,
            ${SQL_INSTALLMENT_STATUS('i')} AS status,
            CASE WHEN i.due_date < :today AND i.amount - i.paid_amount - i.waived_amount > 0 THEN CAST(julianday(:today) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue
     FROM installments i JOIN installment_contracts ic ON ic.id = i.contract_id JOIN customers c ON c.id = ic.customer_id JOIN sales s ON s.id = ic.sale_id
     ${where} ${extra} ORDER BY i.due_date, ic.contract_no, i.seq`,
    { ...params, today: today(ctx) },
  );
}

export function listReports(ctx: Ctx) {
  requirePerm(ctx, 'reports.view');
  const fin = ctx.perms.has('reports.financial');
  return REPORTS.filter((r) => !r.financial || fin).map(({ id, group, title, description, filters, columns, financial }) => ({
    id,
    group,
    title,
    description,
    filters,
    columns,
    financial: !!financial,
  }));
}

export function runReport(db: Db, ctx: Ctx, input: { id: string; filters?: ReportFilters }) {
  requirePerm(ctx, 'reports.view');
  const def = REPORTS.find((r) => r.id === input.id);
  if (!def) fail('NOT_FOUND', 'التقرير غير موجود.');
  if (def!.financial) requirePerm(ctx, 'reports.financial');
  const f = input.filters ?? {};
  const rows = def!.run(db, f, ctx);
  const totals: Record<string, number> = {};
  for (const c of def!.columns) {
    if (c.total) totals[c.key] = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
  }
  // Weighted margin for totals row when both profit and revenue are present.
  if (def!.columns.some((c) => c.key === 'margin')) {
    const p = totals.gross_profit ?? totals.expected_profit;
    const r = totals.selling_price ?? totals.revenue ?? totals.asking_price;
    if (p !== undefined && r) totals.margin = marginPct(p, r);
  }
  return {
    id: def!.id,
    title: def!.title,
    group: def!.group,
    description: def!.description,
    columns: def!.columns,
    rows,
    totals,
    filters: f,
    generated_at: new Date().toISOString(),
  };
}
