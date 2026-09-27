import { useEffect, useState } from 'react';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/actions';
import { DataTable, type Col } from '../components/DataTable';
import { Badge, Field, Modal, PageHeader, Select, Spinner, Tabs, TextInput, optionsOf } from '../components/common';
import { Icon } from '../components/Icon';
import { fmtDateTime, label } from '../../core/format';

export function UsersPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState(can('users.manage') ? 'users' : 'audit');
  return (
    <div>
      <PageHeader title="المستخدمون والصلاحيات" sub="إدارة حسابات المستخدمين وأدوارهم، وسجل المراجعة لكل العمليات المهمة" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'users', label: 'المستخدمون', hidden: !can('users.manage') },
        { key: 'roles', label: 'الأدوار والصلاحيات', hidden: !can('users.manage') },
        { key: 'audit', label: 'سجل المراجعة (Audit Log)', hidden: !can('audit.view') },
      ]} />
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'audit' && <AuditTrail />}
    </div>
  );
}

function UsersTab() {
  const { data, loading } = useApi<any[]>('users.list');
  const roles = useApi<any>('roles.list');
  const [form, setForm] = useState<any | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  if (loading && !data) return <Spinner />;
  return (
    <div className="card">
      <div className="toolbar"><div className="spacer" /><button className="btn primary" onClick={() => setForm({ is_active: 1 })}><Icon name="plus" /> مستخدم جديد</button></div>
      <table className="dt">
        <thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>الدور</th><th>الهاتف</th><th>آخر دخول</th><th>الحالة</th><th /></tr></thead>
        <tbody>{(data ?? []).map((u) => (
          <tr key={u.id}>
            <td className="num">{u.username}</td><td><b>{u.full_name}</b></td><td>{u.role_name}</td><td className="num">{u.phone ?? '—'}</td><td>{fmtDateTime(u.last_login_at)}</td>
            <td>{u.is_active ? <Badge value="active" text="مفعل" /> : <Badge value="cancelled" text="موقوف" />}</td>
            <td className="actions"><button className="btn sm" onClick={() => setForm(u)}><Icon name="edit" /> تعديل</button> <button className="btn sm" onClick={() => setReset(u)}>كلمة المرور</button></td>
          </tr>))}</tbody>
      </table>
      {form && <UserModal initial={form} roles={roles.data?.roles ?? []} onClose={() => setForm(null)} />}
      {reset && <ResetModal u={reset} onClose={() => setReset(null)} />}
    </div>
  );
}

function UserModal({ initial, roles, onClose }: { initial: any; roles: any[]; onClose: () => void }) {
  const [u, setU] = useState<any>(initial);
  const { run, busy } = useAction();
  const set = (k: string, v: any) => setU((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal size="md" title={u.id ? `تعديل ${u.username}` : 'مستخدم جديد'} onClose={onClose}
      footer={<><button className="btn primary" disabled={busy} onClick={async () => (await run(() => call(u.id ? 'users.update' : 'users.create', u), 'تم الحفظ')) && onClose()}>حفظ</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="form-grid">
        <Field label="اسم المستخدم (بالإنجليزية)" required><TextInput value={u.username} onChange={(v) => set('username', v)} ltr disabled={!!u.id} /></Field>
        <Field label="الاسم الكامل" required><TextInput value={u.full_name} onChange={(v) => set('full_name', v)} /></Field>
        <Field label="الدور" required><Select value={u.role_id ?? ''} onChange={(v) => set('role_id', Number(v))} placeholder="اختر..." options={roles.map((r) => [r.id, r.name_ar])} /></Field>
        <Field label="الهاتف"><TextInput value={u.phone} onChange={(v) => set('phone', v)} ltr /></Field>
        {!u.id && <Field label="كلمة المرور" required hint="6 أحرف على الأقل"><TextInput type="password" value={u.password} onChange={(v) => set('password', v)} ltr /></Field>}
        {u.id && <Field label="الحالة"><Select value={u.is_active ? '1' : '0'} onChange={(v) => set('is_active', v === '1' ? 1 : 0)} options={[['1', 'مفعل'], ['0', 'موقوف']]} /></Field>}
      </div>
    </Modal>
  );
}

function ResetModal({ u, onClose }: { u: any; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const { run, busy } = useAction();
  return (
    <Modal size="sm" title={`تعيين كلمة مرور جديدة — ${u.username}`} onClose={onClose}
      footer={<><button className="btn primary" disabled={busy || pw.length < 6} onClick={async () => (await run(() => call('users.resetPassword', { id: u.id, password: pw }), 'تم تعيين كلمة المرور')) && onClose()}>حفظ</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <Field label="كلمة المرور الجديدة" hint="سيُطلب من المستخدم تغييرها عند الدخول"><TextInput type="password" value={pw} onChange={setPw} ltr /></Field>
    </Modal>
  );
}

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState<any>({});
  const { run, busy } = useAction();
  const mismatch = f.password && f.confirm && f.password !== f.confirm;
  return (
    <Modal size="sm" title="تغيير كلمة المرور" onClose={onClose}
      footer={<><button className="btn primary" disabled={busy || !f.current || !f.password || mismatch} onClick={async () => (await run(() => call('users.changePassword', f), 'تم تغيير كلمة المرور')) && onClose()}>حفظ</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="stack">
        <Field label="كلمة المرور الحالية"><TextInput type="password" value={f.current} onChange={(v) => setF({ ...f, current: v })} ltr /></Field>
        <Field label="كلمة المرور الجديدة"><TextInput type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} ltr /></Field>
        <Field label="تأكيد كلمة المرور"><TextInput type="password" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} ltr /></Field>
        {mismatch && <div className="alert error">كلمتا المرور غير متطابقتين</div>}
      </div>
    </Modal>
  );
}

function RolesTab() {
  const { data, loading } = useApi<any>('roles.list');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const { run, busy } = useAction();
  const role = data?.roles.find((r: any) => r.id === roleId);
  useEffect(() => {
    if (data && !roleId) setRoleId(data.roles[1]?.id ?? data.roles[0].id);
  }, [data]);
  useEffect(() => {
    if (role) setPerms(new Set(role.permissions));
  }, [role?.id, data]);
  if (loading && !data) return <Spinner />;
  const modules = [...new Set<string>(data.permissions.map((p: any) => p.module))];
  const locked = role?.code === 'admin';
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '240px minmax(0,1fr)', alignItems: 'start' }}>
      <div className="card">
        {data.roles.map((r: any) => (
          <button key={r.id} className="btn ghost" style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, background: r.id === roleId ? 'var(--primary-50)' : undefined }} onClick={() => setRoleId(r.id)}>
            <span>{r.name_ar}</span><span className="badge navy">{r.permissions.length}</span>
          </button>
        ))}
      </div>
      {role && (
        <div className="card">
          <div className="card-h">
            <h3>صلاحيات: {role.name_ar}</h3>
            <div className="spacer" />
            {locked ? <span className="muted small">صلاحيات مدير النظام كاملة وثابتة</span> : <button className="btn primary sm" disabled={busy} onClick={() => run(() => call('roles.setPermissions', { role_id: role.id, permissions: [...perms] }), 'تم حفظ الصلاحيات')}>حفظ الصلاحيات</button>}
          </div>
          <div className="card-b grid-3">
            {modules.map((m) => (
              <div key={m} className="summary-box">
                <div className="bold" style={{ marginBottom: 6, color: 'var(--primary)' }}>{label('module', m) !== m ? label('module', m) : m}</div>
                {data.permissions.filter((p: any) => p.module === m).map((p: any) => (
                  <label key={p.code} className="checkbox small" style={{ display: 'flex', fontWeight: 500, padding: '3px 0' }}>
                    <input type="checkbox" disabled={locked} checked={perms.has(p.code)} onChange={(e) => { const n = new Set(perms); e.target.checked ? n.add(p.code) : n.delete(p.code); setPerms(n); }} />
                    {p.name_ar}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function short(json: string | null) {
  if (!json) return '';
  try {
    const o = JSON.parse(json);
    if (Array.isArray(o)) return `${o.length} عنصر`;
    if (typeof o !== 'object' || o === null) return String(o);
    return Object.entries(o)
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : v}`)
      .join(' • ');
  } catch {
    return json.slice(0, 80);
  }
}

export function AuditTrail({ filters }: { filters?: Record<string, any> }) {
  const [detail, setDetail] = useState<any | null>(null);
  const cols: Col[] = [
    { key: 'created_at', label: 'التاريخ والوقت', render: (r) => <span className="num">{fmtDateTime(r.created_at)}</span>, exportType: 'text' },
    { key: 'username', label: 'المستخدم' },
    { key: 'module', label: 'الوحدة', render: (r) => label('module', r.module), exportValue: (r) => label('module', r.module) },
    { key: 'action', label: 'العملية', render: (r) => <Badge value={['delete', 'cancel', 'void', 'override_min_price', 'login_failed'].includes(r.action) ? 'overdue' : 'open'} text={label('audit_action', r.action)} />, exportValue: (r) => label('audit_action', r.action) },
    { key: 'record_label', label: 'السجل', render: (r) => r.record_label ?? r.record_id ?? '—' },
    { key: 'old_value', label: 'القيمة القديمة', wrap: true, render: (r) => <span className="small muted">{short(r.old_value)}</span> },
    { key: 'new_value', label: 'القيمة الجديدة', wrap: true, render: (r) => <span className="small">{short(r.new_value)}</span> },
    { key: 'details', label: 'تفاصيل', wrap: true },
  ];
  return (
    <>
      <DataTable
        method="audit.list"
        columns={cols}
        baseFilters={filters}
        exportTitle="سجل المراجعة"
        searchPlaceholder="بحث بالسجل أو المستخدم أو التفاصيل..."
        filters={filters ? [] : [
          { key: 'module', label: 'الوحدة', options: optionsOf('module') },
          { key: 'action', label: 'العملية', options: optionsOf('audit_action') },
          { key: 'dates', label: 'الفترة', type: 'dates' },
        ]}
        onRowClick={setDetail}
        empty={{ icon: 'shield', title: 'لا توجد عمليات مسجلة' }}
      />
      {detail && (
        <Modal size="lg" title={`${label('audit_action', detail.action)} — ${label('module', detail.module)}`} onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="muted">{fmtDateTime(detail.created_at)} • {detail.username} • {detail.record_label ?? detail.record_id}</div>
            {detail.details && <div className="alert info">{detail.details}</div>}
            <div className="grid-2">
              <div><div className="bold">القيمة القديمة</div><pre className="summary-box" style={{ direction: 'ltr', textAlign: 'left', whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 360, overflow: 'auto' }}>{detail.old_value ? JSON.stringify(JSON.parse(detail.old_value), null, 2) : '—'}</pre></div>
              <div><div className="bold">القيمة الجديدة</div><pre className="summary-box" style={{ direction: 'ltr', textAlign: 'left', whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 360, overflow: 'auto' }}>{detail.new_value ? JSON.stringify(JSON.parse(detail.new_value), null, 2) : '—'}</pre></div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
