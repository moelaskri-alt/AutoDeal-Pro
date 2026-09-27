import { AppError } from './errors';
import { isValidDate } from './calc/dates';

const bad = (msg: string): never => {
  throw new AppError('VALIDATION', msg);
};

/** Input validation helpers. Every service validates its input before touching the database. */
export const V = {
  str(v: unknown, label: string, opts: { required?: boolean; max?: number } = {}): string | null {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (opts.required) bad(`حقل "${label}" مطلوب.`);
      return null;
    }
    if (typeof v !== 'string' && typeof v !== 'number') bad(`قيمة "${label}" غير صحيحة.`);
    const s = String(v).trim();
    if (opts.max && s.length > opts.max) bad(`حقل "${label}" يجب ألا يتجاوز ${opts.max} حرفاً.`);
    return s;
  },
  reqStr(v: unknown, label: string, max = 200): string {
    return V.str(v, label, { required: true, max }) as string;
  },
  /** Money in minor units. */
  money(v: unknown, label: string, opts: { allowZero?: boolean; required?: boolean } = {}): number {
    if (v === undefined || v === null || v === '') {
      if (opts.required === false) return 0;
      bad(`حقل "${label}" مطلوب.`);
    }
    const n = typeof v === 'string' ? Number(v) : (v as number);
    if (typeof n !== 'number' || !Number.isFinite(n)) bad(`قيمة "${label}" يجب أن تكون رقماً.`);
    if (!Number.isInteger(n)) bad(`قيمة "${label}" غير صحيحة.`);
    if (n < 0) bad(`قيمة "${label}" لا يمكن أن تكون سالبة.`);
    if (n === 0 && !opts.allowZero) bad(`قيمة "${label}" يجب أن تكون أكبر من صفر.`);
    if (!Number.isSafeInteger(n)) bad(`قيمة "${label}" كبيرة جداً.`);
    return n;
  },
  optMoney(v: unknown, label: string): number {
    return V.money(v, label, { allowZero: true, required: false });
  },
  int(v: unknown, label: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | null {
    if (v === undefined || v === null || v === '') {
      if (opts.required) bad(`حقل "${label}" مطلوب.`);
      return null;
    }
    const n = Number(v);
    if (!Number.isInteger(n)) bad(`قيمة "${label}" يجب أن تكون رقماً صحيحاً.`);
    if (opts.min !== undefined && n < opts.min) bad(`قيمة "${label}" يجب ألا تقل عن ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) bad(`قيمة "${label}" يجب ألا تزيد عن ${opts.max}.`);
    return n;
  },
  id(v: unknown, label: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) bad(`يرجى اختيار ${label}.`);
    return n;
  },
  optId(v: unknown): number | null {
    if (v === undefined || v === null || v === '' || v === 0) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) bad('قيمة مرجعية غير صحيحة.');
    return n;
  },
  date(v: unknown, label: string, required = true): string | null {
    if (v === undefined || v === null || v === '') {
      if (required) bad(`حقل "${label}" مطلوب.`);
      return null;
    }
    if (!isValidDate(v)) bad(`تاريخ "${label}" غير صحيح.`);
    return v as string;
  },
  reqDate(v: unknown, label: string): string {
    return V.date(v, label, true) as string;
  },
  oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string, fallback?: T): T {
    if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
    if (!allowed.includes(v as T)) bad(`قيمة "${label}" غير صحيحة.`);
    return v as T;
  },
  email(v: unknown): string | null {
    const s = V.str(v, 'البريد الإلكتروني', { max: 120 });
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad('البريد الإلكتروني غير صحيح.');
    return s;
  },
  phone(v: unknown, label = 'رقم الهاتف'): string | null {
    const s = V.str(v, label, { max: 30 });
    if (s && !/^[+\d][\d\s-]{5,}$/.test(s)) bad(`${label} غير صحيح.`);
    return s;
  },
};
