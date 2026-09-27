import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { call, useApi, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, usePrint, today } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import {
  Badge,
  DateInput,
  DL,
  ErrorAlert,
  Field,
  Kpi,
  Money,
  MoneyInput,
  NumberInput,
  PageHeader,
  Select,
  Spinner,
  TextArea,
  TextInput,
  optionsOf,
  SummaryLine,
} from '../components/common';
import { VehiclePicker, type VehicleLite } from '../components/Pickers';
import { PlanBuilder, defaultPlan, type Plan } from '../components/PlanBuilder';
import { Icon } from '../components/Icon';
import { CustomerField, usePrefill } from './Quotations';
import { fmtDate, fmtMoney, fmtPct, label } from '../../core/format';

export function SalesPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const fin = can('reports.financial');
  const cols: Col[] = [
    { key: 'sale_no', label: 'رقم البيع', sort: 'sale_no' },
    { key: 'sale_date', label: 'التاريخ', sort: 'sale_date', render: (r) => fmtDate(r.sale_date), exportType: 'date' },
    { key: 'customer_name', label: 'العميل', sort: 'customer_name' },
    {
      key: 'vehicle',
      label: 'السيارة',
      render: (r) => `${r.brand} ${r.model} ${r.model_year} (${r.stock_no})`,
      exportValue: (r) => `${r.brand} ${r.model} ${r.model_year} ${r.stock_no}`,
      wrap: true,
    },
    { key: 'sale_type', label: 'طريقة البيع', render: (r) => label('sale_type', r.sale_type), exportValue: (r) => label('sale_type', r.sale_type) },
    { key: 'salesperson', label: 'المندوب' },
    {
      key: 'selling_price',
      label: 'سعر البيع',
      num: true,
      sort: 'selling_price',
      render: (r) => fmtMoney(r.selling_price),
      exportType: 'money',
      total: (t) => fmtMoney(t.selling_price),
    },
    {
      key: 'actual_cost',
      label: 'التكلفة الفعلية',
      num: true,
      hidden: !fin,
      render: (r) => fmtMoney(r.actual_cost),
      exportType: 'money',
      total: (t) => fmtMoney(t.actual_cost),
    },
    {
      key: 'gross_profit',
      label: 'مجمل الربح',
      num: true,
      sort: 'gross_profit',
      hidden: !fin,
      render: (r) => <span className={r.gross_profit >= 0 ? 'pos' : 'neg'}>{fmtMoney(r.gross_profit)}</span>,
      exportType: 'money',
      total: (t) => fmtMoney(t.gross_profit),
    },
    {
      key: 'status',
      label: 'الحالة',
      render: (r) =>
        r.status === 'cancelled' ? (
          <Badge group="sale_status" value="cancelled" />
        ) : r.delivered_at ? (
          <Badge value="delivered" text="تم التسليم" />
        ) : (
          <Badge value="active" text="سارية" />
        ),
      exportValue: (r) => label('sale_status', r.status),
    },
  ];
  return (
    <div>
      <PageHeader
        title="المبيعات"
        sub="فواتير وعقود بيع السيارات نقداً وبالتقسيط والاستبدال"
        actions={
          can('sales.create') && (
            <button className="btn primary" onClick={() => nav('/sales/new')}>
              <Icon name="plus" /> عملية بيع جديدة
            </button>
          )
        }
      />
      <DataTable
        method="sales.list"
        columns={cols}
        exportTitle="المبيعات"
        initialFilters={{ status: 'active' }}
        rowClass={(r) => (r.status === 'cancelled' ? 'cancelled' : '')}
        filters={[
          { key: 'status', label: 'الحالة', options: optionsOf('sale_status') },
          { key: 'sale_type', label: 'طريقة البيع', options: optionsOf('sale_type') },
          { key: 'brand', label: 'الماركة', type: 'brand' },
          { key: 'salesperson_id', label: 'المندوب', type: 'salesperson' },
          { key: 'dates', label: 'الفترة', type: 'dates' },
          { key: 'customer_id', label: 'العميل', type: 'customer' },
        ]}
        onRowClick={(r) => nav(`/sales/${r.id}`)}
        empty={{
          icon: 'tag',
          title: 'لا توجد مبيعات',
          text: 'سجل أول عملية بيع.',
          action: can('sales.create') ? (
            <button className="btn primary" onClick={() => nav('/sales/new')}>
              بيع سيارة
            </button>
          ) : undefined,
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ new sale

export function NewSalePage() {
  const nav = useNavigate();
  const { can, user } = useAuth();
  const { confirm } = useUi();
  const [params] = useSearchParams();
  const { customer, setCustomer, vehicle, setVehicle, quote } = usePrefill(params);
  const sp = useApi<any[]>('sales.salespeople');
  const [s, setS] = useState<any>({ sale_type: 'cash', sale_date: today(), discount: 0, fees: 0, method: 'cash', salesperson_id: user?.id });
  const [plan, setPlan] = useState<Plan>(defaultPlan());
  const [planOk, setPlanOk] = useState<{ ok: boolean; msg?: string }>({ ok: false });
  const [tiMode, setTiMode] = useState<'existing' | 'new'>('new');
  const [ti, setTi] = useState<any>({ condition_grade: 'good' });
  const [reservation, setReservation] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));

  const evaluated = useApi<any>(customer ? 'tradeins.list' : null, { pageSize: 50, filters: { customer_id: customer?.id, status: 'evaluated' } });

  useEffect(() => {
    if (vehicle) set('list_price', vehicle.asking_price || null);
  }, [vehicle?.id]);
  useEffect(() => {
    if (quote) {
      setS((x: any) => ({
        ...x,
        list_price: quote.asking_price,
        discount: quote.discount,
        sale_type: quote.payment_method,
        down_payment: quote.down_payment ?? undefined,
      }));
      if (quote.months) setPlan((p) => ({ ...p, count: quote.months }));
    }
  }, [quote?.id]);
  useEffect(() => {
    setReservation(null);
    if (!vehicle) return;
    call('reservations.list', { pageSize: 1, filters: { status: 'active' }, search: vehicle.stock_no }).then((r) => {
      const res = r.rows.find((x: any) => x.vehicle_id === vehicle.id);
      setReservation(res ?? null);
      if (res && !customer) setCustomer({ id: res.customer_id, code: res.customer_code, name: res.customer_name, phone: res.customer_phone });
      if (res?.agreed_price) set('list_price', res.agreed_price);
    });
  }, [vehicle?.id]);

  const isTI = s.sale_type.startsWith('trade_in');
  const isInst = s.sale_type.endsWith('installments');
  const tiValue = isTI
    ? tiMode === 'existing'
      ? (evaluated.data?.rows.find((x: any) => x.id === Number(s.trade_in_id))?.trade_in_value ?? 0)
      : (ti.trade_in_value ?? 0)
    : 0;
  const resCredit = reservation && reservation.customer_id === customer?.id ? reservation.paid : 0;
  const selling = (s.list_price ?? 0) - (s.discount ?? 0);
  const totalContract = selling + (s.fees ?? 0);
  const due = totalContract - tiValue - resCredit;
  const down = isInst ? (s.down_payment ?? 0) : due;
  const financed = isInst ? due - down : 0;
  const belowMin = vehicle && vehicle.min_price > 0 && selling < vehicle.min_price;
  const profit = vehicle?.actual_cost != null ? selling - vehicle.actual_cost : null;
  const reservedForOther = reservation && customer && reservation.customer_id !== customer.id;

  const submit = async () => {
    setError(null);
    const payload: any = {
      ...s,
      customer_id: customer?.id,
      vehicle_id: vehicle?.id,
      quotation_id: quote?.id,
      down_payment: isInst ? down : undefined,
      plan: isInst ? plan : undefined,
    };
    if (isTI) {
      if (tiMode === 'existing') payload.trade_in_id = Number(s.trade_in_id);
      else payload.trade_in = ti;
    }
    const doCall = async (extra: any = {}) => {
      setBusy(true);
      try {
        const r: any = await call('sales.create', { ...payload, ...extra });
        nav(`/sales/${r.id}?created=1`);
      } catch (e: any) {
        if (e instanceof ApiError && e.code === 'BELOW_MIN_PRICE_CONFIRM') {
          const reason = await confirm({
            title: 'البيع بأقل من الحد الأدنى',
            message: <div className="alert warning">{e.message}</div>,
            reason: { label: 'سبب تجاوز الحد الأدنى (يُسجل في سجل المراجعة)', required: true },
            confirmText: 'تأكيد البيع',
            danger: true,
          });
          if (reason) return doCall({ confirm_below_min: true, override_reason: reason });
        } else setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    await doCall();
  };

  const canSubmit = customer && vehicle && s.list_price > 0 && (!isInst || planOk.ok) && !reservedForOther && (!isTI || tiValue > 0);

  return (
    <div className="stack">
      <PageHeader
        crumb={
          <a onClick={() => nav('/sales')} style={{ cursor: 'pointer' }}>
            المبيعات
          </a>
        }
        title="عملية بيع جديدة"
        sub={quote ? `من عرض السعر ${quote.quote_no}` : 'فاتورة وعقد بيع سيارة'}
      />
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', alignItems: 'start' }}>
        <div className="stack">
          <div className="card card-b">
            <div className="form-grid">
              <div className="form-section">العميل والسيارة</div>
              <Field label="العميل" required full>
                <CustomerField value={customer} onChange={setCustomer} />
              </Field>
              <Field label="السيارة" required full>
                <VehiclePicker value={vehicle} onChange={setVehicle} />
              </Field>
              {reservation && (
                <div className={`full alert ${reservedForOther ? 'error' : 'info'}`}>
                  {reservedForOther
                    ? `هذه السيارة محجوزة للعميل ${reservation.customer_name} (${reservation.reservation_no}). يجب إلغاء الحجز أولاً.`
                    : `سيتم تحويل الحجز ${reservation.reservation_no} إلى بيع، وخصم العربون المدفوع (${fmtMoney(reservation.paid)}) من المستحق.`}
                </div>
              )}
              <div className="form-section">طريقة البيع والسعر</div>
              <Field label="طريقة البيع" required>
                <Select name="sale_type" value={s.sale_type} onChange={(v) => set('sale_type', v)} options={optionsOf('sale_type')} />
              </Field>
              <Field label="تاريخ البيع" required>
                <DateInput name="sale_date" value={s.sale_date} onChange={(v) => set('sale_date', v)} />
              </Field>
              <Field label="سعر السيارة" required>
                <MoneyInput name="list_price" value={s.list_price} onChange={(v) => set('list_price', v)} />
              </Field>
              <Field label="الخصم">
                <MoneyInput name="discount" value={s.discount} onChange={(v) => set('discount', v)} />
              </Field>
              <Field label="رسوم إضافية" hint="تسجيل / رسوم إدارية تُضاف لقيمة العقد">
                <MoneyInput name="fees" value={s.fees} onChange={(v) => set('fees', v)} />
              </Field>
              <Field label="مندوب المبيعات">
                <Select
                  value={s.salesperson_id ?? ''}
                  onChange={(v) => set('salesperson_id', v ? Number(v) : null)}
                  options={(sp.data ?? []).map((u) => [u.id, u.full_name])}
                />
              </Field>
              {belowMin && (
                <div className="full alert warning">
                  تحذير: صافي سعر البيع ({fmtMoney(selling)}) أقل من الحد الأدنى المسموح ({fmtMoney(vehicle!.min_price)}).
                  {can('sales.override_min_price') ? ' سيُطلب منك تأكيد التجاوز وذكر السبب.' : ' ليس لديك صلاحية البيع بأقل من الحد الأدنى.'}
                </div>
              )}
            </div>
          </div>

          {isTI && (
            <div className="card card-b">
              <div className="form-grid cols-3">
                <div className="form-section">سيارة الاستبدال (Trade-In)</div>
                <Field label="المصدر" full>
                  <Select
                    value={tiMode}
                    onChange={(v) => setTiMode(v as any)}
                    options={[
                      ['new', 'تقييم جديد الآن'],
                      ['existing', `تقييم سابق للعميل (${evaluated.data?.rows.length ?? 0})`],
                    ]}
                  />
                </Field>
                {tiMode === 'existing' ? (
                  <Field label="اختر التقييم" full>
                    <Select
                      value={s.trade_in_id ?? ''}
                      onChange={(v) => set('trade_in_id', v)}
                      placeholder="اختر..."
                      options={(evaluated.data?.rows ?? []).map((t: any) => [
                        t.id,
                        `${t.trade_no} — ${t.brand} ${t.model} ${t.model_year} — ${fmtMoney(t.trade_in_value)}`,
                      ])}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="الماركة" required>
                      <TextInput name="ti_brand" value={ti.brand} onChange={(v) => setTi({ ...ti, brand: v })} />
                    </Field>
                    <Field label="الموديل" required>
                      <TextInput name="ti_model" value={ti.model} onChange={(v) => setTi({ ...ti, model: v })} />
                    </Field>
                    <Field label="السنة" required>
                      <NumberInput name="ti_year" value={ti.model_year} onChange={(v) => setTi({ ...ti, model_year: v })} />
                    </Field>
                    <Field label="رقم الشاسيه">
                      <TextInput value={ti.vin} onChange={(v) => setTi({ ...ti, vin: v.toUpperCase() })} ltr />
                    </Field>
                    <Field label="الكيلومترات">
                      <NumberInput value={ti.mileage} onChange={(v) => setTi({ ...ti, mileage: v })} />
                    </Field>
                    <Field label="الحالة">
                      <Select value={ti.condition_grade} onChange={(v) => setTi({ ...ti, condition_grade: v })} options={optionsOf('condition_grade')} />
                    </Field>
                    <Field label="القيمة السوقية التقديرية">
                      <MoneyInput value={ti.market_value} onChange={(v) => setTi({ ...ti, market_value: v })} />
                    </Field>
                    <Field label="قيمة الاستبدال" required>
                      <MoneyInput name="ti_value" value={ti.trade_in_value} onChange={(v) => setTi({ ...ti, trade_in_value: v })} />
                    </Field>
                    <Field label="تكلفة التجهيز المتوقعة">
                      <MoneyInput value={ti.expected_prep_cost} onChange={(v) => setTi({ ...ti, expected_prep_cost: v })} />
                    </Field>
                    <Field label="سعر البيع المتوقع">
                      <MoneyInput value={ti.expected_selling_price} onChange={(v) => setTi({ ...ti, expected_selling_price: v })} />
                    </Field>
                    <div className="full muted small">
                      الربح المتوقع من سيارة الاستبدال:{' '}
                      <b className="num">{fmtMoney((ti.expected_selling_price ?? 0) - (ti.trade_in_value ?? 0) - (ti.expected_prep_cost ?? 0))}</b> — ستُضاف
                      السيارة للمخزون تلقائياً بتكلفة تساوي قيمة الاستبدال.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="card card-b">
            <div className="form-grid">
              <div className="form-section">{isInst ? 'المقدم ونظام التقسيط' : 'السداد'}</div>
              {isInst && (
                <Field label="المقدم المدفوع الآن" hint="بالإضافة لأي عربون حجز">
                  <MoneyInput name="down_payment" value={s.down_payment} onChange={(v) => set('down_payment', v)} />
                </Field>
              )}
              <Field label={isInst ? 'طريقة دفع المقدم' : 'طريقة الدفع'}>
                <Select
                  value={s.method}
                  onChange={(v) => set('method', v)}
                  options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other'])}
                />
              </Field>
              <Field label="المرجع (رقم شيك/تحويل)">
                <TextInput value={s.reference} onChange={(v) => set('reference', v)} />
              </Field>
            </div>
            {isInst && (
              <div style={{ marginTop: 14 }}>
                <PlanBuilder total={financed} plan={plan} onChange={setPlan} onValidity={(ok, msg) => setPlanOk({ ok, msg })} />
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <Field label="ملاحظات">
                <TextArea value={s.notes} onChange={(v) => set('notes', v)} rows={2} />
              </Field>
            </div>
          </div>
        </div>

        <div className="card card-b stack" style={{ position: 'sticky', top: 0 }}>
          <h3>ملخص العقد</h3>
          <div className="summary-box">
            <SummaryLine label="سعر السيارة" value={fmtMoney(s.list_price ?? 0)} />
            <SummaryLine label="− الخصم" value={fmtMoney(s.discount ?? 0)} />
            <SummaryLine label="= صافي سعر البيع" value={fmtMoney(selling)} />
            <SummaryLine label="+ الرسوم" value={fmtMoney(s.fees ?? 0)} />
            <SummaryLine label="إجمالي قيمة العقد" value={fmtMoney(totalContract)} total />
            {isTI && <SummaryLine label="− قيمة الاستبدال" value={fmtMoney(tiValue)} />}
            {resCredit > 0 && <SummaryLine label="− عربون الحجز" value={fmtMoney(resCredit)} />}
            <SummaryLine label={isInst ? '− المقدم' : 'المطلوب سداده الآن'} value={fmtMoney(down)} />
            {isInst && <SummaryLine label="المبلغ المقسط" value={<span className={financed <= 0 ? 'neg' : ''}>{fmtMoney(financed)}</span>} total />}
          </div>
          {profit !== null && (
            <div className="summary-box">
              <SummaryLine label="التكلفة الفعلية للسيارة" value={fmtMoney(vehicle!.actual_cost!)} />
              <SummaryLine label="مجمل الربح المتوقع" value={<span className={profit >= 0 ? 'pos' : 'neg'}>{fmtMoney(profit)}</span>} />
              <SummaryLine label="هامش الربح" value={fmtPct(selling ? (profit / selling) * 100 : 0)} />
            </div>
          )}
          <ErrorAlert error={error} />
          {isInst && !planOk.ok && planOk.msg && <div className="alert warning">{planOk.msg}</div>}
          <button className="btn success" style={{ minHeight: 44 }} disabled={!canSubmit || busy} onClick={submit}>
            {busy ? 'جاري الحفظ...' : 'إتمام البيع'}
          </button>
          <div className="muted small">عند إتمام البيع تصبح حالة السيارة «مباعة» ولا يمكن بيعها مرة أخرى.</div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sale detail

export function SaleDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const { run } = useAction();
  const print = usePrint();
  const [params] = useSearchParams();
  const { data, error, loading } = useApi<any>('sales.get', { id: Number(id) });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;
  const s = data.sale;
  const p = data.profit;

  const cancel = async () => {
    const reason = await confirm({
      title: 'إلغاء عملية البيع',
      message: (
        <div className="stack">
          <div className="alert warning">
            سيتم إلغاء البيع {s.sale_no}، وإعادة السيارة للمخزون، وإلغاء عقد التقسيط (إن وجد)، وتسجيل رد للمبالغ المدفوعة (المقدم/العربون). لا يمكن الإلغاء إذا
            كانت هناك أقساط محصلة.
          </div>
        </div>
      ),
      reason: { label: 'سبب الإلغاء', required: true },
      typeToConfirm: 'إلغاء',
      danger: true,
      confirmText: 'إلغاء البيع',
    });
    if (reason) await run(() => call('sales.cancel', { id: s.id, reason }), 'تم إلغاء عملية البيع');
  };
  const deliver = async () => {
    if (await confirm({ title: 'تسليم السيارة', message: `تأكيد تسليم السيارة ${s.brand} ${s.model} للعميل ${s.customer_name}؟`, confirmText: 'تم التسليم' }))
      await run(() => call('sales.deliver', { id: s.id }), 'تم تسجيل التسليم');
  };

  return (
    <div className="stack">
      <PageHeader
        crumb={
          <a onClick={() => nav('/sales')} style={{ cursor: 'pointer' }}>
            المبيعات
          </a>
        }
        title={
          <span className="row" style={{ gap: 10 }}>
            عملية البيع {s.sale_no}{' '}
            {s.status === 'cancelled' ? (
              <Badge group="sale_status" value="cancelled" />
            ) : s.delivered_at ? (
              <Badge value="delivered" text="تم التسليم" />
            ) : (
              <Badge value="active" text="سارية" />
            )}
          </span>
        }
        sub={`${fmtDate(s.sale_date)} • ${label('sale_type', s.sale_type)} • المندوب: ${s.salesperson ?? '—'}`}
        actions={
          <>
            <button className="btn" onClick={() => print('invoice', s.id)}>
              <Icon name="printer" /> الفاتورة
            </button>
            <button className="btn" onClick={() => print('contract', s.id)}>
              <Icon name="printer" /> العقد
            </button>
            {s.contract_id && (
              <button className="btn" onClick={() => print('schedule', s.contract_id)}>
                <Icon name="printer" /> جدول الأقساط
              </button>
            )}
            <button className="btn" onClick={() => print('invoice', s.id, 'pdf')}>
              <Icon name="download" /> PDF
            </button>
            {s.contract_id && (
              <button className="btn primary" onClick={() => nav(`/installments/${s.contract_id}`)}>
                عقد التقسيط والتحصيل
              </button>
            )}
            {s.status === 'active' && !s.delivered_at && can('sales.deliver') && (
              <button className="btn success" onClick={deliver}>
                تسليم السيارة
              </button>
            )}
            {s.status === 'active' && can('sales.cancel') && (
              <button className="btn danger" onClick={cancel}>
                إلغاء البيع
              </button>
            )}
          </>
        }
      />
      {params.get('created') && (
        <div className="alert success">تم إتمام البيع بنجاح. يمكنك الآن طباعة الفاتورة والعقد{s.contract_id ? ' وجدول الأقساط' : ''}.</div>
      )}
      {s.status === 'cancelled' && <div className="alert error">عملية البيع ملغاة — السبب: {s.cancel_reason}</div>}
      <div className="grid-4">
        <Kpi label="قيمة العقد" value={<Money v={s.total_contract_value} />} sub={`سعر البيع ${fmtMoney(s.selling_price)} + رسوم ${fmtMoney(s.fees)}`} />
        <Kpi
          label="المدفوع مقدماً"
          value={<Money v={s.down_payment + s.reservation_credit} />}
          sub={s.trade_in_value ? `+ استبدال ${fmtMoney(s.trade_in_value)}` : undefined}
          tone="accent"
        />
        <Kpi label="المبلغ المقسط" value={<Money v={s.financed_amount} />} sub={data.contract ? `المتبقي: ${fmtMoney(data.contract.remaining)}` : 'بيع نقدي'} />
        {p ? (
          <Kpi
            label="مجمل الربح"
            value={<Money v={p.gross_profit} />}
            sub={`هامش ${fmtPct(p.gross_margin)} • التكلفة ${fmtMoney(p.actual_cost)}`}
            tone={p.gross_profit >= 0 ? 'accent' : 'danger'}
          />
        ) : (
          <Kpi label="أيام بالمخزون" value={s.days_in_stock} />
        )}
      </div>
      <div className="grid-2">
        <div className="card card-b">
          <h3 style={{ marginBottom: 8 }}>العميل والسيارة</h3>
          <DL
            items={[
              [
                'العميل',
                <a style={{ cursor: 'pointer' }} onClick={() => nav(`/customers/${s.customer_id}`)}>
                  {s.customer_name}
                </a>,
              ],
              ['الهاتف', <span className="num">{s.customer_phone ?? '—'}</span>],
              [
                'السيارة',
                <a style={{ cursor: 'pointer' }} onClick={() => nav(`/vehicles/${s.vehicle_id}`)}>
                  {s.brand} {s.model} {s.trim ?? ''} {s.model_year}
                </a>,
              ],
              ['رقم المخزون', s.stock_no],
              ['الشاسيه', <span className="num">{s.vin ?? '—'}</span>],
              ['أيام بالمخزون قبل البيع', s.days_in_stock],
              ['تاريخ التسليم', s.delivered_at ? fmtDate(s.delivered_at) : 'لم تُسلم بعد'],
            ]}
          />
        </div>
        <div className="card card-b">
          <h3 style={{ marginBottom: 8 }}>التفاصيل المالية</h3>
          <div className="summary-box">
            <SummaryLine label="سعر السيارة" value={fmtMoney(s.list_price)} />
            <SummaryLine label="الخصم" value={fmtMoney(s.discount)} />
            <SummaryLine label="صافي سعر البيع" value={fmtMoney(s.selling_price)} />
            <SummaryLine label="الرسوم" value={fmtMoney(s.fees)} />
            <SummaryLine label="إجمالي العقد" value={fmtMoney(s.total_contract_value)} total />
            {s.trade_in_value > 0 && <SummaryLine label="قيمة الاستبدال" value={fmtMoney(s.trade_in_value)} />}
            {s.reservation_credit > 0 && <SummaryLine label="عربون الحجز" value={fmtMoney(s.reservation_credit)} />}
            <SummaryLine label={s.financed_amount ? 'المقدم' : 'المدفوع نقداً'} value={fmtMoney(s.down_payment)} />
            {s.financed_amount > 0 && <SummaryLine label="المقسط" value={fmtMoney(s.financed_amount)} total />}
          </div>
          {s.min_price_override ? (
            <div className="alert warning" style={{ marginTop: 8 }}>
              تم البيع بأقل من الحد الأدنى ({fmtMoney(s.min_price_at_sale)}) — السبب: {s.override_reason}
            </div>
          ) : null}
          {p && (
            <div className="summary-box" style={{ marginTop: 8 }}>
              <SummaryLine label="التكلفة الفعلية" value={fmtMoney(p.actual_cost)} />
              <SummaryLine
                label="مجمل الربح"
                value={
                  <span className={p.gross_profit >= 0 ? 'pos' : 'neg'}>
                    {fmtMoney(p.gross_profit)} ({fmtPct(p.gross_margin)})
                  </span>
                }
              />
              {p.sale_expenses > 0 && <SummaryLine label="مصروفات البيع" value={fmtMoney(p.sale_expenses)} />}
              {p.sale_expenses > 0 && <SummaryLine label="صافي ربح البيعة" value={fmtMoney(p.gross_profit - p.sale_expenses)} total />}
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-h">
          <h3>المدفوعات المرتبطة</h3>
        </div>
        {data.payments.length ? (
          <table className="dt">
            <thead>
              <tr>
                <th>رقم الإيصال</th>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>الطريقة</th>
                <th>المرجع</th>
                <th>المبلغ</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.payments.map((x: any) => (
                <tr key={x.id} className={x.status === 'voided' ? 'cancelled' : ''}>
                  <td>{x.receipt_no}</td>
                  <td>{fmtDate(x.pay_date)}</td>
                  <td>{label('payment_kind', x.kind)}</td>
                  <td>{label('pay_method', x.method)}</td>
                  <td>{x.reference ?? '—'}</td>
                  <td className="num bold">{fmtMoney(x.amount)}</td>
                  <td>
                    <Badge group="payment_status" value={x.status} />
                  </td>
                  <td className="actions">
                    <button className="btn sm" onClick={() => print('receipt', x.id)}>
                      <Icon name="printer" /> إيصال
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="card-b muted">لا توجد مدفوعات</div>
        )}
      </div>
      {data.tradeIn && (
        <div className="card card-b">
          <h3 style={{ marginBottom: 8 }}>سيارة الاستبدال</h3>
          <DL
            items={[
              ['الرقم', data.tradeIn.trade_no],
              ['السيارة', `${data.tradeIn.brand} ${data.tradeIn.model} ${data.tradeIn.model_year}`],
              ['قيمة الاستبدال', fmtMoney(data.tradeIn.trade_in_value)],
              [
                'رقم المخزون الجديد',
                data.tradeIn.new_stock_no ? (
                  <a style={{ cursor: 'pointer' }} onClick={() => nav(`/vehicles/${data.tradeIn.vehicle_id}`)}>
                    {data.tradeIn.new_stock_no}
                  </a>
                ) : (
                  '—'
                ),
              ],
            ]}
          />
        </div>
      )}
      {data.expenses.length > 0 && (
        <div className="card">
          <div className="card-h">
            <h3>مصروفات مرتبطة بالبيع</h3>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>البند</th>
                <th>الوصف</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((e: any) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.expense_date)}</td>
                  <td>{label('expense_category', e.category)}</td>
                  <td>{e.description}</td>
                  <td className="num">{fmtMoney(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
