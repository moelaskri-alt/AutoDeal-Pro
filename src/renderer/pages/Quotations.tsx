import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { call } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, usePrint, today, addDaysStr } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import { Badge, DateInput, Field, Modal, MoneyInput, NumberInput, PageHeader, Select, TextArea, optionsOf, SummaryLine } from '../components/common';
import { CustomerPicker, VehiclePicker, type CustomerLite, type VehicleLite } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { CustomerFormModal } from './Customers';
import { fmtDate, fmtMoney, label } from '../../core/format';

/** Customer picker with a "new customer" shortcut. */
export function CustomerField({ value, onChange, disabled }: { value: CustomerLite | null; onChange: (c: CustomerLite | null) => void; disabled?: boolean }) {
  const { can } = useAuth();
  const [add, setAdd] = useState(false);
  return (
    <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CustomerPicker value={value} onChange={onChange} disabled={disabled} />
      </div>
      {!value && !disabled && can('customers.manage') && (
        <button type="button" className="btn" onClick={() => setAdd(true)} title="عميل جديد">
          <Icon name="plus" /> جديد
        </button>
      )}
      {add && <CustomerFormModal onClose={() => setAdd(false)} onSaved={(c) => onChange({ id: c.id, code: c.code, name: c.name, phone: c.phone })} />}
    </div>
  );
}

/** Loads a customer / vehicle given by id in the URL so forms can be pre-filled. */
export function usePrefill(params: URLSearchParams) {
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [vehicle, setVehicle] = useState<VehicleLite | null>(null);
  const [quote, setQuote] = useState<any | null>(null);
  useEffect(() => {
    const cid = params.get('customer');
    const vid = params.get('vehicle');
    const qid = params.get('quote');
    if (cid) call('customers.get', { id: Number(cid) }).then((r) => setCustomer(r.customer)).catch(() => undefined);
    if (vid) call('vehicles.get', { id: Number(vid) }).then((r) => setVehicle(r.vehicle)).catch(() => undefined);
    if (qid)
      call('quotations.get', { id: Number(qid) })
        .then(async (q) => {
          setQuote(q);
          setCustomer({ id: q.customer_id, code: q.customer_code, name: q.customer_name, phone: q.customer_phone });
          const v = await call('vehicles.get', { id: q.vehicle_id });
          setVehicle(v.vehicle);
        })
        .catch(() => undefined);
  }, [params.toString()]);
  return { customer, setCustomer, vehicle, setVehicle, quote };
}

export function QuotationsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const { run } = useAction();
  const print = usePrint();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(!!params.get('new'));
  const cols: Col[] = [
    { key: 'quote_no', label: 'رقم العرض' },
    { key: 'quote_date', label: 'التاريخ', sort: 'quote_date', render: (r) => fmtDate(r.quote_date), exportType: 'date' },
    { key: 'customer_name', label: 'العميل', sort: 'customer_name' },
    { key: 'vehicle', label: 'السيارة', render: (r) => `${r.brand} ${r.model} ${r.model_year} (${r.stock_no})`, exportValue: (r) => `${r.brand} ${r.model} ${r.model_year}`, wrap: true },
    { key: 'payment_method', label: 'طريقة الدفع', render: (r) => label('sale_type', r.payment_method), exportValue: (r) => label('sale_type', r.payment_method) },
    { key: 'final_price', label: 'السعر النهائي', num: true, sort: 'final_price', render: (r) => fmtMoney(r.final_price), exportType: 'money', total: (t) => fmtMoney(t.final_price) },
    { key: 'valid_until', label: 'صالح حتى', sort: 'valid_until', render: (r) => fmtDate(r.valid_until), exportType: 'date' },
    { key: 'status', label: 'الحالة', render: (r) => <Badge group="quotation_status" value={r.status} />, exportValue: (r) => label('quotation_status', r.status) },
    { key: 'created_by_name', label: 'بواسطة' },
    {
      key: 'actions',
      label: '',
      noExport: true,
      render: (r) => (
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn sm" onClick={() => print('quotation', r.id)} title="طباعة"><Icon name="printer" /></button>
          <button className="btn sm" onClick={() => print('quotation', r.id, 'pdf')} title="حفظ PDF">PDF</button>
          {r.status === 'open' && can('reservations.manage') && !['sold', 'delivered', 'reserved'].includes(r.vehicle_status) && <button className="btn sm" onClick={() => nav(`/reservations?new=1&quote=${r.id}`)}>تحويل لحجز</button>}
          {['open', 'reserved'].includes(r.status) && can('sales.create') && !['sold', 'delivered'].includes(r.vehicle_status) && <button className="btn sm success" onClick={() => nav(`/sales/new?quote=${r.id}`)}>تحويل لبيع</button>}
          {r.status === 'open' && can('quotations.manage') && (
            <button className="btn sm ghost" title="إلغاء العرض" onClick={async () => (await confirm({ title: 'إلغاء عرض السعر', message: `إلغاء العرض ${r.quote_no}؟`, danger: true, confirmText: 'إلغاء العرض' })) && run(() => call('quotations.cancel', { id: r.id }), 'تم إلغاء العرض')}>
              <Icon name="x" />
            </button>
          )}
        </div>
      ),
    },
  ];
  return (
    <div>
      <PageHeader title="عروض الأسعار" sub="إنشاء وطباعة عروض الأسعار وتحويلها إلى حجز أو بيع" actions={can('quotations.manage') && <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" /> عرض سعر جديد</button>} />
      <DataTable
        method="quotations.list"
        columns={cols}
        exportTitle="عروض الأسعار"
        filters={[
          { key: 'status', label: 'الحالة', options: optionsOf('quotation_status') },
          { key: 'brand', label: 'الماركة', type: 'brand' },
          { key: 'salesperson_id', label: 'المندوب', type: 'salesperson' },
          { key: 'dates', label: 'الفترة', type: 'dates' },
        ]}
        empty={{ icon: 'file', title: 'لا توجد عروض أسعار', text: 'أنشئ عرض سعر لعميل على سيارة من المخزون.', action: can('quotations.manage') ? <button className="btn primary" onClick={() => setForm(true)}>عرض سعر جديد</button> : undefined }}
      />
      {form && <QuotationFormModal params={params} onClose={() => { setForm(false); if (params.get('new')) setParams({}); }} />}
    </div>
  );
}

function QuotationFormModal({ params, onClose }: { params: URLSearchParams; onClose: () => void }) {
  const { customer, setCustomer, vehicle, setVehicle } = usePrefill(params);
  const { run, busy } = useAction();
  const print = usePrint();
  const [q, setQ] = useState<any>({ quote_date: today(), payment_method: 'cash', discount: 0, valid_until: addDaysStr(today(), 14) });
  const set = (k: string, v: any) => setQ((x: any) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (vehicle) set('asking_price', vehicle.asking_price || null);
  }, [vehicle?.id]);
  const final = (q.asking_price ?? 0) - (q.discount ?? 0);
  const below = vehicle && vehicle.min_price > 0 && final < vehicle.min_price;
  const inst = q.payment_method.endsWith('installments');
  const save = async (andPrint: boolean) => {
    const r: any = await run(() => call('quotations.create', { ...q, customer_id: customer?.id, vehicle_id: vehicle?.id }), 'تم إنشاء عرض السعر');
    if (r) {
      onClose();
      if (andPrint) print('quotation', r.id);
    }
  };
  return (
    <Modal size="lg" title="عرض سعر جديد" onClose={onClose}
      footer={<><button className="btn primary" disabled={busy} onClick={() => save(true)}>حفظ وطباعة</button><button className="btn" disabled={busy} onClick={() => save(false)}>حفظ</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="form-grid">
        <Field label="العميل" required full><CustomerField value={customer} onChange={setCustomer} /></Field>
        <Field label="السيارة" required full><VehiclePicker value={vehicle} onChange={setVehicle} /></Field>
        <Field label="السعر المطلوب" required><MoneyInput name="asking_price" value={q.asking_price} onChange={(v) => set('asking_price', v)} /></Field>
        <Field label="الخصم"><MoneyInput name="discount" value={q.discount} onChange={(v) => set('discount', v)} /></Field>
        <Field label="طريقة الدفع"><Select value={q.payment_method} onChange={(v) => set('payment_method', v)} options={optionsOf('sale_type')} /></Field>
        <Field label="صالح حتى" required><DateInput value={q.valid_until} onChange={(v) => set('valid_until', v)} /></Field>
        {inst && (
          <>
            <Field label="المقدم المقترح"><MoneyInput value={q.down_payment} onChange={(v) => set('down_payment', v)} /></Field>
            <Field label="عدد الشهور"><NumberInput value={q.months} onChange={(v) => set('months', v)} min={1} max={360} /></Field>
          </>
        )}
        <Field label="ملاحظات" full><TextArea value={q.notes} onChange={(v) => set('notes', v)} rows={2} /></Field>
        <div className="full summary-box">
          <SummaryLine label="السعر النهائي" value={fmtMoney(final)} total />
          {inst && q.months && q.down_payment != null ? <SummaryLine label="القسط الشهري التقريبي" value={fmtMoney(Math.round((final - (q.down_payment ?? 0)) / q.months))} /> : null}
          {vehicle && <SummaryLine label="الحد الأدنى المسموح" value={fmtMoney(vehicle.min_price)} />}
        </div>
        {below && <div className="full alert warning">تحذير: السعر النهائي أقل من الحد الأدنى لسعر البيع لهذه السيارة. يتطلب صلاحية تجاوز الحد الأدنى ويتم تسجيله في سجل المراجعة.</div>}
      </div>
    </Modal>
  );
}
