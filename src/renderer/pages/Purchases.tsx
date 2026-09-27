import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, usePrint, today } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import {
  Badge,
  DateInput,
  DL,
  Field,
  Modal,
  MoneyInput,
  PageHeader,
  Select,
  Spinner,
  Tabs,
  TextArea,
  TextInput,
  optionsOf,
  SummaryLine,
} from '../components/common';
import { Icon } from '../components/Icon';
import { VehicleFields } from './Vehicles';
import { fmtDate, fmtMoney, label } from '../../core/format';

const MANUAL = ['transport', 'customs', 'registration', 'maintenance', 'parts', 'bodywork', 'paint', 'tires', 'detailing', 'insurance', 'accessories', 'other'];

export function PurchasesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('purchases');
  const [form, setForm] = useState(!!params.get('new'));
  const [detail, setDetail] = useState<number | null>(null);
  const [supplier, setSupplier] = useState<any | null>(null);
  const cols: Col[] = [
    { key: 'purchase_date', label: 'التاريخ', sort: 'purchase_date', render: (r) => fmtDate(r.purchase_date), exportType: 'date' },
    { key: 'purchase_no', label: 'رقم الشراء', sort: 'purchase_no' },
    { key: 'supplier_name', label: 'المورد / البائع', sort: 'supplier_name' },
    {
      key: 'supplier_type',
      label: 'النوع',
      render: (r) => label('supplier_type', r.supplier_type),
      exportValue: (r) => label('supplier_type', r.supplier_type),
    },
    {
      key: 'vehicle',
      label: 'السيارة',
      render: (r) => `${r.stock_no} — ${r.brand} ${r.model} ${r.model_year}`,
      exportValue: (r) => `${r.stock_no} ${r.brand} ${r.model} ${r.model_year}`,
    },
    { key: 'invoice_no', label: 'رقم الفاتورة' },
    {
      key: 'purchase_price',
      label: 'سعر الشراء',
      num: true,
      sort: 'purchase_price',
      render: (r) => fmtMoney(r.purchase_price),
      exportType: 'money',
      total: (t) => fmtMoney(t.purchase_price),
    },
    { key: 'paid_amount', label: 'المدفوع', num: true, render: (r) => fmtMoney(r.paid_amount), exportType: 'money', total: (t) => fmtMoney(t.paid_amount) },
    {
      key: 'balance',
      label: 'المتبقي للمورد',
      num: true,
      render: (r) => <span className={r.balance > 0 ? 'neg bold' : ''}>{fmtMoney(r.balance)}</span>,
      exportType: 'money',
      total: (t) => fmtMoney(t.purchase_price - t.paid_amount),
    },
  ];
  return (
    <div>
      <PageHeader
        title="المشتريات"
        sub="شراء السيارات من الموردين والوكلاء والتجار والأفراد — يتم إنشاء السيارة وبطاقة التكلفة تلقائياً"
        actions={
          can('purchases.manage') && (
            <>
              <button className="btn" onClick={() => setSupplier({})}>
                <Icon name="plus" /> مورد جديد
              </button>
              <button className="btn primary" onClick={() => setForm(true)}>
                <Icon name="plus" /> تسجيل شراء سيارة
              </button>
            </>
          )
        }
      />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'purchases', label: 'عمليات الشراء' },
          { key: 'suppliers', label: 'الموردون والبائعون' },
        ]}
      />
      {tab === 'purchases' ? (
        <DataTable
          method="purchases.list"
          columns={cols}
          exportTitle="المشتريات"
          searchPlaceholder="بحث برقم الشراء أو المورد أو السيارة أو الفاتورة..."
          filters={[
            { key: 'supplier_type', label: 'نوع المورد', options: optionsOf('supplier_type') },
            { key: 'brand', label: 'الماركة', type: 'brand' },
            { key: 'unpaid', label: 'عليها رصيد للمورد', type: 'checkbox' },
            { key: 'dates', label: 'الفترة', type: 'dates' },
          ]}
          onRowClick={(r) => setDetail(r.id)}
          empty={{
            icon: 'cart',
            title: 'لا توجد عمليات شراء',
            text: 'سجل أول عملية شراء لإضافة سيارة للمخزون.',
            action: can('purchases.manage') ? (
              <button className="btn primary" onClick={() => setForm(true)}>
                تسجيل شراء سيارة
              </button>
            ) : undefined,
          }}
        />
      ) : (
        <DataTable
          method="suppliers.list"
          columns={[
            { key: 'name', label: 'الاسم', sort: 'name' },
            {
              key: 'supplier_type',
              label: 'النوع',
              render: (r) => label('supplier_type', r.supplier_type),
              exportValue: (r) => label('supplier_type', r.supplier_type),
            },
            { key: 'phone', label: 'الهاتف', render: (r) => <span className="num">{r.phone ?? '—'}</span> },
            { key: 'address', label: 'العنوان', wrap: true },
            { key: 'purchases_count', label: 'عدد المشتريات', num: true, exportType: 'int' },
            {
              key: 'purchases_total',
              label: 'إجمالي المشتريات',
              num: true,
              sort: 'purchases_total',
              render: (r) => fmtMoney(r.purchases_total),
              exportType: 'money',
            },
            {
              key: 'balance',
              label: 'الرصيد المستحق',
              num: true,
              render: (r) => fmtMoney(r.purchases_total - r.paid_total),
              exportValue: (r) => (r.purchases_total - r.paid_total) / 100,
            },
          ]}
          exportTitle="الموردون"
          filters={[{ key: 'supplier_type', label: 'النوع', options: optionsOf('supplier_type') }]}
          onRowClick={(r) => can('purchases.manage') && setSupplier(r)}
          empty={{ icon: 'users', title: 'لا يوجد موردون', text: 'يتم إضافة المورد تلقائياً عند تسجيل أول عملية شراء.' }}
        />
      )}
      {form && (
        <PurchaseFormModal
          onClose={() => {
            setForm(false);
            if (params.get('new')) setParams({});
          }}
        />
      )}
      {detail && <PurchaseDetailModal id={detail} onClose={() => setDetail(null)} />}
      {supplier && <SupplierModal initial={supplier} onClose={() => setSupplier(null)} />}
    </div>
  );
}

function SupplierModal({ initial, onClose }: { initial: any; onClose: () => void }) {
  const [s, setS] = useState<any>({ supplier_type: 'company', ...initial });
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal
      size="md"
      title={s.id ? 'تعديل بيانات المورد' : 'مورد جديد'}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => (await run(() => call(s.id ? 'suppliers.update' : 'suppliers.create', s), 'تم الحفظ')) && onClose()}
          >
            حفظ
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
          {s.id && (
            <button
              className="btn ghost"
              style={{ marginInlineStart: 'auto' }}
              onClick={async () =>
                (await confirm({ title: 'حذف المورد', message: `حذف ${s.name}؟`, danger: true, confirmText: 'حذف' })) &&
                (await run(() => call('suppliers.delete', { id: s.id }), 'تم الحذف')) &&
                onClose()
              }
            >
              <Icon name="trash" /> حذف
            </button>
          )}
        </>
      }
    >
      <div className="form-grid">
        <Field label="الاسم" required>
          <TextInput value={s.name} onChange={(v) => set('name', v)} />
        </Field>
        <Field label="النوع">
          <Select value={s.supplier_type} onChange={(v) => set('supplier_type', v)} options={optionsOf('supplier_type')} />
        </Field>
        <Field label="الهاتف">
          <TextInput value={s.phone} onChange={(v) => set('phone', v)} ltr />
        </Field>
        <Field label="الرقم القومي / السجل التجاري">
          <TextInput value={s.national_id} onChange={(v) => set('national_id', v)} ltr />
        </Field>
        <Field label="العنوان" full>
          <TextInput value={s.address} onChange={(v) => set('address', v)} />
        </Field>
        <Field label="ملاحظات" full>
          <TextArea value={s.notes} onChange={(v) => set('notes', v)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function PurchaseFormModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const suppliers = useApi<any>('suppliers.list', { pageSize: 1000 });
  const { run, busy } = useAction();
  const [p, setP] = useState<any>({ purchase_date: today(), status: 'preparation', pay_method: 'cash', supplier_mode: 'existing' });
  const [veh, setVeh] = useState<any>({ condition: 'used', mileage: 0, model_year: new Date().getFullYear() });
  const [sup, setSup] = useState<any>({ supplier_type: 'individual' });
  const [costs, setCosts] = useState<{ category: string; amount: number | null; description?: string }[]>([]);
  const set = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  const setV = (k: string, v: any) => setVeh((x: any) => ({ ...x, [k]: v }));
  const extra = costs.reduce((a, c) => a + (c.amount ?? 0), 0);
  const total = (p.purchase_price ?? 0) + extra;

  const save = async () => {
    const payload = {
      ...p,
      supplier_id: p.supplier_mode === 'existing' ? p.supplier_id : undefined,
      supplier: p.supplier_mode === 'new' ? sup : undefined,
      vehicle: veh,
      costs: costs.filter((c) => c.amount),
    };
    const r: any = await run(() => call('purchases.create', payload), 'تم تسجيل الشراء وإضافة السيارة للمخزون');
    if (r) {
      onClose();
      nav(`/vehicles/${r.vehicle_id}`);
    }
  };

  return (
    <Modal
      size="xl"
      title="تسجيل شراء سيارة"
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" disabled={busy} onClick={save}>
            حفظ عملية الشراء
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <div className="form-grid cols-3">
        <div className="form-section">بيانات الشراء</div>
        <Field label="المورد / البائع" required>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <Select
              value={p.supplier_mode}
              onChange={(v) => set('supplier_mode', v)}
              options={[
                ['existing', 'مورد مسجل'],
                ['new', 'مورد جديد'],
              ]}
            />
          </div>
        </Field>
        {p.supplier_mode === 'existing' ? (
          <Field label="اختر المورد" required>
            <Select
              name="supplier_id"
              value={p.supplier_id ?? ''}
              onChange={(v) => set('supplier_id', v ? Number(v) : null)}
              placeholder="اختر..."
              options={(suppliers.data?.rows ?? []).map((s: any) => [s.id, `${s.name} (${label('supplier_type', s.supplier_type)})`])}
            />
          </Field>
        ) : (
          <>
            <Field label="اسم المورد" required>
              <TextInput name="supplier_name" value={sup.name} onChange={(v) => setSup({ ...sup, name: v })} />
            </Field>
            <Field label="نوع المورد">
              <Select value={sup.supplier_type} onChange={(v) => setSup({ ...sup, supplier_type: v })} options={optionsOf('supplier_type')} />
            </Field>
            <Field label="هاتف المورد">
              <TextInput value={sup.phone} onChange={(v) => setSup({ ...sup, phone: v })} ltr />
            </Field>
          </>
        )}
        <Field label="تاريخ الشراء" required>
          <DateInput name="purchase_date" value={p.purchase_date} onChange={(v) => set('purchase_date', v)} />
        </Field>
        <Field label="رقم فاتورة الشراء">
          <TextInput value={p.invoice_no} onChange={(v) => set('invoice_no', v)} />
        </Field>
        <Field label="سعر الشراء" required>
          <MoneyInput name="purchase_price" value={p.purchase_price} onChange={(v) => set('purchase_price', v)} />
        </Field>
        <Field label="حالة السيارة بعد الشراء">
          <Select
            value={p.status}
            onChange={(v) => set('status', v)}
            options={[
              ['preparation', 'تحت التجهيز'],
              ['available', 'متاحة للبيع'],
            ]}
          />
        </Field>

        <div className="form-section">بيانات السيارة</div>
        <VehicleFields v={veh} set={setV} />
        {can('vehicles.pricing') && (
          <>
            <Field label="السعر المطلوب للبيع">
              <MoneyInput name="asking_price" value={veh.asking_price} onChange={(v) => setV('asking_price', v)} />
            </Field>
            <Field label="الحد الأدنى لسعر البيع">
              <MoneyInput name="min_price" value={veh.min_price} onChange={(v) => setV('min_price', v)} />
            </Field>
          </>
        )}

        <div className="form-section">تكاليف اقتناء إضافية (نقل، جمارك، ترخيص ...)</div>
        <div className="full stack" style={{ gap: 8 }}>
          {costs.map((c, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <Select
                value={c.category}
                onChange={(v) => setCosts(costs.map((x, j) => (j === i ? { ...x, category: v } : x)))}
                options={optionsOf('cost_category', MANUAL)}
              />
              <MoneyInput value={c.amount} onChange={(v) => setCosts(costs.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              <TextInput value={c.description} placeholder="الوصف" onChange={(v) => setCosts(costs.map((x, j) => (j === i ? { ...x, description: v } : x)))} />
              <button className="btn ghost sm" onClick={() => setCosts(costs.filter((_, j) => j !== i))} aria-label="حذف">
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div>
            <button className="btn sm" onClick={() => setCosts([...costs, { category: 'transport', amount: null }])}>
              <Icon name="plus" /> إضافة تكلفة
            </button>
          </div>
        </div>

        <div className="form-section">الدفع للبائع</div>
        <Field label="المبلغ المدفوع الآن" hint="اتركه فارغاً إذا كان الشراء آجلاً">
          <MoneyInput name="paid_amount" value={p.paid_amount} onChange={(v) => set('paid_amount', v)} />
        </Field>
        <Field label="طريقة الدفع">
          <Select
            value={p.pay_method}
            onChange={(v) => set('pay_method', v)}
            options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other'])}
          />
        </Field>
        <Field label="مرجع الدفع">
          <TextInput value={p.pay_reference} onChange={(v) => set('pay_reference', v)} />
        </Field>
        <Field label="ملاحظات" full>
          <TextArea value={p.notes} onChange={(v) => set('notes', v)} rows={2} />
        </Field>
        <div className="full summary-box">
          <SummaryLine label="سعر الشراء" value={fmtMoney(p.purchase_price ?? 0)} />
          <SummaryLine label="+ تكاليف إضافية" value={fmtMoney(extra)} />
          <SummaryLine label="= التكلفة الفعلية المبدئية" value={fmtMoney(total)} total />
          {veh.asking_price ? (
            <SummaryLine
              label="الربح المتوقع بالسعر المطلوب"
              value={<span className={veh.asking_price - total >= 0 ? 'pos' : 'neg'}>{fmtMoney(veh.asking_price - total)}</span>}
            />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function PurchaseDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const print = usePrint();
  const { data, loading } = useApi<any>('purchases.get', { id });
  const { run, busy } = useAction();
  const [pay, setPay] = useState<any>({ pay_date: today(), method: 'cash' });
  const [price, setPrice] = useState<{ purchase_price: number | null; reason: string } | null>(null);
  return (
    <Modal
      size="lg"
      title={data ? `عملية الشراء ${data.purchase_no}` : 'عملية الشراء'}
      onClose={onClose}
      footer={
        data && (
          <>
            <button className="btn" onClick={() => print('purchase', id)}>
              <Icon name="printer" /> طباعة
            </button>
            <button className="btn" onClick={() => nav(`/vehicles/${data.vehicle_id}`)}>
              فتح السيارة
            </button>
          </>
        )
      }
    >
      {loading || !data ? (
        <Spinner />
      ) : (
        <div className="stack">
          <div className="grid-2">
            <DL
              items={[
                ['المورد', data.supplier_name],
                ['النوع', label('supplier_type', data.supplier_type)],
                ['الهاتف', data.supplier_phone],
                ['تاريخ الشراء', fmtDate(data.purchase_date)],
                ['رقم الفاتورة', data.invoice_no],
              ]}
            />
            <DL
              items={[
                ['السيارة', `${data.brand} ${data.model} ${data.model_year}`],
                ['رقم المخزون', data.stock_no],
                ['حالة السيارة', <Badge group="vehicle_status" value={data.vehicle_status} />],
                ['سعر الشراء', <b className="num">{fmtMoney(data.purchase_price)}</b>],
                ['المدفوع', <span className="num">{fmtMoney(data.paid_amount)}</span>],
                ['المتبقي للمورد', <b className={`num ${data.balance > 0 ? 'neg' : 'pos'}`}>{fmtMoney(data.balance)}</b>],
              ]}
            />
          </div>
          <div className="card">
            <div className="card-h">
              <h3>مدفوعات المورد</h3>
            </div>
            {data.payments.length ? (
              <table className="dt">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الطريقة</th>
                    <th>المرجع</th>
                    <th>المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((x: any) => (
                    <tr key={x.id}>
                      <td>{fmtDate(x.pay_date)}</td>
                      <td>{label('pay_method', x.method)}</td>
                      <td>{x.reference ?? '—'}</td>
                      <td className="num">{fmtMoney(x.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="card-b muted">لم يتم دفع أي مبلغ للمورد بعد.</div>
            )}
          </div>
          {can('purchases.manage') && data.balance > 0 && (
            <div className="card card-b">
              <h3 style={{ marginBottom: 8 }}>تسجيل دفعة للمورد</h3>
              <div className="form-grid cols-3">
                <Field label="المبلغ">
                  <MoneyInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} />
                </Field>
                <Field label="التاريخ">
                  <DateInput value={pay.pay_date} onChange={(v) => setPay({ ...pay, pay_date: v })} />
                </Field>
                <Field label="الطريقة">
                  <Select
                    value={pay.method}
                    onChange={(v) => setPay({ ...pay, method: v })}
                    options={optionsOf('pay_method', ['cash', 'bank_transfer', 'cheque', 'card', 'other'])}
                  />
                </Field>
                <Field label="المرجع">
                  <TextInput value={pay.reference} onChange={(v) => setPay({ ...pay, reference: v })} />
                </Field>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () =>
                    (await run(() => call('purchases.addPayment', { ...pay, purchase_id: id }), 'تم تسجيل الدفعة')) &&
                    setPay({ pay_date: today(), method: 'cash' })
                  }
                >
                  تسجيل الدفعة
                </button>
                <button className="btn sm ghost" onClick={() => setPay({ ...pay, amount: data.balance })}>
                  سداد كامل المتبقي
                </button>
              </div>
            </div>
          )}
          {can('purchases.manage') && (
            <div className="card card-b">
              {!price ? (
                <button className="btn sm" onClick={() => setPrice({ purchase_price: data.purchase_price, reason: '' })}>
                  <Icon name="edit" /> تصحيح سعر الشراء
                </button>
              ) : (
                <div className="form-grid">
                  <Field label="سعر الشراء الصحيح">
                    <MoneyInput value={price.purchase_price} onChange={(v) => setPrice({ ...price, purchase_price: v })} />
                  </Field>
                  <Field label="سبب التعديل" required>
                    <TextInput value={price.reason} onChange={(v) => setPrice({ ...price, reason: v })} />
                  </Field>
                  <div className="row full">
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={async () =>
                        (await run(() => call('purchases.updatePrice', { id, ...price }), 'تم تعديل السعر وتحديث بطاقة التكلفة')) && setPrice(null)
                      }
                    >
                      حفظ التعديل
                    </button>
                    <button className="btn" onClick={() => setPrice(null)}>
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
