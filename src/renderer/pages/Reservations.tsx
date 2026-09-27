import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { call } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, usePrint, today, addDaysStr } from '../lib/actions';
import { DataTable, type Col } from '../components/DataTable';
import { Badge, DateInput, Field, Modal, MoneyInput, PageHeader, Select, TextArea, TextInput, optionsOf } from '../components/common';
import { VehiclePicker } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { CustomerField, usePrefill } from './Quotations';
import { fmtDate, fmtMoney, label } from '../../core/format';

export function ReservationsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const print = usePrint();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(!!params.get('new'));
  const [cancel, setCancel] = useState<any | null>(null);
  const [extend, setExtend] = useState<any | null>(null);
  const cols: Col[] = [
    { key: 'reservation_no', label: 'رقم الحجز' },
    { key: 'reservation_date', label: 'تاريخ الحجز', sort: 'reservation_date', render: (r) => fmtDate(r.reservation_date), exportType: 'date' },
    { key: 'customer_name', label: 'العميل', sort: 'customer_name' },
    { key: 'vehicle', label: 'السيارة', render: (r) => `${r.brand} ${r.model} ${r.model_year} (${r.stock_no})`, exportValue: (r) => `${r.brand} ${r.model} ${r.model_year}`, wrap: true },
    { key: 'amount', label: 'العربون', num: true, sort: 'amount', render: (r) => fmtMoney(r.amount), exportType: 'money', total: (t) => fmtMoney(t.amount) },
    { key: 'expiry_date', label: 'ينتهي في', sort: 'expiry_date', render: (r) => <span className={r.status === 'active' && r.expiry_date <= addDaysStr(today(), 2) ? 'neg bold' : ''}>{fmtDate(r.expiry_date)}</span>, exportType: 'date' },
    { key: 'status', label: 'الحالة', render: (r) => <Badge group="reservation_status" value={r.status} />, exportValue: (r) => label('reservation_status', r.status) },
    {
      key: 'actions',
      label: '',
      noExport: true,
      render: (r) => (
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn sm" onClick={() => print('reservation', r.id)} title="طباعة إيصال الحجز"><Icon name="printer" /></button>
          {r.payment_id && <button className="btn sm" onClick={() => print('receipt', r.payment_id)} title="إيصال استلام العربون">إيصال</button>}
          {r.status === 'active' && can('sales.create') && <button className="btn sm success" onClick={() => nav(`/sales/new?vehicle=${r.vehicle_id}&customer=${r.customer_id}`)}>إتمام البيع</button>}
          {r.status === 'active' && can('reservations.manage') && <button className="btn sm" onClick={() => setExtend(r)}>تمديد</button>}
          {['active', 'expired'].includes(r.status) && can('reservations.cancel') && <button className="btn sm danger" onClick={() => setCancel(r)}>إلغاء</button>}
        </div>
      ),
    },
  ];
  return (
    <div>
      <PageHeader title="الحجوزات" sub="حجز السيارات بعربون لحين إتمام البيع — تنتهي الحجوزات تلقائياً بعد تاريخ الانتهاء" actions={can('reservations.manage') && <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" /> حجز جديد</button>} />
      <DataTable
        method="reservations.list"
        columns={cols}
        exportTitle="الحجوزات"
        initialFilters={{ status: 'active' }}
        filters={[
          { key: 'status', label: 'الحالة', options: optionsOf('reservation_status') },
          { key: 'brand', label: 'الماركة', type: 'brand' },
          { key: 'dates', label: 'الفترة', type: 'dates' },
        ]}
        empty={{ icon: 'bookmark', title: 'لا توجد حجوزات', text: 'احجز سيارة لعميل مقابل عربون.', action: can('reservations.manage') ? <button className="btn primary" onClick={() => setForm(true)}>حجز جديد</button> : undefined }}
      />
      {form && <ReservationFormModal params={params} onClose={() => { setForm(false); if (params.get('new')) setParams({}); }} />}
      {cancel && <CancelReservationModal r={cancel} onClose={() => setCancel(null)} />}
      {extend && <ExtendModal r={extend} onClose={() => setExtend(null)} />}
    </div>
  );
}

function ReservationFormModal({ params, onClose }: { params: URLSearchParams; onClose: () => void }) {
  const { customer, setCustomer, vehicle, setVehicle, quote } = usePrefill(params);
  const { run, busy } = useAction();
  const print = usePrint();
  const [r, setR] = useState<any>({ reservation_date: today(), expiry_date: addDaysStr(today(), 7), method: 'cash' });
  const set = (k: string, v: any) => setR((x: any) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (quote) set('agreed_price', quote.final_price);
  }, [quote?.id]);
  const save = async () => {
    const res: any = await run(() => call('reservations.create', { ...r, customer_id: customer?.id, vehicle_id: vehicle?.id, quotation_id: quote?.id }), 'تم تسجيل الحجز');
    if (res) {
      onClose();
      print('reservation', res.id);
    }
  };
  return (
    <Modal size="md" title="حجز سيارة" onClose={onClose}
      footer={<><button className="btn primary" disabled={busy} onClick={save}>حفظ وطباعة الإيصال</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="form-grid">
        <Field label="العميل" required full><CustomerField value={customer} onChange={setCustomer} /></Field>
        <Field label="السيارة" required full><VehiclePicker value={vehicle} onChange={setVehicle} filters={{ status: 'in_stock' }} /></Field>
        <Field label="تاريخ الحجز" required><DateInput value={r.reservation_date} onChange={(v) => set('reservation_date', v)} /></Field>
        <Field label="ينتهي في" required><DateInput value={r.expiry_date} onChange={(v) => set('expiry_date', v)} /></Field>
        <Field label="مبلغ العربون"><MoneyInput name="amount" value={r.amount} onChange={(v) => set('amount', v)} /></Field>
        <Field label="طريقة الدفع"><Select value={r.method} onChange={(v) => set('method', v)} options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other'])} /></Field>
        <Field label="السعر المتفق عليه" hint={vehicle ? `السعر المطلوب: ${fmtMoney(vehicle.asking_price)}` : undefined}><MoneyInput value={r.agreed_price} onChange={(v) => set('agreed_price', v)} /></Field>
        <Field label="المرجع"><TextInput value={r.reference} onChange={(v) => set('reference', v)} /></Field>
        <Field label="ملاحظات" full><TextArea value={r.notes} onChange={(v) => set('notes', v)} rows={2} /></Field>
      </div>
    </Modal>
  );
}

function CancelReservationModal({ r, onClose }: { r: any; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<number | null>(r.paid);
  const [method, setMethod] = useState('cash');
  const { run, busy } = useAction();
  return (
    <Modal size="sm" title={`إلغاء الحجز ${r.reservation_no}`} onClose={onClose}
      footer={<><button className="btn danger" disabled={busy || !reason.trim()} onClick={async () => (await run(() => call('reservations.cancel', { id: r.id, reason, refund_amount: refund ?? 0, method }), 'تم إلغاء الحجز وإتاحة السيارة')) && onClose()}>تأكيد الإلغاء</button><button className="btn" onClick={onClose}>رجوع</button></>}>
      <div className="stack">
        <div className="alert warning">سيتم إلغاء الحجز وإعادة السيارة ({r.brand} {r.model}) إلى حالة «متاحة». العربون المدفوع: <b className="num">{fmtMoney(r.paid)}</b></div>
        <Field label="سبب الإلغاء" required><TextArea value={reason} onChange={setReason} rows={2} /></Field>
        <Field label="المبلغ المسترد للعميل" hint="الفرق يُعتبر عربوناً محتجزاً"><MoneyInput value={refund} onChange={setRefund} /></Field>
        <Field label="طريقة الرد"><Select value={method} onChange={setMethod} options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'other'])} /></Field>
      </div>
    </Modal>
  );
}

function ExtendModal({ r, onClose }: { r: any; onClose: () => void }) {
  const [d, setD] = useState(addDaysStr(r.expiry_date, 7));
  const { run, busy } = useAction();
  return (
    <Modal size="sm" title={`تمديد الحجز ${r.reservation_no}`} onClose={onClose}
      footer={<><button className="btn primary" disabled={busy} onClick={async () => (await run(() => call('reservations.extend', { id: r.id, expiry_date: d }), 'تم تمديد الحجز')) && onClose()}>تمديد</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <Field label="تاريخ الانتهاء الجديد"><DateInput value={d} onChange={setD} /></Field>
    </Modal>
  );
}
