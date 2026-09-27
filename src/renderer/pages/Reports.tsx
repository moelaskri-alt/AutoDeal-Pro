import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { call, useApi } from '../lib/api';
import { useUi } from '../lib/ui';
import { DateInput, EmptyState, ErrorAlert, PageHeader, Select, Spinner, optionsOf } from '../components/common';
import { CustomerPicker } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { anyLabel, fmtDate, fmtMoney, fmtNum, fmtPct } from '../../core/format';

const cellFmt = (type: string | undefined, v: any) => {
  if (v === null || v === undefined || v === '') return '—';
  switch (type) {
    case 'money':
      return fmtMoney(v);
    case 'int':
      return fmtNum(v);
    case 'pct':
      return fmtPct(v);
    case 'date':
      return fmtDate(v);
    case 'status':
      return anyLabel(v);
    default:
      return String(v);
  }
};

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const { data: list, loading } = useApi<any[]>('reports.list', undefined, { live: false });
  const current = params.get('id');
  if (loading && !list) return <Spinner />;
  const groups = [...new Set((list ?? []).map((r) => r.group))];
  const def = list?.find((r) => r.id === current);
  return (
    <div className="stack">
      <PageHeader
        title="التقارير"
        sub="تقارير حقيقية من قاعدة البيانات قابلة للطباعة والتصدير (PDF / Excel / CSV)"
        actions={
          def && (
            <>
              <select className="input" style={{ width: 300 }} aria-label="اختيار التقرير" value={current ?? ''} onChange={(e) => setParams({ id: e.target.value })}>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {(list ?? []).filter((r) => r.group === g).map((r) => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button className="btn" onClick={() => setParams({})}>كل التقارير</button>
            </>
          )
        }
      />
      {def ? (
        <ReportView key={def.id} def={def} />
      ) : (
        groups.map((g) => (
          <div key={g}>
            <div className="section-title">{g}</div>
            <div className="report-cards">
              {(list ?? []).filter((r) => r.group === g).map((r) => (
                <button key={r.id} className="report-card" onClick={() => setParams({ id: r.id })}>
                  <b>{r.title}</b>
                  <span>{r.description}</span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {!def && !(list ?? []).length && <div className="card"><EmptyState icon="chart" title="لا توجد تقارير متاحة لصلاحياتك" /></div>}
    </div>
  );
}

const WRAP_KEYS = ['vehicle', 'customer', 'supplier', 'description'];

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function ReportView({ def }: { def: any }) {
  const { toast } = useUi();
  const hasDate = def.filters.includes('date');
  const [filters, setFilters] = useState<any>(hasDate && def.group !== 'الأقساط والتحصيل' ? { from: `${new Date().getFullYear()}-01-01` } : {});
  const [customer, setCustomer] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const brands = useApi<string[]>(def.filters.includes('brand') ? 'vehicles.brands' : null);
  const sp = useApi<any[]>(def.filters.includes('salesperson') ? 'sales.salespeople' : null);
  const suppliers = useApi<any>(def.filters.includes('supplier') ? 'suppliers.list' : null, { pageSize: 500 });
  useEffect(() => setFilters((f: any) => ({ ...f, customer_id: customer?.id })), [customer?.id]);
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null));
  const { data, error, loading } = useApi<any>('reports.run', { id: def.id, filters: clean });
  const set = (k: string, v: any) => setFilters((f: any) => ({ ...f, [k]: v }));

  const out = async (method: string, extra: any) => {
    setBusy(true);
    try {
      const r = await call(method, { id: def.id, filters: clean, ...extra });
      if (r?.file) toast(`تم الحفظ: ${r.file}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-h">
        <div>
          <h3>{def.title}</h3>
          <div className="muted small">{def.description}</div>
        </div>
        <div className="spacer" />
        <button className="btn sm" disabled={busy} onClick={() => out('print.report', { mode: 'preview' })}><Icon name="printer" /> طباعة</button>
        <button className="btn sm" disabled={busy} onClick={() => out('print.report', { mode: 'pdf' })}><Icon name="download" /> PDF</button>
        <button className="btn sm" disabled={busy || !data?.rows.length} onClick={() => out('export.report', { format: 'xlsx' })}><Icon name="download" /> Excel</button>
        <button className="btn sm" disabled={busy || !data?.rows.length} onClick={() => out('export.report', { format: 'csv' })}><Icon name="download" /> CSV</button>
      </div>
      <div className="toolbar">
        {hasDate && (
          <>
            <span className="muted small">من</span>
            <DateInput value={filters.from} onChange={(v) => set('from', v)} />
            <span className="muted small">إلى</span>
            <DateInput value={filters.to} onChange={(v) => set('to', v)} />
            <button className="btn sm ghost" onClick={() => setFilters((f: any) => ({ ...f, from: monthStart(), to: undefined }))}>هذا الشهر</button>
            <button className="btn sm ghost" onClick={() => setFilters((f: any) => ({ ...f, from: undefined, to: undefined }))}>كل الفترات</button>
          </>
        )}
        {def.filters.includes('brand') && <div style={{ minWidth: 150 }}><Select value={filters.brand} onChange={(v) => set('brand', v)} placeholder="كل الماركات" options={(brands.data ?? []).map((b) => [b, b])} /></div>}
        {def.filters.includes('condition') && <div style={{ minWidth: 140 }}><Select value={filters.condition} onChange={(v) => set('condition', v)} placeholder="جديدة ومستعملة" options={optionsOf('condition')} /></div>}
        {def.filters.includes('vstatus') && <div style={{ minWidth: 150 }}><Select value={filters.vstatus} onChange={(v) => set('vstatus', v)} placeholder="كل الحالات" options={optionsOf('vehicle_status', ['available', 'reserved', 'preparation', 'maintenance', 'returned'])} /></div>}
        {def.filters.includes('sale_type') && <div style={{ minWidth: 150 }}><Select value={filters.sale_type} onChange={(v) => set('sale_type', v)} placeholder="كل طرق البيع" options={optionsOf('sale_type')} /></div>}
        {def.filters.includes('salesperson') && <div style={{ minWidth: 150 }}><Select value={filters.salesperson_id} onChange={(v) => set('salesperson_id', v)} placeholder="كل المندوبين" options={(sp.data ?? []).map((u) => [u.id, u.full_name])} /></div>}
        {def.filters.includes('supplier') && <div style={{ minWidth: 160 }}><Select value={filters.supplier_id} onChange={(v) => set('supplier_id', v)} placeholder="كل الموردين" options={(suppliers.data?.rows ?? []).map((s: any) => [s.id, s.name])} /></div>}
        {def.filters.includes('category') && <div style={{ minWidth: 150 }}><Select value={filters.category} onChange={(v) => set('category', v)} placeholder="كل البنود" options={optionsOf('cost_category').filter(([k]) => !['purchase', 'trade_in'].includes(k))} /></div>}
        {def.filters.includes('customer') && <div style={{ minWidth: 300 }}><CustomerPicker value={customer} onChange={setCustomer} /></div>}
      </div>
      <ErrorAlert error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data && data.rows.length === 0 ? (
        <EmptyState icon="chart" title="لا توجد بيانات لهذه الفلاتر" text="غيّر الفترة أو الفلاتر لعرض النتائج." />
      ) : data ? (
        <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
          <table className="dt compact">
            <thead>
              <tr>{data.columns.map((c: any) => <th key={c.key}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((r: any, i: number) => (
                <tr key={i}>
                  {data.columns.map((c: any) => (
                    <td key={c.key} className={['money', 'int', 'pct'].includes(c.type) ? 'num' : WRAP_KEYS.includes(c.key) ? 'wrap' : 'nowrap'}>
                      <span className={c.type === 'money' && typeof r[c.key] === 'number' && r[c.key] < 0 ? 'neg' : ''}>{cellFmt(c.type, r[c.key])}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {data.columns.some((c: any) => c.total) && (
              <tfoot>
                <tr>
                  {data.columns.map((c: any, i: number) => (
                    <td key={c.key} className="num">{i === 0 ? 'الإجمالي' : c.total || c.key === 'margin' ? cellFmt(c.type, data.totals[c.key]) : ''}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
          <div className="pager"><span className="muted small">عدد السجلات: {data.rows.length}</span></div>
        </div>
      ) : null}
    </div>
  );
}
