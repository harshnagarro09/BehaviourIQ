// Behaviour Analytics > Promotion results > "Where the return comes from": promotion sales split into baseline and uplift.
// Level (all promotions / by brand / by category / by SKU) opens Brand -> Category -> SKU pickers; each list holds only what
// exists under the choice before it. The promotions that ran for the selection are listed with how each performed, and a
// click on one focuses the chart on it. Every number is a sum of engine/returns.ts rows, so the bars, the promotion list and
// the comparison table always agree.
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useEngine } from '@/state';
import { Picker } from '@/components/Picker';
import { Help } from '@/components/Help';
import { useWidth } from '@/components/charts';
import { returnRows, sumReturns, type ReturnRow, type ReturnTotals } from '@/engine/returns';
import { offerName } from '@/engine/options';
import { isoOf, type Campaign } from '@/engine/data';
import { roiColor } from '@/lib/colors';
import { inr, int, pct, shortDate } from '@/lib/fmt';

type Measure = 'units' | 'sales';
type Level = 'overall' | 'brand' | 'category' | 'sku';
type By = 'brand' | 'category' | 'sku';
const LEVELS: { value: Level; label: string }[] = [
  { value: 'overall', label: 'All promotions' }, { value: 'brand', label: 'By brand' }, { value: 'category', label: 'By category' }, { value: 'sku', label: 'By SKU' },
];
const BY_LABEL: Record<By, string> = { brand: 'Brand', category: 'Category', sku: 'Product' };
const uniq = (xs: string[]) => [...new Set(xs)].sort();
const ALL = 'all';
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** the three numbers for one measure: total promotion sales, baseline and uplift */
const view = (t: ReturnTotals, m: Measure) => (m === 'units' ? { total: t.units, base: t.base, uplift: t.uplift } : { total: t.revenue, base: t.baseRevenue, uplift: t.incRevenue });

export function ReturnBreakdown({ cur, ok }: { cur: Campaign[]; ok: (cid: string) => boolean }) {
  const e = useEngine();
  const rows = useMemo(() => returnRows(e.ds, e.perCustomer, cur, ok), [e, cur, ok]);
  const camp = useMemo(() => new Map(e.ds.campaigns.map((c) => [c.id, c])), [e]);
  const [level, setLevel] = useState<Level>('overall');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [sku, setSku] = useState('');
  const [promo, setPromo] = useState(ALL);
  const [measure, setMeasure] = useState<Measure>('units');
  const [showAll, setShowAll] = useState(false);
  const [compare, setCompare] = useState(false);
  const [by, setBy] = useState<By>('brand');

  // brand -> category -> SKU: each list holds only what exists under the choice before it; a stale pick falls back.
  // "By brand" needs one brand; by category and by SKU may look across all brands.
  const allCats = uniq(rows.map((r) => r.category));
  const fixedCat = allCats.length === 1 ? allCats[0] : null; // set by "Product category" in the page filters
  const lvl: Level = fixedCat && level === 'category' ? 'overall' : level;
  const byKey: By = fixedCat && by === 'category' ? 'brand' : by;
  const brands = uniq(rows.map((r) => r.brand));
  const b = lvl === 'brand' ? (brands.includes(brand) ? brand : brands[0] ?? '') : brand === ALL || brands.includes(brand) ? brand || ALL : ALL;
  const inB = rows.filter((r) => b === ALL || r.brand === b);
  const cats = uniq(inB.map((r) => r.category));
  const c = cats.includes(category) ? category : cats[0] ?? '';
  const inC = inB.filter((r) => r.category === c);
  const skus = [...new Map(inC.map((r) => [r.productId, r])).values()].sort((x, y) => x.product.localeCompare(y.product));
  const s = skus.some((r) => r.productId === sku) ? sku : skus[0]?.productId ?? '';
  const scoped = lvl === 'overall' ? rows : lvl === 'brand' ? inB : lvl === 'category' ? inC : inC.filter((r) => r.productId === s);
  const scopeName = lvl === 'overall' ? (fixedCat ? `all ${fixedCat} products` : 'all promoted products')
    : lvl === 'brand' ? b
    : lvl === 'category' ? (b === ALL ? c : `${b} ${c}`)
    : skus.find((r) => r.productId === s)?.product ?? '';

  // the promotions that ran for the selection, and how each performed
  const promoRows = group(scoped, camp).filter((g) => g.t.units > 0 || g.t.base > 0.5).sort((x, y) => view(y.t, measure).uplift - view(x.t, measure).uplift);
  const p = promoRows.some((g) => g.key === promo) ? promo : ALL;
  const sel = p === ALL ? scoped : scoped.filter((r) => r.campaignId === p);
  const T = sumReturns(sel);
  const V = view(T, measure);
  const fmt = measure === 'units' ? (v: number) => int(v) : (v: number) => inr(v, 1);
  const label = p === ALL ? scopeName : `${camp.get(p)?.name} · ${scopeName}`;
  const shown = showAll ? promoRows : promoRows.slice(0, 4);
  const maxUp = Math.max(1e-9, ...promoRows.map((g) => Math.abs(view(g.t, measure).uplift)));
  const scopeT = view(sumReturns(scoped), measure);
  const top = promoRows[0];
  const paid = T.incMargin >= 0;

  const pickLevel = (v: Level) => { setLevel(v); setPromo(ALL); setShowAll(false); if (v !== 'brand' && !brands.includes(brand)) setBrand(ALL); };
  // a comparison row moves the chart to that brand / category / product
  const drill = (g: CmpGroup) => {
    setPromo(ALL);
    if (byKey === 'brand') { setLevel('brand'); setBrand(g.key); }
    else if (byKey === 'category') { setLevel('category'); setCategory(g.key); if (b !== ALL && !rows.some((r) => r.brand === b && r.category === g.key)) setBrand(ALL); }
    else { const r = rows.find((x) => x.productId === g.key)!; setLevel('sku'); setBrand(r.brand); setCategory(r.category); setSku(r.productId); }
  };
  const cmp = cmpGroups(p === ALL ? scoped : sel, byKey).filter((g) => g.t.units > 0 || g.t.base > 0.5).sort((x, y) => view(y.t, measure).uplift - view(x.t, measure).uplift);

  const brandPicker = <Picker label="Brand" value={b} onChange={(v) => { setBrand(v); setPromo(ALL); }}
    options={[...(lvl === 'brand' ? [] : [{ value: ALL, label: 'All brands', hint: count(brands.length, 'brand') }]), ...brands.map((x) => ({ value: x, label: x, hint: count(new Set(rows.filter((r) => r.brand === x).map((r) => r.productId)).size, 'product') }))]} />;
  const categoryPicker = <Picker label="Category" value={c} onChange={(v) => { setCategory(v); setPromo(ALL); }}
    options={cats.map((x) => ({ value: x, label: x, hint: count(new Set(inB.filter((r) => r.category === x).map((r) => r.productId)).size, 'product') }))} />;
  const skuPicker = <Picker label="SKU" value={s} onChange={(v) => { setSku(v); setPromo(ALL); }} placeholder="Search products"
    options={skus.map((r) => ({ value: r.productId, label: r.product, hint: r.productId }))} />;
  const promoPicker = <Picker label="Promotion" value={p} onChange={setPromo} placeholder="Search promotions"
    options={[{ value: ALL, label: 'All promotions', hint: `${promoRows.length} ran` }, ...promoRows.map((g) => ({ value: g.key, label: g.label, hint: shortDate(isoOf(camp.get(g.key)!.start)) }))]} />;

  return (
    <div>
      {/* ------------------------------------------------------------ level -> brand -> category -> SKU, then promotion */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Picker label="Level" value={lvl} onChange={(v) => pickLevel(v as Level)} searchable={false} options={fixedCat ? LEVELS.filter((o) => o.value !== 'category') : LEVELS} />
        {lvl === 'overall' ? <div className="sm:col-span-2">{promoPicker}</div> : <>{brandPicker}{lvl === 'brand' || fixedCat ? promoPicker : categoryPicker}</>}
        {lvl === 'category' && <div className="sm:col-span-3">{promoPicker}</div>}
        {lvl === 'sku' && (fixedCat ? <div className="sm:col-span-3">{skuPicker}</div> : <><div className="sm:col-span-2">{skuPicker}</div>{promoPicker}</>)}
      </div>
      {fixedCat && <p className="mt-2 text-[11.5px] text-[var(--ink-3)]">Category: <b className="font-semibold text-[var(--ink-2)]">{fixedCat}</b>, set in “Which promotions to look at” above.</p>}

      {T.units <= 0 && T.base <= 0 ? (
        <p className="mt-4 rounded-lg bg-[var(--page)] py-14 text-center text-[13px] text-[var(--ink-3)]">No promotion sales for {label} in the current filters.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--ink-2)]">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--navy)]" />Total promo sales</span>
              <span className="inline-flex items-center gap-1.5"><span className="hatch h-2.5 w-2.5 rounded-sm bg-[#94a3b8]" />Baseline</span>
              <span className="inline-flex items-center gap-1.5"><span className="hatch h-2.5 w-2.5 rounded-sm bg-[var(--green)]" />Uplift</span>
            </div>
            <Seg value={measure} onChange={setMeasure} options={[{ id: 'units', label: 'Units' }, { id: 'sales', label: 'Sales ₹' }]} />
          </div>
          <ReturnBars total={V.total} base={V.base} uplift={V.uplift} fmt={fmt} />
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--ink-3)]">
            Showing <b className="font-semibold text-[var(--ink-2)]">{label}</b>: {fmt(V.total)} = {fmt(V.base)} baseline + {fmt(V.uplift)} uplift.
            {' '}Total sales are actual; baseline and uplift (striped) are estimates.
            {(lvl === 'brand' || lvl === 'sku') && ' The baseline is estimated per customer for the category, then split across its SKUs by their normal (non-promotion) sales mix.'}
            {measure === 'sales' && ' In ₹, the baseline is valued at full price and promotion sales after the discount.'}
          </p>

          <div className="mt-3 rounded-lg px-3.5 py-2.5" style={{ background: paid ? 'var(--green-bg)' : 'var(--red-bg)', color: paid ? 'var(--green-dark)' : '#b91c1c' }}>
            <p className="text-[13px] font-semibold">Promo ROI {T.cost > 0 ? T.roi.toFixed(2) : '–'} = {inr(T.incMargin, 1)} incremental margin ÷ {inr(T.cost, 1)} promo cost<Help term="roi" /></p>
            <p className="mt-0.5 text-[12px]">{T.cost <= 0 ? 'No promo cost in this selection.' : paid ? `Every ₹1 of promo cost earned it back plus ₹${T.roi.toFixed(2)}.` : 'The extra sales did not cover the promo cost.'}</p>
          </div>

          {/* ------------------------------------------------------------ the promotions behind the selection */}
          <div className="mt-4 rounded-lg border border-[var(--line)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-3.5 py-2.5">
              <p className="text-[12.5px] font-semibold">Promotions for {scopeName} <span className="font-normal text-[var(--ink-3)]">· {promoRows.length} ran</span></p>
              <p className="text-[11px] text-[var(--ink-3)]">{p === ALL ? 'Biggest uplift first · click one to focus the chart' : 'Click again to show all promotions'}</p>
            </div>
            {top && p === ALL && promoRows.length > 1 && scopeT.uplift > 0 && view(top.t, measure).uplift > 0 && (
              <p className="px-3.5 pt-2.5 text-[12px] text-[var(--ink-2)]"><b className="text-[var(--ink)]">{top.label}</b> brought the most uplift: {pct(view(top.t, measure).uplift / scopeT.uplift)} of it.</p>
            )}
            <ul className="divide-y divide-[var(--line-2)] px-1.5 py-1">
              {shown.map((g) => {
                const v = view(g.t, measure);
                const on = g.key === p;
                return (
                  <li key={g.key}>
                    <button onClick={() => setPromo(on ? ALL : g.key)} aria-pressed={on}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_96px_52px] items-center gap-3 rounded-md px-2 py-2 text-left ${on ? 'bg-[#eef3fa]' : 'hover:bg-[var(--page)]'}`}>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold">{g.label}</span>
                        <span className="block truncate text-[10.5px] text-[var(--ink-3)]">{g.sub}</span>
                      </span>
                      <span>
                        <span className="num block text-right text-[12px] font-semibold" style={{ color: v.uplift < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{v.uplift >= 0 ? '+' : ''}{fmt(v.uplift)}</span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--line-2)]"><span className="block h-full rounded-full" style={{ width: `${(Math.abs(v.uplift) / maxUp) * 100}%`, background: v.uplift < 0 ? 'var(--red)' : 'var(--green)' }} /></span>
                      </span>
                      <span className="num text-right text-[12px] font-bold" title="Promo ROI" style={{ color: g.t.cost > 0 ? roiColor(g.t.roi) : undefined }}>{g.t.cost > 0 ? g.t.roi.toFixed(2) : '–'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-2)] px-3.5 py-2 text-[11px] text-[var(--ink-3)]">
              <span>Uplift in {measure === 'units' ? 'units' : '₹'} · ROI on the right</span>
              {promoRows.length > 4 && <button onClick={() => setShowAll(!showAll)} className="inline-flex items-center gap-1 font-semibold text-[var(--navy)] hover:underline">{showAll ? 'Show top 4' : `Show all ${promoRows.length}`}<ChevronDown className={`h-3 w-3 transition-transform ${showAll ? 'rotate-180' : ''}`} /></button>}
            </div>
          </div>

          {/* ------------------------------------------------------------ compare brands / categories / products, on demand */}
          <button onClick={() => setCompare(!compare)} aria-expanded={compare} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]">
            {compare ? 'Hide the comparison' : 'Compare brands, categories and products'}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${compare ? 'rotate-180' : ''}`} />
          </button>
          {compare && (
            <div className="mt-2 rounded-lg border border-[var(--line)]">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
                <Seg value={byKey} onChange={setBy} options={(['brand', 'category', 'sku'] as By[]).filter((k) => !fixedCat || k !== 'category').map((k) => ({ id: k, label: BY_LABEL[k] }))} />
                <span className="text-[11px] text-[var(--ink-3)]">Within {label} · click a row to open it</span>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-[12px]">
                  <thead><tr className="border-y border-[var(--line)] bg-[var(--page)] text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
                    <th className="px-3 py-2 text-left">{BY_LABEL[byKey]}</th><th className="px-2 py-2">Total</th><th className="px-2 py-2">Baseline</th><th className="px-2 py-2">Uplift</th><th className="px-3 py-2">ROI</th>
                  </tr></thead>
                  <tbody>
                    {cmp.map((g) => {
                      const v = view(g.t, measure);
                      return (
                        <tr key={g.key} onClick={() => drill(g)} className="cursor-pointer border-b border-[var(--line-2)] text-right hover:bg-[var(--page)]">
                          <td className="px-3 py-1.5 text-left"><span className="block font-semibold">{g.label}</span>{g.sub && <span className="block text-[10.5px] text-[var(--ink-3)]">{g.sub}</span>}</td>
                          <td className="num px-2">{fmt(v.total)}</td>
                          <td className="num px-2 text-[var(--ink-2)]">{fmt(v.base)}</td>
                          <td className="num px-2 font-semibold" style={{ color: v.uplift < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{fmt(v.uplift)}</td>
                          <td className="num px-3 font-semibold" style={{ color: g.t.cost > 0 ? roiColor(g.t.roi) : undefined }}>{g.t.cost > 0 ? g.t.roi.toFixed(2) : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr className="text-right font-bold">
                    <td className="px-3 py-2 text-left">Total</td>
                    <td className="num px-2">{fmt(V.total)}</td><td className="num px-2">{fmt(V.base)}</td>
                    <td className="num px-2" style={{ color: V.uplift < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{fmt(V.uplift)}</td>
                    <td className="num px-3" style={{ color: T.cost > 0 ? roiColor(T.roi) : undefined }}>{T.cost > 0 ? T.roi.toFixed(2) : '–'}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface PromoGroup { key: string; label: string; sub: string; t: ReturnTotals }
/** one row per promotion in the selection */
function group(rows: ReturnRow[], camp: Map<string, Campaign>): PromoGroup[] {
  const m = new Map<string, ReturnRow[]>();
  for (const r of rows) { let a = m.get(r.campaignId); if (!a) m.set(r.campaignId, (a = [])); a.push(r); }
  return [...m].map(([key, rs]) => {
    const c = camp.get(key)!;
    return { key, label: c.name, sub: `${c.category} · ${offerName(c.mechanic, c.depth, c.flat, c.minSpend)} · ${shortDate(isoOf(c.start))} – ${shortDate(isoOf(c.end))}`, t: sumReturns(rs) };
  });
}

interface CmpGroup { key: string; label: string; sub?: string; t: ReturnTotals }
function cmpGroups(rows: ReturnRow[], by: By): CmpGroup[] {
  const m = new Map<string, ReturnRow[]>();
  for (const r of rows) {
    const k = by === 'brand' ? r.brand : by === 'category' ? r.category : r.productId;
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(r);
  }
  return [...m].map(([key, rs]) => ({ key, label: by === 'sku' ? rs[0].product : key, sub: by === 'sku' ? `${rs[0].brand} · ${rs[0].category}` : undefined, t: sumReturns(rs) }));
}

/** the small switch used in this card */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--page)] p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`h-full whitespace-nowrap rounded-md px-2.5 text-[12px] font-semibold transition-colors ${value === o.id ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink)]'}`}>{o.label}</button>
      ))}
    </div>
  );
}

/** Total promo sales (actual, solid) next to baseline and uplift (estimates, striped), with dotted guides as in the reference */
function ReturnBars({ total, base, uplift, fmt }: { total: number; base: number; uplift: number; fmt: (v: number) => string }) {
  const [ref, w] = useWidth<HTMLDivElement>(460);
  const H = 240, m = { t: 22, b: 30, l: 44 };
  const bars = [
    { label: 'Total promo sales', value: total, color: 'var(--navy)', est: false, note: 'Everything sold in the promotion windows (actual)' },
    { label: 'Baseline', value: base, color: '#94a3b8', est: true, note: 'Would have sold anyway (estimate)' },
    { label: 'Uplift', value: uplift, color: uplift >= 0 ? 'var(--green)' : 'var(--red)', est: true, note: 'Extra from the promotions (estimate)' },
  ];
  const hi = Math.max(1e-9, total, base, uplift), lo = Math.min(0, uplift);
  const step = niceStep((hi - lo) / 4);
  const top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
  const ih = H - m.t - m.b;
  const Y = (v: number) => m.t + ((top - v) / (top - bot)) * ih;
  const iw = Math.max(10, w - m.l);
  const slot = iw / 3, bw = Math.min(84, slot * 0.62);
  const X = (i: number) => m.l + slot * i + (slot - bw) / 2;
  const tickVals: number[] = [];
  for (let v = bot; v <= top + 1e-9; v += step) tickVals.push(v);
  return (
    <div ref={ref} className="mx-auto mt-2 w-full max-w-[460px]">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`Total promotion sales ${fmt(total)}, baseline ${fmt(base)}, uplift ${fmt(uplift)}`}>
          <defs>
            <pattern id="est-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2.2" strokeOpacity="0.45" />
            </pattern>
          </defs>
          {tickVals.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={w} y1={Y(v)} y2={Y(v)} className="chart-grid" />
              <text x={m.l - 6} y={Y(v) + 4} textAnchor="end" className="chart-text">{fmt(v)}</text>
            </g>
          ))}
          <line x1={m.l} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--ink-3)" />
          <line x1={X(0) + bw} x2={X(1) + bw} y1={Y(total)} y2={Y(total)} stroke="var(--ink-3)" strokeDasharray="2 3" />
          <line x1={X(1) + bw} x2={X(2)} y1={Y(base)} y2={Y(base)} stroke="var(--ink-3)" strokeDasharray="2 3" />
          {bars.map((b, i) => {
            const x = X(i);
            const y0 = Math.min(Y(0), Y(b.value)), h = Math.max(2, Math.abs(Y(b.value) - Y(0)));
            return (
              <g key={b.label}>
                <title>{`${b.label}: ${fmt(b.value)}. ${b.note}.`}</title>
                <rect x={x} y={y0} width={bw} height={h} rx={3} fill={b.color} />
                {b.est && <rect x={x} y={y0} width={bw} height={h} rx={3} fill="url(#est-hatch)" />}
                <text x={x + bw / 2} y={b.value >= 0 ? y0 - 6 : y0 + h + 13} textAnchor="middle" className="chart-text num" style={{ fill: 'var(--ink-2)', fontWeight: 600 }}>{fmt(b.value)}</text>
                <text x={x + bw / 2} y={H - m.b + 16} textAnchor="middle" className="chart-text">{b.label}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** 1, 2, 2.5 or 5 x a power of ten */
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
