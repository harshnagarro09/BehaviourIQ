import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/* ---------------------------------------------------------------- plumbing */

/**
 * Measures the container and returns the width to draw at, never more than `maxW`.
 * Charts render their SVG at that width, centred in the container, so a wide panel does not stretch a
 * chart with few bars or points. Below `maxW` (narrow panels, mobile) the chart fills the container.
 */
export function useWidth<T extends HTMLElement>(maxW = Infinity): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.floor(el.getBoundingClientRect().width));
    measure();
    // layout can still shift after the first paint (scrollbar, fonts, grid columns): measure again once it settles
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return [ref as React.RefObject<T>, Math.min(w, maxW)];
}

/** a sensible maximum chart width for `n` bars / groups, `slot` px each, plus axis margins */
const capFor = (n: number, slot: number, lo = 380, hi = 1100) => Math.min(hi, Math.max(lo, 60 + n * slot));

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
      className="pointer-events-none absolute z-30 rounded-lg bg-[#0b1c2f] px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-lg"
      style={{
        left: Math.max(4, Math.min(tip.x + 12, (box.current?.clientWidth ?? 300) - 232)),
        // Flip below the cursor when there is no room above, so long tooltips are never cut off.
        top: tip.y < 130 ? tip.y + 14 : tip.y - 8,
        transform: tip.y < 130 ? undefined : 'translateY(-100%)',
        width: 'max-content', maxWidth: 220,
      }}
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

/* ---------------------------------------------------------------- bars (vertical, negatives ok) */


/* ---------------------------------------------------------------- grouped bars */
export function GroupedBars({
  groups, series, height = 230, format,
}: {
  groups: { label: string; values: number[] }[]; series: { label: string; color: string }[]; height?: number; format: (v: number) => string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(capFor(groups.length, 110));
  const { box, show, hide, el } = useTip();
  const m = { t: 12, r: 8, b: 30, l: 44 };
  const max = Math.max(...groups.flatMap((g) => g.values));
  const { hi, vals } = ticks(0, max);
  const iw = Math.max(10, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const y = (v: number) => m.t + ih - (v / hi) * ih;
  const gw = iw / groups.length;
  const bw = Math.min(30, (gw * 0.7) / series.length);
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="flex w-full justify-center [contain:inline-size]">
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

/* ---------------------------------------------------------------- scatter */
export interface Dot { x: number; y: number; color: string; tip: ReactNode; onClick?: () => void; r?: number; label?: string }
/**
 * Scatter plot. `xScale: 'sqrt'` spreads out a crowd of small values when one or two points are much larger (ticks stay
 * in real units). `refY` draws a labelled reference line (e.g. break-even), and a dot's `label` is written beside it.
 */
export function Scatter({
  dots, height = 280, xFormat, yFormat, xLabel, yLabel, xMax, yMax, r = 3.4, xScale = 'linear', refY,
}: {
  dots: Dot[]; height?: number; xFormat: (v: number) => string; yFormat: (v: number) => string; xLabel: string; yLabel: string; xMax?: number; yMax?: number; r?: number;
  xScale?: 'linear' | 'sqrt'; refY?: { value: number; label: string };
}) {
  const [ref, w] = useWidth<HTMLDivElement>(1000);
  const { box, show, hide, el } = useTip();
  const m = { t: 12, r: 12, b: 40, l: 54 };
  const xm = xMax ?? Math.max(...dots.map((d) => d.x), 1);
  const ym = yMax ?? Math.max(...dots.map((d) => d.y), 1);
  const xt = ticks(0, xm, xScale === 'sqrt' ? 5 : 4);
  const yt = ticks(Math.min(0, refY?.value ?? 0, ...dots.map((d) => d.y)), ym);
  const iw = Math.max(10, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const f = xScale === 'sqrt' ? (v: number) => Math.sqrt(Math.max(0, v)) : (v: number) => v;
  const X = (v: number) => m.l + (f(v) / f(xt.hi)) * iw;
  const Y = (v: number) => m.t + ih - ((v - yt.lo) / (yt.hi - yt.lo)) * ih;
  // with a sqrt scale the low ticks crowd together: keep only ticks at least 44px apart
  const xTicks = xt.vals.filter((t, i, all) => i === 0 || all.slice(0, i).every((u) => Math.abs(X(t) - X(u)) >= 44));
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="flex w-full justify-center [contain:inline-size]">
        {w > 0 && (
          <svg width={w} height={height}>
            {yt.vals.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} className="chart-grid" />
                <text x={m.l - 6} y={Y(t) + 4} textAnchor="end" className="chart-text">{yFormat(t)}</text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={X(t)} y={height - m.b + 16} textAnchor="middle" className="chart-text">{xFormat(t)}</text>
            ))}
            {refY && (
              <g>
                <line x1={m.l} x2={w - m.r} y1={Y(refY.value)} y2={Y(refY.value)} stroke="var(--ink-2)" strokeWidth={1.2} strokeDasharray="5 4" />
                <text x={m.l + 6} y={Y(refY.value) - 5} textAnchor="start" className="chart-text" style={{ fill: 'var(--ink-2)', fontWeight: 600, paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 }}>{refY.label}</text>
              </g>
            )}
            <text x={m.l + iw / 2} y={height - 6} textAnchor="middle" className="chart-text">{xLabel}</text>
            <text x={12} y={m.t + ih / 2} textAnchor="middle" className="chart-text" transform={`rotate(-90 12 ${m.t + ih / 2})`}>{yLabel}</text>
            {dots.map((d, i) => (
              <circle
                key={i} cx={X(Math.min(d.x, xt.hi))} cy={Y(d.y)} r={d.r ?? r} fill={d.color} fillOpacity={0.78} stroke="var(--card)" strokeWidth={1}
                style={{ cursor: d.onClick ? 'pointer' : undefined }}
                onMouseMove={(e) => show(e, d.tip)} onMouseLeave={hide} onClick={d.onClick}
              />
            ))}
            {dots.filter((d) => d.label).map((d, i) => {
              const cx = X(Math.min(d.x, xt.hi)), rad = d.r ?? r;
              const right = cx < m.l + iw * 0.7; // labels go right of the dot, or left near the right edge
              return (
                <text key={`l${i}`} x={right ? cx + rad + 4 : cx - rad - 4} y={Y(d.y) + 4} textAnchor={right ? 'start' : 'end'} className="chart-text pointer-events-none"
                  style={{ fill: 'var(--ink)', fontWeight: 600, paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 }}>{d.label}</text>
              );
            })}
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
              <th key={c} className="px-1 pb-1 text-center text-[11.5px] font-medium text-[var(--ink-3)]" style={{ minWidth: cell }}>{colLabel ? colLabel(ci) : c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <td className="pr-2 text-right text-[12.5px] font-medium text-[var(--ink-2)]">{rowLabel ? rowLabel(ri) : r}</td>
              {cols.map((c, ci) => {
                const v = value(ri, ci);
                const bg = color(v);
                return (
                  <td
                    key={c} className="num rounded-md text-center text-[11.5px] font-semibold"
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

/** heat map with cells sized to fill the panel */
export function FitHeat(props: Omit<Parameters<typeof Heat>[0], 'cell'>) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = props.cols.length;
  const cell = Math.max(56, Math.min(120, Math.floor((w - (props.rowW ?? 150) - 6 * n - 6) / Math.max(1, n))));
  return <div ref={ref}><Heat {...props} cell={cell} /></div>;
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
