import type { Db } from '../db/database';
import type { Ctx } from '../context';
import { localDate } from '../calc/dates';

// ---------------------------------------------------------------- audit

export interface AuditEntry {
  action: string; // create | update | delete | cancel | override | payment | void | reschedule | login | backup | restore ...
  module: string;
  record_type?: string;
  record_id?: number | string | null;
  label?: string | null;
  old?: unknown;
  new?: unknown;
  details?: string | null;
}

export function audit(db: Db, ctx: Ctx, e: AuditEntry): void {
  db.run(
    `INSERT INTO audit_logs(user_id, username, action, module, record_type, record_id, record_label, old_value, new_value, details)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      ctx.user.id || null,
      ctx.user.username,
      e.action,
      e.module,
      e.record_type ?? null,
      e.record_id == null ? null : String(e.record_id),
      e.label ?? null,
      e.old === undefined ? null : JSON.stringify(e.old),
      e.new === undefined ? null : JSON.stringify(e.new),
      e.details ?? null,
    ],
  );
}

/** Returns only the fields whose value changed (for concise audit entries). */
export function diff(oldRow: Record<string, any>, newRow: Record<string, any>): { old: any; new: any } | null {
  const o: Record<string, any> = {};
  const n: Record<string, any> = {};
  for (const k of Object.keys(newRow)) {
    if (k === 'updated_at') continue;
    const a = oldRow[k] ?? null;
    const b = newRow[k] ?? null;
    if (a !== b) {
      o[k] = a;
      n[k] = b;
    }
  }
  return Object.keys(n).length ? { old: o, new: n } : null;
}

// ---------------------------------------------------------------- numbering

const PREFIX: Record<string, string> = {
  vehicle: 'STK',
  customer: 'C',
  purchase: 'PO',
  vexpense: 'VC',
  quotation: 'QT',
  reservation: 'RS',
  sale: 'SL',
  contract: 'IC',
  receipt: 'RC',
  tradein: 'TI',
  expense: 'EX',
};

/** Generates the next document number, e.g. SL-2026-00012 (sequence restarts yearly). */
export function nextNo(db: Db, kind: keyof typeof PREFIX | string, date?: string): string {
  const year = (date ?? localDate()).slice(0, 4);
  const name = `${kind}:${year}`;
  db.run('INSERT INTO sequences(name, next_value) VALUES (?, 1) ON CONFLICT(name) DO NOTHING', [name]);
  const n = db.scalar<number>('SELECT next_value FROM sequences WHERE name = ?', [name]);
  db.run('UPDATE sequences SET next_value = next_value + 1 WHERE name = ?', [name]);
  const width = kind === 'customer' ? 5 : 5;
  return `${PREFIX[kind] ?? kind.toUpperCase()}-${year}-${String(n).padStart(width, '0')}`;
}

// ---------------------------------------------------------------- settings

export const DEFAULT_SETTINGS: Record<string, string> = {
  company_name: 'معرض AutoDeal للسيارات',
  company_phone: '',
  company_address: '',
  company_tax_no: '',
  currency: 'ج.م',
  aging_threshold_days: '90',
  reservation_default_days: '7',
  quotation_validity_days: '14',
  installment_rounding: '100',
  auto_backup_enabled: '1',
  auto_backup_keep: '10',
  auto_backup_interval_hours: '24',
  backup_dir: '',
  last_auto_backup_at: '',
  receipt_footer: 'شكراً لتعاملكم معنا',
  contract_terms:
    'يلتزم المشتري بسداد الأقساط في مواعيدها المحددة. في حالة التأخر عن السداد يحق للمعرض اتخاذ الإجراءات القانونية اللازمة. تظل ملكية السيارة للمعرض حتى سداد كامل الثمن ما لم يتفق على غير ذلك.',
};

export function getSetting(db: Db, key: string): string {
  const v = db.scalar<string | null>('SELECT value FROM settings WHERE key = ?', [key]);
  return v ?? DEFAULT_SETTINGS[key] ?? '';
}

export function getSettingNum(db: Db, key: string): number {
  const n = Number(getSetting(db, key));
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key] ?? 0);
}

export function allSettings(db: Db): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) out[r.key] = r.value ?? '';
  return out;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

// ---------------------------------------------------------------- paging

export interface ListParams {
  page?: number;
  pageSize?: number; // 0 = all (export), capped
  sort?: string;
  dir?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, any>;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totals?: Record<string, number>;
}

export interface QuerySpec {
  select: string;
  from: string;
  where: string[];
  params: Record<string, unknown>;
  sortable: Record<string, string>;
  defaultSort: string;
  groupBy?: string;
  /** SQL select-list of aggregate totals over the full filtered set, e.g. "SUM(x) AS x". */
  totals?: string;
}

const MAX_EXPORT = 200000;

export function paged<T = any>(db: Db, q: QuerySpec, p: ListParams = {}): Paged<T> {
  const page = Math.max(1, Math.floor(Number(p.page) || 1));
  const rawSize = p.pageSize === 0 ? MAX_EXPORT : Math.floor(Number(p.pageSize) || 25);
  const pageSize = Math.min(Math.max(1, rawSize), MAX_EXPORT);
  const where = q.where.length ? `WHERE ${q.where.join(' AND ')}` : '';
  const group = q.groupBy ? `GROUP BY ${q.groupBy}` : '';
  const sortCol = (p.sort && q.sortable[p.sort]) || q.defaultSort;
  const dir = p.dir === 'asc' ? 'ASC' : p.dir === 'desc' ? 'DESC' : '';
  const order = dir ? `${sortCol} ${dir}` : sortCol;
  const base = `FROM ${q.from} ${where} ${group}`;
  const total = q.groupBy
    ? db.scalar<number>(`SELECT COUNT(*) AS c FROM (SELECT 1 ${base})`, q.params)
    : db.scalar<number>(`SELECT COUNT(*) AS c ${base}`, q.params);
  const rows = db.all<T>(`SELECT ${q.select} ${base} ORDER BY ${order} LIMIT :_limit OFFSET :_offset`, {
    ...q.params,
    _limit: pageSize,
    _offset: (page - 1) * pageSize,
  });
  let totals: Record<string, number> | undefined;
  if (q.totals) {
    totals = q.groupBy ? db.get(`SELECT ${q.totals} FROM (SELECT ${q.select} ${base})`, q.params) : db.get(`SELECT ${q.totals} ${base}`, q.params);
  }
  return { rows, total: total ?? 0, page, pageSize, totals };
}

/** Adds a LIKE search over several columns. */
export function addSearch(q: QuerySpec, search: string | undefined, cols: string[]): void {
  const s = (search ?? '').trim();
  if (!s) return;
  q.where.push(`(${cols.map((c) => `${c} LIKE :_search`).join(' OR ')})`);
  q.params._search = `%${s.replace(/[%_]/g, (m) => '\\' + m)}%`;
  q.where[q.where.length - 1] = q.where[q.where.length - 1].replace(/LIKE :_search/g, "LIKE :_search ESCAPE '\\'");
}

export function addDateRange(q: QuerySpec, col: string, from?: string, to?: string): void {
  if (from) {
    q.where.push(`${col} >= :_from`);
    q.params._from = from;
  }
  if (to) {
    q.where.push(`${col} <= :_to`);
    q.params._to = to;
  }
}

export function addEq(q: QuerySpec, col: string, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '' || value === 'all') return;
  q.where.push(`${col} = :${key}`);
  q.params[key] = value;
}
