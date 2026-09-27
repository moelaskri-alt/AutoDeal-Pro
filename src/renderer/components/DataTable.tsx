import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { call, useApi } from '../lib/api';
import { useUi } from '../lib/ui';
import { Icon } from './Icon';
import { EmptyState, Spinner, ErrorAlert } from './common';

export interface Col<T = any> {
  key: string;
  label: string;
  render?: (r: T) => ReactNode;
  sort?: string;
  num?: boolean;
  wrap?: boolean;
  total?: (totals: Record<string, number>) => ReactNode;
  /** Export: how to write this column to CSV/Excel. Defaults to the raw value. */
  exportType?: 'money' | 'int' | 'date' | 'status' | 'text' | 'pct';
  exportValue?: (r: T) => any;
  noExport?: boolean;
  /** Column only included in CSV/Excel exports, not shown on screen. */
  exportOnly?: boolean;
  hidden?: boolean;
}

export type FilterDef =
  | { key: string; label: string; options: [string | number, string][]; type?: 'select' }
  | { key: string; label: string; type: 'brand' }
  | { key: string; label: string; type: 'salesperson' }
  | { key: string; label: string; type: 'checkbox' }
  | { key: 'dates'; label: string; type: 'dates' };

interface Props<T> {
  method: string;
  columns: Col<T>[];
  filters?: FilterDef[];
  baseFilters?: Record<string, any>;
  initialFilters?: Record<string, any>;
  searchPlaceholder?: string;
  onRowClick?: (r: T) => void;
  empty?: { title: string; text?: string; action?: ReactNode; icon?: string };
  exportTitle?: string;
  toolbar?: ReactNode;
  rowClass?: (r: T) => string;
  defaultSort?: { sort: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  noSearch?: boolean;
}

export function DataTable<T = any>(p: Props<T>) {
  const { toast } = useUi();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState<Record<string, any>>(p.initialFilters ?? {});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(p.pageSize ?? 25);
  const [sort, setSort] = useState<{ sort?: string; dir?: 'asc' | 'desc' }>(p.defaultSort ?? {});
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, JSON.stringify(filters), JSON.stringify(p.baseFilters)]);

  const params = useMemo(
    () => ({ page, pageSize, search: debounced, sort: sort.sort, dir: sort.dir, filters: { ...filters, ...(p.baseFilters ?? {}) } }),
    [page, pageSize, debounced, sort, filters, p.baseFilters],
  );
  const { data, loading, error } = useApi<{ rows: T[]; total: number; totals?: Record<string, number> }>(p.method, params);
  const needsBrands = p.filters?.some((f) => f.type === 'brand');
  const needsSp = p.filters?.some((f) => f.type === 'salesperson');
  const brands = useApi<string[]>(needsBrands ? 'vehicles.brands' : null);
  const salespeople = useApi<{ id: number; full_name: string }[]>(needsSp ? 'sales.salespeople' : null);

  const cols = p.columns.filter((c) => !c.hidden && !c.exportOnly);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const hasFilter = !!debounced || Object.values(filters).some((v) => v !== '' && v !== undefined && v !== false);

  const setF = (k: string, v: any) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleSort = (c: Col<T>) => {
    if (!c.sort) return;
    setSort((s) => (s.sort === c.sort ? { sort: c.sort, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { sort: c.sort, dir: 'desc' }));
  };

  const doExport = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const all = await call<{ rows: T[]; totals?: Record<string, number> }>(p.method, { ...params, page: 1, pageSize: 0 });
      const ex = p.columns.filter((c) => !c.hidden && !c.noExport);
      const rows = all.rows.map((r: any) => Object.fromEntries(ex.map((c) => [c.key, c.exportValue ? c.exportValue(r) : r[c.key]])));
      const res = await call('export.table', {
        title: p.exportTitle ?? 'تصدير',
        format,
        columns: ex.map((c) => ({ key: c.key, label: c.label, type: c.exportValue ? 'text' : c.exportType ?? 'text' })),
        rows,
      });
      if (res?.file) toast(`تم التصدير: ${res.file}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card">
      <div className="toolbar">
        {!p.noSearch && (
          <div style={{ position: 'relative', flex: 1, maxWidth: 360, minWidth: 220 }}>
            <input className="input search" style={{ width: '100%', paddingInlineStart: 34 }} placeholder={p.searchPlaceholder ?? 'بحث...'} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث" />
            <span style={{ position: 'absolute', insetInlineStart: 10, top: 10, color: '#9ca3af' }}>
              <Icon name="search" size={16} />
            </span>
          </div>
        )}
        {p.filters?.map((f) => {
          if (f.type === 'dates')
            return (
              <div key="dates" className="row" style={{ gap: 6 }}>
                <span className="muted small">{f.label}</span>
                <input className="input ltr" type="date" aria-label="من تاريخ" value={filters.from ?? ''} onChange={(e) => setF('from', e.target.value)} style={{ minWidth: 140 }} />
                <span className="muted small">إلى</span>
                <input className="input ltr" type="date" aria-label="إلى تاريخ" value={filters.to ?? ''} onChange={(e) => setF('to', e.target.value)} style={{ minWidth: 140 }} />
              </div>
            );
          if (f.type === 'checkbox')
            return (
              <label key={f.key} className="checkbox small">
                <input type="checkbox" checked={!!filters[f.key]} onChange={(e) => setF(f.key, e.target.checked)} /> {f.label}
              </label>
            );
          const options: [string | number, string][] =
            f.type === 'brand' ? (brands.data ?? []).map((b) => [b, b]) : f.type === 'salesperson' ? (salespeople.data ?? []).map((u) => [u.id, u.full_name]) : (f as any).options;
          return (
            <select key={f.key} className="input" aria-label={f.label} value={filters[f.key] ?? ''} onChange={(e) => setF(f.key, e.target.value)}>
              <option value="">{f.label}: الكل</option>
              {options.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          );
        })}
        {hasFilter && (
          <button
            className="btn ghost sm"
            onClick={() => {
              setSearch('');
              setFilters(p.initialFilters ?? {});
            }}
          >
            مسح الفلاتر
          </button>
        )}
        <div className="spacer" />
        {p.toolbar}
        {p.exportTitle && (
          <>
            <button className="btn sm" disabled={exporting || !data?.total} onClick={() => doExport('xlsx')} title="تصدير Excel">
              <Icon name="download" /> Excel
            </button>
            <button className="btn sm" disabled={exporting || !data?.total} onClick={() => doExport('csv')} title="تصدير CSV">
              <Icon name="download" /> CSV
            </button>
          </>
        )}
      </div>
      <ErrorAlert error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data && data.rows.length === 0 ? (
        hasFilter ? (
          <EmptyState icon="search" title="لا توجد نتائج مطابقة" text="جرّب تغيير كلمات البحث أو الفلاتر." />
        ) : (
          <EmptyState icon={p.empty?.icon ?? 'file'} title={p.empty?.title ?? 'لا توجد بيانات بعد'} text={p.empty?.text} action={p.empty?.action} />
        )
      ) : data ? (
        <>
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="dt">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} className={c.sort ? 'sortable' : ''} onClick={() => toggleSort(c)}>
                      {c.label}
                      {sort.sort === c.sort && c.sort ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any, i) => (
                  <tr key={r.id ?? i} className={`${p.onRowClick ? 'clickable' : ''} ${p.rowClass?.(r) ?? ''}`} onClick={() => p.onRowClick?.(r)}>
                    {cols.map((c) => (
                      <td key={c.key} className={`${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : 'nowrap'}`}>
                        {c.render ? c.render(r) : r[c.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {data.totals && cols.some((c) => c.total) && (
                <tfoot>
                  <tr>
                    {cols.map((c, i) => (
                      <td key={c.key} className={c.num ? 'num' : ''}>
                        {c.total ? c.total(data.totals!) : i === 0 ? 'الإجمالي' : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="pager">
            <span className="muted small">
              إجمالي السجلات: <b className="num">{data.total.toLocaleString('en-US')}</b>
            </span>
            <div className="spacer" />
            <select className="input" style={{ width: 'auto' }} aria-label="عدد الصفوف" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} صف
                </option>
              ))}
            </select>
            <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              السابق
            </button>
            <span className="small">
              صفحة <b className="num">{page}</b> من <b className="num">{totalPages}</b>
            </span>
            <button className="btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              التالي
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
