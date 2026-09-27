import type { Db } from '../db/database';
import { type Ctx, requirePerm } from '../context';
import { fail } from '../errors';
import { addDateRange, addEq, addSearch, allSettings, audit, DEFAULT_SETTINGS, paged, setSetting, type ListParams, type QuerySpec } from './common';

export function listAudit(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'audit.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: 'a.*',
    from: 'audit_logs a',
    where: [],
    params: {},
    sortable: { created_at: 'a.id' },
    defaultSort: 'a.id DESC',
  };
  addSearch(q, p.search, ['a.record_label', 'a.username', 'a.details', 'a.record_id']);
  addEq(q, 'a.module', 'module', f.module);
  addEq(q, 'a.action', 'action', f.action);
  addEq(q, 'a.user_id', 'user_id', f.user_id);
  addEq(q, 'a.record_id', 'record_id', f.record_id);
  addDateRange(q, 'date(a.created_at)', f.from, f.to);
  return paged(db, q, p);
}

/** Settings readable by everyone logged in (company info for printing etc.). */
export function getSettings(db: Db, _ctx: Ctx) {
  return allSettings(db);
}

const NUMERIC = [
  'aging_threshold_days',
  'reservation_default_days',
  'quotation_validity_days',
  'installment_rounding',
  'auto_backup_keep',
  'auto_backup_interval_hours',
];

export function saveSettings(db: Db, ctx: Ctx, input: Record<string, string>) {
  requirePerm(ctx, 'settings.manage');
  if (!input || typeof input !== 'object') fail('VALIDATION', 'بيانات الإعدادات غير صحيحة.');
  const old = allSettings(db);
  const changes: Record<string, { old: string; new: string }> = {};
  for (const [k, raw] of Object.entries(input)) {
    if (!(k in DEFAULT_SETTINGS) || k === 'last_auto_backup_at') continue;
    const v = raw == null ? '' : String(raw).trim();
    if (NUMERIC.includes(k)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 1000000) fail('VALIDATION', 'قيمة رقمية غير صحيحة في الإعدادات.');
    }
    if (k === 'company_name' && !v) fail('VALIDATION', 'اسم المعرض مطلوب.');
    if (v.length > 4000) fail('VALIDATION', 'قيمة طويلة جداً في الإعدادات.');
    if (old[k] !== v) changes[k] = { old: old[k], new: v };
  }
  db.tx(() => {
    for (const [k, c] of Object.entries(changes)) setSetting(db, k, c.new);
    if (Object.keys(changes).length)
      audit(db, ctx, {
        action: 'update',
        module: 'settings',
        record_type: 'settings',
        old: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.old])),
        new: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.new])),
      });
  });
  return allSettings(db);
}
