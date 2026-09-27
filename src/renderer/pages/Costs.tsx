import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, usePrint, today } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import { DateInput, ErrorAlert, Field, Modal, Money, MoneyInput, PageHeader, Select, Spinner, TextArea, TextInput, optionsOf, SummaryLine } from '../components/common';
import { VehiclePicker, type VehicleLite } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { fmtDate, fmtMoney, fmtPct, label } from '../../core/format';

const MANUAL = ['transport', 'customs', 'registration', 'maintenance', 'parts', 'bodywork', 'paint', 'tires', 'detailing', 'insurance', 'accessories', 'other'];

export function CostFormModal({ initial, vehicle, onClose }: { initial?: any; vehicle?: VehicleLite | null; onClose: () => void }) {
  const editing = !!initial?.id;
  const [f, setF] = useState<any>(initial ?? { expense_date: today(), category: 'maintenance', payment_method: 'cash' });
  const [veh, setVeh] = useState<VehicleLite | null>(vehicle ?? null);
  const suppliers = useApi<any>('suppliers.list', { pageSize: 500 });
  const { run, busy } = useAction();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    const payload = { ...f, vehicle_id: veh?.id ?? f.vehicle_id };
    if (await run(() => call(editing ? 'costs.update' : 'costs.create', payload), editing ? 'تم تعديل التكلفة' : 'تم تسجيل التكلفة وتحديث تكلفة السيارة')) onClose();
  };
  return (
    <Modal
      size="md"
      title={editing ? `تعديل بند التكلفة ${initial.expense_no}` : 'تسجيل تكلفة مباشرة على سيارة'}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" disabled={busy} onClick={save}>حفظ</button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      <div className="form-grid">
        {!editing && (
          <Field label="السيارة" required full>
            <VehiclePicker value={veh} onChange={setVeh} disabled={!!vehicle} filters={{}} />
          </Field>
        )}
        <Field label="نوع التكلفة" required>
          <Select name="category" value={f.category} onChange={(v) => set('category', v)} options={optionsOf('cost_category', MANUAL)} />
        </Field>
        <Field label="المبلغ" required>
          <MoneyInput name="amount" value={f.amount} onChange={(v) => set('amount', v)} />
        </Field>
        <Field label="التاريخ" required>
          <DateInput value={f.expense_date} onChange={(v) => set('expense_date', v)} />
        </Field>
        <Field label="طريقة الدفع">
          <Select value={f.payment_method} onChange={(v) => set('payment_method', v)} options={optionsOf('pay_method')} />
        </Field>
        <Field label="المورد / الورشة">
          <Select value={f.supplier_id ?? ''} onChange={(v) => set('supplier_id', v ? Number(v) : null)} placeholder="—" options={(suppliers.data?.rows ?? []).map((s: any) => [s.id, s.name])} />
        </Field>
        <Field label="الوصف">
          <TextInput name="description" value={f.description} onChange={(v) => set('description', v)} />
        </Field>
        <Field label="ملاحظات" full>
          <TextArea value={f.notes} onChange={(v) => set('notes', v)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

export function CostsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [form, setForm] = useState<any | null>(null);
  const cols: Col[] = [
    { key: 'expense_date', label: 'التاريخ', sort: 'expense_date', render: (r) => fmtDate(r.expense_date), exportType: 'date' },
    { key: 'expense_no', label: 'رقم البند' },
    { key: 'vehicle', label: 'السيارة', sort: 'stock_no', render: (r) => <a onClick={(e) => { e.stopPropagation(); nav(`/vehicles/${r.vehicle_id}`); }} style={{ cursor: 'pointer' }}>{r.stock_no} — {r.brand} {r.model} {r.model_year}</a>, exportValue: (r) => `${r.stock_no} ${r.brand} ${r.model} ${r.model_year}` },
    { key: 'category', label: 'نوع التكلفة', sort: 'category', render: (r) => label('cost_category', r.category), exportValue: (r) => label('cost_category', r.category) },
    { key: 'description', label: 'الوصف', wrap: true },
    { key: 'supplier_name', label: 'المورد' },
    { key: 'payment_method', label: 'الدفع', render: (r) => label('pay_method', r.payment_method), exportValue: (r) => label('pay_method', r.payment_method) },
    { key: 'amount', label: 'المبلغ', num: true, sort: 'amount', render: (r) => fmtMoney(r.amount), exportType: 'money', total: (t) => fmtMoney(t.amount) },
  ];
  return (
    <div>
      <PageHeader
        title="تكاليف السيارات"
        sub="كل التكاليف المباشرة المرتبطة بالسيارات (تدخل في التكلفة الفعلية لكل سيارة) — منفصلة عن المصروفات العامة"
        actions={can('costs.manage') && <button className="btn primary" onClick={() => setForm({})}><Icon name="plus" /> تسجيل تكلفة</button>}
      />
      <DataTable
        method="costs.list"
        columns={cols}
        exportTitle="تكاليف السيارات"
        searchPlaceholder="بحث برقم السيارة أو الوصف أو المورد..."
        initialFilters={{ exclude_acquisition: true }}
        filters={[
          { key: 'category', label: 'النوع', options: optionsOf('cost_category') },
          { key: 'brand', label: 'الماركة', type: 'brand' },
          { key: 'exclude_acquisition', label: 'إخفاء سعر الشراء/الاستبدال', type: 'checkbox' },
          { key: 'dates', label: 'الفترة', type: 'dates' },
        ]}
        onRowClick={(r) => r.source_type === 'manual' && can('costs.manage') && setForm(r)}
        empty={{ icon: 'wrench', title: 'لا توجد تكاليف مسجلة', text: 'سجل تكاليف الصيانة والسمكرة والدهان والإطارات وغيرها لكل سيارة.' }}
      />
      {form && <CostFormModal initial={form.id ? form : undefined} onClose={() => setForm(null)} />}
    </div>
  );
}

/** Vehicle Cost Card (used inside the vehicle page). */
export function CostCardView({ vehicleId }: { vehicleId: number }) {
  const { data, error, loading } = useApi<any>('costs.card', { vehicle_id: vehicleId });
  const { confirm } = useUi();
  const { run } = useAction();
  const print = usePrint();
  const [form, setForm] = useState<any | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;
  const t = data.totals;
  const v = data.vehicle;
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
      <div className="card">
        <div className="card-h">
          <h3>بنود التكلفة</h3>
          <div className="spacer" />
          <button className="btn sm" onClick={() => print('costcard', vehicleId)}><Icon name="printer" /> طباعة</button>
          <button className="btn sm" onClick={() => print('costcard', vehicleId, 'pdf')}><Icon name="download" /> PDF</button>
          {data.canManage && <button className="btn sm primary" onClick={() => setForm({})}><Icon name="plus" /> إضافة تكلفة</button>}
        </div>
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>التاريخ</th><th>البند</th><th>الوصف</th><th>المورد</th><th>المبلغ</th><th></th></tr></thead>
            <tbody>
              {data.lines.map((l: any) => (
                <tr key={l.id}>
                  <td className="nowrap">{fmtDate(l.expense_date)}</td>
                  <td className="nowrap"><b>{label('cost_category', l.category)}</b></td>
                  <td className="wrap">{l.description}</td>
                  <td>{l.supplier_name ?? '—'}</td>
                  <td className="num bold">{fmtMoney(l.amount)}</td>
                  <td className="actions">
                    {data.canManage && l.source_type === 'manual' && !['purchase', 'trade_in'].includes(l.category) && (
                      <>
                        <button className="btn sm ghost" onClick={() => setForm(l)} title="تعديل"><Icon name="edit" /></button>
                        <button className="btn sm ghost" title="حذف" onClick={async () => (await confirm({ title: 'حذف بند التكلفة', message: `حذف ${label('cost_category', l.category)} بمبلغ ${fmtMoney(l.amount)}؟ ستنخفض التكلفة الفعلية للسيارة.`, danger: true, confirmText: 'حذف' })) && run(() => call('costs.delete', { id: l.id }), 'تم حذف البند')}>
                          <Icon name="trash" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>التكلفة الفعلية</td><td className="num">{fmtMoney(t.actual_cost)}</td><td /></tr></tfoot>
          </table>
        </div>
      </div>
      <div className="stack">
        <div className="card card-b">
          <h3 style={{ marginBottom: 8 }}>ملخص التكلفة</h3>
          <div className="summary-box">
            <SummaryLine label="تكلفة الاقتناء (شراء/استبدال)" value={fmtMoney(t.acquisition_cost)} />
            <SummaryLine label="+ التكاليف المباشرة" value={fmtMoney(t.direct_costs)} />
            <SummaryLine label="= التكلفة الفعلية" value={fmtMoney(t.actual_cost)} total />
          </div>
        </div>
        <div className="card card-b">
          <h3 style={{ marginBottom: 8 }}>{t.selling_price !== null ? 'الربحية الفعلية' : 'الربحية المتوقعة'}</h3>
          <div className="summary-box">
            {t.selling_price !== null ? (
              <>
                <SummaryLine label="سعر البيع" value={fmtMoney(t.selling_price)} />
                <SummaryLine label="− التكلفة الفعلية" value={fmtMoney(t.actual_cost)} />
                <SummaryLine label="= مجمل الربح" value={<span className={t.gross_profit >= 0 ? 'pos' : 'neg'}>{fmtMoney(t.gross_profit)}</span>} total />
                <SummaryLine label="هامش الربح" value={fmtPct(t.gross_margin)} />
              </>
            ) : (
              <>
                <SummaryLine label="السعر المطلوب" value={fmtMoney(t.asking_price)} />
                <SummaryLine label="الحد الأدنى" value={fmtMoney(t.min_price)} />
                <SummaryLine label="الربح المتوقع" value={t.expected_profit !== null ? <span className={t.expected_profit >= 0 ? 'pos' : 'neg'}>{fmtMoney(t.expected_profit)}</span> : '—'} total />
                <SummaryLine label="الهامش المتوقع" value={fmtPct(t.expected_margin)} />
              </>
            )}
          </div>
        </div>
        <div className="card card-b">
          <h3 style={{ marginBottom: 8 }}>التوزيع حسب البند</h3>
          {data.byCategory.map((c: any) => (
            <SummaryLine key={c.category} label={label('cost_category', c.category)} value={<Money v={c.amount} />} />
          ))}
        </div>
      </div>
      {form && <CostFormModal initial={form.id ? form : undefined} vehicle={{ ...v, id: vehicleId }} onClose={() => setForm(null)} />}
    </div>
  );
}
