import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Takeaway } from '@/components/Takeaway';
import { CustomerGroups } from '@/pages/CustomerGroups';
import { useProductScope } from '@/components/ProductScope';
import { pastResultsTakeaway } from '@/lib/takeaways';
import { useApp, useEngine } from '@/state';
import { Help } from '@/components/Help';
import { Chip, FilterSelect, Kpi, Tabs, ViewToggle } from '@/components/ui';
import { Heat, Scatter, Waterfall, useWidth } from '@/components/charts';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import { offerName } from '@/engine/options';
import { MECH_HOW, MECH_LABEL, MECH_ORDER, type MechKey } from '@/engine/mechanics';
import type { TypeId } from '@/engine/behaviour';
import {
  aggregate, customerFilter, DEFAULT_FILTERS, incShareOf, leakOf, mechOf,
  perCampaign, pctChange, respOf, roiOf, selectCampaigns, skuSales, verdictOf, type Agg, type Filters,
} from '@/lib/analytics';
import { driversOf } from '@/lib/targeting';
import { rateFill, roiColor, roiFill } from '@/lib/colors';
import { inr, int, pct, dateLabel, shortDate } from '@/lib/fmt';
import { isoOf, type Campaign } from '@/engine/data';
import type { GlossaryKey } from '@/lib/glossary';

const VERDICT = { 'High performer': 'var(--green)', 'Needs improvement': 'var(--amber)', 'Low performer': 'var(--red)' } as const;
const VERDICT_TONE = { 'High performer': 'green', 'Needs improvement': 'amber', 'Low performer': 'red' } as const;
const offerOfCampaign = (c: Campaign) => offerName(c.mechanic, c.depth, c.flat, c.minSpend);
const CHANNELS = ['Store', 'App', 'Online'];

/** the metrics a chart can switch between: one definition, used by every chart and table on the page */
type MetricKey = 'roi' | 'incRevenue' | 'resp' | 'uplift';
const METRICS: Record<MetricKey, { label: string; phrase: string; short: string; get: (a: Agg) => number; fmt: (v: number) => string; help: GlossaryKey; good: (v: number) => boolean }> = {
  roi: { label: 'Promo ROI', phrase: 'promo ROI', short: 'ROI', get: roiOf, fmt: (v) => v.toFixed(2), help: 'roi', good: (v) => v >= 0 },
  incRevenue: { label: 'Incremental revenue', phrase: 'incremental revenue', short: 'Incr. revenue', get: (a) => a.incRevenue, fmt: (v) => inr(v, 0), help: 'incRevenue', good: (v) => v >= 0 },
  resp: { label: 'Redemption rate', phrase: 'redemption rate', short: 'Redemption', get: respOf, fmt: (v) => pct(v), help: 'redemption', good: () => true },
  uplift: { label: 'Uplift (share of extra units)', phrase: 'uplift', short: 'Uplift', get: incShareOf, fmt: (v) => pct(v), help: 'uplift', good: (v) => v >= 0 },
};

type Tab = 'types' | 'results';

export function Analytics() {
  const e = useEngine();
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const { params, syncParams } = useApp();
  const [tab, setTabState] = useState<Tab>(() => (params.tab === 'results' ? 'results' : 'types'));
  const setTab = (t: Tab) => { setTabState(t); syncParams({ tab: t }); };
  const set = (k: keyof Filters) => (v: string) => setF({ ...f, [k]: v });

  const { cur, prior } = useMemo(() => selectCampaigns(e, f), [e, f]);
  const ok = useMemo(() => customerFilter(e, f), [e, f]);
  const A = useMemo(() => aggregate(e, cur, ok), [e, cur, ok]);
  const P = useMemo(() => aggregate(e, prior, ok), [e, prior, ok]);
  const hasPrior = f.period !== 'all' && prior.length > 0;
  const mechsInData = MECH_ORDER.filter((k) => e.ds.campaigns.some((c) => mechOf(c) === k));
  const filtered = JSON.stringify({ ...f, period: '' }) !== JSON.stringify({ ...DEFAULT_FILTERS, period: '' });
  const customersInView = e.records.filter((r) => ok(r.cid)).length;
  const sub = hasPrior ? `vs prior ${f.period === '3m' ? '3' : '6'} months` : `${A.campaigns} campaigns`;

  const dPct = (a: number, b: number, good: boolean | null = true) => {
    if (!hasPrior) return null;
    const t = pctChange(a, b);
    return t ? { text: t, good: good === null ? null : t.startsWith('+') === good } : null;
  };
  const dAbs = (a: number, b: number) => (hasPrior ? { text: `${a - b >= 0 ? '+' : '-'}${Math.abs(a - b).toFixed(2)}`, good: a >= b } : null);

  return (
    <>
      <PageTop
        title="Behaviour Analytics"
        sub={`How each kind of customer responds, and what past promotions delivered · ${dateLabel(isoOf(e.ds.minDay))} – ${dateLabel(isoOf(e.ds.maxDay))}`}
        tabs={<Tabs value={tab} onChange={setTab} options={[{ id: 'types', label: 'Customer types' }, { id: 'results', label: 'Promotion results' }]} />}
      />

      <div className="space-y-6 p-6">
        {tab === 'types' ? <CustomerGroups promo={<Types cur={cur} ok={ok} />} /> : <>
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] font-semibold">Filter the results</p>
            <span className="flex items-center gap-4 text-[12px] text-[var(--ink-3)]">
              <span>{A.campaigns} campaigns · {int(customersInView)} customers</span>
              {filtered && <button onClick={() => setF({ ...DEFAULT_FILTERS, period: f.period })} className="font-medium text-[var(--ink-2)] hover:text-[var(--ink)]">Clear filters</button>}
            </span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Time period"><FilterSelect value={f.period} onChange={(v) => setF({ ...f, period: v as Filters['period'] })} options={[{ value: '3m', label: 'Last 3 months' }, { value: '6m', label: 'Last 6 months' }, { value: 'all', label: 'All time' }]} /></Field>
            <Field label="Product category"><FilterSelect value={f.category} onChange={set('category')} options={[{ value: 'all', label: 'All categories' }, ...e.ds.categories.map((c) => ({ value: c, label: c }))]} /></Field>
            <Field label="Promotion type"><FilterSelect value={f.promo} onChange={set('promo')} options={[{ value: 'all', label: 'All promotion types' }, ...mechsInData.map((k) => ({ value: k, label: MECH_LABEL[k] }))]} /></Field>
            <Field label="Customer type"><FilterSelect value={f.type} onChange={set('type')} options={[{ value: 'all', label: 'All customer types' }, ...TYPES.map((t) => ({ value: t.id, label: t.name }))]} /></Field>
            <Field label={<span title="Each customer's main shopping channel: where most of their orders are placed">Main shopping channel</span>}><FilterSelect value={f.channel} onChange={set('channel')} options={[{ value: 'all', label: 'All channels' }, ...CHANNELS.map((c) => ({ value: c, label: c }))]} /></Field>
          </div>
        </section>

        {A.campaigns === 0 ? (
          <div className="card py-16 text-center text-[13px] text-[var(--ink-3)]">No campaigns match these filters. Try “All time” or clear the filters.</div>
        ) : (
          <>
            <Takeaway>{pastResultsTakeaway({ campaigns: A.campaigns, lost: perCampaign(e, cur, ok).filter((r) => roiOf(r.agg) < 0).length, cost: A.cost, incRevenue: A.incRevenue, roi: roiOf(A), incShare: incShareOf(A), units: A.units })}</Takeaway>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi help="investment" label="Promo investment" value={inr(A.cost)} delta={dPct(A.cost, P.cost, null)} note={sub} />
              <Kpi help="promoRevenue" label="Promo revenue" value={inr(A.promoRevenue)} delta={dPct(A.promoRevenue, P.promoRevenue)} note={sub} />
              <Kpi help="incRevenue" label="Incremental revenue" value={inr(A.incRevenue)} tone={A.incRevenue < 0 ? 'bad' : undefined} delta={dPct(A.incRevenue, P.incRevenue)} note={hasPrior ? sub : 'uplift vs baseline'} />
              <Kpi help="roi" emphasis label="Promo ROI" value={roiOf(A).toFixed(2)} tone={roiOf(A) < 0 ? 'bad' : 'good'} delta={dAbs(roiOf(A), roiOf(P))} note={`${inr(A.incMargin)} incremental margin ÷ ${inr(A.cost)} invested${hasPrior ? ` · ${sub}` : ''}`} />
            </div>
            <Results cur={cur} ok={ok} A={A} />
          </>
        )}
        </>}
      </div>
    </>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--ink-2)]">{label}</span>{children}</label>;
}

/** a titled card: plain title, one helpful sentence, optional controls on the right */
function Block({ title, sub, right, children, className = '' }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-[640px]">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          {sub && <p className="mt-1 text-[12.5px] leading-snug text-[var(--ink-3)]">{sub}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricSelect({ value, onChange, keys }: { value: MetricKey; onChange: (k: MetricKey) => void; keys: MetricKey[] }) {
  return <FilterSelect value={value} onChange={(v) => onChange(v as MetricKey)} options={keys.map((k) => ({ value: k, label: `Show: ${METRICS[k].label}` }))} />;
}

function More({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]">
      {children}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

// ============================================================================ PROMOTION RESULTS
function Results({ cur, ok, A }: { cur: Campaign[]; ok: (cid: string) => boolean; A: Agg }) {
  const e = useEngine();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [campMetric, setCampMetric] = useState<MetricKey>('roi');
  const [typeMetric, setTypeMetric] = useState<MetricKey>('roi');
  const [allTypes, setAllTypes] = useState(false);
  const rows = useMemo(() => perCampaign(e, cur, ok), [e, cur, ok]);
  const types = useMemo(() => MECH_ORDER.map((k) => {
    const camps = cur.filter((c) => mechOf(c) === k);
    return { key: k, camps: camps.length, a: aggregate(e, camps, ok) };
  }).filter((g) => g.camps > 0), [e, cur, ok]);
  const M = METRICS[campMetric];
  const T = METRICS[typeMetric];
  const rankedTypes = [...types].sort((x, y) => T.get(y.a) - T.get(x.a));
  const shownTypes = allTypes ? rankedTypes : rankedTypes.slice(0, 5);
  const maxAbs = Math.max(1e-9, ...shownTypes.map((t) => Math.abs(T.get(t.a))));
  const hasNeg = shownTypes.some((t) => T.get(t.a) < 0);
  const zero = hasNeg ? 50 : 0, span = hasNeg ? 50 : 100;

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Block title="How each campaign performed" sub={`Each dot is one campaign: what it cost (across) and its ${M.phrase} (up). Hover a dot for details.`}
          right={<><MetricSelect value={campMetric} onChange={setCampMetric} keys={['roi', 'incRevenue', 'resp']} /><ViewToggle value={view} onChange={setView} /></>}>
          {view === 'chart' ? (
            <>
              <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[var(--ink-2)]">
                {([['High performer', 'paid back well (ROI 0.5+)'], ['Needs improvement', 'just paid back (ROI 0 to 0.5)'], ['Low performer', 'did not pay back (ROI below 0)']] as const).map(([k, t]) => (
                  <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: VERDICT[k] }} /><b className="font-semibold">{k}</b> {t}</span>
                ))}
              </div>
              <Scatter height={380} xLabel="Promo investment" yLabel={M.short} xFormat={(v) => inr(v, 0)} yFormat={M.fmt}
                dots={rows.map(({ campaign: c, agg }) => {
                  const roi = roiOf(agg);
                  return {
                    x: agg.cost, y: M.get(agg), color: VERDICT[verdictOf(roi)], r: 6 + Math.sqrt(agg.buyers) * 0.5,
                    tip: <><b>{c.name}</b><div>{c.category} · {offerOfCampaign(c)}</div><div>Investment {inr(agg.cost)} · ROI {roi.toFixed(2)} · {verdictOf(roi)}</div><div>Incremental revenue {inr(agg.incRevenue)} · {pct(respOf(agg))} redemption</div></>,
                  };
                })} />
            </>
          ) : (
            <div className="-mx-5 max-h-[380px] overflow-auto">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead className="sticky top-0 bg-white"><tr className="border-y border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                  {['Campaign', 'Offer', 'Investment', M.short, ...(campMetric === 'roi' ? [] : ['ROI']), 'Result'].map((h, i, all) => <th key={h + i} className={`px-3 py-2.5 ${i < 2 ? 'text-left' : ''} ${i === 0 ? 'pl-5' : ''} ${i === all.length - 1 ? 'pr-5' : ''}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {[...rows].sort((a, b) => M.get(b.agg) - M.get(a.agg)).map(({ campaign: c, agg }) => {
                    const roi = roiOf(agg);
                    const v = verdictOf(roi);
                    return (
                      <tr key={c.id} className="border-b border-[var(--line-2)] text-right last:border-0">
                        <td className="py-2.5 pl-5 pr-3 text-left"><p className="font-semibold">{c.name}</p><p className="text-[11px] text-[var(--ink-3)]">{c.category} · {shortDate(isoOf(c.start))}</p></td>
                        <td className="px-3 text-left">{offerOfCampaign(c)}</td>
                        <td className="num px-3">{inr(agg.cost)}</td>
                        <td className="num px-3" style={{ color: M.good(M.get(agg)) ? undefined : 'var(--red)' }}>{M.fmt(M.get(agg))}</td>
                        {campMetric !== 'roi' && <td className="num px-3 font-semibold" style={{ color: roiColor(roi) }}>{roi.toFixed(2)}</td>}
                        <td className="px-3 pr-5"><Chip tone={VERDICT_TONE[v]}>{v}</Chip></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Block>

        <Block title={<>Where the return comes from<Help term="incMargin" /></>} sub="Units sold during the promotions, split into what customers would have bought anyway (baseline) and the extra sales the promotions caused (uplift).">
          <ReturnWaterfall A={A} cur={cur} ok={ok} />
        </Block>
      </div>

      <Block title="Which promotion types work best" sub={`Promotion types ranked by ${T.phrase}. Hover a row to see how the promotion works.`}
        right={<MetricSelect value={typeMetric} onChange={setTypeMetric} keys={['roi', 'resp', 'incRevenue', 'uplift']} />}>
        <div className="space-y-1">
          {shownTypes.map((g, i) => {
            const v = T.get(g.a);
            const w = (Math.abs(v) / maxAbs) * span;
            return (
              <div key={g.key} className="grid grid-cols-[minmax(160px,230px)_1fr_120px] items-center gap-5 rounded-lg px-3 py-2.5 hover:bg-[var(--page)]" title={MECH_HOW[g.key]}>
                <div className="min-w-0"><p className="truncate text-[13px] font-semibold">{MECH_LABEL[g.key]}{i === 0 && <span className="ml-2 align-middle"><Chip tone="green">Best</Chip></span>}</p><p className="text-[11.5px] text-[var(--ink-3)]">{g.camps} campaign{g.camps > 1 ? 's' : ''} · {inr(g.a.cost, 0)} invested</p></div>
                <div className="relative h-4">
                  <div className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ left: `${zero}%` }} />
                  <div className="absolute inset-y-0 rounded" style={{ left: v >= 0 ? `${zero}%` : `${zero - w}%`, width: `${Math.max(0.6, w)}%`, background: T.good(v) ? 'var(--green)' : 'var(--red)' }} />
                </div>
                <p className="num text-right text-[14px] font-bold" style={{ color: typeMetric === 'roi' ? roiColor(v) : T.good(v) ? 'var(--ink)' : 'var(--red)' }}>{T.fmt(v)}</p>
              </div>
            );
          })}
        </div>
        {rankedTypes.length > 5 && <More open={allTypes} onClick={() => setAllTypes(!allTypes)}>{allTypes ? 'Show top 5 only' : `Show all ${rankedTypes.length} promotion types`}</More>}
      </Block>
    </>
  );
}

/** Total promo sales = baseline + uplift, overall or drilled down brand -> category -> SKU; ROI and the full breakdown one click away */
function ReturnWaterfall({ A, cur, ok }: { A: Agg; cur: Campaign[]; ok: (cid: string) => boolean }) {
  const e = useEngine();
  const [open, setOpen] = useState(false);
  const skus = useMemo(() => skuSales(e, cur, ok), [e, cur, ok]);
  const { level, picked, label: scope, controls } = useProductScope(skus, { overall: 'all promotions' });
  const total = picked.reduce((t, s) => t + s.total, 0);
  const base = picked.reduce((t, s) => t + s.base, 0);
  const uplift = total - base;

  const cost = A.cost;
  const inc = A.incMargin;
  const roi = roiOf(A);
  const paid = inc >= 0;
  const C = { total: 'var(--navy)', base: '#94a3b8', uplift: uplift >= 0 ? 'var(--green)' : 'var(--red)' };
  const rows: [string, string, string][] = [
    ['Baseline units', int(A.base), 'what customers would have bought anyway, with no promotion'],
    ['Units sold in promotion windows', int(A.units), 'baseline + uplift'],
    ['Uplift units', int(A.inc), `${pct(incShareOf(A))} of promotion-window units`],
    ['Incremental revenue', inr(A.incRevenue, 0), 'revenue above the baseline, after discounts'],
    ['Promo cost', inr(cost, 0), 'discounts given + loyalty points redeemed'],
    ['  of which subsidy', inr(A.leak, 0), `${pct(leakOf(A))} of promo cost went on baseline sales`],
    ['Incremental margin', inr(inc, 0), 'margin above the baseline, after the promo cost'],
    ['Promo ROI', roi.toFixed(2), 'incremental margin ÷ promo cost'],
  ];
  return (
    <div>
      <div className="mb-3">{controls}</div>
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-[var(--ink-2)]">
        {([['Total promo sales', C.total], ['Baseline', C.base], ['Uplift', C.uplift]] as const).map(([l, col]) => (
          <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: col }} />{l}</span>
        ))}
      </div>
      {total > 0 ? (
        <Waterfall height={300} format={(v) => int(v)} steps={[
          { label: 'Total promo\nsales', value: total, kind: 'total', color: C.total, note: `Units sold during the promotions (${scope}): baseline plus uplift` },
          { label: 'Baseline', value: base, kind: 'total', color: C.base, note: 'Units customers would have bought anyway, with no promotion' },
          { label: 'Uplift', value: uplift, kind: 'total', color: C.uplift, note: `Extra units caused by the promotions (${pct(total ? uplift / total : 0)} of promo sales)` },
        ]} />
      ) : <p className="py-16 text-center text-[13px] text-[var(--ink-3)]">No promotion sales for {scope || 'this selection'} in the current filters.</p>}
      <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">
        Showing {scope}.{level === 'sku' && ' The baseline is estimated per customer for the category, then split across its SKUs by their normal (non-promotion) sales mix.'} Promo ROI and the breakdown below cover all campaigns in the filters.
      </p>
      <p className="mt-3 rounded-lg px-3.5 py-2.5 text-[13px] font-semibold" style={{ background: paid ? 'var(--green-bg)' : 'var(--red-bg)', color: paid ? 'var(--green-dark)' : '#b91c1c' }}>
        Promo ROI {roi.toFixed(2)} = {inr(inc, 0)} incremental margin ÷ {inr(cost, 0)} promo cost
        <span className="mt-0.5 block text-[12px] font-normal">{paid ? `Every ₹1 of promo cost earned it back plus ₹${roi.toFixed(2)}.` : 'The uplift did not cover the promo cost.'}</span>
      </p>
      <More open={open} onClick={() => setOpen(!open)}>{open ? 'Hide the breakdown' : 'See the full breakdown (baseline, uplift, subsidy)'}</More>
      {open && (
        <dl className="mt-3 divide-y divide-[var(--line-2)] rounded-lg border border-[var(--line)]">
          {rows.map(([k, v, n]) => (
            <div key={k} className="grid grid-cols-[1fr_auto] gap-x-4 px-3.5 py-2">
              <dt className={`text-[12.5px] ${k.startsWith('  ') ? 'pl-3 text-[var(--ink-3)]' : 'font-semibold'}`}>{k.trim()}<span className="block text-[11.5px] font-normal text-[var(--ink-3)]">{n}</span></dt>
              <dd className="num self-center text-right text-[13px] font-bold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ============================================================================ CUSTOMER TYPES
function Types({ cur, ok }: { cur: Campaign[]; ok: (cid: string) => boolean }) {
  const e = useEngine();
  const [focus, setFocus] = useState<TypeId>('persuadable');
  const [metric, setMetric] = useState<'resp' | 'roi'>('resp');
  const [grid, setGrid] = useState(false);
  const [allDrivers, setAllDrivers] = useState(false);
  const drivers = useMemo(() => driversOf(e), [e]);

  const groups = useMemo(() => {
    const totalSpend = e.records.reduce((t, r) => t + r.b.totalSpend, 0) || 1;
    return TYPES.map((t) => {
      const ids = new Set(e.records.filter((r) => r.type === t.id && ok(r.cid)).map((r) => r.cid));
      const spend = e.records.filter((r) => ids.has(r.cid)).reduce((s, r) => s + r.b.totalSpend, 0);
      return { t, ids, n: ids.size, spendShare: spend / totalSpend, a: aggregate(e, cur, (cid) => ids.has(cid)) };
    }).filter((g) => g.n > 0);
  }, [e, cur, ok]);

  const mechs = MECH_ORDER.filter((k) => cur.some((c) => mechOf(c) === k));
  const cell = useMemo(() => {
    const m = new Map<string, Agg | null>();
    for (const g of groups) for (const k of mechs) {
      const a = aggregate(e, cur.filter((c) => mechOf(c) === k), (cid) => g.ids.has(cid));
      m.set(`${g.t.id}|${k}`, a.reached >= 8 ? a : null);
    }
    return m;
  }, [groups, mechs, e, cur]);
  const get = (t: TypeId, k: MechKey) => cell.get(`${t}|${k}`) ?? null;
  const val = (a: Agg | null) => (a ? (metric === 'resp' ? respOf(a) : roiOf(a)) : null);
  const focusType = groups.some((g) => g.t.id === focus) ? focus : groups[0]?.t.id ?? 'persuadable';
  const focusRows = mechs.map((k) => ({ k, a: get(focusType, k) })).filter((x) => x.a).sort((x, y) => val(y.a)! - val(x.a)!);
  const focusMax = Math.max(1e-9, ...focusRows.map((x) => Math.abs(val(x.a)!)));

  const shownDrivers = allDrivers ? drivers : drivers.slice(0, 3);
  const dMax = Math.max(...drivers.flatMap((x) => x.bands.map((b) => b.rate)), 0.01);

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Block title={`Which promotions work for ${TYPE_BY_ID[focusType].name}`} sub="What past campaigns actually achieved with this customer type, best first. Pick another type or metric to compare."
          right={<>
            <FilterSelect value={focusType} onChange={(v) => setFocus(v as TypeId)} options={groups.map((g) => ({ value: g.t.id, label: g.t.name }))} />
            <FilterSelect value={metric} onChange={(v) => setMetric(v as 'resp' | 'roi')} options={[{ value: 'resp', label: 'Show: Redemption rate' }, { value: 'roi', label: 'Show: Promo ROI' }]} />
          </>}>
          {focusRows.length ? (
            <div className="space-y-2.5">
              {focusRows.map(({ k, a }, i) => {
                const v = val(a)!;
                return (
                  <div key={k} className="grid grid-cols-[minmax(140px,190px)_1fr_64px] items-center gap-4" title={MECH_HOW[k]}>
                    <span className="truncate text-[13px] font-medium">{MECH_LABEL[k]}</span>
                    <div className="h-3.5 rounded bg-[var(--line-2)]"><div className="h-full rounded" style={{ width: `${Math.max(1.5, (Math.abs(v) / focusMax) * 100)}%`, background: v < 0 ? 'var(--red)' : i === 0 ? 'var(--green)' : 'var(--navy)', opacity: i === 0 || v < 0 ? 1 : 0.7 }} /></div>
                    <span className="num text-right text-[13px] font-bold" style={{ color: metric === 'roi' ? roiColor(v) : undefined }}>{metric === 'resp' ? pct(v) : v.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="py-8 text-center text-[13px] text-[var(--ink-3)]">Too few customers of this type in the filtered campaigns to read.</p>}
          <More open={grid} onClick={() => setGrid(!grid)}>{grid ? 'Hide comparison' : 'Compare all customer types side by side'}</More>
          {grid && (
            <div className="mt-3">
              <FitHeat rows={groups.map((g) => g.t.name)} cols={mechs.map((k) => MECH_LABEL[k].replace(' (Points)', '').replace(' on Min Spend', ''))} rowW={120}
                value={(r, c) => val(get(groups[r].t.id, mechs[c])) ?? -99}
                color={(v) => (v === -99 ? '#f6f7f9' : metric === 'resp' ? rateFill(v) : roiFill(v))}
                label={(v) => (v === -99 ? '–' : metric === 'resp' ? `${Math.round(v * 100)}%` : v.toFixed(1))}
                tip={(r, c) => { const a = get(groups[r].t.id, mechs[c]); return <><b>{groups[r].t.name} · {MECH_LABEL[mechs[c]]}</b>{a ? <div>Redemption {pct(respOf(a))} · ROI {roiOf(a).toFixed(2)}</div> : <div>Too few customers to read</div>}</>; }} />
            </div>
          )}
        </Block>

        <Block title="What predicts a response" sub="Customers split into five equal groups on each behaviour, from lowest to highest. Taller bars mean more of that group bought on the offer.">
          <div className="space-y-4">
            {shownDrivers.map((d) => (
              <div key={d.key} className="flex items-center gap-4" title={d.bands.map((b, i) => `Group ${i + 1}: ${pct(b.rate)}`).join(' · ')}>
                <div className="w-[180px] shrink-0">
                  <p className="text-[13px] font-semibold">{d.label}</p>
                  <p className="text-[11.5px] text-[var(--ink-3)]">{d.direction === 'higher' ? 'Higher → responds more' : d.direction === 'lower' ? 'Higher → responds less' : 'No simple pattern'}</p>
                </div>
                <div className="flex h-10 flex-1 items-end gap-[3px]">
                  {d.bands.map((b, i) => <div key={i} className="flex-1 rounded-t" style={{ height: `${Math.max(6, (b.rate / dMax) * 100)}%`, background: 'var(--navy)', opacity: 0.35 + 0.13 * i }} />)}
                </div>
                <span className="num w-[72px] shrink-0 text-right text-[12px] text-[var(--ink-2)]">{pct(d.bands[0].rate)} → <b>{pct(d.bands[4].rate)}</b></span>
              </div>
            ))}
          </div>
          {drivers.length > 3 && <More open={allDrivers} onClick={() => setAllDrivers(!allDrivers)}>{allDrivers ? 'Show the top 3 only' : `Show all ${drivers.length} behaviours`}</More>}
          <p className="mt-4 text-[12px] leading-snug text-[var(--ink-3)]">Past response is the strongest signal: the most responsive fifth redeemed {pct(drivers[0]?.bands[4].rate ?? 0)} of offers, the least responsive {pct(drivers[0]?.bands[0].rate ?? 0)}. Measured across all customers.</p>
        </Block>
      </div>
    </>
  );
}

/** heat map with cells sized to fill the panel */
function FitHeat(props: Omit<ComponentProps<typeof Heat>, 'cell'>) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = props.cols.length;
  const cell = Math.max(56, Math.min(120, Math.floor((w - (props.rowW ?? 150) - 6 * n - 6) / Math.max(1, n))));
  return <div ref={ref}><Heat {...props} cell={cell} /></div>;
}

export function PageTop({ title, sub, right, tabs }: { title: string; sub: string; right?: ReactNode; tabs?: ReactNode }) {
  return (
    <div className={`border-b border-[var(--line)] bg-white px-6 pt-4 ${tabs ? 'pb-0' : 'pb-4'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">{sub}</p>
        </div>
        {right}
      </div>
      {tabs && <div className="mt-3">{tabs}</div>}
    </div>
  );
}
