import { useState } from 'react';
import { call } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, today } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import { DateInput, Field, Modal, MoneyInput, PageHeader, Select, TextArea, TextInput, optionsOf } from '../components/common';
import { Icon } from '../components/Icon';
import { fmtDate, fmtMoney, label } from '../../core/format';
import { useApi } from '../lib/api';

export function ExpensesPage() {
  const { can } = useAuth();
  const [form, setForm] = useState<any | null>(null);
  const cols: Col[] = [
    { key: 'expense_date', label: 'التاريخ', sort: 'expense_date', render: (r) => fmtDate(r.expense_date), exportType: 'date' },
    { key: 'expense_no', label: 'الرقم' },
    { key: 'scope', label: 'النوع', render: (r) => label('expense_scope', r.scope), exportValue: (r) => label('expense_scope', r.scope) },
    { key: 'category', label: 'البند', sort: 'category', render: (r) => label('expense_category', r.category), exportValue: (r) => label('expense_category', r.category) },
    { key: 'description', label: 'الوصف', wrap: true },
    { key: 'sale_no', label: 'البيع المرتبط' },
    { key: 'payee', label: 'المستفيد' },
    { key: 'payment_method', label: 'الدفع', render: (r) => label('pay_method', r.payment_method), exportValue: (r) => label('pay_method', r.payment_method) },
    { key: 'amount', label: 'المبلغ', num: true, sort: 'amount', render: (r) => <b>{fmtMoney(r.amount)}</b>, exportType: 'money', total: (t) => fmtMoney(t.amount) },
  ];
  return (
    <div>
      <PageHeader
        title="المصروفات"
        sub="المصروفات العامة (إيجار، رواتب، كهرباء، تسويق ...) ومصروفات البيع — التكاليف المباشرة للسيارات تُسجل من «تكاليف السيارات»"
        actions={can('expenses.manage') && <button className="btn primary" onClick={() => setForm({})}><Icon name="plus" /> مصروف جديد</button>}
      />
      <DataTable
        method="expenses.list"
        columns={cols}
        exportTitle="المصروفات"
        searchPlaceholder="بحث بالوصف أو المستفيد أو الرقم..."
        filters={[
          { key: 'category', label: 'البند', options: optionsOf('expense_category') },
          { key: 'scope', label: 'النوع', options: optionsOf('expense_scope') },
          { key: 'payment_method', label: 'الدفع', options: optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other']) },
          { key: 'dates', label: 'الفترة', type: 'dates' },
        ]}
        onRowClick={(r) => can('expenses.manage') && setForm(r)}
        empty={{ icon: 'wallet', title: 'لا توجد مصروفات مسجلة', action: can('expenses.manage') ? <button className="btn primary" onClick={() => setForm({})}>تسجيل مصروف</button> : undefined }}
      />
      {form && <ExpenseModal initial={form} onClose={() => setForm(null)} />}
    </div>
  );
}

function ExpenseModal({ initial, onClose }: { initial: any; onClose: () => void }) {
  const [e, setE] = useState<any>({ expense_date: today(), scope: 'general', category: 'rent', payment_method: 'cash', ...initial });
  const sales = useApi<any>(e.scope === 'sale' ? 'sales.list' : null, { pageSize: 200, filters: { status: 'active' } });
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const set = (k: string, v: any) => setE((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal size="md" title={e.id ? `تعديل المصروف ${e.expense_no}` : 'مصروف جديد'} onClose={onClose}
      footer={<>
        <button className="btn primary" disabled={busy} onClick={async () => (await run(() => call(e.id ? 'expenses.update' : 'expenses.create', e), 'تم الحفظ')) && onClose()}>حفظ</button>
        <button className="btn" onClick={onClose}>إلغاء</button>
        {e.id && <button className="btn ghost" style={{ marginInlineStart: 'auto' }} onClick={async () => (await confirm({ title: 'حذف المصروف', message: `حذف المصروف ${e.expense_no} بمبلغ ${fmtMoney(e.amount)}؟`, danger: true, confirmText: 'حذف' })) && (await run(() => call('expenses.delete', { id: e.id }), 'تم الحذف')) && onClose()}><Icon name="trash" /> حذف</button>}
      </>}>
      <div className="form-grid">
        <Field label="نوع المصروف"><Select value={e.scope} onChange={(v) => set('scope', v)} options={optionsOf('expense_scope')} /></Field>
        <Field label="البند" required><Select name="category" value={e.category} onChange={(v) => set('category', v)} options={optionsOf('expense_category')} /></Field>
        {e.scope === 'sale' && (
          <Field label="عملية البيع" required full>
            <Select value={e.sale_id ?? ''} onChange={(v) => set('sale_id', v ? Number(v) : null)} placeholder="اختر..." options={(sales.data?.rows ?? []).map((s: any) => [s.id, `${s.sale_no} — ${s.customer_name} — ${s.brand} ${s.model}`])} />
          </Field>
        )}
        <Field label="الوصف" required full><TextInput name="description" value={e.description} onChange={(v) => set('description', v)} /></Field>
        <Field label="المبلغ" required><MoneyInput name="amount" value={e.amount} onChange={(v) => set('amount', v)} /></Field>
        <Field label="التاريخ" required><DateInput value={e.expense_date} onChange={(v) => set('expense_date', v)} /></Field>
        <Field label="المستفيد"><TextInput value={e.payee} onChange={(v) => set('payee', v)} /></Field>
        <Field label="طريقة الدفع"><Select value={e.payment_method} onChange={(v) => set('payment_method', v)} options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other'])} /></Field>
        <Field label="ملاحظات" full><TextArea value={e.notes} onChange={(v) => set('notes', v)} rows={2} /></Field>
      </div>
    </Modal>
  );
}
