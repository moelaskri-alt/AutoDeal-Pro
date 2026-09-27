import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/api';
import { fmtMoney, label } from '../../core/format';

interface PickerProps<T> {
  value: T | null;
  onChange: (v: T | null) => void;
  placeholder: string;
  search: (q: string) => Promise<T[]>;
  render: (v: T) => { title: string; sub?: string };
  disabled?: boolean;
  name?: string;
}

/** Searchable single-select (type-ahead) used for customers and vehicles. */
export function Picker<T extends { id: number }>({ value, onChange, placeholder, search, render, disabled, name }: PickerProps<T>) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[]>([]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        if (alive) {
          setItems(r);
          setActive(0);
        }
      } catch {
        if (alive) setItems([]);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open]);

  useEffect(() => {
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (value) {
    const r = render(value);
    return (
      <div className="row" style={{ gap: 6 }}>
        <span className="chip" title={r.sub}>
          {r.title}
          {r.sub && (
            <span className="muted small" style={{ fontWeight: 400 }}>
              — {r.sub}
            </span>
          )}
        </span>
        {!disabled && (
          <button type="button" className="btn sm ghost" onClick={() => onChange(null)}>
            تغيير
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="picker" ref={box}>
      <input
        className="input"
        name={name}
        placeholder={placeholder}
        value={q}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            onChange(items[active]);
            setOpen(false);
            setQ('');
          }
        }}
      />
      {open && (
        <div className="picker-list" role="listbox">
          {items.length === 0 && <div className="picker-item muted">لا توجد نتائج</div>}
          {items.map((it, i) => {
            const r = render(it);
            return (
              <div
                key={it.id}
                role="option"
                aria-selected={i === active}
                className={`picker-item ${i === active ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(it);
                  setOpen(false);
                  setQ('');
                }}
              >
                <div className="bold">{r.title}</div>
                {r.sub && <div className="sub">{r.sub}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface CustomerLite {
  id: number;
  code: string;
  name: string;
  phone?: string;
  national_id?: string;
}

export function CustomerPicker(p: { value: CustomerLite | null; onChange: (v: CustomerLite | null) => void; disabled?: boolean }) {
  return (
    <Picker<CustomerLite>
      {...p}
      name="customer"
      placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي..."
      search={(q) => call('customers.lookup', { search: q })}
      render={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(' • ') })}
    />
  );
}

export interface VehicleLite {
  id: number;
  stock_no: string;
  brand: string;
  model: string;
  trim?: string;
  model_year: number;
  color?: string;
  status: string;
  asking_price: number;
  min_price: number;
  vin?: string;
  condition: string;
  actual_cost?: number | null;
}

export function VehiclePicker(p: { value: VehicleLite | null; onChange: (v: VehicleLite | null) => void; disabled?: boolean; filters?: Record<string, any> }) {
  return (
    <Picker<VehicleLite>
      {...p}
      name="vehicle"
      placeholder="ابحث برقم المخزون أو الماركة أو الموديل أو الشاسيه..."
      search={async (q) => (await call('vehicles.list', { search: q, pageSize: 30, filters: p.filters ?? { sellable: true } })).rows}
      render={(v) => ({
        title: `${v.brand} ${v.model} ${v.trim ?? ''} ${v.model_year}`.replace(/\s+/g, ' '),
        sub: `${v.stock_no} • ${label('condition', v.condition)} • ${label('vehicle_status', v.status)} • ${fmtMoney(v.asking_price)}`,
      })}
    />
  );
}
