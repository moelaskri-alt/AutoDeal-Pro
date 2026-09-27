import { useEffect, useState } from 'react';
import { call, useApi } from '../lib/api';
import { useAction } from '../lib/actions';
import { Field, PageHeader, Select, Spinner, TextArea, TextInput, NumberInput, DL } from '../components/common';

export function SettingsPage() {
  const { data } = useApi<Record<string, string>>('settings.get', undefined, { live: false });
  const info = useApi<any>('app.info', undefined, { live: false });
  const [s, setS] = useState<Record<string, string> | null>(null);
  const { run, busy } = useAction();
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (!s) return <Spinner />;
  const set = (k: string, v: any) => setS({ ...s, [k]: v == null ? '' : String(v) });
  const num = (k: string) => (s[k] === '' ? null : Number(s[k]));
  return (
    <div className="stack">
      <PageHeader title="الإعدادات" sub="بيانات المعرض وقواعد العمل" actions={<button className="btn primary" disabled={busy} onClick={() => run(() => call('settings.save', s), 'تم حفظ الإعدادات')}>حفظ الإعدادات</button>} />
      <div className="grid-2">
        <div className="card card-b">
          <div className="form-grid">
            <div className="form-section">بيانات المعرض (تظهر في المطبوعات)</div>
            <Field label="اسم المعرض" required full><TextInput value={s.company_name} onChange={(v) => set('company_name', v)} /></Field>
            <Field label="الهاتف"><TextInput value={s.company_phone} onChange={(v) => set('company_phone', v)} ltr /></Field>
            <Field label="الرقم الضريبي / السجل"><TextInput value={s.company_tax_no} onChange={(v) => set('company_tax_no', v)} ltr /></Field>
            <Field label="العنوان" full><TextInput value={s.company_address} onChange={(v) => set('company_address', v)} /></Field>
            <Field label="العملة (الرمز المطبوع)"><TextInput value={s.currency} onChange={(v) => set('currency', v)} /></Field>
            <Field label="تذييل الإيصالات"><TextInput value={s.receipt_footer} onChange={(v) => set('receipt_footer', v)} /></Field>
            <Field label="شروط عقد البيع" full><TextArea value={s.contract_terms} onChange={(v) => set('contract_terms', v)} rows={5} /></Field>
          </div>
        </div>
        <div className="stack">
          <div className="card card-b">
            <div className="form-grid">
              <div className="form-section">قواعد العمل</div>
              <Field label="حد السيارة الراكدة (يوم)" hint="تظهر السيارات التي تتجاوزه في التنبيهات وتقرير الأعمار"><NumberInput value={num('aging_threshold_days')} onChange={(v) => set('aging_threshold_days', v)} min={1} /></Field>
              <Field label="مدة الحجز الافتراضية (يوم)"><NumberInput value={num('reservation_default_days')} onChange={(v) => set('reservation_default_days', v)} min={1} /></Field>
              <Field label="صلاحية عرض السعر (يوم)"><NumberInput value={num('quotation_validity_days')} onChange={(v) => set('quotation_validity_days', v)} min={1} /></Field>
              <Field label="تقريب الأقساط المتساوية" hint="الفرق يُضاف للقسط الأخير">
                <Select value={s.installment_rounding} onChange={(v) => set('installment_rounding', v)} options={[['1', 'بدون تقريب (قروش)'], ['100', 'أقرب 1 جنيه'], ['1000', 'أقرب 10 جنيه'], ['10000', 'أقرب 100 جنيه']]} />
              </Field>
            </div>
          </div>
          <div className="card card-b">
            <h3 style={{ marginBottom: 8 }}>معلومات النظام</h3>
            {info.data && <DL items={[['الإصدار', info.data.version], ['ملف قاعدة البيانات', <span className="num small">{info.data.dbPath}</span>], ['مجلد النسخ الاحتياطي', <span className="num small">{info.data.backupDir}</span>], ['سجل التطبيق', <span className="num small">{info.data.logPath}</span>], ['SQLite', info.data.sqlite], ['Electron', info.data.electron]]} />}
          </div>
        </div>
      </div>
    </div>
  );
}
