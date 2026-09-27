import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, usePrint } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import {
  Badge,
  DateInput,
  DL,
  ErrorAlert,
  Field,
  Kpi,
  Modal,
  Money,
  PageHeader,
  Select,
  Spinner,
  Tabs,
  TextArea,
  TextInput,
  optionsOf,
} from '../components/common';
import { Icon } from '../components/Icon';
import { fmtDate, fmtMoney, label } from '../../core/format';

export function CustomerFormModal({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved?: (c: any) => void }) {
  const [c, setC] = useState<any>(initial ?? { customer_type: 'individual' });
  const { run, busy } = useAction();
  const set = (k: string, v: any) => setC((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    const r: any = await run(() => call(c.id ? 'customers.update' : 'customers.create', c), c.id ? 'تم حفظ بيانات العميل' : 'تمت إضافة العميل');
    if (r) {
      onClose();
      onSaved?.({ ...c, ...r });
    }
  };
  return (
    <Modal
      size="md"
      title={c.id ? `تعديل العميل ${c.code}` : 'عميل جديد'}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" disabled={busy} onClick={save}>
            حفظ
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="اسم العميل" required full>
          <TextInput name="name" value={c.name} onChange={(v) => set('name', v)} autoFocus />
        </Field>
        <Field label="نوع العميل">
          <Select value={c.customer_type} onChange={(v) => set('customer_type', v)} options={optionsOf('customer_type')} />
        </Field>
        <Field label="الرقم القومي / السجل التجاري" hint="لا يتكرر">
          <TextInput name="national_id" value={c.national_id} onChange={(v) => set('national_id', v)} ltr />
        </Field>
        <Field label="الهاتف">
          <TextInput name="phone" value={c.phone} onChange={(v) => set('phone', v)} ltr />
        </Field>
        <Field label="هاتف إضافي">
          <TextInput value={c.phone2} onChange={(v) => set('phone2', v)} ltr />
        </Field>
        <Field label="البريد الإلكتروني">
          <TextInput value={c.email} onChange={(v) => set('email', v)} ltr />
        </Field>
        <Field label="العنوان">
          <TextInput value={c.address} onChange={(v) => set('address', v)} />
        </Field>
        <Field label="ملاحظات" full>
          <TextArea value={c.notes} onChange={(v) => set('notes', v)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

export function CustomersPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [form, setForm] = useState(false);
  const cols: Col[] = [
    { key: 'code', label: 'الكود', sort: 'code' },
    { key: 'name', label: 'الاسم', sort: 'name', render: (r) => <b>{r.name}</b> },
    {
      key: 'customer_type',
      label: 'النوع',
      render: (r) => label('customer_type', r.customer_type),
      exportValue: (r) => label('customer_type', r.customer_type),
    },
    { key: 'phone', label: 'الهاتف', render: (r) => <span className="num">{r.phone ?? '—'}</span> },
    { key: 'national_id', label: 'الرقم القومي', render: (r) => <span className="num">{r.national_id ?? '—'}</span> },
    { key: 'sales_count', label: 'المشتريات', num: true, exportType: 'int' },
    {
      key: 'balance',
      label: 'الرصيد المستحق',
      num: true,
      sort: 'balance',
      render: (r) => (r.balance ? <b>{fmtMoney(r.balance)}</b> : '—'),
      exportType: 'money',
    },
    {
      key: 'overdue',
      label: 'المتأخرات',
      num: true,
      sort: 'overdue',
      render: (r) => (r.overdue ? <b className="neg">{fmtMoney(r.overdue)}</b> : '—'),
      exportType: 'money',
    },
  ];
  return (
    <div>
      <PageHeader
        title="العملاء"
        sub="بيانات العملاء وأرصدتهم ومتأخراتهم"
        actions={
          can('customers.manage') && (
            <button className="btn primary" onClick={() => setForm(true)}>
              <Icon name="plus" /> عميل جديد
            </button>
          )
        }
      />
      <DataTable
        method="customers.list"
        columns={cols}
        exportTitle="العملاء"
        searchPlaceholder="بحث بالاسم أو الهاتف أو الرقم القومي أو الكود..."
        filters={[
          { key: 'customer_type', label: 'النوع', options: optionsOf('customer_type') },
          { key: 'debtors', label: 'العملاء المدينون فقط', type: 'checkbox' },
          { key: 'overdue', label: 'عليهم متأخرات', type: 'checkbox' },
        ]}
        onRowClick={(r) => nav(`/customers/${r.id}`)}
        empty={{
          icon: 'users',
          title: 'لا يوجد عملاء بعد',
          text: 'أضف أول عميل لتبدأ عروض الأسعار والحجوزات والمبيعات.',
          action: can('customers.manage') ? (
            <button className="btn primary" onClick={() => setForm(true)}>
              إضافة عميل
            </button>
          ) : undefined,
        }}
      />
      {form && <CustomerFormModal onClose={() => setForm(false)} onSaved={(c) => nav(`/customers/${c.id}`)} />}
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const { run } = useAction();
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  const { data, error, loading } = useApi<any>('customers.get', { id: Number(id) });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;
  const c = data.customer;
  const s = data.summary;
  const del = async () => {
    const ok = await confirm({ title: 'حذف العميل', message: `حذف العميل ${c.name}؟ لا يمكن حذف عميل لديه معاملات.`, danger: true, confirmText: 'حذف' });
    if (ok && (await run(() => call('customers.delete', { id: c.id }), 'تم حذف العميل'))) nav('/customers');
  };
  return (
    <div className="stack">
      <PageHeader
        crumb={
          <a onClick={() => nav('/customers')} style={{ cursor: 'pointer' }}>
            العملاء
          </a>
        }
        title={c.name}
        sub={`${c.code} • ${label('customer_type', c.customer_type)}${c.phone ? ' • ' + c.phone : ''}`}
        actions={
          <>
            {can('quotations.manage') && (
              <button className="btn" onClick={() => nav(`/quotations?new=1&customer=${c.id}`)}>
                عرض سعر
              </button>
            )}
            {can('reservations.manage') && (
              <button className="btn" onClick={() => nav(`/reservations?new=1&customer=${c.id}`)}>
                حجز
              </button>
            )}
            {can('sales.create') && (
              <button className="btn success" onClick={() => nav(`/sales/new?customer=${c.id}`)}>
                بيع سيارة
              </button>
            )}
            {can('customers.manage') && (
              <button className="btn" onClick={() => setEdit(true)}>
                <Icon name="edit" /> تعديل
              </button>
            )}
            {can('customers.delete') && (
              <button className="btn ghost" onClick={del} title="حذف">
                <Icon name="trash" />
              </button>
            )}
          </>
        }
      />
      <div className="grid-4">
        <Kpi label="إجمالي المشتريات" value={<Money v={s.total_purchases} />} sub={`${data.sales.filter((x: any) => x.status === 'active').length} سيارة`} />
        <Kpi label="إجمالي المدفوع" value={<Money v={s.total_paid} />} tone="accent" />
        <Kpi label="الرصيد المستحق" value={<Money v={s.balance} />} />
        <Kpi label="المتأخرات" value={<Money v={s.overdue} />} sub={`${s.overdue_count} قسط متأخر`} tone={s.overdue > 0 ? 'danger' : undefined} />
      </div>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'نظرة عامة' },
          { key: 'installments', label: 'الأقساط', count: data.installments.length },
          { key: 'payments', label: 'المدفوعات', count: data.payments.length },
          { key: 'sales', label: 'المبيعات', count: data.sales.length },
          { key: 'quotes', label: 'العروض والحجوزات', count: data.quotations.length + data.reservations.length },
          { key: 'interests', label: 'الاهتمامات والاستبدال', count: data.leads.length + data.tradeIns.length },
          { key: 'statement', label: 'كشف الحساب' },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid-2">
          <div className="card card-b">
            <DL
              items={[
                ['الكود', c.code],
                ['الاسم', c.name],
                ['الرقم القومي', <span className="num">{c.national_id ?? '—'}</span>],
                ['الهاتف', <span className="num">{c.phone ?? '—'}</span>],
                ['هاتف إضافي', c.phone2],
                ['البريد', c.email],
                ['العنوان', c.address],
                ['ملاحظات', c.notes],
                ['تاريخ التسجيل', fmtDate(c.created_at)],
              ]}
            />
          </div>
          <div className="card">
            <div className="card-h">
              <h3>الأقساط القادمة والمتأخرة</h3>
            </div>
            <InstallmentsTable rows={data.installments.filter((i: any) => i.remaining > 0).slice(0, 8)} />
          </div>
        </div>
      )}
      {tab === 'installments' && (
        <div className="card">
          <InstallmentsTable rows={data.installments} />
        </div>
      )}
      {tab === 'payments' && (
        <div className="card">
          <SimpleTable
            rows={data.payments}
            empty="لا توجد مدفوعات"
            cols={[
              ['receipt_no', 'رقم الإيصال'],
              ['pay_date', 'التاريخ', (r) => fmtDate(r.pay_date)],
              ['kind', 'النوع', (r) => label('payment_kind', r.kind)],
              ['method', 'الطريقة', (r) => label('pay_method', r.method)],
              ['reference', 'المرجع'],
              ['amount', 'المبلغ', (r) => <span className="num">{fmtMoney(r.amount)}</span>],
              ['status', 'الحالة', (r) => <Badge group="payment_status" value={r.status} />],
            ]}
            rowClass={(r) => (r.status === 'voided' ? 'cancelled' : '')}
          />
        </div>
      )}
      {tab === 'sales' && (
        <div className="card">
          <SimpleTable
            rows={data.sales}
            empty="لا توجد مبيعات"
            onClick={(r) => nav(`/sales/${r.id}`)}
            cols={[
              ['sale_no', 'رقم البيع'],
              ['sale_date', 'التاريخ', (r) => fmtDate(r.sale_date)],
              ['vehicle', 'السيارة', (r) => `${r.brand} ${r.model} ${r.model_year} (${r.stock_no})`],
              ['sale_type', 'طريقة البيع', (r) => label('sale_type', r.sale_type)],
              ['total_contract_value', 'قيمة العقد', (r) => <span className="num">{fmtMoney(r.total_contract_value)}</span>],
              ['contract_no', 'عقد التقسيط'],
              ['status', 'الحالة', (r) => <Badge group="sale_status" value={r.status} />],
            ]}
          />
        </div>
      )}
      {tab === 'quotes' && (
        <div className="grid-2">
          <div className="card">
            <div className="card-h">
              <h3>عروض الأسعار</h3>
            </div>
            <SimpleTable
              rows={data.quotations}
              empty="لا توجد عروض"
              cols={[
                ['quote_no', 'الرقم'],
                ['quote_date', 'التاريخ', (r) => fmtDate(r.quote_date)],
                ['vehicle', 'السيارة', (r) => `${r.brand} ${r.model} ${r.model_year}`],
                ['final_price', 'السعر', (r) => <span className="num">{fmtMoney(r.final_price)}</span>],
                ['status', 'الحالة', (r) => <Badge group="quotation_status" value={r.status} />],
              ]}
            />
          </div>
          <div className="card">
            <div className="card-h">
              <h3>الحجوزات</h3>
            </div>
            <SimpleTable
              rows={data.reservations}
              empty="لا توجد حجوزات"
              cols={[
                ['reservation_no', 'الرقم'],
                ['reservation_date', 'التاريخ', (r) => fmtDate(r.reservation_date)],
                ['vehicle', 'السيارة', (r) => `${r.brand} ${r.model}`],
                ['amount', 'العربون', (r) => <span className="num">{fmtMoney(r.amount)}</span>],
                ['status', 'الحالة', (r) => <Badge group="reservation_status" value={r.status} />],
              ]}
            />
          </div>
        </div>
      )}
      {tab === 'interests' && (
        <div className="grid-2">
          <div className="card">
            <div className="card-h">
              <h3>السيارات التي اهتم بها</h3>
            </div>
            <SimpleTable
              rows={data.leads}
              empty="لا توجد اهتمامات مسجلة"
              cols={[
                ['vehicle', 'السيارة', (r) => (r.brand ? `${r.brand} ${r.model} ${r.model_year}` : '—')],
                ['interest', 'الاهتمام'],
                ['source', 'المصدر', (r) => label('lead_source', r.source)],
                ['status', 'الحالة', (r) => <Badge group="lead_status" value={r.status} />],
              ]}
            />
          </div>
          <div className="card">
            <div className="card-h">
              <h3>سيارات الاستبدال</h3>
            </div>
            <SimpleTable
              rows={data.tradeIns}
              empty="لا توجد"
              cols={[
                ['trade_no', 'الرقم'],
                ['vehicle', 'السيارة', (r) => `${r.brand} ${r.model} ${r.model_year}`],
                ['trade_in_value', 'القيمة', (r) => <span className="num">{fmtMoney(r.trade_in_value)}</span>],
                ['status', 'الحالة', (r) => <Badge group="trade_status" value={r.status} />],
              ]}
            />
          </div>
        </div>
      )}
      {tab === 'statement' && <StatementView customerId={c.id} />}
      {edit && <CustomerFormModal initial={c} onClose={() => setEdit(false)} />}
    </div>
  );
}

export function SimpleTable({
  rows,
  cols,
  empty,
  onClick,
  rowClass,
}: {
  rows: any[];
  cols: [string, string, ((r: any) => any)?][];
  empty: string;
  onClick?: (r: any) => void;
  rowClass?: (r: any) => string;
}) {
  if (!rows.length) return <div className="card-b muted">{empty}</div>;
  return (
    <div className="table-wrap">
      <table className="dt">
        <thead>
          <tr>
            {cols.map(([k, l]) => (
              <th key={k}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className={`${onClick ? 'clickable' : ''} ${rowClass?.(r) ?? ''}`} onClick={() => onClick?.(r)}>
              {cols.map(([k, , f]) => (
                <td key={k}>{f ? f(r) : (r[k] ?? '—')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstallmentsTable({ rows }: { rows: any[] }) {
  const nav = useNavigate();
  return (
    <SimpleTable
      rows={rows}
      empty="لا توجد أقساط"
      onClick={(r) => nav(`/installments/${r.contract_id}`)}
      cols={[
        ['contract_no', 'العقد'],
        ['seq', '#'],
        ['due_date', 'الاستحقاق', (r) => fmtDate(r.due_date)],
        ['amount', 'القسط', (r) => <span className="num">{fmtMoney(r.amount)}</span>],
        ['paid_amount', 'المدفوع', (r) => <span className="num">{fmtMoney(r.paid_amount)}</span>],
        ['remaining', 'المتبقي', (r) => <b className="num">{fmtMoney(r.remaining)}</b>],
        ['status', 'الحالة', (r) => <Badge group="installment_status" value={r.status} />],
        ['days_overdue', 'أيام التأخير', (r) => (r.days_overdue ? <span className="neg num">{r.days_overdue}</span> : '—')],
      ]}
    />
  );
}

export function StatementView({ customerId }: { customerId: number }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const print = usePrint();
  const { data, loading } = useApi<any>('customers.statement', { id: customerId, from: from || undefined, to: to || undefined });
  return (
    <div className="card">
      <div className="toolbar">
        <div className="tb-dates">
          <span className="muted small">من</span>
          <DateInput value={from} onChange={setFrom} />
          <span className="muted small">إلى</span>
          <DateInput value={to} onChange={setTo} />
        </div>
        <div className="spacer" />
        <button className="btn sm" onClick={() => print('statement', customerId, 'preview', { from: from || undefined, to: to || undefined })}>
          <Icon name="printer" /> طباعة
        </button>
        <button className="btn sm" onClick={() => print('statement', customerId, 'pdf', { from: from || undefined, to: to || undefined })}>
          <Icon name="download" /> PDF
        </button>
      </div>
      {loading || !data ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المرجع</th>
                <th>البيان</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {data.opening ? (
                <tr>
                  <td />
                  <td />
                  <td>رصيد افتتاحي</td>
                  <td />
                  <td />
                  <td className="num">{fmtMoney(data.opening)}</td>
                </tr>
              ) : null}
              {data.rows.map((r: any, i: number) => (
                <tr key={i}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.ref}</td>
                  <td className="wrap">{r.description}</td>
                  <td className="num">{r.debit ? fmtMoney(r.debit) : ''}</td>
                  <td className="num">{r.credit ? fmtMoney(r.credit) : ''}</td>
                  <td className="num bold">{fmtMoney(r.balance)}</td>
                </tr>
              ))}
              {!data.rows.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    لا توجد حركات في هذه الفترة
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>الإجمالي</td>
                <td className="num">{fmtMoney(data.totalDebit)}</td>
                <td className="num">{fmtMoney(data.totalCredit)}</td>
                <td className="num">{fmtMoney(data.closing)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="card-b muted small">الرصيد الموجب = مستحق على العميل • الرصيد السالب = رصيد دائن للعميل</div>
        </div>
      )}
    </div>
  );
}
