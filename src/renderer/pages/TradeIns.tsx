import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { call } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, today } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import { Badge, DateInput, Field, Modal, MoneyInput, NumberInput, PageHeader, Select, TextArea, TextInput, optionsOf, SummaryLine } from '../components/common';
import { Icon } from '../components/Icon';
import { CustomerField } from './Quotations';
import { fmtDate, fmtMoney, fmtPct, label } from '../../core/format';

export function TradeInsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const { run } = useAction();
  const [form, setForm] = useState<any | null>(null);
  const fin = can('costs.view');
  const cols: Col[] = [
    { key: 'trade_no', label: 'الرقم' },
    { key: 'eval_date', label: 'تاريخ التقييم', sort: 'eval_date', render: (r) => fmtDate(r.eval_date), exportType: 'date' },
    { key: 'customer_name', label: 'العميل', sort: 'customer_name' },
    { key: 'vehicle', label: 'السيارة', render: (r) => `${r.brand} ${r.model} ${r.model_year}`, exportValue: (r) => `${r.brand} ${r.model} ${r.model_year}` },
    { key: 'market_value', label: 'القيمة السوقية', num: true, render: (r) => fmtMoney(r.market_value), exportType: 'money' },
    {
      key: 'trade_in_value',
      label: 'قيمة الاستبدال',
      num: true,
      sort: 'trade_in_value',
      render: (r) => <b>{fmtMoney(r.trade_in_value)}</b>,
      exportType: 'money',
      total: (t) => fmtMoney(t.trade_in_value),
    },
    { key: 'expected_total_cost', label: 'التكلفة المتوقعة', num: true, render: (r) => fmtMoney(r.expected_total_cost), exportType: 'money' },
    { key: 'expected_selling_price', label: 'سعر البيع المتوقع', num: true, render: (r) => fmtMoney(r.expected_selling_price), exportType: 'money' },
    {
      key: 'expected_profit',
      label: 'الربح المتوقع',
      num: true,
      sort: 'expected_profit',
      render: (r) => <span className={r.expected_profit >= 0 ? 'pos' : 'neg'}>{fmtMoney(r.expected_profit)}</span>,
      exportType: 'money',
    },
    {
      key: 'actual_profit',
      label: 'الربح الفعلي',
      num: true,
      hidden: !fin,
      render: (r) => (r.actual_profit != null ? <span className={r.actual_profit >= 0 ? 'pos' : 'neg'}>{fmtMoney(r.actual_profit)}</span> : '—'),
      exportType: 'money',
    },
    { key: 'status', label: 'الحالة', render: (r) => <Badge group="trade_status" value={r.status} />, exportValue: (r) => label('trade_status', r.status) },
    {
      key: 'act',
      label: '',
      noExport: true,
      render: (r) => (
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          {r.status === 'evaluated' && can('sales.create') && (
            <button className="btn sm success" onClick={() => nav(`/sales/new?customer=${r.customer_id}`)}>
              استخدام في بيع
            </button>
          )}
          {r.status === 'evaluated' && can('tradeins.manage') && (
            <button className="btn sm" onClick={() => setForm(r)}>
              <Icon name="edit" />
            </button>
          )}
          {r.status === 'evaluated' && can('tradeins.manage') && (
            <button
              className="btn sm ghost"
              onClick={async () => {
                const reason = await confirm({
                  title: 'رفض الاستبدال',
                  message: `رفض تقييم ${r.trade_no}؟`,
                  reason: { label: 'السبب' },
                  danger: true,
                  confirmText: 'رفض',
                });
                if (reason) run(() => call('tradeins.reject', { id: r.id, reason: reason === 'yes' ? '' : reason }), 'تم الرفض');
              }}
            >
              رفض
            </button>
          )}
          {r.vehicle_id && (
            <button className="btn sm" onClick={() => nav(`/vehicles/${r.vehicle_id}`)}>
              السيارة {r.stock_no}
            </button>
          )}
        </div>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="الاستبدال (Trade-In)"
        sub="تقييم سيارات العملاء وحساب الربح المتوقع — عند استخدامها في بيع تُضاف للمخزون تلقائياً بتكلفة = قيمة الاستبدال"
        actions={
          can('tradeins.manage') && (
            <button className="btn primary" onClick={() => setForm({})}>
              <Icon name="plus" /> تقييم سيارة
            </button>
          )
        }
      />
      <DataTable
        method="tradeins.list"
        columns={cols}
        exportTitle="الاستبدال"
        filters={[
          { key: 'status', label: 'الحالة', options: optionsOf('trade_status') },
          { key: 'customer_id', label: 'العميل', type: 'customer' },
          { key: 'dates', label: 'الفترة', type: 'dates' },
        ]}
        empty={{ icon: 'swap', title: 'لا توجد عمليات استبدال', text: 'قيّم سيارة العميل ثم استخدمها كجزء من ثمن سيارة جديدة.' }}
      />
      {form && <TradeInFormModal initial={form} onClose={() => setForm(null)} />}
    </div>
  );
}

function TradeInFormModal({ initial, onClose }: { initial: any; onClose: () => void }) {
  const [t, setT] = useState<any>({ eval_date: today(), condition_grade: 'good', mileage: 0, ...initial });
  const [customer, setCustomer] = useState<any>(initial.customer_id ? { id: initial.customer_id, name: initial.customer_name, code: '' } : null);
  const { run, busy } = useAction();
  const set = (k: string, v: any) => setT((x: any) => ({ ...x, [k]: v }));
  const cost = (t.trade_in_value ?? 0) + (t.expected_prep_cost ?? 0);
  const profit = (t.expected_selling_price ?? 0) - cost;
  return (
    <Modal
      size="lg"
      title={t.id ? `تعديل تقييم ${t.trade_no}` : 'تقييم سيارة استبدال'}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () =>
              (await run(() => call(t.id ? 'tradeins.update' : 'tradeins.create', { ...t, customer_id: customer?.id }), 'تم حفظ التقييم')) && onClose()
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
      <div className="form-grid cols-3">
        <Field label="العميل" required full>
          <CustomerField value={customer} onChange={setCustomer} disabled={!!t.id} />
        </Field>
        <Field label="الماركة" required>
          <TextInput value={t.brand} onChange={(v) => set('brand', v)} />
        </Field>
        <Field label="الموديل" required>
          <TextInput value={t.model} onChange={(v) => set('model', v)} />
        </Field>
        <Field label="الفئة">
          <TextInput value={t.trim} onChange={(v) => set('trim', v)} />
        </Field>
        <Field label="السنة" required>
          <NumberInput value={t.model_year} onChange={(v) => set('model_year', v)} />
        </Field>
        <Field label="اللون">
          <TextInput value={t.color} onChange={(v) => set('color', v)} />
        </Field>
        <Field label="الكيلومترات">
          <NumberInput value={t.mileage} onChange={(v) => set('mileage', v)} />
        </Field>
        <Field label="رقم الشاسيه">
          <TextInput value={t.vin} onChange={(v) => set('vin', v.toUpperCase())} ltr />
        </Field>
        <Field label="رقم المحرك">
          <TextInput value={t.engine_no} onChange={(v) => set('engine_no', v.toUpperCase())} ltr />
        </Field>
        <Field label="رقم اللوحة">
          <TextInput value={t.plate_no} onChange={(v) => set('plate_no', v)} />
        </Field>
        <Field label="الحالة العامة">
          <Select value={t.condition_grade} onChange={(v) => set('condition_grade', v)} options={optionsOf('condition_grade')} />
        </Field>
        <Field label="تاريخ التقييم">
          <DateInput value={t.eval_date} onChange={(v) => set('eval_date', v)} />
        </Field>
        <Field label="ملاحظات الفحص" full>
          <TextArea value={t.condition_notes} onChange={(v) => set('condition_notes', v)} rows={2} />
        </Field>
        <div className="form-section">التقييم المالي</div>
        <Field label="القيمة السوقية التقديرية">
          <MoneyInput value={t.market_value} onChange={(v) => set('market_value', v)} />
        </Field>
        <Field label="قيمة الاستبدال (للعميل)" required>
          <MoneyInput name="trade_in_value" value={t.trade_in_value} onChange={(v) => set('trade_in_value', v)} />
        </Field>
        <Field label="تكلفة التجهيز المتوقعة">
          <MoneyInput value={t.expected_prep_cost} onChange={(v) => set('expected_prep_cost', v)} />
        </Field>
        <Field label="سعر البيع المتوقع">
          <MoneyInput value={t.expected_selling_price} onChange={(v) => set('expected_selling_price', v)} />
        </Field>
        <div className="full summary-box">
          <SummaryLine label="تكلفة الاقتناء المتوقعة (قيمة الاستبدال)" value={fmtMoney(t.trade_in_value ?? 0)} />
          <SummaryLine label="+ تكلفة التجهيز المتوقعة" value={fmtMoney(t.expected_prep_cost ?? 0)} />
          <SummaryLine label="= التكلفة الإجمالية المتوقعة" value={fmtMoney(cost)} total />
          <SummaryLine
            label="سعر البيع المتوقع − التكلفة = الربح المتوقع"
            value={
              <span className={profit >= 0 ? 'pos' : 'neg'}>
                {fmtMoney(profit)} ({fmtPct(t.expected_selling_price ? (profit / t.expected_selling_price) * 100 : 0)})
              </span>
            }
            total
          />
        </div>
      </div>
    </Modal>
  );
}
