import { fmtMoney } from '../../core/format';

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthLabel = (ym: string) => `${MONTHS_AR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

function compact(minor: number): string {
  const v = minor / 100;
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

/**
 * Grouped vertical bar chart (SVG, RTL: first month on the right).
 * Series values are money in minor units.
 */
export function BarChart({ labels, series, height = 220 }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number }) {
  const W = 640;
  const H = height;
  const pad = { t: 12, b: 34, l: 10, r: 46 };
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.max(0, v))));
  const min = Math.min(0, ...series.flatMap((s) => s.values));
  const range = max - min || 1;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = labels.length;
  const groupW = innerW / Math.max(1, n);
  const barW = Math.max(3, Math.min(22, (groupW * 0.7) / series.length));
  const y = (v: number) => pad.t + innerH - ((v - min) / range) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * range);
  const total = series.reduce((a, s) => a + s.values.reduce((x, y2) => x + Math.abs(y2), 0), 0);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join('، ')}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eef1f5" />
            <text x={W - pad.r + 6} y={y(t) + 4} textAnchor="start">
              {compact(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          // RTL: index 0 at the right edge
          const gx = W - pad.r - (i + 1) * groupW;
          const start = gx + (groupW - barW * series.length) / 2;
          return (
            <g key={l}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const y0 = y(Math.max(0, v));
                const h = Math.abs(y(v) - y(0));
                return (
                  <rect key={s.name} x={start + (series.length - 1 - si) * barW} y={y0} width={barW - 2} height={Math.max(v ? 1 : 0, h)} rx={2} fill={s.color}>
                    <title>{`${s.name} — ${l}: ${fmtMoney(v)}`}</title>
                  </rect>
                );
              })}
              <text x={gx + groupW / 2} y={H - 12} textAnchor="middle">
                {l}
              </text>
            </g>
          );
        })}
        {total === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" style={{ fontSize: 13 }}>
            لا توجد بيانات في هذه الفترة
          </text>
        )}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars with labels (inventory by brand, aging buckets). */
export function HBars({
  items,
  color = 'var(--primary)',
  format,
}: {
  items: { label: string; value: number; sub?: string }[];
  color?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="muted small">لا توجد بيانات</div>;
  return (
    <div>
      {items.map((i) => (
        <div className="bar-row" key={i.label}>
          <span className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.label}>
            {i.label}
          </span>
          <div className="track">
            <div className="fill" style={{ width: `${(i.value / max) * 100}%`, background: color }} />
          </div>
          <span className="small num">
            {format ? format(i.value) : i.value}
            {i.sub && <span className="muted"> ({i.sub})</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
