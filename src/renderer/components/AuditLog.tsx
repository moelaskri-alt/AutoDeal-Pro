import { useMemo, useState } from 'react';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { DataTable, type Col, type FilterDef } from './DataTable';
import { Badge, Modal, optionsOf } from './common';
import { Icon } from './Icon';
import { fmtDate, fmtDateTime, label } from '../../core/format';
import { describeAudit, prettyRaw, recordTypeLabel, type AuditRow, type AuditView, type TableView } from '../lib/auditFormat';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts where the async clipboard API is unavailable.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function CopyBtn({ text }: { text: string }) {
  const { toast } = useUi();
  return (
    <button
      type="button"
      className="btn ghost sm audit-copy"
      title="نسخ"
      onClick={async () => {
        const ok = await copyText(text);
        toast(ok ? 'تم النسخ' : 'تعذر النسخ', ok ? 'success' : 'error');
      }}
    >
      نسخ
    </button>
  );
}

function MiniTable({ t }: { t: TableView }) {
  return (
    <div className="audit-block">
      <div className="audit-block-title">{t.title}</div>
      <div className="table-wrap audit-mini">
        <table className="dt compact">
          <thead>
            <tr>
              {t.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {r.map((x, j) => (
                  <td key={j}>{x}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Compact responsive label/value grid used by every section of the details modal. */
function KV({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <div className="audit-kv">
      {items.map(([k, v], i) => (
        <div key={i} className="audit-kv-item">
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="audit-sec">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

export function AuditDetailsModal({ row, view, onClose }: { row: AuditRow; view: AuditView; onClose: () => void }) {
  const raw: [string, string | null][] = [
    ['old_value', prettyRaw(row.old_value)],
    ['new_value', prettyRaw(row.new_value)],
    ['details', prettyRaw(row.details)],
  ];
  const changed = view.compare?.filter((r) => r.changed) ?? [];
  const unchanged = view.compare?.filter((r) => !r.changed) ?? [];
  return (
    <Modal
      size="lg"
      className="audit-modal"
      title="تفاصيل سجل المراجعة"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          إغلاق
        </button>
      }
    >
      <Section title="معلومات أساسية">
        <KV
          items={[
            ['التاريخ والوقت', <span className="num">{fmtDateTime(row.created_at)}</span>],
            ['المستخدم', row.username ?? '—'],
            ['الوحدة', view.moduleLabel],
            ['العملية', <Badge value={row.action} tone={view.tone} text={view.actionLabel} />],
            ['السجل', <span className="audit-wrap">{view.record}</span>],
            ...(view.recordType ? ([['نوع السجل', view.recordType]] as [string, string][]) : []),
          ]}
        />
      </Section>

      <Section title="ملخص العملية">
        <div className="audit-summary-box">
          <div className="audit-summary-main">{view.summary}</div>
          {view.sub && <div className="muted audit-wrap">{view.sub}</div>}
        </div>
        {view.facts.length > 0 && <KV items={view.facts.map((f) => [f.label, <span className="audit-wrap">{f.value}</span>])} />}
        {view.notes.map((n) => (
          <div key={n.key} className="audit-note">
            <div className="muted small">{n.label}</div>
            <div className="audit-note-row">
              <span className={n.mono ? 'audit-mono' : 'audit-wrap'}>{n.value}</span>
              {n.mono && <CopyBtn text={n.value} />}
            </div>
          </div>
        ))}
      </Section>

      {view.groups.map((g, i) => (
        <Section key={i} title={g.title}>
          {g.fields.length > 0 && <KV items={g.fields.map((f) => [f.label, <span className={f.mono ? 'audit-mono' : 'audit-wrap'}>{f.value}</span>])} />}
          {g.tables.map((t, j) => (
            <MiniTable key={j} t={t} />
          ))}
        </Section>
      ))}

      {view.schedules.length > 0 && (
        <Section title="الجدول قبل وبعد">
          <div className="audit-compare-grid">
            {view.schedules.map((t, j) => (
              <MiniTable key={j} t={t} />
            ))}
          </div>
        </Section>
      )}

      {view.permissions && (
        <Section title="الصلاحيات قبل / بعد">
          <div className="audit-compare-grid">
            <div className="audit-perm added">
              <div className="audit-block-title">صلاحيات أضيفت ({view.permissions.added.length})</div>
              {view.permissions.added.length ? (
                <ul>
                  {view.permissions.added.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <div className="muted">لا يوجد</div>
              )}
            </div>
            <div className="audit-perm removed">
              <div className="audit-block-title">صلاحيات أزيلت ({view.permissions.removed.length})</div>
              {view.permissions.removed.length ? (
                <ul>
                  {view.permissions.removed.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <div className="muted">لا يوجد</div>
              )}
            </div>
          </div>
        </Section>
      )}

      {view.compare && (
        <Section title={view.compareTitle}>
          {view.compare.length === 0 ? (
            <div className="muted">لم تتغير أي قيمة.</div>
          ) : (
            <div className="table-wrap audit-mini">
              <table className="dt compact audit-compare">
                <thead>
                  <tr>
                    <th>الحقل</th>
                    <th>القيمة قبل التعديل</th>
                    <th>القيمة بعد التعديل</th>
                  </tr>
                </thead>
                <tbody>
                  {[...changed, ...unchanged].map((r) => (
                    <tr key={r.key} className={r.changed ? 'changed' : ''}>
                      <td className="bold">{r.label}</td>
                      <td>
                        <span className={r.changed ? 'audit-before' : ''}>{r.before}</span>
                      </td>
                      <td>
                        <span className={r.changed ? 'audit-after' : ''}>{r.after}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <details className="audit-tech">
        <summary>
          <Icon name="file" size={15} /> البيانات التقنية
          <span className="muted small"> — البيانات الأصلية كما سُجلت (للمراجعة الفنية)</span>
        </summary>
        <div className="audit-tech-body">
          <KV
            items={[
              ['رقم القيد', <span className="num">{row.id}</span>],
              ['الوقت كما خُزن', <span className="audit-mono">{row.created_at}</span>],
              ['كود العملية', <span className="audit-mono">{row.action}</span>],
              ['كود الوحدة', <span className="audit-mono">{row.module}</span>],
              ['نوع السجل', <span className="audit-mono">{row.record_type ?? '—'}</span>],
              ['معرف السجل', <span className="audit-mono">{row.record_id ?? '—'}</span>],
              ['وصف السجل', <span className="audit-mono">{row.record_label ?? '—'}</span>],
              ['معرف المستخدم', <span className="audit-mono">{row.user_id ?? '—'}</span>],
            ]}
          />
          {raw.map(([k, text]) => (
            <div key={k} className="audit-raw">
              <div className="audit-raw-h">
                <span className="audit-mono">{k}</span>
                {text ? <CopyBtn text={text} /> : <span className="muted small">غير متوفر</span>}
              </div>
              {text && <pre>{text}</pre>}
            </div>
          ))}
        </div>
      </details>
    </Modal>
  );
}

export function AuditTrail({ filters }: { filters?: Record<string, any> }) {
  const { can } = useAuth();
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const settings = useApi<Record<string, string>>('settings.get', undefined, { live: false });
  const users = useApi<{ id: number; username: string; full_name: string }[]>(!filters && can('users.manage') ? 'users.list' : null);
  const currency = settings.data?.currency || 'ج.م';
  const cache = useMemo(() => new Map<number, AuditView>(), [currency]);
  const view = (r: AuditRow) => {
    let v = cache.get(r.id);
    if (!v) cache.set(r.id, (v = describeAudit(r, currency)));
    return v;
  };

  const cols: Col<AuditRow>[] = [
    {
      key: 'created_at',
      label: 'التاريخ والوقت',
      sort: 'created_at',
      className: 'c-date',
      render: (r) => (
        <div className="num">
          <div>{fmtDate(r.created_at)}</div>
          <div className="muted small">{r.created_at.slice(11, 16)}</div>
        </div>
      ),
      exportValue: (r) => fmtDateTime(r.created_at),
    },
    { key: 'username', label: 'المستخدم', className: 'c-user', render: (r) => <span className="audit-clip">{r.username ?? '—'}</span> },
    { key: 'module', label: 'الوحدة', className: 'c-module', render: (r) => label('module', r.module), exportValue: (r) => label('module', r.module) },
    {
      key: 'action',
      label: 'العملية',
      className: 'c-action',
      render: (r) => <Badge value={r.action} tone={view(r).tone} text={view(r).actionLabel} />,
      exportValue: (r) => label('audit_action', r.action),
    },
    {
      key: 'record_label',
      label: 'السجل',
      className: 'c-record',
      render: (r) => (
        <div>
          <div className="clamp-2 audit-wrap">{view(r).record}</div>
          {view(r).recordType && view(r).record === r.record_label && <div className="muted small">{view(r).recordType}</div>}
        </div>
      ),
      exportValue: (r) => view(r).record,
    },
    {
      key: 'old_value',
      label: 'القيمة القديمة',
      className: 'c-val',
      render: (r) => <div className="clamp-2 audit-wrap small muted">{view(r).oldCell}</div>,
      exportValue: (r) => view(r).oldCell,
    },
    {
      key: 'new_value',
      label: 'القيمة الجديدة',
      className: 'c-val',
      render: (r) => <div className="clamp-2 audit-wrap small">{view(r).newCell}</div>,
      exportValue: (r) => view(r).newCell,
    },
    {
      key: 'details',
      label: 'التفاصيل',
      className: 'c-details',
      render: (r) => (
        <div className="audit-cell">
          <div className="audit-summary clamp-2">{view(r).summary}</div>
          {view(r).sub && <div className="muted small clamp-1">{view(r).sub}</div>}
          <button
            type="button"
            className="link-btn small"
            onClick={(e) => {
              e.stopPropagation();
              setDetail(r);
            }}
          >
            عرض التفاصيل
          </button>
        </div>
      ),
      exportValue: (r) => [view(r).summary, view(r).sub].filter(Boolean).join(' — '),
    },
    // Full technical values are still exported, as separate columns, for external auditing.
    { key: 'record_type', label: 'نوع السجل', exportOnly: true, exportValue: (r) => recordTypeLabel(r.record_type) ?? '' },
    { key: 'raw_old', label: 'القيمة القديمة (أصلية)', exportOnly: true, exportValue: (r) => r.old_value ?? '' },
    { key: 'raw_new', label: 'القيمة الجديدة (أصلية)', exportOnly: true, exportValue: (r) => r.new_value ?? '' },
    { key: 'raw_details', label: 'التفاصيل (أصلية)', exportOnly: true, exportValue: (r) => r.details ?? '' },
  ];

  const tbFilters: FilterDef[] = filters
    ? []
    : [
        ...(users.data?.length ? [{ key: 'user_id', label: 'المستخدم', options: users.data.map((u) => [u.id, u.username] as [number, string]) }] : []),
        { key: 'module', label: 'الوحدة', options: optionsOf('module') },
        { key: 'action', label: 'العملية', options: optionsOf('audit_action') },
        { key: 'dates', label: 'الفترة', type: 'dates' },
      ];

  return (
    <>
      <DataTable
        className="audit-table"
        method="audit.list"
        columns={cols}
        baseFilters={filters}
        exportTitle="سجل المراجعة"
        searchPlaceholder="بحث بالسجل أو المستخدم أو التفاصيل..."
        filters={tbFilters}
        onRowClick={setDetail}
        empty={{ icon: 'shield', title: 'لا توجد عمليات مسجلة' }}
      />
      {detail && <AuditDetailsModal row={detail} view={view(detail)} onClose={() => setDetail(null)} />}
    </>
  );
}
