import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { call, useApi } from '../lib/api';
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
  Modal,
  Money,
  MoneyInput,
  NumberInput,
  PageHeader,
  Select,
  Spinner,
  Tabs,
  TextArea,
  TextInput,
  optionsOf,
  Kpi,
  EmptyState,
} from '../components/common';
import { Icon } from '../components/Icon';
import { fmtDate, fmtMoney, fmtNum, fmtPct, label, fmtDateTime } from '../../core/format';
import { CostCardView } from './Costs';
import { AuditTrail } from '../components/AuditLog';

const imgCache = new Map<number, string>();
export function VehicleImage({ id, className = 'thumb', alt = '' }: { id: number | null | undefined; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(id ? (imgCache.get(id) ?? null) : null);
  useEffect(() => {
    let alive = true;
    if (!id) return setSrc(null);
    if (imgCache.has(id)) return setSrc(imgCache.get(id)!);
    call('vehicles.getImage', { id })
      .then((r) => {
        const url = `data:${r.mime};base64,${r.base64}`;
        imgCache.set(id, url);
        if (alive) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  if (!src)
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
        <Icon name="car" size={18} />
      </div>
    );
  return <img className={className} src={src} alt={alt} />;
}

export const vehicleTitle = (v: any) => `${v.brand} ${v.model}${v.trim ? ' ' + v.trim : ''} ${v.model_year}`;

export function VehiclesPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<any | null>(params.get('new') ? {} : null);
  const fin = can('costs.view');
  const cols: Col[] = [
    { key: 'image', label: '', render: (r) => <VehicleImage id={r.image_id} />, noExport: true },
    { key: 'stock_no', label: 'رقم المخزون', sort: 'stock_no' },
    {
      key: 'vehicle',
      label: 'السيارة',
      sort: 'brand',
      render: (r) => (
        <>
          <b>{vehicleTitle(r)}</b>
          <span className="cell-sub">{[r.color, r.vin].filter(Boolean).join(' • ') || '—'}</span>
        </>
      ),
      exportValue: (r) => vehicleTitle(r),
      wrap: true,
    },
    { key: 'condition', label: 'النوع', render: (r) => <Badge group="condition" value={r.condition} />, exportValue: (r) => label('condition', r.condition) },
    { key: 'color', label: 'اللون', exportOnly: true },
    { key: 'vin', label: 'رقم الشاسيه', exportOnly: true },
    { key: 'mileage', label: 'كم', num: true, sort: 'mileage', render: (r) => fmtNum(r.mileage), exportType: 'int' },
    {
      key: 'status',
      label: 'الحالة',
      sort: 'status',
      render: (r) => <Badge group="vehicle_status" value={r.status} />,
      exportValue: (r) => label('vehicle_status', r.status),
    },
    { key: 'days_in_stock', label: 'أيام بالمخزون', num: true, sort: 'days_in_stock', exportType: 'int' },
    {
      key: 'actual_cost',
      label: 'التكلفة الفعلية',
      num: true,
      sort: 'actual_cost',
      hidden: !fin,
      render: (r) => fmtMoney(r.actual_cost),
      exportType: 'money',
      total: (t) => fmtMoney(t.actual_cost),
    },
    {
      key: 'asking_price',
      label: 'السعر المطلوب',
      num: true,
      sort: 'asking_price',
      render: (r) => fmtMoney(r.asking_price),
      exportType: 'money',
      total: (t) => fmtMoney(t.asking_price),
    },
    {
      key: 'expected_profit',
      label: 'الربح المتوقع',
      num: true,
      hidden: !fin,
      render: (r) =>
        r.asking_price ? <span className={r.asking_price - r.actual_cost >= 0 ? 'pos' : 'neg'}>{fmtMoney(r.asking_price - r.actual_cost)}</span> : '—',
      exportValue: (r) => (r.asking_price ? (r.asking_price - r.actual_cost) / 100 : ''),
    },
  ];
  return (
    <div>
      <PageHeader
        title="السيارات"
        sub="مخزون المعرض من السيارات الجديدة والمستعملة"
        actions={
          <>
            {can('purchases.manage') && (
              <button className="btn" onClick={() => nav('/purchases?new=1')}>
                <Icon name="cart" /> تسجيل شراء
              </button>
            )}
            {can('vehicles.manage') && (
              <button className="btn primary" onClick={() => setForm({})}>
                <Icon name="plus" /> إضافة سيارة
              </button>
            )}
          </>
        }
      />
      <DataTable
        method="vehicles.list"
        columns={cols}
        exportTitle="السيارات"
        searchPlaceholder="بحث: رقم المخزون، الماركة، الموديل، الشاسيه..."
        initialFilters={{ status: params.get('status') ?? 'in_stock' }}
        filters={[
          { key: 'status', label: 'الحالة', options: [['in_stock', 'بالمعرض (كل غير المباع)'], ...optionsOf('vehicle_status')] },
          { key: 'condition', label: 'النوع', options: optionsOf('condition') },
          { key: 'brand', label: 'الماركة', type: 'brand' },
          { key: 'dates', label: 'تاريخ الاستلام', type: 'dates' },
        ]}
        onRowClick={(r) => nav(`/vehicles/${r.id}`)}
        empty={{
          icon: 'car',
          title: 'لا توجد سيارات حالياً',
          text: 'أضف أول سيارة للمعرض لتبدأ إدارة المخزون.',
          action: can('vehicles.manage') ? (
            <button className="btn primary" onClick={() => setForm({})}>
              إضافة سيارة
            </button>
          ) : undefined,
        }}
      />
      {form && (
        <VehicleFormModal
          initial={form}
          onClose={() => {
            setForm(null);
            if (params.get('new')) setParams({});
          }}
          onSaved={(id) => nav(`/vehicles/${id}`)}
        />
      )}
    </div>
  );
}

export function VehicleFields({ v, set, showStatus }: { v: any; set: (k: string, val: any) => void; showStatus?: boolean }) {
  return (
    <>
      <Field label="نوع السيارة" required>
        <Select name="condition" value={v.condition} onChange={(x) => set('condition', x)} options={optionsOf('condition')} placeholder="اختر..." />
      </Field>
      <Field label="الماركة" required>
        <TextInput name="brand" value={v.brand} onChange={(x) => set('brand', x)} placeholder="مثال: Toyota" />
      </Field>
      <Field label="الموديل" required>
        <TextInput name="model" value={v.model} onChange={(x) => set('model', x)} placeholder="مثال: Corolla" />
      </Field>
      <Field label="الفئة (Trim)">
        <TextInput name="trim" value={v.trim} onChange={(x) => set('trim', x)} />
      </Field>
      <Field label="سنة الصنع" required>
        <NumberInput name="model_year" value={v.model_year} onChange={(x) => set('model_year', x)} min={1950} max={2100} />
      </Field>
      <Field label="اللون">
        <TextInput name="color" value={v.color} onChange={(x) => set('color', x)} />
      </Field>
      <Field label="رقم الشاسيه (VIN)" hint="يجب ألا يتكرر">
        <TextInput name="vin" value={v.vin} onChange={(x) => set('vin', x.toUpperCase())} ltr />
      </Field>
      <Field label="رقم المحرك">
        <TextInput name="engine_no" value={v.engine_no} onChange={(x) => set('engine_no', x.toUpperCase())} ltr />
      </Field>
      <Field label="رقم اللوحة">
        <TextInput name="plate_no" value={v.plate_no} onChange={(x) => set('plate_no', x)} />
      </Field>
      <Field label="عداد الكيلومترات">
        <NumberInput name="mileage" value={v.mileage} onChange={(x) => set('mileage', x)} min={0} />
      </Field>
      <Field label="ناقل الحركة">
        <Select
          name="transmission"
          value={v.transmission}
          onChange={(x) => set('transmission', x)}
          options={[
            ['أوتوماتيك', 'أوتوماتيك'],
            ['مانيوال', 'مانيوال'],
          ]}
          placeholder="—"
        />
      </Field>
      <Field label="نوع الوقود">
        <Select
          name="fuel_type"
          value={v.fuel_type}
          onChange={(x) => set('fuel_type', x)}
          options={[
            ['بنزين', 'بنزين'],
            ['ديزل', 'ديزل'],
            ['هايبرد', 'هايبرد'],
            ['كهرباء', 'كهرباء'],
            ['غاز طبيعي', 'غاز طبيعي'],
          ]}
          placeholder="—"
        />
      </Field>
      <Field label="نوع الهيكل">
        <Select
          name="body_type"
          value={v.body_type}
          onChange={(x) => set('body_type', x)}
          options={[
            ['سيدان', 'سيدان'],
            ['هاتشباك', 'هاتشباك'],
            ['SUV', 'SUV'],
            ['كروس أوفر', 'كروس أوفر'],
            ['بيك أب', 'بيك أب'],
            ['فان', 'فان'],
            ['كوبيه', 'كوبيه'],
          ]}
          placeholder="—"
        />
      </Field>
      <Field label="بلد المنشأ">
        <TextInput name="origin_country" value={v.origin_country} onChange={(x) => set('origin_country', x)} />
      </Field>
      {showStatus && (
        <Field label="الحالة">
          <Select
            name="status"
            value={v.status}
            onChange={(x) => set('status', x)}
            options={optionsOf('vehicle_status', ['available', 'preparation', 'maintenance', 'returned'])}
          />
        </Field>
      )}
    </>
  );
}

export function VehicleFormModal({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved?: (id: number) => void }) {
  const { can } = useAuth();
  const { run, busy } = useAction();
  const editing = !!initial.id;
  const [v, setV] = useState<any>(
    editing ? initial : { condition: 'new', status: 'available', acquisition_date: today(), mileage: 0, model_year: new Date().getFullYear() },
  );
  const set = (k: string, val: any) => setV((x: any) => ({ ...x, [k]: val }));
  const lockedStatus = ['reserved', 'sold', 'delivered'].includes(initial.status);
  const save = async () => {
    const r = await run(() => call(editing ? 'vehicles.update' : 'vehicles.create', v), editing ? 'تم حفظ التعديلات' : 'تمت إضافة السيارة');
    if (r) {
      onClose();
      onSaved?.((r as any).id);
    }
  };
  return (
    <Modal
      size="lg"
      title={editing ? `تعديل السيارة ${initial.stock_no}` : 'إضافة سيارة (رصيد افتتاحي / سيارة موجودة)'}
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
      {!editing && (
        <div className="alert info" style={{ marginBottom: 12 }}>
          لتسجيل سيارة مشتراة من مورد أو فرد مع فاتورة الشراء، استخدم شاشة «المشتريات» — سيتم إنشاء السيارة وبطاقة التكلفة تلقائياً.
        </div>
      )}
      <div className="form-grid cols-3">
        <VehicleFields v={v} set={set} showStatus={!lockedStatus} />
        <Field label="تاريخ الاستلام" required>
          <DateInput name="acquisition_date" value={v.acquisition_date} onChange={(x) => set('acquisition_date', x)} />
        </Field>
        {can('vehicles.pricing') && (
          <>
            <div className="form-section">التسعير</div>
            <Field label="السعر المطلوب">
              <MoneyInput name="asking_price" value={v.asking_price} onChange={(x) => set('asking_price', x)} />
            </Field>
            <Field label="الحد الأدنى لسعر البيع" hint="لا يُسمح بالبيع بأقل منه إلا بصلاحية">
              <MoneyInput name="min_price" value={v.min_price} onChange={(x) => set('min_price', x)} />
            </Field>
          </>
        )}
        {!editing && (can('costs.manage') || can('purchases.manage')) && (
          <Field label="تكلفة الاقتناء (اختياري)" hint="تُسجل كبند أول في بطاقة التكلفة">
            <MoneyInput name="opening_cost" value={v.opening_cost} onChange={(x) => set('opening_cost', x)} />
          </Field>
        )}
        <Field label="ملاحظات" full>
          <TextArea value={v.notes} onChange={(x) => set('notes', x)} />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ detail

export function VehicleDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const { run } = useAction();
  const print = usePrint();
  const [tab, setTab] = useState('info');
  const [edit, setEdit] = useState(false);
  const [pricing, setPricing] = useState(false);
  const { data, error, loading } = useApi<any>('vehicles.get', { id: Number(id) });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;
  const v = data.vehicle;
  const pr = data.pricing;
  const sellable = ['available', 'returned', 'preparation', 'reserved'].includes(v.status);

  const del = async () => {
    const ok = await confirm({
      title: 'حذف السيارة',
      message: `سيتم حذف السيارة ${v.stock_no} (${vehicleTitle(v)}). لا يمكن حذف سيارة مرتبطة بعمليات بيع أو شراء أو حجز.`,
      danger: true,
      confirmText: 'حذف',
    });
    if (ok && (await run(() => call('vehicles.delete', { id: v.id }), 'تم حذف السيارة'))) nav('/vehicles');
  };

  return (
    <div className="stack">
      <PageHeader
        crumb={
          <a onClick={() => nav('/vehicles')} style={{ cursor: 'pointer' }}>
            السيارات
          </a>
        }
        title={
          <span className="row" style={{ gap: 10 }}>
            {vehicleTitle(v)} <Badge group="vehicle_status" value={v.status} /> <Badge group="condition" value={v.condition} />
          </span>
        }
        sub={`رقم المخزون ${v.stock_no} • ${label('acquisition_type', v.acquisition_type)} بتاريخ ${fmtDate(v.acquisition_date)} • ${v.days_in_stock} يوم بالمعرض`}
        actions={
          <>
            {can('costs.view') && (
              <button className="btn" onClick={() => print('costcard', v.id)}>
                <Icon name="printer" /> بطاقة التكلفة
              </button>
            )}
            {can('quotations.manage') && sellable && (
              <button className="btn" onClick={() => nav(`/quotations?new=1&vehicle=${v.id}`)}>
                عرض سعر
              </button>
            )}
            {can('reservations.manage') && ['available', 'returned', 'preparation'].includes(v.status) && (
              <button className="btn" onClick={() => nav(`/reservations?new=1&vehicle=${v.id}`)}>
                حجز
              </button>
            )}
            {can('sales.create') && sellable && (
              <button className="btn success" onClick={() => nav(`/sales/new?vehicle=${v.id}`)}>
                بيع السيارة
              </button>
            )}
            {can('vehicles.manage') && (
              <button className="btn" onClick={() => setEdit(true)}>
                <Icon name="edit" /> تعديل
              </button>
            )}
            {can('vehicles.delete') && (
              <button className="btn ghost" onClick={del} title="حذف">
                <Icon name="trash" />
              </button>
            )}
          </>
        }
      />
      <div className="grid-4">
        {pr ? (
          <Kpi
            label="التكلفة الفعلية"
            value={<Money v={pr.actual_cost} />}
            sub={
              <>
                شراء <Money v={v.acquisition_cost} /> + مباشرة <Money v={v.direct_costs} />
              </>
            }
          />
        ) : (
          <Kpi label="الحالة" value={label('vehicle_status', v.status)} />
        )}
        <Kpi
          label="السعر المطلوب"
          value={<Money v={v.asking_price} />}
          sub={
            <>
              الحد الأدنى: <Money v={v.min_price} />
            </>
          }
        />
        {pr && v.sale_id ? (
          <Kpi
            label="سعر البيع / الربح الفعلي"
            value={<Money v={v.selling_price} />}
            sub={
              <span className={pr.actual_profit >= 0 ? 'pos' : 'neg'}>
                ربح {fmtMoney(pr.actual_profit)} ({fmtPct(pr.actual_margin)})
              </span>
            }
            tone="accent"
          />
        ) : pr ? (
          <Kpi
            label="الربح المتوقع"
            value={pr.expected_profit !== null ? <Money v={pr.expected_profit} /> : '—'}
            sub={pr.expected_margin !== null ? `هامش ${fmtPct(pr.expected_margin)} • عند الحد الأدنى: ${fmtMoney(pr.min_profit)}` : 'حدد سعر البيع'}
            tone={pr.expected_profit < 0 ? 'danger' : 'accent'}
          />
        ) : (
          <Kpi label="الكيلومترات" value={fmtNum(v.mileage)} />
        )}
        <Kpi label="أيام بالمخزون" value={fmtNum(v.days_in_stock)} sub={v.sale_date ? `بيعت في ${fmtDate(v.sale_date)}` : 'منذ تاريخ الاستلام'} />
      </div>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'info', label: 'البيانات الأساسية' },
          { key: 'cost', label: 'بطاقة التكلفة', hidden: !can('costs.view') },
          { key: 'images', label: 'الصور', count: data.images.length },
          { key: 'history', label: 'العروض والحجوزات والمبيعات', count: data.quotations.length + data.reservations.length + data.sales.length },
          { key: 'audit', label: 'سجل التعديلات', hidden: !can('audit.view') },
        ]}
      />
      {tab === 'info' && (
        <div className="grid-2">
          <div className="card card-b">
            <DL
              items={[
                ['الماركة / الموديل', `${v.brand} ${v.model} ${v.trim ?? ''}`],
                ['سنة الصنع', v.model_year],
                ['اللون', v.color],
                ['رقم الشاسيه (VIN)', <span className="num">{v.vin ?? '—'}</span>],
                ['رقم المحرك', <span className="num">{v.engine_no ?? '—'}</span>],
                ['رقم اللوحة', v.plate_no],
                ['الكيلومترات', fmtNum(v.mileage)],
                ['ناقل الحركة', v.transmission],
                ['الوقود', v.fuel_type],
                ['نوع الهيكل', v.body_type],
                ['بلد المنشأ', v.origin_country],
              ]}
            />
          </div>
          <div className="card card-b stack">
            <DL
              items={[
                ['طريقة الاقتناء', label('acquisition_type', v.acquisition_type)],
                ['تاريخ الاستلام', fmtDate(v.acquisition_date)],
                ['المورد / البائع', v.supplier_name ?? data.tradeIn?.customer_name],
                ['رقم الشراء', data.purchase?.purchase_no],
                ['الاستبدال', data.tradeIn ? `${data.tradeIn.trade_no} من ${data.tradeIn.customer_name}` : null],
                ['ملاحظات', v.notes],
              ]}
            />
            {can('vehicles.pricing') && !['sold', 'delivered'].includes(v.status) && (
              <div>
                <button className="btn" onClick={() => setPricing(true)}>
                  <Icon name="money" /> تعديل التسعير
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'cost' && <CostCardView vehicleId={v.id} />}
      {tab === 'images' && <VehicleImages vehicleId={v.id} images={data.images} canEdit={can('vehicles.manage')} />}
      {tab === 'history' && <VehicleHistory data={data} />}
      {tab === 'audit' && <AuditTrail filters={{ record_id: String(v.id) }} />}
      {edit && <VehicleFormModal initial={v} onClose={() => setEdit(false)} />}
      {pricing && <PricingModal v={v} actualCost={pr?.actual_cost} onClose={() => setPricing(false)} />}
    </div>
  );
}

function PricingModal({ v, actualCost, onClose }: { v: any; actualCost?: number; onClose: () => void }) {
  const [asking, setAsking] = useState<number | null>(v.asking_price);
  const [min, setMin] = useState<number | null>(v.min_price);
  const { run, busy } = useAction();
  const profit = asking && actualCost !== undefined ? asking - actualCost : null;
  return (
    <Modal
      size="sm"
      title="تسعير السيارة"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () =>
              (await run(() => call('vehicles.setPrices', { id: v.id, asking_price: asking ?? 0, min_price: min ?? 0 }), 'تم تحديث الأسعار')) && onClose()
            }
          >
            حفظ
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <div className="stack">
        {actualCost !== undefined && (
          <div className="summary-box">
            <div className="summary-line">
              <span>التكلفة الفعلية</span>
              <b className="num">{fmtMoney(actualCost)}</b>
            </div>
            <div className="summary-line">
              <span>الربح المتوقع</span>
              <b className={`num ${profit !== null && profit < 0 ? 'neg' : 'pos'}`}>
                {profit !== null ? `${fmtMoney(profit)} (${fmtPct(asking ? (profit / asking) * 100 : 0)})` : '—'}
              </b>
            </div>
            <div className="summary-line">
              <span>الربح عند الحد الأدنى</span>
              <b className="num">{min ? fmtMoney(min - actualCost) : '—'}</b>
            </div>
          </div>
        )}
        <Field label="السعر المطلوب">
          <MoneyInput value={asking} onChange={setAsking} />
        </Field>
        <Field label="الحد الأدنى لسعر البيع">
          <MoneyInput value={min} onChange={setMin} />
        </Field>
        <div className="muted small">يتم تسجيل أي تعديل للأسعار في سجل المراجعة.</div>
      </div>
    </Modal>
  );
}

async function resizeImage(file: File): Promise<{ mime: string; base64: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { mime: 'image/jpeg', base64: dataUrl.split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function VehicleImages({ vehicleId, images, canEdit }: { vehicleId: number; images: any[]; canEdit: boolean }) {
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const img = await resizeImage(f).catch(() => null);
      if (!img) continue;
      await run(() => call('vehicles.addImage', { vehicle_id: vehicleId, ...img }));
    }
  };
  return (
    <div className="card card-b stack">
      {canEdit && (
        <div className="row">
          <label className="btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            <Icon name="image" /> إضافة صور
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
          </label>
          <span className="muted small">يتم ضغط الصور تلقائياً وحفظها داخل قاعدة البيانات (تشملها النسخة الاحتياطية).</span>
        </div>
      )}
      {images.length === 0 ? (
        <EmptyState icon="image" title="لا توجد صور لهذه السيارة" text={canEdit ? 'أضف صوراً لعرضها للعملاء.' : undefined} />
      ) : (
        <div className="gallery">
          {images.map((im) => (
            <div className="img" key={im.id}>
              <VehicleImage id={im.id} className="" />
              {canEdit && (
                <div className="ops">
                  {im.is_primary ? (
                    <span className="badge green">الرئيسية</span>
                  ) : (
                    <button className="btn sm" onClick={() => run(() => call('vehicles.setPrimaryImage', { id: im.id }))}>
                      تعيين رئيسية
                    </button>
                  )}
                  <button
                    className="btn sm danger"
                    onClick={async () =>
                      (await confirm({ title: 'حذف الصورة', message: 'هل تريد حذف هذه الصورة؟', danger: true, confirmText: 'حذف' })) &&
                      run(() => call('vehicles.deleteImage', { id: im.id }), 'تم حذف الصورة')
                    }
                  >
                    حذف
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleHistory({ data }: { data: any }) {
  const nav = useNavigate();
  return (
    <div className="stack">
      <div className="card">
        <div className="card-h">
          <h3>المبيعات</h3>
        </div>
        {data.sales.length ? (
          <table className="dt">
            <thead>
              <tr>
                <th>رقم البيع</th>
                <th>التاريخ</th>
                <th>العميل</th>
                <th>طريقة البيع</th>
                <th>المندوب</th>
                <th>السعر</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data.sales.map((s: any) => (
                <tr key={s.id} className="clickable" onClick={() => nav(`/sales/${s.id}`)}>
                  <td>{s.sale_no}</td>
                  <td>{fmtDate(s.sale_date)}</td>
                  <td>{s.customer_name}</td>
                  <td>{label('sale_type', s.sale_type)}</td>
                  <td>{s.salesperson}</td>
                  <td className="num">{fmtMoney(s.selling_price)}</td>
                  <td>
                    <Badge group="sale_status" value={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="card-b muted">لا توجد مبيعات</div>
        )}
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <h3>الحجوزات</h3>
          </div>
          {data.reservations.length ? (
            <table className="dt">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>العميل</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th>العربون</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.reservations.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.reservation_no}</td>
                    <td>{r.customer_name}</td>
                    <td>{fmtDate(r.reservation_date)}</td>
                    <td>{fmtDate(r.expiry_date)}</td>
                    <td className="num">{fmtMoney(r.amount)}</td>
                    <td>
                      <Badge group="reservation_status" value={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="card-b muted">لا توجد حجوزات</div>
          )}
        </div>
        <div className="card">
          <div className="card-h">
            <h3>عروض الأسعار</h3>
          </div>
          {data.quotations.length ? (
            <table className="dt">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>العميل</th>
                  <th>التاريخ</th>
                  <th>السعر</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.quotations.map((q: any) => (
                  <tr key={q.id}>
                    <td>{q.quote_no}</td>
                    <td>{q.customer_name}</td>
                    <td>{fmtDate(q.quote_date)}</td>
                    <td className="num">{fmtMoney(q.final_price)}</td>
                    <td>
                      <Badge group="quotation_status" value={q.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="card-b muted">لا توجد عروض أسعار</div>
          )}
        </div>
      </div>
    </div>
  );
}

export { fmtDateTime };
