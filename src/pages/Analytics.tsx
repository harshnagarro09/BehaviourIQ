import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Takeaway } from '@/components/Takeaway';
import { CustomerGroups, Drivers } from '@/pages/CustomerGroups';
import { ReturnBreakdown } from '@/pages/ReturnBreakdown';
import { resultsInsight } from '@/lib/takeaways';
import { useApp, useEngine } from '@/state';
import { Help } from '@/components/Help';
import { Chip, FilterSelect, Kpi, NextStep, Tabs, ViewToggle } from '@/components/ui';
import { FitHeat, Scatter } from '@/components/charts';
import { TYPES } from '@/engine/segments';
import { offerName } from '@/engine/options';
import { MECH_HOW, MECH_LABEL, MECH_ORDER } from '@/engine/mechanics';
import {
  aggregate, aggregateByCampaign, customerFilter, DEFAULT_FILTERS, incShareOf, mechOf, sumAggs,
  perCampaign, pctChange, respOf, roiOf, selectCampaigns, verdictOf, type Agg, type Filters,
} from '@/lib/analytics';
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
  roi: { label: 'ROI', phrase: 'ROI (extra profit per ₹1)', short: 'ROI', get: roiOf, fmt: (v) => v.toFixed(2), help: 'roi', good: (v) => v >= 0 },
  incRevenue: { label: 'Extra sales', phrase: 'extra sales', short: 'Extra sales', get: (a) => a.incRevenue, fmt: (v) => inr(v, 0), help: 'incRevenue', good: (v) => v >= 0 },
  resp: { label: 'Redemption rate', phrase: 'redemption rate', short: 'Redemption', get: respOf, fmt: (v) => pct(v), help: 'redemption', good: () => true },
  uplift: { label: 'Extra units share', phrase: 'share of units that were extra', short: 'Extra units', get: incShareOf, fmt: (v) => pct(v), help: 'uplift', good: (v) => v >= 0 },
};

type Tab = 'types' | 'results';

export function Analytics() {
  const e = useEngine();
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const { params, syncParams, go } = useApp();
  const [tab, setTabState] = useState<Tab>(() => (params.tab === 'results' ? 'results' : 'types'));
  const setTab = (t: Tab) => { setTabState(t); syncParams({ tab: t }); document.getElementById('main-scroll')?.scrollTo({ top: 0 }); };
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
        sub={`Who your customers are, what they buy, and how past promotions performed · ${dateLabel(isoOf(e.ds.minDay))} – ${dateLabel(isoOf(e.ds.maxDay))}`}
        tabs={<Tabs value={tab} onChange={setTab} options={[{ id: 'types', label: 'Customer types' }, { id: 'results', label: 'Promotion results' }]} />}
      />

      <div className="space-y-6 p-6">
        {tab === 'types' ? <CustomerGroups onNext={() => setTab('results')} /> : <>
        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[14px] font-semibold">Which promotions to look at</p>
              <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">These filters apply to every number and chart on this tab.</p>
            </div>
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
            <Takeaway>{resultsInsight(perCampaign(e, cur, ok).map(({ campaign: c, agg }) => ({ name: c.name, category: c.category, roi: roiOf(agg), cost: agg.cost })), A.units)}</Takeaway>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi help="investment" label="Promotion cost" value={inr(A.cost)} delta={dPct(A.cost, P.cost, null)} note={sub} />
              <Kpi help="promoRevenue" label="Promotion sales" value={inr(A.promoRevenue)} delta={dPct(A.promoRevenue, P.promoRevenue)} note={sub} />
              <Kpi help="incRevenue" label="Extra sales" value={inr(A.incRevenue)} tone={A.incRevenue < 0 ? 'bad' : undefined} delta={dPct(A.incRevenue, P.incRevenue)} note={hasPrior ? sub : 'above what customers would buy anyway'} />
              <Kpi help="roi" emphasis label="ROI" value={roiOf(A).toFixed(2)} tone={roiOf(A) < 0 ? 'bad' : 'good'} delta={dAbs(roiOf(A), roiOf(P))} note={hasPrior ? sub : `${inr(A.incMargin)} extra profit ÷ ${inr(A.cost)} cost`} />
            </div>
            <Results cur={cur} ok={ok} />
          </>
        )}
        <NextStep text="Use what worked to choose who to target with the next promotion." action="Find customers" onClick={() => go('customers', { tab: 'find' })} />
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
        <div className="min-w-0 max-w-[720px]">
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
// Storyline: how each campaign did and where its return came from -> what worked best, by promotion type and by customer group.
function Results({ cur, ok }: { cur: Campaign[]; ok: (cid: string) => boolean }) {
  const e = useEngine();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [campMetric, setCampMetric] = useState<MetricKey>('roi');
  const [typeMetric, setTypeMetric] = useState<MetricKey>('roi');
  const [allTypes, setAllTypes] = useState(false);
  const [by, setBy] = useState<'types' | 'groups'>('types');
  const rows = useMemo(() => perCampaign(e, cur, ok), [e, cur, ok]);
  const types = useMemo(() => MECH_ORDER.map((k) => {
    const camps = cur.filter((c) => mechOf(c) === k);
    return { key: k, camps: camps.length, a: aggregate(e, camps, ok) };
  }).filter((g) => g.camps > 0), [e, cur, ok]);
  const M = METRICS[campMetric];
  const T = METRICS[typeMetric];
  const rankedTypes = [...types].sort((x, y) => T.get(y.a) - T.get(x.a));
  const shownTypes = allTypes ? rankedTypes : rankedTypes.slice(0, 6);
  const maxAbs = Math.max(1e-9, ...shownTypes.map((t) => Math.abs(T.get(t.a))));
  const hasNeg = shownTypes.some((t) => T.get(t.a) < 0);
  const zero = hasNeg ? 50 : 0, span = hasNeg ? 50 : 100;
  // name the best two and worst two campaigns on the chosen metric, so the chart reads without hovering
  const byMetric = [...rows].sort((a, b) => M.get(b.agg) - M.get(a.agg));
  const labelled = new Set((byMetric.length <= 4 ? byMetric : [...byMetric.slice(0, 2), ...byMetric.slice(-2)]).map((r) => r.campaign.id));

  return (
    <>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
        <Block title="How each campaign performed" sub={`Each dot is one campaign: what it cost (across) and its ${M.phrase} (up). Hover a dot for details.`}
          right={<><MetricSelect value={campMetric} onChange={setCampMetric} keys={['roi', 'incRevenue', 'resp']} /><ViewToggle value={view} onChange={setView} /></>}>
          {view === 'chart' ? (
            <>
              {campMetric === 'roi' ? (
                <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[var(--ink-2)]">
                  {([['High performer', 'ROI 0.5+'], ['Needs improvement', 'ROI 0 to 0.5'], ['Low performer', 'ROI below 0']] as const).map(([k, t]) => (
                    <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: VERDICT[k] }} /><b className="font-semibold">{k}</b> {t}</span>
                  ))}
                </div>
              ) : <p className="mb-2 text-[12px] text-[var(--ink-3)]">Showing {M.phrase}. Switch to ROI to colour campaigns by whether they paid back.</p>}
              <Scatter height={340} xLabel="Promotion cost (scale compressed so small campaigns spread out)" yLabel={M.short} xFormat={(v) => inr(v, 0)} yFormat={M.fmt}
                xScale="sqrt" refY={campMetric === 'roi' ? { value: 0, label: 'Break-even' } : campMetric === 'incRevenue' ? { value: 0, label: 'No extra sales' } : undefined}
                dots={rows.map(({ campaign: c, agg }) => {
                  const roi = roiOf(agg);
                  return {
                    x: agg.cost, y: M.get(agg), color: campMetric === 'roi' ? VERDICT[verdictOf(roi)] : 'var(--navy)', r: 6 + Math.sqrt(agg.buyers) * 0.5,
                    label: labelled.has(c.id) ? c.name : undefined,
                    tip: <><b>{c.name}</b><div>{c.category} · {offerOfCampaign(c)}</div><div>Promotion cost {inr(agg.cost)} · ROI {roi.toFixed(2)} · {verdictOf(roi)}</div><div>Extra sales {inr(agg.incRevenue)} · {pct(respOf(agg))} redemption</div></>,
                  };
                })} />
            </>
          ) : (
            <div className="-mx-5 max-h-[400px] overflow-auto">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead className="sticky top-0 bg-white"><tr className="border-y border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                  {['Campaign', 'Offer', 'Promotion cost', M.short, ...(campMetric === 'roi' ? [] : ['ROI']), 'Result'].map((h, i, all) => <th key={h + i} className={`px-3 py-2.5 ${i < 2 ? 'text-left' : ''} ${i === 0 ? 'pl-5' : ''} ${i === all.length - 1 ? 'pr-5' : ''}`}>{h}</th>)}
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

        <Block title="What worked best" sub={by === 'types' ? `Promotion types ranked by ${T.phrase}. Hover a row to see how the promotion works.` : `How each customer group responded to these promotions, by ${T.phrase}.`}
            right={<><Seg value={by} onChange={setBy} options={[{ id: 'types', label: 'Promotion types' }, { id: 'groups', label: 'Customer groups' }]} /><MetricSelect value={typeMetric} onChange={setTypeMetric} keys={['roi', 'resp', 'incRevenue', 'uplift']} /></>}>
            {by === 'groups' ? <GroupView cur={cur} ok={ok} metric={typeMetric} /> : <>
            <div className="space-y-1">
              {shownTypes.map((g, i) => {
                const v = T.get(g.a);
                const w = (Math.abs(v) / maxAbs) * span;
                return (
                  <div key={g.key} className="grid grid-cols-[minmax(130px,190px)_1fr_64px] items-center gap-4 rounded-lg px-2 py-2 hover:bg-[var(--page)]" title={MECH_HOW[g.key]}>
                    <div className="min-w-0"><p className="truncate text-[13px] font-semibold">{MECH_LABEL[g.key]}{i === 0 && <span className="ml-2 align-middle"><Chip tone="green">Best</Chip></span>}</p><p className="text-[11.5px] text-[var(--ink-3)]">{g.camps} campaign{g.camps > 1 ? 's' : ''} · {inr(g.a.cost, 0)} cost</p></div>
                    <div className="relative h-3.5">
                      <div className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ left: `${zero}%` }} />
                      <div className="absolute inset-y-0 rounded" style={{ left: v >= 0 ? `${zero}%` : `${zero - w}%`, width: `${Math.max(0.6, w)}%`, background: T.good(v) ? 'var(--green)' : 'var(--red)' }} />
                    </div>
                    <p className="num text-right text-[14px] font-bold" style={{ color: typeMetric === 'roi' ? roiColor(v) : T.good(v) ? 'var(--ink)' : 'var(--red)' }}>{T.fmt(v)}</p>
                  </div>
                );
              })}
            </div>
            {rankedTypes.length > 6 && <More open={allTypes} onClick={() => setAllTypes(!allTypes)}>{allTypes ? 'Show top 6 only' : `Show all ${rankedTypes.length} promotion types`}</More>}
            </>}
          </Block>
        </div>

        <Block title={<>Where the return comes from<Help term="incrementality" /></>}
          sub="Units sold during the promotions, split into what customers would have bought anyway (baseline) and the extra sales the promotions caused (uplift).">
          <ReturnBreakdown cur={cur} ok={ok} />
        </Block>
      </div>
    </>
  );
}


/** the small switch used on this page */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-9 items-center rounded-lg border border-[var(--line)] bg-[var(--page)] p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`h-full whitespace-nowrap rounded-md px-3 text-[12px] font-semibold transition-colors ${value === o.id ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink)]'}`}>{o.label}</button>
      ))}
    </div>
  );
}

/** below this many reached customers, a result is not read */
const MIN_REACH = 8;

/**
 * How each customer group responded to the promotions in view (same filters as the page): one bar per group, the promotion
 * type that worked best for it, the full group x promotion-type grid, and which behaviours predict a response.
 */
function GroupView({ cur, ok, metric }: { cur: Campaign[]; ok: (cid: string) => boolean; metric: MetricKey }) {
  const e = useEngine();
  const T = METRICS[metric];
  const [grid, setGrid] = useState(false);
  const [why, setWhy] = useState(false);
  const mechs = useMemo(() => MECH_ORDER.filter((k) => cur.some((c) => mechOf(c) === k)), [cur]);
  const groups = useMemo(() => TYPES.map((t) => {
    const byCamp = aggregateByCampaign(e, cur, (cid) => ok(cid) && e.typeOf.get(cid) === t.id);
    return {
      t, a: sumAggs([...byCamp.values()]),
      cells: mechs.map((k) => sumAggs(cur.filter((c) => mechOf(c) === k).map((c) => byCamp.get(c.id)!))),
      customers: e.records.filter((r) => r.type === t.id && ok(r.cid)).length,
    };
  }).filter((g) => g.customers > 0), [e, cur, ok, mechs]);
  const readable = groups.filter((g) => g.a.reached >= MIN_REACH);
  const vals = readable.map((g) => T.get(g.a));
  const maxAbs = Math.max(1e-9, ...vals.map(Math.abs));
  const neg = vals.some((v) => v < 0);
  const zero = neg ? 50 : 0, span = neg ? 50 : 100;
  const ranked = [...readable].sort((x, y) => T.get(y.a) - T.get(x.a));
  if (!readable.length) return <p className="py-8 text-center text-[12.5px] text-[var(--ink-3)]">Too few customers were reached by these promotions to compare groups.</p>;
  return (
    <div>
      {ranked.length > 1 && <p className="mb-2 text-[12.5px] text-[var(--ink)]"><b>{ranked[0].t.name}</b> responded best ({T.fmt(T.get(ranked[0].a))}), <b>{ranked[ranked.length - 1].t.name}</b> least ({T.fmt(T.get(ranked[ranked.length - 1].a))}).</p>}
      <div className="space-y-1">
        {groups.map((g) => {
          const ok8 = g.a.reached >= MIN_REACH;
          const v = T.get(g.a);
          const w = (Math.abs(v) / maxAbs) * span;
          const best = g.cells.map((a, i) => ({ k: mechs[i], a })).filter((x) => x.a.reached >= MIN_REACH).sort((x, y) => T.get(y.a) - T.get(x.a))[0];
          return (
            <div key={g.t.id} className="grid grid-cols-[minmax(130px,190px)_1fr_64px] items-center gap-4 rounded-lg px-2 py-2" title={g.t.tagline}>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.t.color }} />{g.t.name}</p>
                <p className="truncate text-[11.5px] text-[var(--ink-3)]">{ok8 && best ? <>Best: {MECH_LABEL[best.k]} ({T.fmt(T.get(best.a))})</> : `${int(g.customers)} customers · too few reached`}</p>
              </div>
              <div className="relative h-3.5">
                {ok8 && <>
                  <div className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ left: `${zero}%` }} />
                  <div className="absolute inset-y-0 rounded" style={{ left: v >= 0 ? `${zero}%` : `${zero - w}%`, width: `${Math.max(0.6, w)}%`, background: T.good(v) ? 'var(--green)' : 'var(--red)' }} />
                </>}
              </div>
              <p className="num text-right text-[14px] font-bold" style={{ color: !ok8 ? 'var(--ink-3)' : metric === 'roi' ? roiColor(v) : T.good(v) ? 'var(--ink)' : 'var(--red)' }}>{ok8 ? T.fmt(v) : '–'}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--line-2)] pt-3">
        <More open={grid} onClick={() => setGrid(!grid)}>{grid ? 'Hide' : 'Compare by promotion type'}</More>
        <More open={why} onClick={() => setWhy(!why)}>{why ? 'Hide' : 'What makes a customer respond?'}</More>
      </div>
      {grid && (
        <div className="mt-3">
          <p className="mb-2 text-[11.5px] text-[var(--ink-3)]">{T.label} by customer group and promotion type. “–” means too few customers to read.</p>
          <FitHeat rows={groups.map((g) => g.t.name)} cols={mechs.map((k) => MECH_LABEL[k].replace(' (Points)', '').replace(' on Min Spend', ''))} rowW={110}
            value={(r, c) => { const a = groups[r].cells[c]; return a.reached >= MIN_REACH ? T.get(a) : -99; }}
            color={(v) => (v === -99 ? '#f6f7f9' : metric === 'roi' ? roiFill(v) : rateFill(Math.max(0, v)))}
            label={(v) => (v === -99 ? '–' : metric === 'roi' ? v.toFixed(1) : metric === 'incRevenue' ? inr(v, 0) : `${Math.round(v * 100)}%`)}
            tip={(r, c) => { const a = groups[r].cells[c]; return <><b>{groups[r].t.name} · {MECH_LABEL[mechs[c]]}</b>{a.reached >= MIN_REACH ? <div>Redemption {pct(respOf(a))} · ROI {roiOf(a).toFixed(2)} · {int(a.reached)} reached</div> : <div>Too few customers to read</div>}</>; }} />
        </div>
      )}
      {why && <Drivers />}
    </div>
  );
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
