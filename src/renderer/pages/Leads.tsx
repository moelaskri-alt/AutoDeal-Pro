import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, today } from '../lib/actions';
import { useUi } from '../lib/ui';
import { DataTable, type Col } from '../components/DataTable';
import { Badge, DateInput, DL, Field, Modal, MoneyInput, PageHeader, Select, Spinner, TextArea, TextInput, optionsOf } from '../components/common';
import { VehiclePicker } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateTime, fmtMoney, label } from '../../core/format';

export function LeadsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [form, setForm] = useState<any | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const cols: Col[] = [
    { key: 'created_at', label: 'التاريخ', sort: 'created_at', render: (r) => fmtDate(r.created_at), exportType: 'date' },
    { key: 'name', label: 'الاسم', sort: 'name', render: (r) => <b>{r.name}</b> },
    { key: 'phone', label: 'الهاتف', render: (r) => <span className="num">{r.phone ?? '—'}</span> },
    { key: 'source', label: 'المصدر', render: (r) => label('lead_source', r.source), exportValue: (r) => label('lead_source', r.source) },
    { key: 'interest', label: 'الاهتمام', wrap: true, render: (r) => r.interest ?? (r.brand ? `${r.brand} ${r.model}` : '—') },
    {
      key: 'vehicle',
      label: 'السيارة',
      render: (r) => (r.stock_no ? `${r.brand} ${r.model} (${r.stock_no})` : '—'),
      exportValue: (r) => (r.stock_no ? `${r.brand} ${r.model}` : ''),
    },
    { key: 'assigned_name', label: 'المسؤول' },
    {
      key: 'next_follow_up',
      label: 'المتابعة القادمة',
      sort: 'next_follow_up',
      render: (r) =>
        r.next_follow_up ? (
          <span className={r.next_follow_up <= today() && !['won', 'lost'].includes(r.status) ? 'neg bold' : ''}>{fmtDate(r.next_follow_up)}</span>
        ) : (
          '—'
        ),
      exportType: 'date',
    },
    {
      key: 'status',
      label: 'الحالة',
      sort: 'status',
      render: (r) => <Badge group="lead_status" value={r.status} />,
      exportValue: (r) => label('lead_status', r.status),
    },
  ];
  return (
    <div>
      <PageHeader
        title="العملاء المحتملون (CRM)"
        sub="متابعة الاستفسارات حتى إتمام البيع"
        actions={
          can('leads.manage') && (
            <button className="btn primary" onClick={() => setForm({})}>
              <Icon name="plus" /> عميل محتمل جديد
            </button>
          )
        }
      />
      <DataTable
        method="leads.list"
        columns={cols}
        exportTitle="العملاء المحتملون"
        initialFilters={params.get('due') ? { due_follow_up: true } : {}}
        filters={[
          { key: 'status', label: 'الحالة', options: optionsOf('lead_status') },
          { key: 'source', label: 'المصدر', options: optionsOf('lead_source') },
          { key: 'assigned_to', label: 'المسؤول', type: 'salesperson' },
          { key: 'due_follow_up', label: 'متابعات مستحقة', type: 'checkbox' },
          { key: 'dates', label: 'الفترة', type: 'dates' },
        ]}
        onRowClick={(r) => setDetail(r.id)}
        empty={{
          icon: 'target',
          title: 'لا يوجد عملاء محتملون',
          text: 'سجّل كل استفسار من الزوار أو السوشيال ميديا لمتابعته.',
          action: can('leads.manage') ? (
            <button className="btn primary" onClick={() => setForm({})}>
              إضافة
            </button>
          ) : undefined,
        }}
      />
      {form && <LeadFormModal initial={form} onClose={() => setForm(null)} />}
      {detail && (
        <LeadDetailModal
          id={detail}
          onClose={() => setDetail(null)}
          onEdit={(l) => {
            setDetail(null);
            setForm(l);
          }}
        />
      )}
    </div>
  );
}

function LeadFormModal({ initial, onClose }: { initial: any; onClose: () => void }) {
  const [l, setL] = useState<any>({ source: 'walk_in', status: 'new', ...initial });
  const [veh, setVeh] = useState<any>(
    initial.vehicle_id
      ? {
          id: initial.vehicle_id,
          brand: initial.brand,
          model: initial.model,
          model_year: initial.model_year,
          stock_no: initial.stock_no,
          status: '',
          asking_price: 0,
          condition: '',
        }
      : null,
  );
  const sp = useApi<any[]>('sales.salespeople');
  const { run, busy } = useAction();
  const set = (k: string, v: any) => setL((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal
      size="md"
      title={l.id ? 'تعديل عميل محتمل' : 'عميل محتمل جديد'}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () =>
              (await run(() => call(l.id ? 'leads.update' : 'leads.create', { ...l, vehicle_id: veh?.id ?? null }), 'تم الحفظ')) && onClose()
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
      <div className="form-grid">
        <Field label="الاسم" required>
          <TextInput name="name" value={l.name} onChange={(v) => set('name', v)} autoFocus />
        </Field>
        <Field label="الهاتف">
          <TextInput name="phone" value={l.phone} onChange={(v) => set('phone', v)} ltr />
        </Field>
        <Field label="المصدر">
          <Select value={l.source} onChange={(v) => set('source', v)} options={optionsOf('lead_source')} />
        </Field>
        <Field label="الحالة">
          <Select value={l.status} onChange={(v) => set('status', v)} options={optionsOf('lead_status')} />
        </Field>
        <Field label="السيارة المهتم بها" full>
          <VehiclePicker value={veh} onChange={setVeh} filters={{ status: 'in_stock' }} />
        </Field>
        <Field label="الاهتمام / المواصفات المطلوبة" full>
          <TextInput value={l.interest} onChange={(v) => set('interest', v)} />
        </Field>
        <Field label="الميزانية">
          <MoneyInput value={l.budget} onChange={(v) => set('budget', v)} />
        </Field>
        <Field label="المسؤول">
          <Select
            value={l.assigned_to ?? ''}
            onChange={(v) => set('assigned_to', v ? Number(v) : null)}
            placeholder="—"
            options={(sp.data ?? []).map((u) => [u.id, u.full_name])}
          />
        </Field>
        <Field label="موعد المتابعة القادم">
          <DateInput value={l.next_follow_up} onChange={(v) => set('next_follow_up', v)} />
        </Field>
        {l.status === 'lost' && (
          <Field label="سبب الخسارة" required>
            <TextInput value={l.lost_reason} onChange={(v) => set('lost_reason', v)} />
          </Field>
        )}
        <Field label="ملاحظات" full>
          <TextArea value={l.notes} onChange={(v) => set('notes', v)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function LeadDetailModal({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (l: any) => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const { data } = useApi<any>('leads.get', { id });
  const { run, busy } = useAction();
  const [fu, setFu] = useState<any>({ follow_date: today(), method: 'call' });
  if (!data)
    return (
      <Modal title="عميل محتمل" onClose={onClose}>
        <Spinner />
      </Modal>
    );
  const l = data.lead;
  const convert = async () => {
    const r: any = await run(() => call('leads.convert', { id }), 'تم إنشاء ملف العميل');
    if (r) nav(`/customers/${r.customer_id}`);
  };
  return (
    <Modal
      size="lg"
      title={`${l.name} — ${label('lead_status', l.status)}`}
      onClose={onClose}
      footer={
        can('leads.manage') && (
          <>
            <button className="btn" onClick={() => onEdit(l)}>
              <Icon name="edit" /> تعديل
            </button>
            {l.customer_id ? (
              <button className="btn" onClick={() => nav(`/customers/${l.customer_id}`)}>
                ملف العميل
              </button>
            ) : (
              can('customers.manage') && (
                <button className="btn primary" disabled={busy} onClick={convert}>
                  تحويل إلى عميل
                </button>
              )
            )}
            <button
              className="btn ghost"
              style={{ marginInlineStart: 'auto' }}
              onClick={async () =>
                (await confirm({ title: 'حذف', message: 'حذف هذا العميل المحتمل؟', danger: true, confirmText: 'حذف' })) &&
                (await run(() => call('leads.delete', { id }), 'تم الحذف')) &&
                onClose()
              }
            >
              <Icon name="trash" />
            </button>
          </>
        )
      }
    >
      <div className="stack">
        <div className="grid-2">
          <DL
            items={[
              ['الهاتف', <span className="num">{l.phone ?? '—'}</span>],
              ['المصدر', label('lead_source', l.source)],
              ['الحالة', <Badge group="lead_status" value={l.status} />],
              ['المسؤول', l.assigned_name],
            ]}
          />
          <DL
            items={[
              ['السيارة', l.stock_no ? `${l.brand} ${l.model} ${l.model_year} (${l.stock_no})` : '—'],
              ['الاهتمام', l.interest],
              ['الميزانية', l.budget ? fmtMoney(l.budget) : '—'],
              ['المتابعة القادمة', fmtDate(l.next_follow_up)],
            ]}
          />
        </div>
        {can('leads.manage') && !['won', 'lost'].includes(l.status) && (
          <div className="card card-b">
            <h3 style={{ marginBottom: 8 }}>تسجيل متابعة</h3>
            <div className="form-grid cols-3">
              <Field label="التاريخ">
                <DateInput value={fu.follow_date} onChange={(v) => setFu({ ...fu, follow_date: v })} />
              </Field>
              <Field label="الوسيلة">
                <Select value={fu.method} onChange={(v) => setFu({ ...fu, method: v })} options={optionsOf('follow_method')} />
              </Field>
              <Field label="الحالة الجديدة">
                <Select
                  value={fu.status ?? ''}
                  onChange={(v) => setFu({ ...fu, status: v || undefined })}
                  placeholder="بدون تغيير"
                  options={optionsOf('lead_status', ['contacted', 'interested', 'negotiating', 'reserved'])}
                />
              </Field>
              <Field label="النتيجة" required full>
                <TextArea value={fu.notes} onChange={(v) => setFu({ ...fu, notes: v })} rows={2} />
              </Field>
              <Field label="المتابعة القادمة">
                <DateInput value={fu.next_follow_up} onChange={(v) => setFu({ ...fu, next_follow_up: v })} />
              </Field>
            </div>
            <button
              className="btn primary"
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={async () =>
                (await run(() => call('leads.addFollowUp', { ...fu, lead_id: id }), 'تم تسجيل المتابعة')) && setFu({ follow_date: today(), method: 'call' })
              }
            >
              حفظ المتابعة
            </button>
          </div>
        )}
        <div className="card">
          <div className="card-h">
            <h3>سجل المتابعات</h3>
          </div>
          {data.followUps.length === 0 ? (
            <div className="card-b muted">لا توجد متابعات بعد.</div>
          ) : (
            <table className="dt">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الوسيلة</th>
                  <th>النتيجة</th>
                  <th>المتابعة القادمة</th>
                  <th>بواسطة</th>
                </tr>
              </thead>
              <tbody>
                {data.followUps.map((f: any) => (
                  <tr key={f.id}>
                    <td>{fmtDate(f.follow_date)}</td>
                    <td>{label('follow_method', f.method)}</td>
                    <td className="wrap">{f.notes}</td>
                    <td>{fmtDate(f.next_follow_up)}</td>
                    <td>
                      {f.user_name} <div className="muted small">{fmtDateTime(f.created_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
