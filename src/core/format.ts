/** Shared formatting + Arabic labels (used by the UI and the printable documents). */

export function fmtMoney(minor: number | null | undefined, opts: { currency?: string; decimals?: boolean } = {}): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return '—';
  const major = minor / 100;
  const hasFraction = Math.round(minor) % 100 !== 0;
  const s = major.toLocaleString('en-US', {
    minimumFractionDigits: opts.decimals || hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return opts.currency ? `${s} ${opts.currency}` : s;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US');
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toFixed(2)}%`;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = s.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : s;
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return `${fmtDate(s)} ${s.slice(11, 16)}`;
}

export const LABELS: Record<string, Record<string, string>> = {
  vehicle_status: {
    available: 'متاحة',
    reserved: 'محجوزة',
    sold: 'مباعة',
    delivered: 'تم التسليم',
    preparation: 'تحت التجهيز',
    maintenance: 'تحت الصيانة',
    returned: 'مرتجعة',
  },
  condition: { new: 'جديدة', used: 'مستعملة' },
  acquisition_type: { purchase: 'شراء', trade_in: 'استبدال', opening: 'رصيد افتتاحي' },
  cost_category: {
    purchase: 'سعر الشراء',
    trade_in: 'قيمة الاستبدال',
    transport: 'نقل',
    customs: 'جمارك',
    registration: 'ترخيص وتسجيل',
    maintenance: 'صيانة',
    parts: 'قطع غيار',
    bodywork: 'سمكرة',
    paint: 'دهان',
    tires: 'إطارات',
    detailing: 'تنظيف وتلميع',
    insurance: 'تأمين',
    accessories: 'إكسسوارات',
    other: 'تكاليف مباشرة أخرى',
  },
  expense_category: {
    rent: 'إيجار',
    salaries: 'رواتب',
    electricity: 'كهرباء ومرافق',
    marketing: 'تسويق وإعلان',
    transportation: 'انتقالات ونقل',
    maintenance: 'صيانة المعرض',
    office: 'مصروفات مكتبية',
    commission: 'عمولات',
    other: 'أخرى',
  },
  expense_scope: { general: 'مصروف عام', sale: 'مصروف بيع' },
  pay_method: { cash: 'نقدي', bank_transfer: 'تحويل بنكي', cheque: 'شيك', card: 'بطاقة', credit: 'آجل', other: 'أخرى' },
  sale_type: {
    cash: 'نقدي',
    installments: 'تقسيط',
    trade_in_cash: 'استبدال + نقدي',
    trade_in_installments: 'استبدال + تقسيط',
  },
  sale_status: { active: 'سارية', cancelled: 'ملغاة' },
  installment_status: {
    not_due: 'غير مستحق',
    due_today: 'مستحق اليوم',
    paid: 'مسدد',
    partially_paid: 'مسدد جزئياً',
    overdue: 'متأخر',
    cancelled: 'ملغي',
  },
  contract_status: { active: 'نشط', settled: 'مسدد بالكامل', cancelled: 'ملغي' },
  plan_type: { equal: 'أقساط متساوية', custom: 'جدول مخصص', balloon: 'أقساط + دفعة أخيرة' },
  payment_kind: {
    reservation: 'عربون حجز',
    down_payment: 'مقدم',
    cash_sale: 'سداد نقدي',
    installment: 'قسط',
    early_settlement: 'سداد مبكر',
    refund: 'رد مبلغ',
  },
  payment_status: { valid: 'سارية', voided: 'ملغاة' },
  reservation_status: { active: 'نشط', expired: 'منتهي', cancelled: 'ملغي', converted: 'تحول لبيع' },
  quotation_status: { open: 'مفتوح', reserved: 'تحول لحجز', sold: 'تحول لبيع', expired: 'منتهي', cancelled: 'ملغي' },
  lead_status: {
    new: 'جديد',
    contacted: 'تم التواصل',
    interested: 'مهتم',
    negotiating: 'تفاوض',
    reserved: 'حجز',
    won: 'تم البيع',
    lost: 'خسارة',
  },
  lead_source: {
    walk_in: 'زيارة المعرض',
    facebook: 'فيسبوك',
    instagram: 'إنستجرام',
    website: 'الموقع الإلكتروني',
    referral: 'ترشيح',
    advertisement: 'إعلان',
    other: 'أخرى',
  },
  follow_method: { call: 'مكالمة', visit: 'زيارة', whatsapp: 'واتساب', message: 'رسالة', email: 'بريد إلكتروني', other: 'أخرى' },
  supplier_type: { company: 'شركة', individual: 'فرد', dealer: 'تاجر', agent: 'وكيل', workshop: 'ورشة', other: 'أخرى' },
  customer_type: { individual: 'فرد', company: 'شركة' },
  trade_status: { evaluated: 'تم التقييم', accepted: 'مقبول', rejected: 'مرفوض' },
  condition_grade: { excellent: 'ممتازة', good: 'جيدة', fair: 'متوسطة', poor: 'ضعيفة' },
  audit_action: {
    create: 'إنشاء',
    update: 'تعديل',
    delete: 'حذف',
    cancel: 'إلغاء',
    price_change: 'تعديل سعر',
    cost_change: 'تعديل تكلفة',
    override_min_price: 'تجاوز الحد الأدنى للسعر',
    payment: 'تسجيل تحصيل',
    void: 'إلغاء تحصيل',
    reschedule: 'إعادة جدولة',
    early_settlement: 'سداد مبكر',
    login: 'تسجيل دخول',
    login_failed: 'محاولة دخول فاشلة',
    logout: 'تسجيل خروج',
    backup: 'نسخ احتياطي',
    restore: 'استعادة نسخة',
    deliver: 'تسليم سيارة',
    expire: 'انتهاء تلقائي',
    extend: 'تمديد',
    follow_up: 'متابعة',
    accept: 'قبول',
    reject: 'رفض',
    supplier_payment: 'دفعة لمورد',
    add_image: 'إضافة صورة',
    delete_image: 'حذف صورة',
    reset_password: 'إعادة تعيين كلمة المرور',
    change_password: 'تغيير كلمة المرور',
    update_permissions: 'تعديل الصلاحيات',
    seed_demo: 'تحميل بيانات تجريبية',
  },
  module: {
    auth: 'الدخول',
    vehicles: 'السيارات',
    costs: 'تكاليف السيارات',
    purchases: 'المشتريات',
    customers: 'العملاء',
    leads: 'العملاء المحتملون',
    quotations: 'عروض الأسعار',
    reservations: 'الحجوزات',
    sales: 'المبيعات',
    installments: 'التقسيط',
    payments: 'التحصيل',
    tradeins: 'الاستبدال',
    expenses: 'المصروفات',
    users: 'المستخدمون',
    settings: 'الإعدادات',
    backup: 'النسخ الاحتياطي',
  },
};

export function label(group: string, key: string | null | undefined): string {
  if (key === null || key === undefined || key === '') return '—';
  return LABELS[group]?.[key] ?? key;
}

/** Status label lookup across groups (used by generic report tables). */
export function anyLabel(key: string | null | undefined): string {
  if (key === null || key === undefined) return '—';
  for (const g of ['vehicle_status', 'condition', 'sale_type', 'installment_status', 'contract_status', 'payment_kind', 'pay_method', 'expense_category', 'expense_scope', 'trade_status', 'supplier_type']) {
    const v = LABELS[g][key];
    if (v) return v;
  }
  return key;
}

// ------------------------------------------------------------ Arabic amount in words (تفقيط)

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const o = r % 10;
      const t = Math.floor(r / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

function scale(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${below1000(n)} ${few}`;
  return `${below1000(n)} ${many}`;
}

export function numberToArabicWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1e3);
  const rest = n % 1000;
  const parts: string[] = [];
  if (billions) parts.push(scale(billions, 'مليار', 'ملياران', 'مليارات', 'مليار'));
  if (millions) parts.push(scale(millions, 'مليون', 'مليونان', 'ملايين', 'مليون'));
  if (thousands) parts.push(scale(thousands, 'ألف', 'ألفان', 'آلاف', 'ألف'));
  if (rest) parts.push(below1000(rest));
  return parts.join(' و');
}

export function amountInWords(minor: number, currencyName = 'جنيه مصري', fractionName = 'قرش'): string {
  const major = Math.floor(minor / 100);
  const fr = minor % 100;
  let s = `فقط ${numberToArabicWords(major)} ${currencyName}`;
  if (fr) s += ` و${numberToArabicWords(fr)} ${fractionName}`;
  return s + ' لا غير';
}
