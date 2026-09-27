import { describe, expect, it } from 'vitest';
import { describeAudit, type AuditRow } from '../../src/renderer/lib/auditFormat';

const row = (p: Partial<AuditRow>): AuditRow => ({
  id: 1,
  created_at: '2026-09-27 08:38:00',
  user_id: 1,
  username: 'admin',
  action: 'create',
  module: 'customers',
  record_type: null,
  record_id: null,
  record_label: null,
  old_value: null,
  new_value: null,
  details: null,
  ...p,
});
const RAW = /[{}[\]"]|null|undefined/;

describe('audit presentation layer', () => {
  it('payment: readable summary, facts and allocation table — no raw JSON', () => {
    const v = describeAudit(
      row({
        action: 'payment',
        module: 'payments',
        record_type: 'payment',
        record_id: '12',
        record_label: 'RC-2026-00012 / IC-2026-00002',
        new_value: JSON.stringify({
          amount: 350000000,
          pay_date: '2026-09-27',
          method: 'cash',
          mode: 'manual',
          allocations: [{ installment_id: 26, amount: 350000000 }],
        }),
      }),
      'جنيه',
    );
    expect(v.summary).toBe('تسجيل تحصيل نقدي بقيمة 3,500,000 جنيه');
    expect(v.actionLabel).toBe('تسجيل تحصيل');
    expect(v.facts.map((f) => [f.label, f.value])).toEqual([
      ['المبلغ', '3,500,000 جنيه'],
      ['تاريخ التحصيل', '27/09/2026'],
      ['طريقة الدفع', 'نقدي'],
      ['طريقة التوزيع', 'يدوي (أقساط محددة)'],
    ]);
    const t = v.groups.flatMap((g) => g.tables)[0];
    expect(t.columns).toEqual(['القسط', 'المبلغ المخصص']);
    expect(t.rows).toEqual([['#26', '3,500,000 جنيه']]);
    expect(v.newCell).not.toMatch(RAW);
  });

  it('lead status change → Arabic status labels and a one-field comparison', () => {
    const v = describeAudit(
      row({
        action: 'update',
        module: 'leads',
        record_type: 'lead',
        record_label: 'طارق جمال',
        old_value: JSON.stringify({ status: 'interested', lost_reason: null }),
        new_value: JSON.stringify({ status: 'lost', lost_reason: 'اشترى من معرض آخر' }),
      }),
    );
    expect(v.summary).toBe('تغيير حالة العميل المحتمل إلى «خسارة»');
    expect(v.oldCell).toBe('الحالة: مهتم، سبب الخسارة: —');
    expect(v.newCell).toBe('الحالة: خسارة، سبب الخسارة: اشترى من معرض آخر');
    expect(v.compare?.filter((r) => r.changed).map((r) => r.label)).toEqual(['الحالة', 'سبب الخسارة']);
  });

  it('multi-field update → concise "تم تعديل" cell, full comparison in the modal', () => {
    const v = describeAudit(
      row({
        action: 'update',
        record_type: 'customer',
        old_value: JSON.stringify({ phone: '01001234567', address: 'مصر الجديدة', notes: null }),
        new_value: JSON.stringify({ phone: '01009998887', address: 'التجمع', notes: 'عميل مميز' }),
      }),
    );
    expect(v.newCell).toBe('تم تعديل: الهاتف، العنوان، ملاحظات');
    expect(v.compare).toHaveLength(3);
    expect(v.compare![0]).toMatchObject({ label: 'الهاتف', before: '01001234567', after: '01009998887', changed: true });
  });

  it('backup: long file name/path never appears in the table cells, only in notes', () => {
    const file = 'C:\\Users\\Owner\\AppData\\Roaming\\AutoDeal Pro\\backups\\AutoDealPro-manual-20260927-084932.adpbak';
    const v = describeAudit(row({ action: 'backup', module: 'backup', record_label: 'AutoDealPro-manual-20260927-084932.adpbak', details: file }));
    expect(v.summary).toBe('إنشاء نسخة احتياطية يدوية');
    expect(v.record).toBe('نسخة احتياطية يدوية');
    expect(v.oldCell).toBe('—');
    expect(v.newCell).toBe('—');
    expect(v.notes.map((n) => n.value)).toEqual(['AutoDealPro-manual-20260927-084932.adpbak', file]);
  });

  it('demo data / login / permissions / reschedule', () => {
    expect(describeAudit(row({ action: 'seed_demo', module: 'settings', details: '{"vehicles":20,"customers":6,"sales":5}' })).sub).toBe(
      'السيارات: 20، العملاء: 6، المبيعات: 5',
    );
    expect(describeAudit(row({ action: 'login', module: 'auth', record_type: 'user', record_id: '1', record_label: 'admin' })).summary).toBe(
      'تسجيل دخول إلى النظام',
    );
    const p = describeAudit(
      row({
        action: 'update_permissions',
        module: 'users',
        record_type: 'role',
        record_label: 'sales',
        old_value: '["leads.manage","sales.view"]',
        new_value: '["sales.view","reports.view"]',
      }),
    );
    expect(p.summary).toBe('تعديل صلاحيات دور «مندوب مبيعات»');
    expect(p.permissions).toEqual({ added: ['عرض التقارير'], removed: ['إدارة العملاء المحتملين والمتابعات'] });
    const r = describeAudit(
      row({
        action: 'reschedule',
        module: 'installments',
        record_type: 'contract',
        old_value: JSON.stringify([{ id: 9, seq: 3, due_date: '2026-10-12', amount: 6000000, paid_amount: 0, waived_amount: 0 }]),
        new_value: JSON.stringify([
          { seq: 4, due_date: '2026-10-27', amount: 3000000 },
          { seq: 5, due_date: '2026-11-27', amount: 3000000 },
        ]),
        details: 'طلب العميل',
      }),
    );
    expect(r.summary).toBe('إعادة جدولة العقد: 2 قسط جديد بإجمالي 60,000 ج.م');
    expect(r.sub).toBe('السبب: طلب العميل');
    expect(r.schedules.map((t) => t.rows.length)).toEqual([1, 2]);
  });

  it('unknown/empty values never render as null / {} / []', () => {
    const v = describeAudit(
      row({
        action: 'delete',
        module: 'customers',
        record_label: 'C-1 x',
        old_value: JSON.stringify({ id: 3, name: 'x', phone2: null, notes: '', extra: {} }),
      }),
    );
    const all = [v.oldCell, v.newCell, v.summary, ...v.groups.flatMap((g) => g.fields.map((f) => f.value))].join(' ');
    expect(all).not.toMatch(RAW);
    expect(v.groups[0].title).toBe('البيانات قبل الحذف');
  });
});
