import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Takeaway } from '@/components/Takeaway';
import { behaviourTakeaway, pastResultsTakeaway } from '@/lib/takeaways';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Help, Lbl } from '@/components/Help';
import { Chip, FilterSelect, Kpi, Meter, Panel, Tabs, Toggle, ViewToggle } from '@/components/ui';
import { BarChart, Heat, Scatter, useWidth } from '@/components/charts';
import { TYPES } from '@/engine/segments';
import { offerName } from '@/engine/options';
import {
  aggregate, customerFilter, DEFAULT_FILTERS, incShareOf, leakOf, mechOf, perCampaign, pctChange, respOf, roiOf, selectCampaigns, verdictOf,
  type Agg, type Filters,
} from '@/lib/analytics';
import { inr, int, pct, dateLabel, shortDate } from '@/lib/fmt';
import { isoOf, type Campaign } from '@/engine/data';
import { TypeCards } from '@/components/AnalyticsStory';

const VERDICT = { Scale: 'var(--green)', Optimise: 'var(--amber)', Stop: 'var(--red)' } as const;
const offerOfCampaign = (c: Campaign) => offerName(c.mechanic, c.depth, c.flat, c.minSpend);

type FeatRow = { n: number; freq: number; rec: number; spend: number; aov: number; basket: number; promo: number; resp: number; weekend: number; fullPrice: number; a: Agg };
const FEAT_METRICS: { key: string; label: string; get: (g: FeatRow) => number; fmt: (v: number) => string }[] = [
  { key: 'resp', label: 'Promo response', get: (g) => g.resp, fmt: (v) => pct(v) },
  { key: 'roi', label: 'Promo ROI', get: (g) => roiOf(g.a), fmt: (v) => v.toFixed(2) },
  { key: 'net', label: 'Net promo profit', get: (g) => g.a.net, fmt: (v) => inr(v, 0) },
  { key: 'promo', label: 'Purchases on promo', get: (g) => g.promo, fmt: (v) => pct(v) },
  { key: 'freq', label: 'Orders per month', get: (g) => g.freq, fmt: (v) => v.toFixed(1) },
  { key: 'aov', label: 'Order value', get: (g) => g.aov, fmt: (v) => inr(v, 0) },
  { key: 'fullPrice', label: 'Full-price buys per month', get: (g) => g.fullPrice, fmt: (v) => v.toFixed(1) },
];
const shortName = (n: string) => n;

type Tab = 'results' | 'behaviour';

export function Analytics() {
  const e = useEngine();
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const { params, syncParams } = useApp();
  const [tab, setTabState] = useState<Tab>(() => (params.tab === 'behaviour' ? 'behaviour' : 'results'));
  const setTab = (t: Tab) => { setTabState(t); syncParams({ tab: t }); };
  const [featView, setFeatView] = useState<'chart' | 'table'>('chart');
  const [featMetric, setFeatMetric] = useState('roi');
  const [perfView, setPerfView] = useState<'chart' | 'table'>('chart');
  const set = (k: keyof Filters) => (v: string) => setF({ ...f, [k]: v });

  const { cur, prior } = useMemo(() => selectCampaigns(e, f), [e, f]);
  const ok = useMemo(() => customerFilter(e, f), [e, f]);
  const A = useMemo(() => aggregate(e, cur, ok), [e, cur, ok]);
  const P = useMemo(() => aggregate(e, prior, ok), [e, prior, ok]);
  const hasPrior = f.period !== 'all' && prior.length > 0;
  const rows = useMemo(() => perCampaign(e, cur, ok), [e, cur, ok]);
  const cats = e.ds.categories;
  const channels = [...new Set(e.records.map((r) => r.b.topChannel))].sort();
  const filtered = JSON.stringify({ ...f, period: '' }) !== JSON.stringify({ ...DEFAULT_FILTERS, period: '' });
  const spanLabel = f.period === '3m' ? '3 months' : '6 months';
  const sub = hasPrior ? `vs prior ${spanLabel}` : f.period === 'all' ? 'all campaigns' : '';

  const dPct = (a: number, b: number, good: boolean | null = true) => {
    if (!hasPrior) return null;
    const t = pctChange(a, b);
    return t ? { text: t, good: good === null ? null : t.startsWith('+') === good } : null;
  };
  const dAbs = (a: number, b: number, fmt: (n: number) => string, goodUp = true) => {
    if (!hasPrior) return null;
    const d = a - b;
    return { text: `${d >= 0 ? '+' : '-'}${fmt(Math.abs(d))}`, good: d >= 0 === goodUp };
  };
  const pp = (n: number) => `${(n * 100).toFixed(1)}pp`;

  const dots = rows.map(({ campaign: c, agg }) => {
    const v = verdictOf(roiOf(agg));
    return {
      x: agg.cost, y: agg.net, color: VERDICT[v], r: 5 + Math.sqrt(agg.buyers) * 0.55,
      tip: <><b>{c.name}</b><div>{c.category} · {offerOfCampaign(c)}</div><div>Spend {inr(agg.cost)} · net {inr(agg.net)}</div><div>ROI {roiOf(agg).toFixed(2)} · {v}</div></>,
    };
  });

  const feat = useMemo(() => TYPES.map((t) => {
    const rs = e.records.filter((r) => r.type === t.id && ok(r.cid));
    const ids = new Set(rs.map((r) => r.cid));
    const av = (fn: (b: (typeof rs)[number]['b']) => number) => (rs.length ? rs.reduce((s, r) => s + fn(r.b), 0) / rs.length : 0);
    return {
      id: t.id as string, name: t.name, n: rs.length, freq: av((b) => b.ordersPerMonth), rec: av((b) => b.recencyDays), spend: av((b) => b.totalSpend), aov: av((b) => b.avgOrderValue),
      basket: av((b) => b.linesPerOrder), promo: av((b) => b.promoReliance), resp: av((b) => b.respRate), weekend: av((b) => b.weekendShare), fullPrice: av((b) => b.fullPriceBuysPerMonth),
      a: aggregate(e, cur, (cid) => ids.has(cid)),
    };
  }).filter((g) => g.n > 0), [e, ok, cur]);

  const behaviourKpi = useMemo(() => {
    const n = feat.reduce((a, g) => a + g.n, 0);
    return { n, promo: n ? feat.reduce((a, g) => a + g.promo * g.n, 0) / n : 0 };
  }, [feat]);

  const personaRows = f.persona === 'all' ? TYPES : TYPES.filter((t) => t.id === f.persona);
  const heat = useMemo(() => personaRows.map((t) => cats.map((cat) => {
    const camps = cur.filter((c) => c.category === cat);
    if (!camps.length) return null;
    const a = aggregate(e, camps, (cid) => e.recById.get(cid)!.type === t.id && ok(cid));
    return a.reached ? a.buyers / a.reached : null;
  })), [e, cur, ok, f.persona]); // eslint-disable-line react-hooks/exhaustive-deps

  // summarise the response map per customer type (display only, from the same numbers)
  const bestWorst = personaRows.flatMap((t, r) => {
    const cells = cats.map((cat, c) => ({ cat, v: heat[r][c] })).filter((x): x is { cat: string; v: number } => x.v !== null);
    if (cells.length < 2) return [];
    const sorted = [...cells].sort((a, b) => b.v - a.v);
    return [{ id: t.id, name: t.short, color: t.color, best: sorted[0], worst: sorted[sorted.length - 1] }];
  });

  const promoGroups = useMemo(() => {
    const defs: { key: string; label: string }[] = [
      { key: 'pct10', label: '10% Discount' }, { key: 'pct20', label: '20% Discount' }, { key: 'flat', label: '₹ Off on Minimum Spend' },
      { key: 'bogo', label: 'BOGO' }, { key: 'bundle', label: 'Bundle / Combo Offer' },
    ];
    return defs.map((d) => {
      const camps = cur.filter((c) => mechOf(c) === d.key);
      const a = aggregate(e, camps, ok);
      return { ...d, camps: camps.length, a, share: a.cost / (A.cost || 1) };
    }).filter((g) => g.camps > 0);
  }, [e, cur, ok, A.cost]);

  const takeaway =
    tab === 'results' ? pastResultsTakeaway({ campaigns: A.campaigns, lost: rows.filter((r) => r.agg.net < 0).length, incShare: incShareOf(A), units: A.units })
    : behaviourTakeaway(feat.map((g) => ({ name: g.name, n: g.n, net: g.a.net })));

  const typeRows = feat.map((g) => { const st = e.stats.find((x) => x.type === g.id); return { id: g.id, n: g.n, share: st?.share ?? 0, spendShare: st?.spendShare ?? 0, a: g.a }; });

  const typeKey = TYPES.map((t) => ({ label: t.name, color: t.color, text: t.tagline }));

  return (
    <>
      <PageTop
        tabs={<Tabs value={tab} onChange={setTab} options={[{ id: 'results', label: 'Past results' }, { id: 'behaviour', label: 'Customer behaviour' }]} />}
        title="Behaviour Analytics"
        sub={`How customer behaviour links to promotion response, and whether acting on it pays · ${dateLabel(isoOf(e.ds.minDay))} – ${dateLabel(isoOf(e.ds.maxDay))}`}
        right={<Toggle value={f.period} onChange={(v) => setF({ ...f, period: v })} options={[{ id: '3m', label: 'Last 3 months' }, { id: '6m', label: 'Last 6 months' }, { id: 'all', label: 'All time' }]} />}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-white px-4 py-2">
        <FilterSelect value={f.category} onChange={set('category')} options={[{ value: 'all', label: 'All Categories' }, ...cats.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect value={f.promo} onChange={set('promo')} options={[
          { value: 'all', label: 'All Promotion Types' }, { value: 'pct10', label: '10% Discount' }, { value: 'pct20', label: '20% Discount' },
          { value: 'flat', label: '₹ Off on Minimum Spend' }, { value: 'bogo', label: 'BOGO' }, { value: 'bundle', label: 'Bundle / Combo Offer' },
        ]} />
        <span className="flex items-center"><FilterSelect value={f.persona} onChange={set('persona')} options={[{ value: 'all', label: 'All Customer Types' }, ...TYPES.map((t) => ({ value: t.id, label: t.name }))]} /><Help term="allTypes" below /></span>
        <FilterSelect value={f.channel} onChange={set('channel')} options={[{ value: 'all', label: 'All Channels' }, ...channels.map((c) => ({ value: c, label: c }))]} />
            <FilterSelect value={f.frequency} onChange={set('frequency')} options={[{ value: 'all', label: 'All Frequencies' }, { value: 'high', label: 'Frequent (3+/mo)' }, { value: 'mid', label: 'Regular (1.5-3)' }, { value: 'low', label: 'Occasional (<1.5)' }]} />
        {filtered && <button onClick={() => setF({ ...DEFAULT_FILTERS, period: f.period })} className="flex items-center gap-1 text-[12px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />Reset</button>}
      </div>

      <div className="space-y-4 p-6">
        {tab === 'results' ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Discount invested" value={inr(A.cost)} delta={dPct(A.cost, P.cost, null)} note={sub || `${A.campaigns} campaigns`} />
            <Kpi help="netProfit" label="Net promo profit" value={inr(A.net)} tone={A.net < 0 ? 'bad' : 'good'} delta={dPct(A.net, P.net)} note={sub || 'past promotions'} />
            <Kpi help="roi" label="Avg promo ROI" value={roiOf(A).toFixed(2)} tone={roiOf(A) < 0 ? 'bad' : undefined} delta={dAbs(roiOf(A), roiOf(P), (n) => n.toFixed(2))} note={sub || 'profit per ₹ of discount'} />
            <Kpi label="Response rate" value={pct(respOf(A))} delta={dAbs(respOf(A), respOf(P), pp)} note={sub || 'bought on promo'} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Customers in view" value={int(behaviourKpi.n)} note={`${feat.length} customer types`} />
            <Kpi label="Buying on promotion" value={pct(behaviourKpi.promo)} note="average share of a customer's purchases" />
          </div>
        )}

        <Takeaway>{takeaway}</Takeaway>

        {/* ------------------------------------------------------------ PAST RESULTS */}
        {tab === 'results' && (A.campaigns === 0 ? (
          <Panel title="Past promotion results" what="Nothing to show for these filters."><p className="py-6 text-center text-[13px] text-[var(--ink-3)]">No campaigns match these filters in this period. Try All time or reset the filters.</p></Panel>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title="Campaign performance" what="Each past campaign: the discount it cost against the profit it made."
                right={<ViewToggle value={perfView} onChange={setPerfView} />}
                legend={[
                  { label: 'Across', text: 'discount invested' }, { label: 'Up', text: 'net profit (below zero is a loss)' }, { label: 'Size', text: 'customers who bought' },
                  { label: 'Green', color: 'var(--green)', text: 'ROI 0.5+' }, { label: 'Amber', color: 'var(--amber)', text: 'ROI 0 to 0.5' }, { label: 'Red', color: 'var(--red)', text: 'loses money' },
                ]}>
                {perfView === 'chart' ? (
                  <Scatter height={380} dots={dots} xLabel="Discount invested" yLabel="Net profit" xFormat={(v) => inr(v, 0)} yFormat={(v) => inr(v, 0)} />
                ) : (
                  <div className="-mx-4 max-h-[420px] overflow-auto">
                    <table className="w-full min-w-[720px] text-[12.5px]">
                      <thead className="sticky top-0 bg-white"><tr className="border-y border-[var(--line)] text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                        {['Campaign', 'Offer', 'Window', 'Response', 'Discount', 'Net profit', 'ROI', ''].map((h) => <th key={h} className="px-3 py-2"><Lbl t={h} /></th>)}
                      </tr></thead>
                      <tbody>
                        {rows.map(({ campaign: c, agg }) => {
                          const v = verdictOf(roiOf(agg));
                          return (
                            <tr key={c.id} className="border-b border-[var(--line-2)] last:border-0">
                              <td className="px-3 py-2"><p className="font-semibold">{c.name}</p><p className="text-[11px] text-[var(--ink-3)]">{c.category}</p></td>
                              <td className="px-3">{offerOfCampaign(c)}</td>
                              <td className="num px-3 text-[var(--ink-2)]">{shortDate(isoOf(c.start))} – {shortDate(isoOf(c.end))}</td>
                              <td className="num px-3">{pct(respOf(agg))}</td><td className="num px-3">{inr(agg.cost)}</td>
                              <td className="num px-3 font-semibold" style={{ color: agg.net < 0 ? 'var(--red)' : undefined }}>{inr(agg.net)}</td>
                              <td className="num px-3 font-semibold" style={{ color: agg.net < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{roiOf(agg).toFixed(2)}</td>
                              <td className="px-3"><Chip tone={v === 'Scale' ? 'green' : v === 'Optimise' ? 'amber' : 'red'}>{v}</Chip></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
              <Panel title={<>Incrementality<Help term="incrementality" /></>} what="Of the units sold during promotions, how many are baseline (would have sold anyway) and how many are uplift (extra from the promotion)."
                legend={[{ label: 'Total promo sales', color: 'var(--navy)', text: 'all units sold during the promotions (baseline + uplift)' }, { label: 'Baseline', color: '#94a3b8', text: 'units that would have been bought anyway at full price' }, { label: 'Uplift', color: 'var(--green)', text: 'extra units the promotion brought in' }]}>
                <BarChart height={250} maxW={460} showValues yLabel="Units sold" yTitle="Units sold" xTitle="Promoted sales, split" format={(v) => int(v)}
                  data={[
                    { label: 'Total promo sales', value: A.units, color: 'var(--navy)' },
                    { label: 'Baseline', value: A.base, color: '#94a3b8' },
                    { label: 'Uplift', value: A.units - A.base, color: 'var(--green)' },
                  ]} />
                <details className="group mt-3 rounded-lg bg-[var(--page)] text-[12.5px] leading-snug">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-[12px] font-semibold text-[var(--ink)] [&::-webkit-details-marker]:hidden">
                    How the numbers come from the bars
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)] transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-2 px-3 pb-3">
                  <p className="num flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <Chip tone="navy">{int(A.units)} total</Chip>−<span className="rounded-full bg-[#e2e8f0] px-2 py-0.5 font-semibold">{int(A.base)} baseline</span>=<Chip tone="green">{int(A.units - A.base)} uplift</Chip>
                  </p>
                  <p><b>{pct(incShareOf(A))} uplift</b> = {int(A.units - A.base)} uplift ÷ {int(A.units)} total promo sales.</p>
                  <p><b>{pct(leakOf(A))} of the discount is subsidy</b> = {inr(A.leak, 0)} ÷ {inr(A.cost, 0)}. {inr(A.leak, 0)} is the discount handed out on baseline units. Those customers would have paid full price.</p>
                  </div>
                </details>
                <p className="mt-2 text-[11.5px] leading-snug text-[var(--ink-3)]">An estimate: each customer's own usual full-price buying is the baseline. There was no control group.</p>
              </Panel>
            </div>
            <Panel title="Promotion type performance" what="Which kinds of promotion earned their discount back."
              legend={[{ label: 'Bar', text: 'share of all discount spend' }, { label: 'ROI', text: 'net profit per ₹ of discount; red loses money' }, { label: 'Response', text: 'reached customers who bought on the promotion' }]}>
              <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                {promoGroups.map((g) => {
                  const roi = roiOf(g.a);
                  return (
                    <div key={g.key}>
                      <div className="flex items-baseline justify-between text-[12.5px]">
                        <span className="font-semibold">{g.label}</span>
                        <span className="num text-[12px]"><b style={{ color: roi < 0 ? 'var(--red)' : roi < 0.3 ? 'var(--amber)' : 'var(--green-dark)' }}>{roi.toFixed(2)} ROI</b> <span className="text-[var(--ink-3)]">· {pct(respOf(g.a))} response</span></span>
                      </div>
                      <div className="mt-1.5"><Meter value={g.share} color={roi < 0 ? 'var(--red)' : 'var(--navy)'} width={300} /></div>
                      <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">{pct(g.share)} of spend · {g.camps} campaign{g.camps > 1 ? 's' : ''}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </>
        ))}

        {/* ------------------------------------------------------------ CUSTOMER BEHAVIOUR */}
        {tab === 'behaviour' && <TypeCards rows={typeRows} />}
        {tab === 'behaviour' && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel className="min-w-0" title="How each customer type behaves and responds" what="The four customer types, grouped by how they react to promotions. Behaviour columns show how each type buys; results show what promotions earned from it."
              right={<>
                {featView === 'chart' && <FilterSelect value={featMetric} onChange={setFeatMetric} options={FEAT_METRICS.map((m) => ({ value: m.key, label: m.label }))} />}
                <ViewToggle value={featView} onChange={setFeatView} />
              </>}
              legend={[{ label: 'Bars', text: 'the metric chosen in the dropdown for each customer type' }, ...typeKey]}>
              {featView === 'chart' ? (
                <BarChart height={260} maxW={900} posColor="var(--navy)" negColor="var(--red)" format={FEAT_METRICS.find((m) => m.key === featMetric)!.fmt}
                  data={feat.map((g) => { const m = FEAT_METRICS.find((x) => x.key === featMetric)!; const t = TYPES.find((x) => x.id === g.id)!; return { label: shortName(g.name), value: m.get(g), color: t.color, tip: <><b>{g.name}</b><br />{m.label}: {m.fmt(m.get(g))} · {g.n} customers</> }; })} />
              ) : (
                <div className="-mx-4 overflow-x-auto">
                  <table className="w-full min-w-[900px] text-[12.5px]">
                    <thead><tr className="border-y border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                      <th className="px-4 py-2 text-left">Customer type</th>
                      {['Customers', 'Orders / mo', 'Days since order', 'Avg spend', 'Order value', 'Items / order', 'On promo', 'Full-price buys / mo', 'Promo response', 'Discount', 'Net profit', 'ROI'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {feat.map((g) => (
                        <tr key={g.id} className="border-b border-[var(--line-2)] text-right last:border-0">
                          <td className="px-4 py-2.5 text-left font-semibold">{g.name}</td>
                          <td className="num px-3">{int(g.n)}</td><td className="num px-3">{g.freq.toFixed(1)}</td><td className="num px-3">{g.rec.toFixed(0)}</td>
                          <td className="num px-3">{inr(g.spend)}</td><td className="num px-3">{inr(g.aov, 0)}</td><td className="num px-3">{g.basket.toFixed(1)}</td>
                          <td className="num px-3">{pct(g.promo)}</td><td className="num px-3">{g.fullPrice.toFixed(1)}</td><td className="num px-3 font-semibold">{pct(g.resp)}</td>
                          <td className="num px-3">{inr(g.a.cost)}</td><td className="num px-3" style={{ color: g.a.net < 0 ? 'var(--red)' : undefined }}>{inr(g.a.net)}</td>
                          <td className="num px-3 font-semibold" style={{ color: g.a.net < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{roiOf(g.a).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel className="min-w-0" title="Response map" what="Which customer types respond in which categories."
              legend={[{ label: 'Rows', text: 'customer types' }, { label: 'Columns', text: 'categories' }, { label: 'Cell', text: '% of reached customers who bought on promotion; darker green is higher' }, { label: '–', text: 'no campaign in the period' }]}>
                <FitHeat rows={personaRows.map((t) => t.short)} cols={cats} rowW={100}
                  value={(r, c) => heat[r][c] ?? -1}
                  color={(v) => (v < 0 ? '#f1f4f8' : v < 0.25 ? '#cbd5e1' : v < 0.5 ? '#86efac' : v < 0.7 ? '#34d399' : '#059669')}
                  label={(v) => (v < 0 ? '–' : `${Math.round(v * 100)}%`)}
                  tip={(r, c) => <>{personaRows[r].name} · {cats[c]}<br />{heat[r][c] === null ? 'no campaign' : pct(heat[r][c]!) + ' responded'}</>} />
              <p className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Strongest and weakest category for each customer type</p>
              <div className="space-y-1.5">
                {bestWorst.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 text-[12.5px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.color }} />
                    <span className="w-28 shrink-0 font-semibold">{b.name}</span>
                    <span className="text-[var(--ink-2)]">strongest in <b>{b.best.cat}</b> ({pct(b.best.v)}), weakest in <b>{b.worst.cat}</b> ({pct(b.worst.v)})</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

      </div>
    </>
  );
}

/** the response map, with cells sized to fill the panel */
function FitHeat(props: Omit<ComponentProps<typeof Heat>, 'cell'>) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = props.cols.length;
  const cell = Math.max(52, Math.min(130, Math.floor((w - (props.rowW ?? 150) - 6 * n - 6) / Math.max(1, n))));
  return <div ref={ref}><Heat {...props} cell={cell} /></div>;
}

export function PageTop({ title, sub, right, tabs }: { title: string; sub: string; right?: ReactNode; tabs?: ReactNode }) {
  return (
    <div className={`border-b border-[var(--line)] bg-white px-6 pt-3.5 ${tabs ? 'pb-0' : 'pb-3.5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[16px] font-bold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">{sub}</p>
        </div>
        {right}
      </div>
      {tabs && <div className="mt-3">{tabs}</div>}
    </div>
  );
}
