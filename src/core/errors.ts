/**
 * Business errors carry a user-facing Arabic message. Technical errors are translated
 * by `toAppError` so the UI never shows raw SQLite messages or stack traces.
 */
export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const fail = (code: string, message: string, details?: unknown): never => {
  throw new AppError(code, message, details);
};

export function assert(cond: unknown, code: string, message: string): asserts cond {
  if (!cond) throw new AppError(code, message);
}

const UNIQUE_MESSAGES: [RegExp, string][] = [
  [/vehicles\.vin/i, 'رقم الشاسيه (VIN) مسجل مسبقاً لسيارة أخرى.'],
  [/vehicles\.engine_no/i, 'رقم المحرك مسجل مسبقاً لسيارة أخرى.'],
  [/vehicles\.stock_no/i, 'رقم المخزون مستخدم مسبقاً.'],
  [/customers\.national_id/i, 'الرقم القومي مسجل مسبقاً لعميل آخر.'],
  [/users\.username/i, 'اسم المستخدم مستخدم مسبقاً.'],
  [/sales\.vehicle_id/i, 'هذه السيارة مباعة بالفعل ولا يمكن بيعها مرة أخرى.'],
  [/reservations\.vehicle_id/i, 'يوجد حجز نشط لهذه السيارة بالفعل.'],
  [/purchases\.vehicle_id/i, 'تم تسجيل عملية شراء لهذه السيارة مسبقاً.'],
  [/installment_contracts\.sale_id/i, 'يوجد عقد تقسيط لهذه البيعة بالفعل.'],
];

const RAISE_MESSAGES: Record<string, string> = {
  VEHICLE_ALREADY_SOLD: 'لا يمكن تنفيذ العملية لأن السيارة مباعة.',
  AUDIT_IMMUTABLE: 'سجل المراجعة لا يمكن تعديله أو حذفه.',
  ALLOCATION_IMMUTABLE: 'لا يمكن تعديل توزيع دفعة مسجلة؛ قم بإلغاء الدفعة وإعادة تسجيلها.',
};

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  for (const [code, text] of Object.entries(RAISE_MESSAGES)) {
    if (msg.includes(code)) return new AppError(code, text);
  }
  if (/UNIQUE constraint failed/i.test(msg)) {
    for (const [re, text] of UNIQUE_MESSAGES) if (re.test(msg)) return new AppError('DUPLICATE', text);
    return new AppError('DUPLICATE', 'هذه البيانات مسجلة مسبقاً ولا يمكن تكرارها.');
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    return new AppError('REFERENCED', 'لا يمكن تنفيذ العملية لأن السجل مرتبط بعمليات أخرى أو أن أحد السجلات المرتبطة غير موجود.');
  }
  if (/CHECK constraint failed: .*paid_amount/i.test(msg)) {
    return new AppError('OVERPAYMENT', 'المبلغ المدفوع يتجاوز قيمة القسط المتبقية.');
  }
  if (/CHECK constraint failed/i.test(msg)) {
    return new AppError('INVALID_DATA', 'البيانات المدخلة غير متسقة. يرجى مراجعة المبالغ والتواريخ.');
  }
  if (/NOT NULL constraint failed/i.test(msg)) {
    return new AppError('REQUIRED', 'يرجى استكمال الحقول المطلوبة.');
  }
  if (/database is locked|SQLITE_BUSY/i.test(msg)) {
    return new AppError('BUSY', 'قاعدة البيانات مشغولة حالياً، يرجى المحاولة مرة أخرى.');
  }
  return new AppError('UNEXPECTED', 'حدث خطأ غير متوقع. تم تسجيل التفاصيل في سجل التطبيق.');
}
