import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { fmtMoney, label, LABELS } from '../../core/format';

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div className={`modal ${size}`} role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="x-btn" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label: l,
  required,
  hint,
  children,
  full,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label>
        {l} {required && <span className="req">*</span>}
      </label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function TextInput(p: {
  value: any;
  onChange: (v: string) => void;
  placeholder?: string;
  ltr?: boolean;
  disabled?: boolean;
  type?: string;
  autoFocus?: boolean;
  name?: string;
}) {
  return (
    <input
      className={`input${p.ltr ? ' ltr' : ''}`}
      name={p.name}
      type={p.type ?? 'text'}
      value={p.value ?? ''}
      placeholder={p.placeholder}
      disabled={p.disabled}
      autoFocus={p.autoFocus}
      onChange={(e) => p.onChange(e.target.value)}
    />
  );
}

export function NumberInput(p: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <input
      className="input ltr"
      name={p.name}
      type="number"
      value={p.value ?? ''}
      min={p.min}
      max={p.max}
      disabled={p.disabled}
      onChange={(e) => p.onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

/** Money input: user types major units; value is minor units (integer). */
export function MoneyInput({
  value,
  onChange,
  disabled,
  name,
  placeholder,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  name?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value == null ? '' : fmtMoney(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value == null ? '' : fmtMoney(value));
  }, [value, focused]);
  return (
    <input
      className="input ltr num"
      name={name}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      placeholder={placeholder ?? '0'}
      onFocus={() => {
        setFocused(true);
        setText(value == null ? '' : String(value / 100));
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
        setText(raw);
        if (raw === '') return onChange(null);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(Math.round(n * 100));
      }}
    />
  );
}

export function DateInput({
  value,
  onChange,
  disabled,
  name,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  name?: string;
}) {
  return <input className="input ltr" name={name} type="date" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  name,
}: {
  value: any;
  onChange: (v: string) => void;
  options: [string | number, string][];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <select className="input" name={name} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export const optionsOf = (group: string, keys?: string[]): [string, string][] => {
  const g = LABELS[group] ?? {};
  return (keys ?? Object.keys(g)).map((k) => [k, g[k] ?? k]);
};

export function TextArea({ value, onChange, rows = 3, name }: { value: any; onChange: (v: string) => void; rows?: number; name?: string }) {
  return <textarea className="input" name={name} rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

const BADGE_COLORS: Record<string, string> = {
  available: 'green',
  reserved: 'amber',
  sold: 'navy',
  delivered: 'gray',
  preparation: 'blue',
  maintenance: 'red',
  returned: 'amber',
  paid: 'green',
  overdue: 'red',
  partially_paid: 'amber',
  due_today: 'blue',
  not_due: 'gray',
  cancelled: 'gray',
  active: 'green',
  settled: 'navy',
  expired: 'gray',
  converted: 'navy',
  open: 'blue',
  valid: 'green',
  voided: 'red',
  new: 'blue',
  contacted: 'navy',
  interested: 'amber',
  negotiating: 'amber',
  won: 'green',
  lost: 'red',
  evaluated: 'blue',
  accepted: 'green',
  rejected: 'red',
  used: 'amber',
};

export function Badge({ group, value, text }: { group?: string; value: string; text?: string }) {
  const color = BADGE_COLORS[value] ?? 'gray';
  return <span className={`badge ${color}`}>{text ?? (group ? label(group, value) : value)}</span>;
}

export function Money({ v, className }: { v: number | null | undefined; className?: string }) {
  return <span className={`num ${className ?? ''}`}>{fmtMoney(v)}</span>;
}

export function Spinner() {
  return <div className="spinner" role="progressbar" aria-label="جاري التحميل" />;
}

export function EmptyState({ icon = 'file', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, sub, actions, crumb }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <div>
      {crumb && <div className="breadcrumb">{crumb}</div>}
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="spacer" />
        <div className="row">{actions}</div>
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number; hidden?: boolean }[];
  active: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
            {t.label}
            {t.count !== undefined && <span className="count">{t.count}</span>}
          </button>
        ))}
    </div>
  );
}

export function Kpi({
  label: l,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'accent' | 'danger';
  onClick?: () => void;
}) {
  return (
    <div className={`card kpi ${tone ?? ''} ${onClick ? 'clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="k-label">{l}</div>
      <div className="k-value">{value}</div>
      {sub && <div className="k-sub">{sub}</div>}
    </div>
  );
}

export function ErrorAlert({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="alert error">{error}</div>;
}

export function DL({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="dl">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SummaryLine({ label: l, value, total, className }: { label: ReactNode; value: ReactNode; total?: boolean; className?: string }) {
  return (
    <div className={`summary-line ${total ? 'total' : ''} ${className ?? ''}`}>
      <span>{l}</span>
      <span className="num">{value}</span>
    </div>
  );
}
