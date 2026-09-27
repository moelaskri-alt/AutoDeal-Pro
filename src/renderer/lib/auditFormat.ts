/**
 * Presentation layer for audit-log entries.
 *
 * Audit rows are stored exactly as the services wrote them (codes + JSON snapshots). This module only
 * translates them into readable Arabic business language for the Audit Log screen; it never changes
 * what is stored, and the raw values stay available to the UI for the «البيانات التقنية» section.
 */
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct, label } from '../../core/format';
import { PERMISSIONS, ROLES } from '../../core/permissions';

export interface AuditRow {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string | null;
  action: string;
  module: string;
  record_type: string | null;
  record_id: string | null;
  record_label: string | null;
  old_value: string | null;
  new_value: string | null;
  details: string | null;
}

export interface FieldView {
  key: string;
  label: string;
  value: string;
  mono?: boolean;
}
export interface TableView {
  title: string;
  columns: string[];
  rows: string[][];
}
export interface GroupView {
  title: string;
  fields: FieldView[];
  tables: TableView[];
}
export interface CompareRow {
  key: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}
export interface AuditView {
  actionLabel: string;
  moduleLabel: string;
  tone: 'green' | 'red' | 'amber' | 'blue' | 'navy' | 'gray';
  record: string;
  recordType: string | null;
  summary: string;
  sub: string | null;
  oldCell: string;
  newCell: string;
  facts: FieldView[];
  notes: FieldView[];
  groups: GroupView[];
  compare: CompareRow[] | null;
  compareTitle: string;
  schedules: TableView[];
  permissions: { added: string[]; removed: string[] } | null;
}

// ---------------------------------------------------------------- labels

const FIELD_LABELS: Record<string, string> = {
  // people / records
  name: 'الاسم',
  full_name: 'الاسم الكامل',
  username: 'اسم المستخدم',
  phone: 'الهاتف',
  phone2: 'هاتف آخر',
  national_id: 'الرقم القومي',
  address: 'العنوان',
  email: 'البريد الإلكتروني',
  customer_type: 'نوع العميل',
  supplier_type: 'نوع المورد',
  notes: 'ملاحظات',
  description: 'الوصف',
  status: 'الحالة',
  is_active: 'الحساب مفعل',
  role_id: 'الدور',
  role: 'الدور',
  code: 'الكود',
  // links
  customer_id: 'العميل',
  vehicle_id: 'السيارة',
  supplier_id: 'المورد',
  sale_id: 'عملية البيع',
  contract_id: 'عقد التقسيط',
  installment_id: 'القسط',
  payment_id: 'الإيصال',
  lead_id: 'العميل المحتمل',
  quotation_id: 'عرض السعر',
  reservation_id: 'الحجز',
  purchase_id: 'فاتورة الشراء',
  assigned_to: 'المسؤول',
  salesperson_id: 'مندوب المبيعات',
  user_id: 'المستخدم',
  // numbers / documents
  stock_no: 'رقم المخزون',
  expense_no: 'رقم المصروف',
  receipt_no: 'رقم الإيصال',
  receipt: 'رقم الإيصال',
  contract: 'رقم العقد',
  contract_no: 'رقم العقد',
  sale_no: 'رقم البيع',
  purchase_no: 'رقم فاتورة الشراء',
  quote_no: 'رقم عرض السعر',
  reservation_no: 'رقم الحجز',
  trade_no: 'رقم الاستبدال',
  invoice_no: 'رقم الفاتورة',
  reference: 'المرجع (شيك / تحويل)',
  // vehicle
  brand: 'الماركة',
  model: 'الموديل',
  trim: 'الفئة',
  model_year: 'سنة الصنع',
  color: 'اللون',
  vin: 'رقم الشاسيه (VIN)',
  engine_no: 'رقم الموتور',
  plate_no: 'رقم اللوحة',
  mileage: 'العداد',
  transmission: 'ناقل الحركة',
  fuel_type: 'الوقود',
  body_type: 'نوع الهيكل',
  origin_country: 'بلد المنشأ',
  condition: 'الحالة الفنية',
  condition_grade: 'تقييم الحالة',
  condition_notes: 'ملاحظات الحالة',
  acquisition_type: 'طريقة الاقتناء',
  acquisition_date: 'تاريخ الاقتناء',
  // money
  amount: 'المبلغ',
  purchase_price: 'سعر الشراء',
  asking_price: 'السعر المطلوب',
  min_price: 'الحد الأدنى للسعر',
  min_price_at_sale: 'الحد الأدنى وقت البيع',
  opening_cost: 'التكلفة الافتتاحية',
  list_price: 'سعر القائمة',
  discount: 'الخصم',
  selling_price: 'سعر البيع',
  fees: 'رسوم إضافية',
  total_contract_value: 'إجمالي قيمة العقد',
  trade_in_value: 'قيمة الاستبدال',
  reservation_credit: 'خصم العربون',
  down_payment: 'المقدم',
  financed_amount: 'المبلغ المقسط',
  cost_at_sale: 'التكلفة وقت البيع',
  final_price: 'السعر النهائي',
  agreed_price: 'السعر المتفق عليه',
  budget: 'الميزانية',
  market_value: 'القيمة السوقية',
  expected_prep_cost: 'تكلفة التجهيز المتوقعة',
  expected_selling_price: 'سعر البيع المتوقع',
  expected_total_cost: 'إجمالي التكلفة المتوقعة',
  expected_profit: 'الربح المتوقع',
  expected_margin: 'هامش الربح المتوقع',
  refund: 'المبلغ المسترد',
  refund_amount: 'المبلغ المسترد',
  paid: 'المدفوع',
  paid_amount: 'المسدد',
  waived_amount: 'المعفى',
  outstanding: 'الرصيد المستحق',
  below_min: 'أقل من الحد الأدنى',
  override_reason: 'سبب تجاوز الحد الأدنى',
  // dates
  pay_date: 'تاريخ التحصيل',
  expense_date: 'تاريخ المصروف',
  sale_date: 'تاريخ البيع',
  purchase_date: 'تاريخ الشراء',
  quote_date: 'تاريخ عرض السعر',
  valid_until: 'صالح حتى',
  reservation_date: 'تاريخ الحجز',
  expiry_date: 'تاريخ انتهاء الحجز',
  due_date: 'تاريخ الاستحقاق',
  first_due_date: 'تاريخ أول قسط',
  follow_date: 'تاريخ المتابعة',
  next_follow_up: 'المتابعة القادمة',
  eval_date: 'تاريخ التقييم',
  delivered_at: 'تاريخ التسليم',
  voided_at: 'تاريخ الإلغاء',
  cancelled_at: 'تاريخ الإلغاء',
  created_at: 'تاريخ الإنشاء',
  // misc
  method: 'طريقة الدفع',
  payment_method: 'طريقة الدفع',
  mode: 'طريقة التوزيع',
  kind: 'نوع الحركة',
  category: 'البند',
  scope: 'نوع المصروف',
  payee: 'المستفيد',
  source: 'المصدر',
  interest: 'الاهتمام',
  lost_reason: 'سبب الخسارة',
  sale_type: 'نوع البيع',
  plan_type: 'نظام التقسيط',
  seq: 'رقم القسط',
  void_reason: 'سبب الإلغاء',
  cancel_reason: 'سبب الإلغاء',
  reason: 'السبب',
  // demo-data counts (details of seed_demo)
  vehicles: 'السيارات',
  customers: 'العملاء',
  sales: 'المبيعات',
  // settings
  company_name: 'اسم المعرض',
  company_phone: 'الهاتف',
  company_address: 'العنوان',
  company_tax_no: 'الرقم الضريبي / السجل',
  currency: 'العملة',
  aging_threshold_days: 'حد السيارة الراكدة (يوم)',
  reservation_default_days: 'مدة الحجز الافتراضية (يوم)',
  quotation_validity_days: 'صلاحية عرض السعر (يوم)',
  installment_rounding: 'تقريب الأقساط المتساوية',
  auto_backup_enabled: 'النسخ الاحتياطي التلقائي',
  auto_backup_keep: 'الاحتفاظ بآخر (نسخة)',
  auto_backup_interval_hours: 'النسخ التلقائي كل (ساعة)',
  backup_dir: 'مجلد النسخ الاحتياطية',
  last_auto_backup_at: 'آخر نسخة تلقائية',
  receipt_footer: 'تذييل الإيصالات',
  contract_terms: 'شروط عقد البيع',
};

const RECORD_TYPES: Record<string, string> = {
  vehicle: 'سيارة',
  customer: 'عميل',
  lead: 'عميل محتمل',
  supplier: 'مورد',
  purchase: 'فاتورة شراء',
  vehicle_expense: 'تكلفة سيارة',
  expense: 'مصروف',
  payment: 'إيصال تحصيل',
  contract: 'عقد تقسيط',
  quotation: 'عرض سعر',
  reservation: 'حجز',
  sale: 'عملية بيع',
  trade_in: 'استبدال',
  user: 'مستخدم',
  role: 'دور',
  settings: 'الإعدادات',
};

const STATUS_GROUP: Record<string, string> = {
  vehicle: 'vehicle_status',
  lead: 'lead_status',
  sale: 'sale_status',
  reservation: 'reservation_status',
  quotation: 'quotation_status',
  trade_in: 'trade_status',
  payment: 'payment_status',
  contract: 'contract_status',
};

const MONEY = new Set([
  'amount',
  'purchase_price',
  'asking_price',
  'min_price',
  'min_price_at_sale',
  'opening_cost',
  'list_price',
  'discount',
  'selling_price',
  'fees',
  'total_contract_value',
  'trade_in_value',
  'reservation_credit',
  'down_payment',
  'financed_amount',
  'cost_at_sale',
  'final_price',
  'agreed_price',
  'budget',
  'market_value',
  'expected_prep_cost',
  'expected_selling_price',
  'expected_total_cost',
  'expected_profit',
  'refund',
  'refund_amount',
  'paid',
  'paid_amount',
  'waived_amount',
  'outstanding',
]);
const DATES = new Set([
  'pay_date',
  'expense_date',
  'sale_date',
  'purchase_date',
  'quote_date',
  'valid_until',
  'reservation_date',
  'expiry_date',
  'due_date',
  'first_due_date',
  'follow_date',
  'next_follow_up',
  'eval_date',
  'delivered_at',
  'acquisition_date',
]);
const DATETIMES = new Set(['created_at', 'voided_at', 'cancelled_at', 'last_auto_backup_at']);
const BOOLS = new Set(['below_min', 'is_active', 'is_primary', 'auto_backup_enabled']);
const IDS = new Set([
  'customer_id',
  'vehicle_id',
  'supplier_id',
  'sale_id',
  'contract_id',
  'installment_id',
  'payment_id',
  'lead_id',
  'quotation_id',
  'reservation_id',
  'purchase_id',
  'assigned_to',
  'salesperson_id',
  'user_id',
]);
/** Internal bookkeeping columns: kept in «البيانات التقنية» only. */
const HIDDEN = new Set(['id', 'updated_at', 'deleted_at', 'created_by', 'password_hash', 'schedule_version', 'must_change_password', 'failed_logins']);
/** Fields that identify a record best, in order, for one-line table cells. */
const HEADLINE = [
  'name',
  'username',
  'amount',
  'final_price',
  'selling_price',
  'purchase_price',
  'trade_in_value',
  'status',
  'expiry_date',
  'delivered_at',
  'category',
  'brand',
  'phone',
];
const MODE: Record<string, string> = { auto: 'تلقائي (الأقدم أولاً)', manual: 'يدوي (أقساط محددة)' };

const TONES: Record<string, AuditView['tone']> = {
  create: 'green',
  payment: 'green',
  accept: 'green',
  early_settlement: 'green',
  deliver: 'green',
  supplier_payment: 'green',
  add_image: 'green',
  update: 'blue',
  price_change: 'amber',
  cost_change: 'amber',
  reschedule: 'amber',
  extend: 'amber',
  follow_up: 'blue',
  update_permissions: 'amber',
  reset_password: 'amber',
  change_password: 'amber',
  delete: 'red',
  cancel: 'red',
  void: 'red',
  reject: 'red',
  delete_image: 'red',
  override_min_price: 'red',
  login_failed: 'red',
  backup: 'navy',
  restore: 'navy',
  seed_demo: 'navy',
  login: 'gray',
  logout: 'gray',
  expire: 'gray',
};

export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;
export const recordTypeLabel = (t: string | null | undefined) => (t ? (RECORD_TYPES[t] ?? t) : null);
export const permissionName = (code: string) => PERMISSIONS.find((p) => p.code === code)?.name_ar ?? code;
const roleName = (code: string | null) => ROLES.find((r) => r.code === code)?.name_ar ?? code ?? '—';

// ---------------------------------------------------------------- values

export function parseJson(s: string | null | undefined): unknown {
  if (s === null || s === undefined || s === '') return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);

interface Ctx {
  module: string;
  recordType: string | null;
  currency: string;
}

const money = (v: unknown, c: Ctx) => (typeof v === 'number' ? `${fmtMoney(v)} ${c.currency}` : '—');

/** One field value as readable text ('—' when empty). Never returns raw JSON for known shapes. */
export function fmtValue(key: string, v: unknown, c: Ctx): string {
  if (isEmpty(v)) return '—';
  if (BOOLS.has(key)) return v === true || v === 1 || v === '1' ? 'نعم' : 'لا';
  if (MONEY.has(key) && typeof v === 'number') return money(v, c);
  if (DATES.has(key) && typeof v === 'string') return fmtDate(v);
  if (DATETIMES.has(key) && typeof v === 'string') return fmtDateTime(v.replace('T', ' '));
  if (IDS.has(key) && (typeof v === 'number' || typeof v === 'string')) return `#${v}`;
  if (key === 'role_id') return `#${v}`;
  if (key === 'mileage' && typeof v === 'number') return `${fmtNum(v)} كم`;
  if (key === 'expected_margin' && typeof v === 'number') return fmtPct(v);
  if (typeof v === 'string') {
    switch (key) {
      case 'status':
        return label(STATUS_GROUP[c.recordType ?? ''] ?? 'vehicle_status', v);
      case 'method':
      case 'payment_method':
        return label('pay_method', v);
      case 'category':
        return c.module === 'expenses' ? label('expense_category', v) : label('cost_category', v);
      case 'scope':
        return label('expense_scope', v);
      case 'condition':
        return label('condition', v);
      case 'condition_grade':
        return label('condition_grade', v);
      case 'customer_type':
        return label('customer_type', v);
      case 'supplier_type':
        return label('supplier_type', v);
      case 'source':
        return label('lead_source', v);
      case 'sale_type':
        return label('sale_type', v);
      case 'kind':
        return label('payment_kind', v);
      case 'acquisition_type':
        return label('acquisition_type', v);
      case 'plan_type':
        return label('plan_type', v);
      case 'mode':
        return MODE[v] ?? v;
      case 'role':
        return roleName(v);
    }
    return v;
  }
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join('، ') : `${v.length} عنصر`;
  return `${Object.keys(v as object).length} بيانات`;
}

function fieldsOf(o: Record<string, any>, c: Ctx, skip: Set<string> = new Set()): FieldView[] {
  return Object.entries(o)
    .filter(([k, v]) => !HIDDEN.has(k) && !skip.has(k) && !Array.isArray(v) && !isObj(v) && !isEmpty(v))
    .map(([k, v]) => ({ key: k, label: fieldLabel(k), value: fmtValue(k, v, c), mono: k === 'vin' || k === 'engine_no' || k === 'backup_dir' }));
}

const TABLE_TITLES: Record<string, string> = {
  allocations: 'تفاصيل التوزيع على الأقساط',
  costs: 'التكاليف المباشرة المسجلة مع الشراء',
};

function tableOf(key: string, arr: any[], c: Ctx): TableView {
  const objs = arr.filter(isObj);
  const cols = [...new Set(objs.flatMap((o) => Object.keys(o)))].filter((k) => !HIDDEN.has(k));
  return {
    title: TABLE_TITLES[key] ?? fieldLabel(key),
    columns: cols.map((k) => (key === 'allocations' && k === 'amount' ? 'المبلغ المخصص' : fieldLabel(k))),
    rows: objs.map((o) => cols.map((k) => fmtValue(k, o[k], c))),
  };
}

/** Business view of a snapshot object: its scalar fields, nested objects as groups, arrays as tables. */
function groupOf(title: string, o: Record<string, any>, c: Ctx, skip: Set<string>): GroupView[] {
  const main: GroupView = { title, fields: fieldsOf(o, c, skip), tables: [] };
  const extra: GroupView[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (skip.has(k) || HIDDEN.has(k)) continue;
    if (Array.isArray(v) && v.length && v.some(isObj)) main.tables.push(tableOf(k, v, c));
    else if (Array.isArray(v) && v.length) main.fields.push({ key: k, label: fieldLabel(k), value: fmtValue(k, v, c) });
    else if (isObj(v) && Object.keys(v).length) {
      const t = k === 'vehicle' ? 'بيانات السيارة' : fieldLabel(k);
      extra.push(...groupOf(t, v, c, new Set()));
    }
  }
  return [main, ...extra].filter((g) => g.fields.length || g.tables.length);
}

function compareOf(o: Record<string, any>, n: Record<string, any>, c: Ctx, onlyChanged: boolean): CompareRow[] {
  const keys = Object.keys(n).filter((k) => !HIDDEN.has(k));
  for (const k of Object.keys(o)) if (!keys.includes(k) && !HIDDEN.has(k) && k in n) keys.push(k);
  const rows = keys
    .filter((k) => !Array.isArray(n[k]) && !isObj(n[k]) && !Array.isArray(o[k]) && !isObj(o[k]))
    .map((k) => {
      const before = fmtValue(k, o[k], c);
      const after = fmtValue(k, n[k], c);
      return { key: k, label: fieldLabel(k), before, after, changed: before !== after };
    });
  return onlyChanged ? rows.filter((r) => r.changed) : rows;
}

const pairs = (fs: { label: string; value: string }[]) => fs.map((f) => `${f.label}: ${f.value}`).join('، ');
const listLabels = (keys: string[], max = 3) =>
  keys.length > max ? `${keys.slice(0, max).map(fieldLabel).join('، ')} و${keys.length - max} أخرى` : keys.map(fieldLabel).join('، ');

function headline(o: Record<string, any>, c: Ctx, n = 2): string {
  const f = HEADLINE.filter((k) => !isEmpty(o[k]) && !isObj(o[k]) && !Array.isArray(o[k]))
    .slice(0, n)
    .map((k) => ({ label: fieldLabel(k), value: fmtValue(k, o[k], c) }));
  if (f.length) return pairs(f);
  const all = fieldsOf(o, c);
  return all.length ? pairs(all.slice(0, n)) : '—';
}

function backupKind(file: string | null): string {
  const k = /-(manual|auto|pre_restore)-/.exec(file ?? '')?.[1];
  return k === 'auto' ? 'تلقائية' : k === 'pre_restore' ? 'أمان قبل الاستعادة' : k === 'manual' ? 'يدوية' : '';
}
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

// ---------------------------------------------------------------- main

export function describeAudit(row: AuditRow, currency = 'ج.م'): AuditView {
  const c: Ctx = { module: row.module, recordType: row.record_type, currency };
  const o = parseJson(row.old_value);
  const n = parseJson(row.new_value);
  const d = parseJson(row.details);
  const O = isObj(o) ? o : {};
  const N = isObj(n) ? n : {};
  const m = (v: unknown) => money(v, c);
  const s = (k: string, src: Record<string, any> = N) => fmtValue(k, src[k], c);
  const reason = typeof row.details === 'string' && row.details && !isObj(d) ? row.details : null;

  const v: AuditView = {
    actionLabel: label('audit_action', row.action),
    moduleLabel: label('module', row.module),
    tone: TONES[row.action] ?? 'gray',
    record: row.record_label ?? (row.record_id ? `${recordTypeLabel(row.record_type) ?? ''} #${row.record_id}`.trim() : '—'),
    recordType: recordTypeLabel(row.record_type),
    summary: `${label('audit_action', row.action)} — ${label('module', row.module)}`,
    sub: null,
    oldCell: '—',
    newCell: '—',
    facts: [],
    notes: [],
    groups: [],
    compare: null,
    compareTitle: 'القيم السابقة / الجديدة',
    schedules: [],
    permissions: null,
  };
  const factKeys: string[] = [];
  const facts = (...keys: string[]) => factKeys.push(...keys);
  const note = (l: string, value: string | null | undefined, mono = false) => value && v.notes.push({ key: l, label: l, value, mono });
  const changedKeys = isObj(o) && isObj(n) ? compareOf(O, N, c, true).map((r) => r.key) : [];
  const reasonNote = () => reason && (v.sub = `السبب: ${reason}`);
  const key = `${row.module}/${row.action}`;

  switch (true) {
    // ---- sign-in / system
    case key === 'auth/login':
      v.summary = 'تسجيل دخول إلى النظام';
      break;
    case key === 'auth/logout':
      v.summary = 'تسجيل خروج من النظام';
      break;
    case key === 'auth/login_failed':
      v.summary = `محاولة دخول فاشلة باسم المستخدم «${row.username ?? '—'}»`;
      v.sub = 'كلمة مرور غير صحيحة أو مستخدم غير موجود';
      break;
    case key === 'backup/backup': {
      const kind = backupKind(row.record_label ?? row.details);
      v.summary = `إنشاء نسخة احتياطية${kind ? ' ' + kind : ''}`;
      v.record = `نسخة احتياطية${kind ? ' ' + kind : ''}`;
      note('اسم الملف', row.record_label ?? (row.details ? fileName(row.details) : null), true);
      note('مسار الملف', row.details, true);
      break;
    }
    case key === 'backup/restore': {
      const mm = /^(.*?) \(نسخة أمان: (.*)\)$/.exec(row.details ?? '');
      v.summary = 'استعادة نسخة احتياطية';
      v.sub = 'تم حفظ نسخة أمان من البيانات قبل الاستعادة';
      v.record = 'استعادة بيانات';
      if (mm) {
        note('النسخة المستعادة', mm[1], true);
        note('نسخة الأمان قبل الاستعادة', mm[2], true);
      } else note('التفاصيل', row.details, true);
      break;
    }
    case key === 'settings/seed_demo':
      v.summary = 'تحميل البيانات التجريبية';
      v.record = 'بيانات تجريبية';
      if (isObj(d)) {
        v.facts = Object.entries(d).map(([k, x]) => ({ key: k, label: fieldLabel(k), value: fmtValue(k, x, c) }));
        v.sub = pairs(v.facts);
      }
      break;
    case key === 'settings/update':
      v.summary = `تعديل الإعدادات: ${listLabels(Object.keys(N))}`;
      v.record = 'إعدادات النظام';
      break;

    // ---- collections / installments
    case key === 'payments/payment':
      v.summary = `تسجيل تحصيل ${s('method') === '—' ? '' : s('method') + ' '}بقيمة ${m(N.amount)}`;
      if (Array.isArray(N.allocations) && N.allocations.length)
        v.sub = N.allocations.length === 1 ? `على القسط #${N.allocations[0].installment_id}` : `موزع على ${N.allocations.length} أقساط`;
      facts('amount', 'pay_date', 'method', 'mode');
      break;
    case key === 'payments/void':
      v.summary = `إلغاء إيصال تحصيل بقيمة ${m(O.amount)}`;
      reasonNote();
      facts('receipt_no', 'amount', 'pay_date', 'method', 'kind', 'reference');
      break;
    case key === 'installments/early_settlement':
      v.summary = `سداد مبكر للعقد بقيمة ${m(N.amount)}`;
      if (N.discount) v.sub = `بخصم ${m(N.discount)} من رصيد ${m(N.outstanding)}`;
      facts('outstanding', 'discount', 'amount', 'receipt');
      break;
    case key === 'installments/reschedule': {
      const sched = (arr: unknown, title: string): TableView | null =>
        Array.isArray(arr)
          ? {
              title,
              columns: ['رقم القسط', 'تاريخ الاستحقاق', 'المبلغ', 'المسدد'],
              rows: arr.map((l: any) => [String(l.seq ?? '—'), fmtDate(l.due_date), m(l.amount), l.paid_amount ? m(l.paid_amount) : '—']),
            }
          : null;
      const newTotal = Array.isArray(n) ? n.reduce((a: number, l: any) => a + (l.amount ?? 0), 0) : 0;
      v.summary = `إعادة جدولة العقد: ${Array.isArray(n) ? n.length : 0} قسط جديد بإجمالي ${m(newTotal)}`;
      reasonNote();
      v.schedules = [sched(o, 'الجدول قبل إعادة الجدولة'), sched(n, 'الجدول الجديد')].filter(Boolean) as TableView[];
      v.oldCell = Array.isArray(o) ? `${o.length} قسط` : '—';
      v.newCell = Array.isArray(n) ? `${n.length} قسط بإجمالي ${m(newTotal)}` : '—';
      break;
    }

    // ---- purchases & suppliers
    case key === 'purchases/create' && row.record_type === 'purchase': {
      const car = isObj(N.vehicle) ? [N.vehicle.brand, N.vehicle.model, N.vehicle.trim, N.vehicle.model_year].filter(Boolean).join(' ') : '';
      v.summary = `شراء سيارة ${car} بسعر ${m(N.purchase_price)}`.replace(/\s+/g, ' ');
      if (typeof N.paid === 'number') v.sub = `المدفوع للمورد: ${m(N.paid)}`;
      facts('purchase_price', 'paid', 'supplier_id');
      break;
    }
    case key === 'purchases/create':
      v.summary = `إضافة مورد: ${N.name ?? row.record_label ?? ''}`;
      break;
    case key === 'purchases/update':
      v.summary = `تعديل بيانات المورد: ${listLabels(changedKeys) || '—'}`;
      break;
    case key === 'purchases/delete':
      v.summary = `حذف المورد ${row.record_label ?? ''}`;
      break;
    case key === 'purchases/supplier_payment':
      v.summary = `دفعة للمورد بقيمة ${m(N.amount)}${N.method ? ' (' + s('method') + ')' : ''}`;
      facts('amount', 'pay_date', 'method');
      break;
    case key === 'purchases/cost_change':
      v.summary = `تعديل سعر الشراء من ${m(O.purchase_price)} إلى ${m(N.purchase_price)}`;
      reasonNote();
      break;

    // ---- vehicle costs / expenses
    case key === 'costs/create':
      v.summary = `تسجيل تكلفة ${s('category')} بقيمة ${m(N.amount)}`;
      v.sub = N.description ?? null;
      facts('amount', 'category', 'expense_date', 'payment_method');
      break;
    case key === 'costs/update':
    case key === 'expenses/update':
      v.summary = `تعديل ${row.module === 'costs' ? 'تكلفة سيارة' : 'مصروف'}: ${listLabels(changedKeys) || 'بدون تغيير في القيم'}`;
      break;
    case key === 'costs/delete':
    case key === 'expenses/delete':
      v.summary = `حذف ${row.module === 'costs' ? 'تكلفة' : 'مصروف'} ${s('category', O)} بقيمة ${m(O.amount)}`;
      break;
    case key === 'expenses/create':
      v.summary = `تسجيل ${N.scope === 'sale' ? 'مصروف بيع' : 'مصروف'} ${s('category')} بقيمة ${m(N.amount)}`;
      v.sub = N.description ?? null;
      facts('amount', 'category', 'scope', 'expense_date', 'payment_method');
      break;

    // ---- customers & leads
    case key === 'customers/create':
      v.summary = `إضافة عميل جديد: ${N.name ?? ''}`;
      break;
    case key === 'customers/update':
      v.summary = `تعديل بيانات العميل: ${listLabels(changedKeys) || '—'}`;
      break;
    case key === 'customers/delete':
      v.summary = `حذف العميل ${row.record_label ?? ''}`;
      break;
    case key === 'leads/create':
      v.summary = `إضافة عميل محتمل: ${N.name ?? ''}`;
      v.sub = N.status ? `الحالة: ${s('status')}` : null;
      break;
    case key === 'leads/update':
      if (changedKeys.includes('status')) {
        v.summary = `تغيير حالة العميل المحتمل إلى «${s('status')}»`;
        if (N.status === 'lost' && N.lost_reason) v.sub = `سبب الخسارة: ${N.lost_reason}`;
      } else v.summary = `تعديل بيانات العميل المحتمل: ${listLabels(changedKeys) || '—'}`;
      break;
    case key === 'leads/delete':
      v.summary = `حذف العميل المحتمل ${row.record_label ?? ''}`;
      break;
    case key === 'leads/follow_up':
      v.summary = `متابعة ${N.method ? label('follow_method', N.method) : ''} — الحالة: ${s('status')}`.replace(/\s+/g, ' ');
      v.sub = N.notes ?? null;
      facts('follow_date', 'method', 'status', 'next_follow_up');
      break;

    // ---- quotations / reservations / sales
    case row.module === 'quotations' && (row.action === 'create' || row.action === 'override_min_price'):
      v.summary = `عرض سعر بقيمة ${m(N.final_price)}${row.action === 'override_min_price' ? ' — أقل من الحد الأدنى' : ''}`;
      if (N.discount) v.sub = `بعد خصم ${m(N.discount)} من ${m(N.asking_price)}`;
      facts('asking_price', 'discount', 'final_price', 'customer_id', 'vehicle_id');
      break;
    case key === 'quotations/cancel':
      v.summary = 'إلغاء عرض السعر';
      reasonNote();
      break;
    case key === 'reservations/create':
      v.summary = `حجز بعربون ${m(N.amount)} حتى ${s('expiry_date')}`;
      facts('amount', 'expiry_date', 'customer_id', 'vehicle_id');
      break;
    case key === 'reservations/cancel':
      v.summary = `إلغاء الحجز${N.refund ? ' ورد ' + m(N.refund) + ' للعميل' : ''}`;
      reasonNote();
      break;
    case key === 'reservations/extend':
      v.summary = `تمديد الحجز حتى ${s('expiry_date')}`;
      break;
    case key === 'reservations/expire':
      v.summary = 'انتهاء مدة الحجز تلقائياً';
      v.sub = null;
      break;
    case row.module === 'sales' && (row.action === 'create' || row.action === 'override_min_price'):
      v.summary = `بيع ${s('sale_type')} بقيمة ${m(N.selling_price)}${row.action === 'override_min_price' ? ' — بأقل من الحد الأدنى' : ''}`;
      v.sub = N.contract ? `عقد تقسيط ${N.contract}: مقدم ${m(N.down_payment)}، مقسط ${m(N.financed_amount)}` : `إجمالي العقد ${m(N.total_contract_value)}`;
      if (row.action === 'override_min_price' && N.override_reason) v.sub = `السبب: ${N.override_reason}`;
      facts('sale_type', 'selling_price', 'total_contract_value', 'down_payment', 'financed_amount', 'contract');
      break;
    case key === 'sales/cancel':
      v.summary = `إلغاء عملية البيع${N.refund ? ' ورد ' + m(N.refund) + ' للعميل' : ''}`;
      reasonNote();
      break;
    case key === 'sales/deliver':
      v.summary = `تسليم السيارة للعميل بتاريخ ${s('delivered_at')}`;
      break;

    // ---- trade-ins
    case key === 'tradeins/create':
      v.summary = `تقييم سيارة استبدال ${[N.brand, N.model, N.model_year].filter(Boolean).join(' ')} بقيمة ${m(N.trade_in_value)}`;
      if (typeof N.expected_profit === 'number') v.sub = `الربح المتوقع: ${m(N.expected_profit)}`;
      facts('trade_in_value', 'market_value', 'expected_prep_cost', 'expected_selling_price', 'expected_profit', 'expected_margin');
      break;
    case key === 'tradeins/update':
      v.summary = `تعديل تقييم الاستبدال: ${listLabels(changedKeys) || '—'}`;
      break;
    case key === 'tradeins/accept':
      v.summary = 'قبول الاستبدال وإضافة السيارة للمخزون';
      break;
    case key === 'tradeins/reject':
      v.summary = 'رفض الاستبدال';
      reasonNote();
      break;

    // ---- users
    case key === 'users/create':
      v.summary = `إضافة مستخدم جديد: ${N.username ?? ''}`;
      break;
    case key === 'users/update':
      v.summary = `تعديل بيانات المستخدم: ${listLabels(changedKeys) || '—'}`;
      break;
    case key === 'users/reset_password':
      v.summary = `إعادة تعيين كلمة مرور المستخدم ${row.record_label ?? ''}`;
      break;
    case key === 'users/change_password':
      v.summary = 'تغيير كلمة المرور الخاصة بالمستخدم';
      break;
    case key === 'users/update_permissions': {
      const before = Array.isArray(o) ? (o as string[]) : [];
      const after = Array.isArray(n) ? (n as string[]) : [];
      const added = after.filter((p) => !before.includes(p));
      const removed = before.filter((p) => !after.includes(p));
      v.permissions = { added: added.map(permissionName), removed: removed.map(permissionName) };
      v.record = `دور: ${roleName(row.record_label)}`;
      v.summary = `تعديل صلاحيات دور «${roleName(row.record_label)}»`;
      v.sub = [added.length && `إضافة ${added.length}`, removed.length && `إزالة ${removed.length}`].filter(Boolean).join('، ') || 'بدون تغيير';
      v.oldCell = `${before.length} صلاحية`;
      v.newCell = `${after.length} صلاحية`;
      break;
    }

    // ---- vehicles
    case key === 'vehicles/create':
      v.summary = `إضافة سيارة: ${[N.brand, N.model, N.trim, N.model_year].filter(Boolean).join(' ')}`;
      facts('asking_price', 'min_price', 'opening_cost');
      break;
    case key === 'vehicles/update':
      v.summary =
        changedKeys.length === 1 && changedKeys[0] === 'status'
          ? `تغيير حالة السيارة إلى «${s('status')}»`
          : `تعديل بيانات السيارة: ${listLabels(changedKeys) || '—'}`;
      break;
    case key === 'vehicles/price_change':
      v.summary =
        O.asking_price !== N.asking_price
          ? `تعديل السعر المطلوب من ${m(O.asking_price)} إلى ${m(N.asking_price)}`
          : `تعديل الحد الأدنى للسعر من ${m(O.min_price)} إلى ${m(N.min_price)}`;
      break;
    case key === 'vehicles/delete':
      v.summary = `حذف السيارة ${row.record_label ?? ''}`;
      break;
    case key === 'vehicles/add_image':
      v.summary = 'إضافة صورة للسيارة';
      break;
    case key === 'vehicles/delete_image':
      v.summary = 'حذف صورة من السيارة';
      break;
    default:
      if (reason) reasonNote();
  }
  v.summary = v.summary.replace(/\s+/g, ' ').trim();
  // Any reason text the services stored (details) that the summary did not already present.
  if (reason && !v.sub && !v.notes.length && row.module !== 'backup') note('ملاحظات العملية', reason);

  // ---- facts / business data / comparison
  const src = isObj(n) ? N : isObj(o) ? O : null;
  if (src && factKeys.length) v.facts = factKeys.filter((k) => !isEmpty(src[k])).map((k) => ({ key: k, label: fieldLabel(k), value: fmtValue(k, src[k], c) }));
  const factSet = new Set(factKeys);
  const isChange = isObj(o) && isObj(n);
  if (isChange) {
    const onlyChanged = row.action === 'update' || row.module === 'settings';
    v.compare = compareOf(O, N, c, onlyChanged);
    if (!onlyChanged) {
      // extra fields recorded only on the new side (e.g. refund on cancel) — show them as "after" values
      for (const r of v.compare) if (r.before === '—' && r.after !== '—') r.changed = true;
    }
    if (v.oldCell === '—' && v.newCell === '—') {
      const ch = v.compare.filter((r) => r.changed);
      if (ch.length && ch.length <= 2) {
        v.oldCell = pairs(ch.map((r) => ({ label: r.label, value: r.before })));
        v.newCell = pairs(ch.map((r) => ({ label: r.label, value: r.after })));
      } else if (ch.length) {
        v.oldCell = `القيم السابقة لـ ${ch.length} حقول`;
        v.newCell = `تم تعديل: ${listLabels(ch.map((r) => r.key))}`;
      } else v.newCell = 'بدون تغيير في القيم';
    }
    const extras = groupOf('بيانات إضافية', N, c, new Set([...Object.keys(O), ...factSet]));
    v.groups = extras.filter((g) => g.tables.length || g.fields.length);
  } else if (isObj(n)) {
    v.groups = groupOf('بيانات العملية', N, c, factSet);
    if (v.newCell === '—') v.newCell = headline(N, c);
  } else if (isObj(o)) {
    v.groups = groupOf(row.action === 'delete' ? 'البيانات قبل الحذف' : 'البيانات قبل الإلغاء', O, c, factSet);
    if (v.oldCell === '—') v.oldCell = headline(O, c);
  }
  // A money payment's allocation table is always worth showing even though "amount" is a fact.
  if (isObj(n) && Array.isArray(N.allocations) && !v.groups.some((g) => g.tables.some((t) => t.title === TABLE_TITLES.allocations)))
    v.groups.push({ title: 'تفاصيل التوزيع', fields: [], tables: [tableOf('allocations', N.allocations, c)] });
  return v;
}

/** Pretty-prints a stored JSON column for the technical section (unchanged text when it is not JSON). */
export function prettyRaw(s: string | null): string {
  if (!s) return '';
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
