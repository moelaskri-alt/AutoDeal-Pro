import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, usePrint, today, addMonthsStr } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import { Badge, DateInput, DL, ErrorAlert, Field, Kpi, Modal, Money, MoneyInput, PageHeader, Select, Spinner, Tabs, TextArea, TextInput, optionsOf, SummaryLine } from '../components/common';
import { PlanBuilder, type Plan } from '../components/PlanBuilder';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateTime, fmtMoney, label } from '../../core/format';

export function InstallmentsPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overdue';
  const setTab = (t: string) => setParams({ tab: t });
  const [pay, setPay] = useState<any | null>(null);
  const { data: d } = useApi<any>('dashboard.get');
  const rec = d?.receivables;

  const instCols: Col[] = [
    { key: 'due_date', label: 'الاستحقاق', sort: 'due_date', render: (r) => fmtDate(r.due_date), exportType: 'date' },
    { key: 'customer_name', label: 'العميل', sort: 'customer_name', render: (r) => <b>{r.customer_name}</b> },
    { key: 'customer_phone', label: 'الهاتف', render: (r) => <span className="num">{r.customer_phone ?? '—'}</span> },
    { key: 'contract_no', label: 'العقد' },
    { key: 'vehicle', label: 'السيارة', render: (r) => `${r.brand} ${r.model}`, exportValue: (r) => `${r.brand} ${r.model}` },
    { key: 'seq', label: '#', num: true, exportType: 'int' },
    { key: 'amount', label: 'القسط', num: true, sort: 'amount', render: (r) => fmtMoney(r.amount), exportType: 'money', total: (t) => fmtMoney(t.amount) },
    { key: 'paid_amount', label: 'المدفوع', num: true, render: (r) => fmtMoney(r.paid_amount), exportType: 'money', total: (t) => fmtMoney(t.paid_amount) },
    { key: 'remaining', label: 'المتبقي', num: true, sort: 'remaining', render: (r) => <b>{fmtMoney(r.remaining)}</b>, exportType: 'money', total: (t) => fmtMoney(t.remaining) },
    { key: 'status', label: 'الحالة', render: (r) => <Badge group="installment_status" value={r.status} />, exportValue: (r) => label('installment_status', r.status) },
    { key: 'days_overdue', label: 'أيام التأخير', num: true, sort: 'days_overdue', render: (r) => (r.days_overdue ? <span className="neg bold">{r.days_overdue}</span> : '—'), exportType: 'int' },
    {
      key: 'act',
      label: '',
      noExport: true,
      render: (r) =>
        r.remaining > 0 ? (
          <button className="btn sm success" onClick={(e) => { e.stopPropagation(); setPay({ contract_id: r.contract_id, installment: r }); }}>
            تحصيل
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="التقسيط والتحصيل" sub="متابعة الأقساط المستحقة والمتأخرة وتسجيل التحصيلات" />
      {rec && (
        <div className="grid-4" style={{ marginBottom: 14 }}>
          <Kpi label="إجمالي المستحق" value={<Money v={rec.outstanding} />} onClick={() => setTab('open')} />
          <Kpi label="مستحق اليوم" value={<Money v={rec.due_today} />} sub={`${rec.due_today_count} قسط`} onClick={() => setTab('due_today')} />
          <Kpi label="خلال 7 أيام" value={<Money v={rec.due_7} />} sub={`${rec.due_7_count} قسط`} onClick={() => setTab('next7')} />
          <Kpi label="المتأخرات" value={<Money v={rec.overdue} />} sub={`${rec.overdue_count} قسط • ${rec.overdue_customers} عميل`} tone={rec.overdue ? 'danger' : undefined} onClick={() => setTab('overdue')} />
        </div>
      )}
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overdue', label: 'المتأخرة' },
          { key: 'due_today', label: 'مستحقة اليوم' },
          { key: 'next7', label: 'خلال 7 أيام' },
          { key: 'open', label: 'كل الأقساط المفتوحة' },
          { key: 'all', label: 'جدول كل الأقساط' },
          { key: 'contracts', label: 'عقود التقسيط' },
          { key: 'payments', label: 'التحصيلات' },
        ]}
      />
      {['overdue', 'due_today', 'next7', 'open', 'all'].includes(tab) && (
        <DataTable
          key={tab}
          method="installments.list"
          columns={instCols}
          baseFilters={tab === 'all' ? {} : { status: tab }}
          defaultSort={tab === 'overdue' ? { sort: 'days_overdue', dir: 'desc' } : undefined}
          exportTitle={`الأقساط - ${tab}`}
          searchPlaceholder="بحث باسم العميل أو الهاتف أو رقم العقد..."
          filters={[{ key: 'salesperson_id', label: 'المندوب', type: 'salesperson' }, { key: 'dates', label: 'الاستحقاق', type: 'dates' }, ...(tab === 'all' ? [{ key: 'status', label: 'الحالة', options: optionsOf('installment_status', ['paid', 'partially_paid', 'overdue', 'not_due']) } as any] : [])]}
          onRowClick={(r) => nav(`/installments/${r.contract_id}`)}
          empty={{ icon: 'calendar', title: tab === 'overdue' ? 'لا توجد أقساط متأخرة' : 'لا توجد أقساط', text: tab === 'overdue' ? 'كل العملاء ملتزمون بالسداد.' : undefined }}
        />
      )}
      {tab === 'contracts' && <ContractsTable />}
      {tab === 'payments' && <PaymentsTable />}
      {pay && <PaymentModal contractId={pay.contract_id} installment={pay.installment} onClose={() => setPay(null)} />}
    </div>
  );
}

function ContractsTable() {
  const nav = useNavigate();
  const cols: Col[] = [
    { key: 'contract_no', label: 'رقم العقد', sort: 'contract_no' },
    { key: 'customer_name', label: 'العميل', sort: 'customer_name' },
    { key: 'vehicle', label: 'السيارة', render: (r) => `${r.brand} ${r.model} ${r.model_year}`, exportValue: (r) => `${r.brand} ${r.model} ${r.model_year}` },
    { key: 'sale_date', label: 'تاريخ البيع', sort: 'sale_date', render: (r) => fmtDate(r.sale_date), exportType: 'date' },
    { key: 'plan_type', label: 'النظام', render: (r) => label('plan_type', r.plan_type), exportValue: (r) => label('plan_type', r.plan_type) },
    { key: 'financed_amount', label: 'المبلغ الممول', num: true, render: (r) => fmtMoney(r.financed_amount), exportType: 'money', total: (t) => fmtMoney(t.financed_amount) },
    { key: 'paid', label: 'المحصل', num: true, render: (r) => fmtMoney(r.paid), exportType: 'money', total: (t) => fmtMoney(t.paid) },
    { key: 'remaining', label: 'المتبقي', num: true, sort: 'remaining', render: (r) => <b>{fmtMoney(r.remaining)}</b>, exportType: 'money', total: (t) => fmtMoney(t.remaining) },
    { key: 'overdue_amount', label: 'المتأخر', num: true, sort: 'overdue_amount', render: (r) => (r.overdue_amount ? <b className="neg">{fmtMoney(r.overdue_amount)}</b> : '—'), exportType: 'money', total: (t) => fmtMoney(t.overdue_amount) },
    { key: 'next_due_date', label: 'القسط القادم', sort: 'next_due_date', render: (r) => fmtDate(r.next_due_date), exportType: 'date' },
    { key: 'status', label: 'الحالة', render: (r) => <Badge group="contract_status" value={r.status} />, exportValue: (r) => label('contract_status', r.status) },
  ];
  return (
    <DataTable
      method="installments.contracts"
      columns={cols}
      exportTitle="عقود التقسيط"
      filters={[
        { key: 'status', label: 'الحالة', options: optionsOf('contract_status') },
        { key: 'overdue', label: 'عليها متأخرات', type: 'checkbox' },
        { key: 'salesperson_id', label: 'المندوب', type: 'salesperson' },
        { key: 'dates', label: 'تاريخ البيع', type: 'dates' },
      ]}
      onRowClick={(r) => nav(`/installments/${r.id}`)}
      empty={{ icon: 'calendar', title: 'لا توجد عقود تقسيط', text: 'تُنشأ العقود تلقائياً عند البيع بالتقسيط.' }}
    />
  );
}

function PaymentsTable() {
  const print = usePrint();
  const nav = useNavigate();
  const cols: Col[] = [
    { key: 'pay_date', label: 'التاريخ', sort: 'pay_date', render: (r) => fmtDate(r.pay_date), exportType: 'date' },
    { key: 'receipt_no', label: 'رقم الإيصال', sort: 'receipt_no' },
    { key: 'customer_name', label: 'العميل', sort: 'customer_name' },
    { key: 'kind', label: 'النوع', render: (r) => label('payment_kind', r.kind), exportValue: (r) => label('payment_kind', r.kind) },
    { key: 'ref', label: 'العقد/البيع', render: (r) => r.contract_no ?? r.sale_no ?? r.reservation_no ?? '—', exportValue: (r) => r.contract_no ?? r.sale_no ?? r.reservation_no },
    { key: 'method', label: 'الطريقة', render: (r) => label('pay_method', r.method), exportValue: (r) => label('pay_method', r.method) },
    { key: 'reference', label: 'المرجع' },
    { key: 'amount', label: 'المبلغ', num: true, sort: 'amount', render: (r) => <b className={r.kind === 'refund' ? 'neg' : ''}>{r.kind === 'refund' ? '-' : ''}{fmtMoney(r.amount)}</b>, exportValue: (r) => (r.kind === 'refund' ? -r.amount : r.amount) / 100, total: (t) => fmtMoney(t.collected - t.refunded) },
    { key: 'status', label: 'الحالة', render: (r) => <Badge group="payment_status" value={r.status} />, exportValue: (r) => label('payment_status', r.status) },
    { key: 'user_name', label: 'بواسطة' },
    { key: 'p', label: '', noExport: true, render: (r) => <button className="btn sm" onClick={(e) => { e.stopPropagation(); print('receipt', r.id); }}><Icon name="printer" /></button> },
  ];
  return (
    <DataTable
      method="payments.list"
      columns={cols}
      exportTitle="التحصيلات"
      rowClass={(r) => (r.status === 'voided' ? 'cancelled' : '')}
      searchPlaceholder="بحث برقم الإيصال أو العميل أو المرجع..."
      filters={[
        { key: 'kind', label: 'النوع', options: optionsOf('payment_kind') },
        { key: 'method', label: 'الطريقة', options: optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other']) },
        { key: 'status', label: 'الحالة', options: optionsOf('payment_status') },
        { key: 'dates', label: 'الفترة', type: 'dates' },
      ]}
      onRowClick={(r) => r.contract_no && nav(`/installments?tab=payments`)}
      empty={{ icon: 'money', title: 'لا توجد تحصيلات' }}
    />
  );
}

// ------------------------------------------------------------------ payment modal

export function PaymentModal({ contractId, installment, onClose }: { contractId: number; installment?: any; onClose: () => void }) {
  const { data } = useApi<any>('installments.contract', { id: contractId });
  const print = usePrint();
  const { run, busy } = useAction();
  const [p, setP] = useState<any>({ pay_date: today(), method: 'cash', mode: installment ? 'manual' : 'auto', amount: installment?.remaining ?? null, installment_ids: installment ? [installment.id] : [] });
  const set = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  if (!data) return <Modal title="تسجيل تحصيل" onClose={onClose}><Spinner /></Modal>;
  const c = data.contract;
  const open = data.schedule.filter((i: any) => !i.is_cancelled && i.remaining > 0);
  const selected = open.filter((i: any) => p.installment_ids.includes(i.id));
  const selRemaining = selected.reduce((a: number, i: any) => a + i.remaining, 0);
  const over = p.mode === 'manual' && (p.amount ?? 0) > selRemaining;
  const save = async () => {
    const r: any = await run(() => call('payments.create', { ...p, contract_id: contractId }), 'تم تسجيل التحصيل');
    if (r) {
      onClose();
      print('receipt', r.id);
    }
  };
  return (
    <Modal size="lg" title={`تسجيل تحصيل — ${c.customer_name} (${c.contract_no})`} onClose={onClose}
      footer={<><button className="btn success" disabled={busy || !p.amount || (over && !p.allow_spillover)} onClick={save}>حفظ وطباعة الإيصال</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="stack">
        <div className="grid-3">
          <Kpi label="المتبقي على العقد" value={<Money v={c.remaining} />} />
          <Kpi label="المتأخر" value={<Money v={c.overdue_amount} />} tone={c.overdue_amount ? 'danger' : undefined} />
          <Kpi label="القسط القادم" value={fmtDate(c.next_due_date)} />
        </div>
        <div className="form-grid cols-3">
          <Field label="المبلغ المحصل" required><MoneyInput name="amount" value={p.amount} onChange={(v) => set('amount', v)} /></Field>
          <Field label="تاريخ التحصيل" required><DateInput value={p.pay_date} onChange={(v) => set('pay_date', v)} /></Field>
          <Field label="طريقة الدفع"><Select value={p.method} onChange={(v) => set('method', v)} options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other'])} /></Field>
          <Field label="المرجع (رقم شيك/تحويل)"><TextInput value={p.reference} onChange={(v) => set('reference', v)} /></Field>
          <Field label="توزيع الدفعة">
            <Select value={p.mode} onChange={(v) => set('mode', v)} options={[['auto', 'تلقائي: الأقدم أولاً'], ['manual', 'يدوي: أقساط محددة']]} />
          </Field>
          <Field label="ملاحظات"><TextInput value={p.notes} onChange={(v) => set('notes', v)} /></Field>
        </div>
        {p.mode === 'manual' && (
          <div className="card">
            <div className="card-h"><h3>اختر الأقساط</h3><div className="spacer" /><span className="muted small">المتبقي على المحدد: <b className="num">{fmtMoney(selRemaining)}</b></span></div>
            <div className="table-wrap" style={{ maxHeight: 240 }}>
              <table className="dt">
                <thead><tr><th /><th>#</th><th>الاستحقاق</th><th>القسط</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
                <tbody>{open.map((i: any) => (
                  <tr key={i.id} className="clickable" onClick={() => set('installment_ids', p.installment_ids.includes(i.id) ? p.installment_ids.filter((x: number) => x !== i.id) : [...p.installment_ids, i.id])}>
                    <td><input type="checkbox" readOnly checked={p.installment_ids.includes(i.id)} /></td>
                    <td>{i.seq}</td><td>{fmtDate(i.due_date)}</td><td className="num">{fmtMoney(i.amount)}</td><td className="num">{fmtMoney(i.paid_amount)}</td><td className="num bold">{fmtMoney(i.remaining)}</td>
                    <td><Badge group="installment_status" value={i.status} /></td>
                  </tr>))}</tbody>
              </table>
            </div>
            {over && (
              <div className="card-b">
                <div className="alert warning">المبلغ أكبر من المتبقي على الأقساط المحددة بمقدار {fmtMoney((p.amount ?? 0) - selRemaining)}.</div>
                <label className="checkbox" style={{ marginTop: 8 }}><input type="checkbox" checked={!!p.allow_spillover} onChange={(e) => set('allow_spillover', e.target.checked)} /> توزيع الزيادة على الأقساط التالية (دفعة مقدمة)</label>
              </div>
            )}
          </div>
        )}
        {p.mode === 'auto' && <div className="muted small">سيتم توزيع المبلغ على أقدم الأقساط غير المسددة أولاً. لا يُسمح بمبلغ أكبر من المتبقي على العقد.</div>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ contract detail

export function ContractDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const print = usePrint();
  const { confirm } = useUi();
  const { run } = useAction();
  const [pay, setPay] = useState<any | null>(null);
  const [early, setEarly] = useState(false);
  const [resched, setResched] = useState(false);
  const { data, error, loading } = useApi<any>('installments.contract', { id: Number(id) });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;
  const c = data.contract;
  const active = c.status === 'active';
  const voidPay = async (p: any) => {
    const reason = await confirm({ title: 'إلغاء تحصيل', message: `سيتم إلغاء الإيصال ${p.receipt_no} بمبلغ ${fmtMoney(p.amount)} وإعادة الأقساط كما كانت قبل التحصيل.`, reason: { label: 'سبب الإلغاء', required: true }, danger: true, confirmText: 'إلغاء التحصيل' });
    if (reason) await run(() => call('payments.void', { id: p.id, reason }), 'تم إلغاء التحصيل');
  };
  return (
    <div className="stack">
      <PageHeader
        crumb={<a onClick={() => nav('/installments?tab=contracts')} style={{ cursor: 'pointer' }}>التقسيط والتحصيل</a>}
        title={<span className="row" style={{ gap: 10 }}>عقد التقسيط {c.contract_no} <Badge group="contract_status" value={c.status} /></span>}
        sub={`${c.customer_name} • ${c.brand} ${c.model} ${c.model_year} • ${label('plan_type', c.plan_type)}${c.schedule_version > 1 ? ` • أعيدت جدولته (إصدار ${c.schedule_version})` : ''}`}
        actions={<>
          <button className="btn" onClick={() => print('schedule', c.id)}><Icon name="printer" /> جدول الأقساط</button>
          <button className="btn" onClick={() => print('schedule', c.id, 'pdf')}><Icon name="download" /> PDF</button>
          <button className="btn" onClick={() => print('statement', c.customer_id)}>كشف حساب العميل</button>
          <button className="btn" onClick={() => nav(`/sales/${c.sale_id}`)}>البيع {c.sale_no}</button>
          {active && can('payments.create') && <button className="btn success" onClick={() => setPay({})}><Icon name="money" /> تسجيل تحصيل</button>}
          {active && can('payments.create') && <button className="btn" onClick={() => setEarly(true)}>سداد مبكر</button>}
          {active && can('installments.manage') && <button className="btn" onClick={() => setResched(true)}>إعادة جدولة</button>}
        </>}
      />
      <div className="grid-4">
        <Kpi label="المبلغ الممول" value={<Money v={c.financed_amount} />} sub={`قيمة العقد ${fmtMoney(c.total_contract_value)}`} />
        <Kpi label="المحصل" value={<Money v={c.paid} />} tone="accent" sub={c.waived ? `خصم سداد مبكر ${fmtMoney(c.waived)}` : undefined} />
        <Kpi label="المتبقي" value={<Money v={c.remaining} />} sub={c.next_due_date ? `القسط القادم ${fmtDate(c.next_due_date)}` : 'مسدد بالكامل'} />
        <Kpi label="المتأخر" value={<Money v={c.overdue_amount} />} sub={`${c.overdue_count} قسط متأخر`} tone={c.overdue_amount ? 'danger' : undefined} />
      </div>
      <div className="card">
        <div className="card-h"><h3>جدول الأقساط</h3></div>
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th>قيمة القسط</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>أيام التأخير</th><th>تاريخ السداد</th><th /></tr></thead>
            <tbody>
              {data.schedule.map((i: any) => (
                <tr key={i.id} className={i.is_cancelled ? 'cancelled' : ''} title={i.notes ?? undefined}>
                  <td>{i.seq}</td><td>{fmtDate(i.due_date)}</td><td className="num">{fmtMoney(i.amount)}</td><td className="num">{fmtMoney(i.paid_amount)}</td>
                  <td className="num bold">{fmtMoney(i.is_cancelled ? 0 : i.remaining)}</td>
                  <td><Badge group="installment_status" value={i.status} /></td>
                  <td className="num">{i.days_overdue ? <span className="neg bold">{i.days_overdue}</span> : '—'}</td>
                  <td>{fmtDate(i.paid_at)}</td>
                  <td className="actions">{active && !i.is_cancelled && i.remaining > 0 && can('payments.create') && <button className="btn sm success" onClick={() => setPay({ installment: i })}>تحصيل</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>الإجمالي (الأقساط السارية)</td>
              <td className="num">{fmtMoney(data.schedule.filter((i: any) => !i.is_cancelled).reduce((a: number, i: any) => a + i.amount, 0))}</td>
              <td className="num">{fmtMoney(data.schedule.reduce((a: number, i: any) => a + i.paid_amount, 0))}</td>
              <td className="num">{fmtMoney(c.remaining)}</td><td colSpan={4} /></tr></tfoot>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h3>المدفوعات</h3></div>
        {data.payments.length ? (
          <table className="dt">
            <thead><tr><th>رقم الإيصال</th><th>التاريخ</th><th>النوع</th><th>الأقساط</th><th>الطريقة</th><th>المرجع</th><th>المبلغ</th><th>الحالة</th><th>بواسطة</th><th /></tr></thead>
            <tbody>{data.payments.map((p: any) => (
              <tr key={p.id} className={p.status === 'voided' ? 'cancelled' : ''}>
                <td>{p.receipt_no}</td><td>{fmtDate(p.pay_date)}</td><td>{label('payment_kind', p.kind)}</td><td>{p.installments ?? '—'}</td><td>{label('pay_method', p.method)}</td><td>{p.reference ?? '—'}</td>
                <td className="num bold">{fmtMoney(p.amount)}</td><td><Badge group="payment_status" value={p.status} /></td><td>{p.user_name}</td>
                <td className="actions">
                  <button className="btn sm" onClick={() => print('receipt', p.id)}><Icon name="printer" /></button>
                  {p.status === 'valid' && ['installment', 'early_settlement'].includes(p.kind) && can('payments.void') && <button className="btn sm ghost" onClick={() => voidPay(p)}>إلغاء</button>}
                </td>
              </tr>))}</tbody>
          </table>
        ) : <div className="card-b muted">لا توجد مدفوعات</div>}
      </div>
      {data.reschedules.length > 0 && (
        <div className="card">
          <div className="card-h"><h3>سجل إعادة الجدولة</h3></div>
          <table className="dt"><thead><tr><th>التاريخ</th><th>بواسطة</th><th>السبب</th><th>من إصدار</th><th>إلى إصدار</th><th>الجدول القديم</th><th>الجدول الجديد</th></tr></thead>
            <tbody>{data.reschedules.map((r: any) => {
              const o = JSON.parse(r.old_schedule);
              const n = JSON.parse(r.new_schedule);
              return <tr key={r.id}><td>{fmtDateTime(r.created_at)}</td><td>{r.user_name}</td><td className="wrap">{r.reason}</td><td>{r.from_version}</td><td>{r.to_version}</td>
                <td className="small">{o.length} قسط — {fmtMoney(o.reduce((a: number, x: any) => a + x.amount - x.paid_amount - (x.waived_amount ?? 0), 0))} متبقي</td>
                <td className="small">{n.length} قسط — {fmtMoney(n.reduce((a: number, x: any) => a + x.amount, 0))}</td></tr>;
            })}</tbody></table>
        </div>
      )}
      <div className="card card-b"><DL items={[['العميل', <a style={{ cursor: 'pointer' }} onClick={() => nav(`/customers/${c.customer_id}`)}>{c.customer_name}</a>], ['الهاتف', <span className="num">{c.customer_phone ?? '—'}</span>], ['المندوب', c.salesperson], ['تاريخ البيع', fmtDate(c.sale_date)], ['ملاحظات', c.notes]]} /></div>
      {pay && <PaymentModal contractId={c.id} installment={pay.installment} onClose={() => setPay(null)} />}
      {early && <EarlySettlementModal c={c} onClose={() => setEarly(false)} />}
      {resched && <RescheduleModal c={c} onClose={() => setResched(false)} />}
    </div>
  );
}

function EarlySettlementModal({ c, onClose }: { c: any; onClose: () => void }) {
  const { can } = useAuth();
  const print = usePrint();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ pay_date: today(), method: 'cash', discount: 0 });
  const amount = c.remaining - (f.discount ?? 0);
  return (
    <Modal size="sm" title="سداد مبكر للعقد" onClose={onClose}
      footer={<><button className="btn success" disabled={busy || amount <= 0} onClick={async () => { const r: any = await run(() => call('installments.earlySettlement', { ...f, contract_id: c.id }), 'تم السداد المبكر وإقفال العقد'); if (r) { onClose(); print('receipt', r.id); } }}>تأكيد السداد</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="stack">
        <div className="summary-box">
          <SummaryLine label="الرصيد المتبقي" value={fmtMoney(c.remaining)} />
          <SummaryLine label="خصم السداد المبكر" value={fmtMoney(f.discount ?? 0)} />
          <SummaryLine label="المطلوب سداده" value={fmtMoney(amount)} total />
        </div>
        {can('installments.manage') && <Field label="خصم السداد المبكر" hint="يتطلب صلاحية إدارة العقود"><MoneyInput value={f.discount} onChange={(v) => setF({ ...f, discount: v })} /></Field>}
        <Field label="تاريخ السداد"><DateInput value={f.pay_date} onChange={(v) => setF({ ...f, pay_date: v })} /></Field>
        <Field label="طريقة الدفع"><Select value={f.method} onChange={(v) => setF({ ...f, method: v })} options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other'])} /></Field>
        <Field label="المرجع"><TextInput value={f.reference} onChange={(v) => setF({ ...f, reference: v })} /></Field>
      </div>
    </Modal>
  );
}

function RescheduleModal({ c, onClose }: { c: any; onClose: () => void }) {
  const { confirm } = useUi();
  const { run, busy } = useAction();
  const [plan, setPlan] = useState<Plan>({ plan_type: 'equal', count: 12, first_due_date: addMonthsStr(today(), 1), interval_months: 1 });
  const [ok, setOk] = useState(false);
  const [reason, setReason] = useState('');
  const save = async () => {
    const yes = await confirm({ title: 'تأكيد إعادة الجدولة', message: `سيتم إلغاء الأقساط غير المسددة واستبدالها بجدول جديد لإجمالي ${fmtMoney(c.remaining)}. يتم حفظ الجدول القديم في سجل العقد وسجل المراجعة.`, confirmText: 'إعادة الجدولة' });
    if (yes && (await run(() => call('installments.reschedule', { contract_id: c.id, reason, plan }), 'تمت إعادة الجدولة'))) onClose();
  };
  return (
    <Modal size="lg" title={`إعادة جدولة العقد ${c.contract_no}`} onClose={onClose}
      footer={<><button className="btn primary" disabled={busy || !ok || !reason.trim()} onClick={save}>حفظ الجدول الجديد</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="stack">
        <div className="alert info">الرصيد المتبقي الذي سيُعاد جدولته: <b className="num">{fmtMoney(c.remaining)}</b> (المتأخر منه {fmtMoney(c.overdue_amount)}). الأقساط المسددة جزئياً تُقفل على المبلغ المدفوع.</div>
        <Field label="سبب إعادة الجدولة" required><TextArea value={reason} onChange={setReason} rows={2} /></Field>
        <PlanBuilder total={c.remaining} plan={plan} onChange={setPlan} onValidity={(v) => setOk(v)} />
      </div>
    </Modal>
  );
}
