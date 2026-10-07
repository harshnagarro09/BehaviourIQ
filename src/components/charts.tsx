import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/* ---------------------------------------------------------------- plumbing */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setW(ref.current.clientWidth);
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref as React.RefObject<T>, w];
}

interface Tip { x: number; y: number; node: ReactNode }

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.MouseEvent, node: ReactNode) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, node });
  };
  const hide = () => setTip(null);
  const el = tip && (
    <div
      className="pointer-events-none absolute z-30 rounded-lg bg-[#0b1c2f] px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg"
      style={{ left: Math.min(tip.x + 12, (box.current?.clientWidth ?? 300) - 190), top: Math.max(0, tip.y - 8), transform: 'translateY(-100%)', maxWidth: 220 }}
    >
      {tip.node}
    </div>
  );
  return { box, show, hide, el };
}

function ticks(min: number, max: number, n = 4) {
  const lo0 = Math.min(0, min);
  const hi0 = Math.max(0, max);
  const raw = (hi0 - lo0) / n || 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
  const lo = Math.floor(lo0 / step + 1e-9) * step;
  let hi = Math.ceil(hi0 / step - 1e-9) * step;
  if (hi === lo) hi = lo + step;
  const vals: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) vals.push(Math.abs(v) < step / 1000 ? 0 : v);
  return { lo, hi, vals };
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- bars (vertical, negatives ok) */

export interface BarDatum { label: string; value: number; color?: string; tip?: ReactNode; sub?: string }

export function BarChart({
  data, height = 220, format, color = 'var(--t-anyways)', posColor, negColor, showValues = false, yLabel,
}: {
  data: BarDatum[]; height?: number; format: (v: number) => string; color?: string; posColor?: string; negColor?: string; showValues?: boolean; yLabel?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const { box, show, hide, el } = useTip();
  const m = { t: 14, r: 8, b: 34, l: 52 };
  const min = Math.min(0, ...data.map((d) => d.value));
  const max = Math.max(0, ...data.map((d) => d.value));
  const { lo, hi, vals } = ticks(min, max);
  const iw = Math.max(10, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const bw = iw / data.length;
  const barW = Math.min(34, bw * 0.62);
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="w-full">
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label={yLabel ?? 'Bar chart'}>
            {vals.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="chart-text">{format(t)}</text>
              </g>
            ))}
            <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} />
            {data.map((d, i) => {
              const cx = m.l + bw * i + bw / 2;
              const y0 = y(0);
              const y1 = y(d.value);
              const top = Math.min(y0, y1);
              const h = Math.max(1, Math.abs(y1 - y0));
              const fill = d.color ?? (d.value < 0 ? negColor ?? color : posColor ?? color);
              return (
                <g key={d.label + i} onMouseMove={(e) => show(e, d.tip ?? <><b>{d.label}</b><br />{format(d.value)}</>)} onMouseLeave={hide}>
                  <rect x={m.l + bw * i} y={m.t} width={bw} height={ih} fill="transparent" />
                  <rect x={cx - barW / 2} y={top} width={barW} height={h} rx={3} fill={fill} />
                  {showValues && (
                    <text x={cx} y={d.value >= 0 ? top - 4 : top + h + 11} textAnchor="middle" className="chart-text" style={{ fill: 'var(--ink-2)', fontWeight: 600 }}>
                      {format(d.value)}
                    </text>
                  )}
                  <text x={cx} y={height - m.b + 14} textAnchor="middle" className="chart-text">{d.label}</text>
                  {d.sub && <text x={cx} y={height - m.b + 26} textAnchor="middle" className="chart-text" style={{ fontSize: 10 }}>{d.sub}</text>}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {el}
    </div>
  );
}

/* ---------------------------------------------------------------- grouped bars */
export function GroupedBars({
  groups, series, height = 230, format,
}: {
  groups: { label: string; values: number[] }[]; series: { label: string; color: string }[]; height?: number; format: (v: number) => string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const { box, show, hide, el } = useTip();
  const m = { t: 12, r: 8, b: 30, l: 44 };
  const max = Math.max(...groups.flatMap((g) => g.values));
  const { hi, vals } = ticks(0, max);
  const iw = Math.max(10, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const y = (v: number) => m.t + ih - (v / hi) * ih;
  const gw = iw / groups.length;
  const bw = Math.min(26, (gw * 0.7) / series.length);
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="w-full">
        {w > 0 && (
          <svg width={w} height={height}>
            {vals.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="chart-text">{format(t)}</text>
              </g>
            ))}
            {groups.map((g, gi) => {
              const cx = m.l + gw * gi + gw / 2;
              return (
                <g key={g.label} onMouseMove={(e) => show(e, <><b>{g.label}</b>{series.map((s, si) => <div key={s.label}>{s.label}: {format(g.values[si])}</div>)}</>)} onMouseLeave={hide}>
                  <rect x={m.l + gw * gi} y={m.t} width={gw} height={ih} fill="transparent" />
                  {g.values.map((v, si) => (
                    <rect key={si} x={cx - (bw * series.length) / 2 + si * bw + (si ? 1 : 0)} y={y(v)} width={bw - 2} height={Math.max(1, y(0) - y(v))} rx={3} fill={series[si].color} />
                  ))}
                  <text x={cx} y={height - 10} textAnchor="middle" className="chart-text">{g.label}</text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {el}
    </div>
  );
}

/* ---------------------------------------------------------------- line chart */
export interface LineSeries { name: string; color: string; points: { x: number; y: number }[]; dashed?: boolean }

export function LineChart({
  series, height = 240, xFormat, yFormat, xTicks, yMax, markers = true, xLabel, band,
}: {
  series: LineSeries[]; height?: number; xFormat: (v: number) => string; yFormat: (v: number) => string; xTicks?: number[]; yMax?: number; markers?: boolean; xLabel?: string;
  band?: { a: LineSeries; b: LineSeries; color: string };
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const { box, show, hide, el } = useTip();
  const [hx, setHx] = useState<number | null>(null);
  const m = { t: 14, r: 14, b: xLabel ? 40 : 28, l: 46 };
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const xmin = xs[0] ?? 0;
  const xmax = xs[xs.length - 1] ?? 1;
  const ymaxData = Math.max(...series.flatMap((s) => s.points.map((p) => p.y)), 0.0001);
  const { hi, vals } = ticks(0, yMax ?? ymaxData);
  const iw = Math.max(10, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const X = (v: number) => m.l + ((v - xmin) / (xmax - xmin || 1)) * iw;
  const Y = (v: number) => m.t + ih - (v / hi) * ih;
  const tickX = xTicks ?? xs;
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="w-full">
        {w > 0 && (
          <svg
            width={w}
            height={height}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - r.left;
              const v = xmin + ((px - m.l) / iw) * (xmax - xmin);
              const nearest = xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), xs[0]);
              setHx(nearest);
              show(e, (
                <>
                  <b>{xFormat(nearest)}</b>
                  {series.map((s) => {
                    const p = s.points.find((q) => q.x === nearest);
                    return p ? (
                      <div key={s.name} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}: {yFormat(p.y)}
                      </div>
                    ) : null;
                  })}
                </>
              ));
            }}
            onMouseLeave={() => { setHx(null); hide(); }}
          >
            {vals.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} className="chart-grid" />
                <text x={m.l - 6} y={Y(t) + 4} textAnchor="end" className="chart-text">{yFormat(t)}</text>
              </g>
            ))}
            {tickX.map((t) => (
              <text key={t} x={X(t)} y={height - m.b + 16} textAnchor="middle" className="chart-text">{xFormat(t)}</text>
            ))}
            {xLabel && <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" className="chart-text">{xLabel}</text>}
            {band && (
              <path
                d={`${path(band.a.points)}L${band.b.points.slice().reverse().map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('L')}Z`}
                fill={band.color}
                opacity={0.14}
              />
            )}
            {hx !== null && <line x1={X(hx)} x2={X(hx)} y1={m.t} y2={m.t + ih} stroke="var(--ink-3)" strokeDasharray="3 3" />}
            {series.map((s) => (
              <g key={s.name}>
                <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
                {markers && s.points.map((p) => (
                  <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r={hx === p.x ? 5 : 3.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            ))}
          </svg>
        )}
      </div>
      {el}
    </div>
  );
}

/* ---------------------------------------------------------------- scatter */
export interface Dot { x: number; y: number; color: string; tip: ReactNode; onClick?: () => void; r?: number }
export function Scatter({
  dots, height = 280, xFormat, yFormat, xLabel, yLabel, xMax, yMax, r = 3.4,
}: {
  dots: Dot[]; height?: number; xFormat: (v: number) => string; yFormat: (v: number) => string; xLabel: string; yLabel: string; xMax?: number; yMax?: number; r?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const { box, show, hide, el } = useTip();
  const m = { t: 12, r: 12, b: 40, l: 54 };
  const xm = xMax ?? Math.max(...dots.map((d) => d.x), 1);
  const ym = yMax ?? Math.max(...dots.map((d) => d.y), 1);
  const xt = ticks(0, xm);
  const yt = ticks(Math.min(0, ...dots.map((d) => d.y)), ym);
  const iw = Math.max(10, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const X = (v: number) => m.l + (v / xt.hi) * iw;
  const Y = (v: number) => m.t + ih - ((v - yt.lo) / (yt.hi - yt.lo)) * ih;
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="w-full">
        {w > 0 && (
          <svg width={w} height={height}>
            {yt.vals.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} className="chart-grid" />
                <text x={m.l - 6} y={Y(t) + 4} textAnchor="end" className="chart-text">{yFormat(t)}</text>
              </g>
            ))}
            {xt.vals.map((t) => (
              <text key={t} x={X(t)} y={height - m.b + 16} textAnchor="middle" className="chart-text">{xFormat(t)}</text>
            ))}
            <text x={m.l + iw / 2} y={height - 6} textAnchor="middle" className="chart-text">{xLabel}</text>
            <text x={12} y={m.t + ih / 2} textAnchor="middle" className="chart-text" transform={`rotate(-90 12 ${m.t + ih / 2})`}>{yLabel}</text>
            {dots.map((d, i) => (
              <circle
                key={i} cx={X(Math.min(d.x, xt.hi))} cy={Y(d.y)} r={d.r ?? r} fill={d.color} fillOpacity={0.78} stroke="var(--card)" strokeWidth={1}
                style={{ cursor: d.onClick ? 'pointer' : undefined }}
                onMouseMove={(e) => show(e, d.tip)} onMouseLeave={hide} onClick={d.onClick}
              />
            ))}
          </svg>
        )}
      </div>
      {el}
    </div>
  );
}

/* ---------------------------------------------------------------- heat table */
export function Heat({
  rows, cols, value, color, label, rowLabel, colLabel, cell = 44, tip, rowW = 150,
}: {
  rows: string[]; cols: string[]; value: (r: number, c: number) => number; color: (v: number) => string; label?: (v: number) => string;
  rowLabel?: (r: number) => ReactNode; colLabel?: (c: number) => ReactNode; cell?: number; tip?: (r: number, c: number) => ReactNode; rowW?: number;
}) {
  const { box, show, hide, el } = useTip();
  return (
    <div ref={box} className="relative overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 3 }}>
        <thead>
          <tr>
            <th style={{ width: rowW }} />
            {cols.map((c, ci) => (
              <th key={c} className="px-1 pb-1 text-center text-[10.5px] font-medium text-[var(--ink-3)]" style={{ minWidth: cell }}>{colLabel ? colLabel(ci) : c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <td className="pr-2 text-right text-[11.5px] font-medium text-[var(--ink-2)]">{rowLabel ? rowLabel(ri) : r}</td>
              {cols.map((c, ci) => {
                const v = value(ri, ci);
                const bg = color(v);
                return (
                  <td
                    key={c} className="num rounded-md text-center text-[10.5px] font-semibold"
                    style={{ background: bg, height: 30, color: textOn(bg) }}
                    onMouseMove={(e) => show(e, tip ? tip(ri, ci) : <>{r} · {c}<br />{label ? label(v) : v.toFixed(2)}</>)}
                    onMouseLeave={hide}
                  >
                    {label ? label(v) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {el}
    </div>
  );
}

function textOn(bg: string) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(bg);
  if (!m) return 'var(--ink)';
  const l = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
  return l < 0.58 ? '#fff' : 'var(--ink)';
}

/** single-hue sequential ramp (light to dark) */
export function ramp(t: number, hue: [number, number, number] = [42, 120, 214]) {
  const c = Math.max(0, Math.min(1, t));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * c);
  return `rgb(${mix(236, hue[0])}, ${mix(241, hue[1])}, ${mix(248, hue[2])})`;
}
/** diverging: blue below, neutral at 1, orange above */
export function diverge(v: number) {
  const t = Math.max(-1, Math.min(1, v));
  const neutral = [240, 238, 232];
  const pole = t >= 0 ? [235, 104, 52] : [42, 120, 214];
  const a = Math.abs(t);
  return `rgb(${Math.round(neutral[0] + (pole[0] - neutral[0]) * a)}, ${Math.round(neutral[1] + (pole[1] - neutral[1]) * a)}, ${Math.round(neutral[2] + (pole[2] - neutral[2]) * a)})`;
}

/* ---------------------------------------------------------------- horizontal list bars */
export function HBars({
  rows, format, max, labelW = 130,
}: {
  rows: { label: ReactNode; value: number; color: string; note?: ReactNode }[]; format: (v: number) => string; max?: number; labelW?: number;
}) {
  const m = max ?? Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="shrink-0 truncate text-[12px] text-[var(--ink-2)]" style={{ width: labelW }}>{r.label}</div>
          <div className="relative h-5 flex-1 rounded-md bg-[var(--line-2)]">
            <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.max(1.5, (Math.abs(r.value) / m) * 100)}%`, background: r.color }} />
          </div>
          <div className="num w-14 shrink-0 text-right text-[12px] font-semibold">{format(r.value)}</div>
          {r.note && <div className="w-20 shrink-0 text-[11px] text-[var(--ink-3)]">{r.note}</div>}
        </div>
      ))}
    </div>
  );
}

/** diverging horizontal bars around a zero axis (profit / loss) */
export function DivergingBars({
  rows, format, labelW = 130,
}: {
  rows: { label: ReactNode; value: number; color: string; note?: ReactNode }[]; format: (v: number) => string; labelW?: number;
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
  const hasNeg = rows.some((r) => r.value < 0);
  const hasPos = rows.some((r) => r.value > 0);
  const negShare = hasNeg ? (hasPos ? Math.abs(Math.min(...rows.map((r) => r.value))) / (max + Math.abs(Math.min(...rows.map((r) => r.value)))) : 1) : 0;
  const lo = Math.min(...rows.map((r) => r.value), 0);
  const hi = Math.max(...rows.map((r) => r.value), 0);
  const span = hi - lo || 1;
  const zero = (-lo / span) * 100;
  void negShare;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const left = r.value >= 0 ? zero : zero - (Math.abs(r.value) / span) * 100;
        const width = Math.max(0.8, (Math.abs(r.value) / span) * 100);
        return (
          <div key={i} className="flex items-center gap-3">
            <div className="shrink-0 truncate text-[12px] text-[var(--ink-2)]" style={{ width: labelW }}>{r.label}</div>
            <div className="relative h-5 flex-1">
              <div className="absolute inset-y-0 w-px bg-[var(--ink-3)]" style={{ left: `${zero}%` }} />
              <div className="absolute inset-y-0.5 rounded-[4px]" style={{ left: `${left}%`, width: `${width}%`, background: r.color }} />
            </div>
            <div className="num w-16 shrink-0 text-right text-[12px] font-semibold" style={{ color: r.value < 0 ? 'var(--bad)' : 'var(--ink)' }}>{format(r.value)}</div>
            {r.note && <div className="w-16 shrink-0 text-[11px] text-[var(--ink-3)]">{r.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** 100% stacked segment bar */
export function Stack({ parts, height = 14 }: { parts: { label: string; value: number; color: string }[]; height?: number }) {
  const tot = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-md" style={{ height }}>
      {parts.map((p) => (
        <div key={p.label} title={`${p.label}: ${((p.value / tot) * 100).toFixed(0)}%`} style={{ width: `${(p.value / tot) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- waterfall */
export function Waterfall({
  steps, height = 230, format,
}: {
  steps: { label: string; value: number; kind: 'total' | 'delta'; note?: string }[]; height?: number; format: (v: number) => string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const { box, show, hide, el } = useTip();
  const m = { t: 22, r: 8, b: 44, l: 52 };
  let run = 0;
  const bars = steps.map((s) => {
    if (s.kind === 'total') { const b = { ...s, from: 0, to: s.value }; run = s.value; return b; }
    const b = { ...s, from: run, to: run + s.value };
    run += s.value;
    return b;
  });
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  const hi = Math.max(0, ...bars.flatMap((b) => [b.from, b.to]));
  const t = ticks(lo, hi);
  const iw = Math.max(10, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const Y = (v: number) => m.t + ih - ((v - t.lo) / (t.hi - t.lo)) * ih;
  const bw = iw / bars.length;
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="w-full">
        {w > 0 && (
          <svg width={w} height={height}>
            {t.vals.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} className="chart-grid" />
                <text x={m.l - 6} y={Y(v) + 4} textAnchor="end" className="chart-text">{format(v)}</text>
              </g>
            ))}
            <line x1={m.l} x2={w - m.r} y1={Y(0)} y2={Y(0)} stroke="var(--ink-3)" />
            {bars.map((b, i) => {
              const x = m.l + bw * i + bw * 0.18;
              const top = Math.min(Y(b.from), Y(b.to));
              const h = Math.max(1.5, Math.abs(Y(b.from) - Y(b.to)));
              const fill = b.kind === 'total' ? 'var(--ink)' : b.value >= 0 ? 'var(--t-stockup)' : 'var(--bad)';
              return (
                <g key={b.label} onMouseMove={(e) => show(e, <><b>{b.label}</b><br />{format(b.value)}{b.note && <div className="opacity-70">{b.note}</div>}</>)} onMouseLeave={hide}>
                  <rect x={x} y={top} width={bw * 0.64} height={h} rx={3} fill={fill} />
                  <text x={x + bw * 0.32} y={top - 5} textAnchor="middle" className="chart-text" style={{ fill: 'var(--ink-2)', fontWeight: 600 }}>{format(b.value)}</text>
                  {b.label.split('\n').map((ln, k) => (
                    <text key={k} x={x + bw * 0.32} y={height - m.b + 16 + k * 12} textAnchor="middle" className="chart-text">{ln}</text>
                  ))}
                  {i < bars.length - 1 && <line x1={x + bw * 0.64} x2={x + bw * 1.18} y1={Y(b.to)} y2={Y(b.to)} stroke="var(--ink-3)" strokeDasharray="2 3" />}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {el}
    </div>
  );
}

export function Spark({ values, color = 'var(--ink)', width = 90, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const mx = Math.max(...values, 0.0001);
  const mn = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - mn) / (mx - mn || 1)) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true));
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}
