import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Chip, FilterSelect, Kpi, Meter, Panel, Toggle, ViewToggle } from '@/components/ui';
import { BarChart, DivergingBars, GroupedBars, Heat, HBars, Legend, LineChart, Scatter, Waterfall } from '@/components/charts';
import { TYPES } from '@/engine/segments';
import { activeAt, buildCtxs } from '@/engine/planner';
import { compareOptions, offerName, promoOptions, shortOffer } from '@/engine/options';
import {
  aggregate, customerFilter, DEFAULT_FILTERS, incShareOf, leakOf, mechOf, perCampaign, pctChange, respOf, roiOf, selectCampaigns, verdictOf,
  type Agg, type Filters,
} from '@/lib/analytics';
import { inr, int, pct, dateLabel, shortDate } from '@/lib/fmt';
import { summariseValidation } from '@/lib/validation';
import { isoOf, type Campaign } from '@/engine/data';

const VERDICT = { Scale: 'var(--green)', Optimise: 'var(--amber)', Stop: 'var(--red)' } as const;
const offerOfCampaign = (c: Campaign) => offerName(c.mechanic, c.depth, c.flat, c.minSpend);

type FeatRow = { n: number; freq: number; rec: number; spend: number; aov: number; basket: number; promo: number; resp: number; weekend: number; ourShare: number; a: Agg };
const FEAT_METRICS: { key: string; label: string; get: (g: FeatRow) => number; fmt: (v: number) => string }[] = [
  { key: 'promo', label: 'Purchases on promo', get: (g) => g.promo, fmt: (v) => pct(v) },
  { key: 'n', label: 'Customers', get: (g) => g.n, fmt: (v) => int(v) },
  { key: 'resp', label: 'Promo response', get: (g) => g.resp, fmt: (v) => pct(v) },
  { key: 'roi', label: 'Promo ROI', get: (g) => roiOf(g.a), fmt: (v) => v.toFixed(2) },
  { key: 'net', label: 'Net promo profit', get: (g) => g.a.net, fmt: (v) => inr(v, 0) },
  { key: 'cost', label: 'Discount invested', get: (g) => g.a.cost, fmt: (v) => inr(v, 0) },
  { key: 'freq', label: 'Orders per month', get: (g) => g.freq, fmt: (v) => v.toFixed(1) },
  { key: 'rec', label: 'Days since last order', get: (g) => g.rec, fmt: (v) => v.toFixed(0) },
  { key: 'spend', label: 'Average spend', get: (g) => g.spend, fmt: (v) => inr(v, 0) },
  { key: 'aov', label: 'Order value', get: (g) => g.aov, fmt: (v) => inr(v, 0) },
  { key: 'basket', label: 'Items per order', get: (g) => g.basket, fmt: (v) => v.toFixed(1) },
  { key: 'ourShare', label: 'Our-brand share', get: (g) => g.ourShare, fmt: (v) => pct(v) },
  { key: 'weekend', label: 'Weekend orders', get: (g) => g.weekend, fmt: (v) => pct(v) },
];
const shortName = (n: string) => n.replace(' Buyers', '').replace(' Buyer', '').replace(' Promotions', '').replace('Competitor ', '');

type ValView = 'predicted' | 'ranking' | 'skipped';

export function Analytics() {
  const e = useEngine();
  const { go } = useApp();
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [adv, setAdv] = useState(() => window.location.hash.includes('adv=1'));
  const [more, setMore] = useState(false);
  const [featView, setFeatView] = useState<'chart' | 'table'>('chart');
  const [featMetric, setFeatMetric] = useState('promo');
  const [perfView, setPerfView] = useState<'chart' | 'table'>('chart');
  const [predCat, setPredCat] = useState('Beverages');
  const [valView, setValView] = useState<ValView>('predicted');
  const [drvView, setDrvView] = useState<'group' | 'signal'>('group');
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

  // ---- validation: does the prediction work, does acting on it make money
  const V = e.validation;
  const vt = useMemo(() => {
    const s = (fn: (v: (typeof V)[number]) => number) => V.reduce((a, v) => a + fn(v), 0);
    const real = s((v) => v.realNet), cost = s((v) => v.cost);
    return { real, cost, roi: cost ? real / cost : 0, skipped: s((v) => v.skippedNet), broad: s((v) => v.broadNet), broadCost: s((v) => v.broadCost), reached: s((v) => v.reached), tgt: s((v) => v.targeted) };
  }, [V]);
  const top20 = e.model.gains.find((g) => g.pctCustomers >= 0.2);
  const broadRoi = vt.broadCost ? vt.broad / vt.broadCost : 0;
  const makesMoney = vt.real > 0;
  // short, unique axis labels for campaigns ("Back-to-School Breakfast" -> "School")
  const vLabel = (v: (typeof V)[number]) => {
    const words = v.campaign.name.replace('Back-to-', '').split(' ');
    const clash = V.filter((x) => x.campaign.name.replace('Back-to-', '').split(' ')[0] === words[0]).length > 1;
    const w = clash && words[1] ? words[1] : words[0];
    return w.length > 9 ? w.slice(0, 8) + '.' : w;
  };

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
      basket: av((b) => b.linesPerOrder), promo: av((b) => b.promoReliance), resp: av((b) => b.respRate), weekend: av((b) => b.weekendShare), ourShare: av((b) => b.ourShareFull),
      a: aggregate(e, cur, (cid) => ids.has(cid)),
    };
  }).filter((g) => g.n > 0), [e, ok, cur]);

  const personaRows = f.persona === 'all' ? TYPES : TYPES.filter((t) => t.id === f.persona);
  const heat = useMemo(() => personaRows.map((t) => cats.map((cat) => {
    const camps = cur.filter((c) => c.category === cat);
    if (!camps.length) return null;
    const a = aggregate(e, camps, (cid) => e.recById.get(cid)!.type === t.id && ok(cid));
    return a.reached ? a.buyers / a.reached : null;
  })), [e, cur, ok, f.persona]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const pred = useMemo(() => {
    const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), predCat, e.asOf).filter((c) => ok(c.cid));
    const options = promoOptions(e.ds, predCat);
    const cmp = compareOptions(e.ds, e.model, ctxs, predCat, options);
    const gs = TYPES.map((t) => ({ name: t.name, ids: ctxs.filter((c) => e.recById.get(c.cid)!.type === t.id).map((c) => c.cid) })).filter((g) => g.ids.length > 0);
    const val = (g: (typeof gs)[number], key: string) => g.ids.reduce((s, id) => s + cmp.exps.get(key)!.get(id)!.p1, 0) / g.ids.length;
    return { options, gs, val, n: ctxs.length };
  }, [e, predCat, ok]);

  const impact = useMemo(() => {
    const z = () => ({ contacts: 0, cost: 0, net: 0, inc: 0, leak: 0 });
    const trad = z(); const beh = z();
    for (const r of e.recommendations) {
      const p20 = r.scenarios.find((s) => s.option.key === 'pct20')!;
      trad.contacts += p20.blanket.customers; trad.cost += p20.blanket.discountCost; trad.net += p20.blanket.net; trad.inc += p20.blanket.incBuyers; trad.leak += p20.blanket.leakage;
      if (r.best) { beh.contacts += r.best.audience.targeted; beh.cost += r.best.discountCost; beh.net += r.best.net; beh.inc += r.best.incrementalBuyers; beh.leak += r.best.leakage; }
    }
    return { trad, beh };
  }, [e]);
  const smart = e.strategies.find((s) => s.name.startsWith('Target persuadable'))!;
  const broad = e.strategies[0];

  const typeKey = TYPES.map((t) => ({ label: t.name, color: t.color, text: t.tagline }));

  return (
    <>
      <PageTop
        title="Behaviour Analytics"
        sub={`How customer behaviour predicts promotion response, and whether acting on it pays · ${dateLabel(isoOf(e.ds.minDay))} – ${dateLabel(isoOf(e.ds.maxDay))}`}
        right={<Toggle value={f.period} onChange={(v) => setF({ ...f, period: v })} options={[{ id: '3m', label: 'Last 3 months' }, { id: '6m', label: 'Last 6 months' }, { id: 'all', label: 'All time' }]} />}
      />
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--line)] bg-white px-6 py-2.5">
        <FilterSelect value={f.category} onChange={set('category')} options={[{ value: 'all', label: 'All Categories' }, ...cats.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect value={f.promo} onChange={set('promo')} options={[
          { value: 'all', label: 'All Promotion Types' }, { value: 'pct10', label: '10% Discount' }, { value: 'pct20', label: '20% Discount' },
          { value: 'flat', label: '₹ Off on Minimum Spend' }, { value: 'bogo', label: 'BOGO' }, { value: 'bundle', label: 'Bundle / Combo Offer' },
        ]} />
        <FilterSelect value={f.persona} onChange={set('persona')} options={[{ value: 'all', label: 'All Customer Types' }, ...TYPES.map((t) => ({ value: t.id, label: t.name }))]} />
        <FilterSelect value={f.channel} onChange={set('channel')} options={[{ value: 'all', label: 'All Channels' }, ...channels.map((c) => ({ value: c, label: c }))]} />
        <button onClick={() => setMore(!more)} className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium ${more ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--page)]'}`}><SlidersHorizontal className="h-3 w-3" />More filters</button>
        {more && (
          <>
            <FilterSelect value={f.loyalty} onChange={set('loyalty')} options={[{ value: 'all', label: 'All Brand Loyalty' }, { value: 'ours', label: 'Mostly our brand' }, { value: 'mixed', label: 'Mixed brands' }, { value: 'rival', label: 'Mostly competitors' }]} />
            <FilterSelect value={f.frequency} onChange={set('frequency')} options={[{ value: 'all', label: 'All Frequencies' }, { value: 'high', label: 'Frequent (3+/mo)' }, { value: 'mid', label: 'Regular (1.5-3)' }, { value: 'low', label: 'Occasional (<1.5)' }]} />
          </>
        )}
        {filtered && <button onClick={() => setF({ ...DEFAULT_FILTERS, period: f.period })} className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />Reset</button>}
      </div>

      <div className="space-y-6 p-6">
        {/* the three numbers that carry the story */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Response rate" value={pct(respOf(A))} delta={dAbs(respOf(A), respOf(P), pp)} note={sub || 'of reached customers bought on a promotion'} />
          <Kpi label="Prediction quality" value={`AUC ${e.model.aucTest.toFixed(2)}`} note={`top 20% of customers hold ${pct(top20?.pctResponders ?? 0)} of buyers`} />
          <Kpi label="Profit from acting on it" value={inr(vt.real)} tone={makesMoney ? 'good' : 'bad'} note={`ROI ${vt.roi.toFixed(2)} vs ${broadRoi.toFixed(2)} for blanket promotion`} />
        </div>

        {/* ---------------------------------------------------------- A */}
        <section className="space-y-3">
          <SectionHead letter="A" title="What did customers do?" sub="Customers fall into five types by how they react to promotions. Their behaviour is what the model learns from." />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="How each customer type behaves" what="One bar per customer type for the behaviour you choose."
              right={<>
                {featView === 'chart' && <FilterSelect value={featMetric} onChange={setFeatMetric} options={FEAT_METRICS.map((m) => ({ value: m.key, label: m.label }))} />}
                <ViewToggle value={featView} onChange={setFeatView} />
              </>}
              legend={[{ label: 'Bars', text: 'the behaviour chosen in the dropdown' }, ...typeKey]}>
              {featView === 'chart' ? (
                <BarChart height={230} posColor="var(--navy)" negColor="var(--red)" format={FEAT_METRICS.find((m) => m.key === featMetric)!.fmt}
                  data={feat.map((g) => { const m = FEAT_METRICS.find((x) => x.key === featMetric)!; const t = TYPES.find((x) => x.id === g.id)!; return { label: shortName(g.name), value: m.get(g), color: t.color, tip: <><b>{g.name}</b><br />{m.label}: {m.fmt(m.get(g))} · {g.n} customers</> }; })} />
              ) : (
                <div className="-mx-4 overflow-x-auto">
                  <table className="w-full min-w-[820px] text-[11.5px]">
                    <thead><tr className="border-y border-[var(--line)] text-right text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                      <th className="px-4 py-2 text-left">Customer type</th>
                      {['Customers', 'Orders / mo', 'Days since order', 'Avg spend', 'Order value', 'Items / order', 'On promo', 'Our-brand share', 'Promo response', 'Discount', 'Net profit', 'ROI'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {feat.map((g) => (
                        <tr key={g.id} className="border-b border-[var(--line-2)] text-right last:border-0">
                          <td className="px-4 py-2.5 text-left font-semibold">{g.name}</td>
                          <td className="num px-3">{int(g.n)}</td><td className="num px-3">{g.freq.toFixed(1)}</td><td className="num px-3">{g.rec.toFixed(0)}</td>
                          <td className="num px-3">{inr(g.spend)}</td><td className="num px-3">{inr(g.aov, 0)}</td><td className="num px-3">{g.basket.toFixed(1)}</td>
                          <td className="num px-3">{pct(g.promo)}</td><td className="num px-3">{pct(g.ourShare)}</td><td className="num px-3 font-semibold">{pct(g.resp)}</td>
                          <td className="num px-3">{inr(g.a.cost)}</td><td className="num px-3" style={{ color: g.a.net < 0 ? 'var(--red)' : undefined }}>{inr(g.a.net)}</td>
                          <td className="num px-3 font-semibold" style={{ color: g.a.net < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{roiOf(g.a).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title="Who responded in which category" what="Share of reached customers who bought on a promotion, by customer type and category."
              legend={[{ label: 'Rows', text: 'customer types' }, { label: 'Columns', text: 'categories' }, { label: 'Cell', text: '% who bought on promotion; darker green is higher' }, { label: '–', text: 'no campaign in the period' }]}>
              <Heat rows={personaRows.map((t) => t.short)} cols={cats} cell={62} rowW={100}
                value={(r, c) => heat[r][c] ?? -1}
                color={(v) => (v < 0 ? '#f1f4f8' : v < 0.25 ? '#cbd5e1' : v < 0.5 ? '#86efac' : v < 0.7 ? '#34d399' : '#059669')}
                label={(v) => (v < 0 ? '–' : `${Math.round(v * 100)}%`)}
                tip={(r, c) => <>{personaRows[r].name} · {cats[c]}<br />{heat[r][c] === null ? 'no campaign' : pct(heat[r][c]!) + ' responded'}</>} />
            </Panel>
          </div>
        </section>

        {/* ---------------------------------------------------------- B */}
        <section className="space-y-3">
          <SectionHead letter="B" title="What does behaviour predict?" sub="From behaviour, the model predicts each customer's chance of buying with and without every promotion."
            right={<button onClick={() => go('customers')} className="flex items-center gap-1.5 rounded-md bg-[var(--navy)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-black">See it for one customer <ArrowRight className="h-3 w-3" /></button>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-2" title="Predicted Response by customer type and promotion" what={`Average predicted chance of buying in the next 14 days, ${int(pred.n)} recently active customers.`}
              right={<FilterSelect value={predCat} onChange={setPredCat} options={cats.map((c) => ({ value: c, label: c }))} />}
              legend={[{ label: 'Rows', text: 'customer types' }, { label: 'Columns', text: 'promotion types; No Promotion is what they do anyway' }, { label: 'Cell', text: 'predicted response; darker green is higher. The gap to No Promotion is the estimated uplift.' }]}>
              <Heat rows={pred.gs.map((g) => g.name)} cols={pred.options.map((o) => shortOffer(o.label))} cell={104} rowW={150}
                value={(r, c) => pred.val(pred.gs[r], pred.options[c].key)}
                color={(v) => (v < 0.2 ? '#e2e8f0' : v < 0.4 ? '#a7f3d0' : v < 0.6 ? '#34d399' : v < 0.8 ? '#10b981' : '#047857')}
                label={(v) => `${Math.round(v * 100)}%`}
                tip={(r, c) => <>{pred.gs[r].name} · {pred.options[c].label}<br />{pct(pred.val(pred.gs[r], pred.options[c].key))} predicted response ({pred.gs[r].ids.length} customers)</>} />
            </Panel>
            <Panel title="What drives the prediction" what="How much each kind of behaviour contributes."
              right={<Toggle value={drvView} onChange={setDrvView} options={[{ id: 'group', label: 'Group' }, { id: 'signal', label: 'Signal' }]} />}
              legend={drvView === 'group'
                ? [{ label: 'Bar', text: "share of the model's weight" }, { label: 'Purchasing', text: 'frequency, recency, quantity' }, { label: 'Price', text: 'discount taken' }, { label: 'Promotion', text: 'past response' }, { label: 'Brand', text: 'loyalty vs competitors' }, { label: 'Basket', text: 'items, category mix' }, { label: 'Timing', text: 'purchase rhythm' }]
                : [{ label: 'Green', color: 'var(--green)', text: 'raises predicted response' }, { label: 'Orange', color: 'var(--amber)', text: 'lowers it' }, { label: 'Length', text: 'strength' }]}>
              {drvView === 'group'
                ? <HBars labelW={84} max={Math.max(...e.model.groupImportance.map((g) => g.share))} format={(v) => pct(v)} rows={e.model.groupImportance.map((g) => ({ label: g.group, value: g.share, color: 'var(--navy)' }))} />
                : <DivergingBars labelW={150} format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} rows={e.model.importance.slice(0, 9).map((i) => ({ label: i.label.length > 24 ? i.label.slice(0, 23) + '…' : i.label, value: i.weight, color: i.weight >= 0 ? 'var(--green)' : 'var(--amber)' }))} />}
            </Panel>
          </div>
        </section>

        {/* ---------------------------------------------------------- C */}
        <section className="space-y-3">
          <SectionHead letter="C" title="Does the prediction work?" sub={`Tested on ${V.length} campaigns that were not used to train the model.`} />
          <ValidationCallout />
          <Panel title="Accuracy and profit on unseen campaigns"
            what="The model chose who to target using only earlier data. Left: are its probabilities right? Right: did targeting by behaviour beat a blanket promotion?"
            right={<div className="flex items-center gap-2"><Chip tone="navy">AUC {e.model.aucTest.toFixed(2)}</Chip><Chip tone={makesMoney ? 'green' : 'red'}>{makesMoney ? 'Profit-making' : 'Loss-making'}: ROI {vt.roi.toFixed(2)} vs {broadRoi.toFixed(2)} blanket</Chip></div>}
            legend={[{ label: 'Left, grey', color: '#94a3b8', text: 'predicted chance of buying' }, { label: 'Left, navy', color: '#0b1c2f', text: 'what actually happened (5 equal groups, most to least likely)' }, { label: 'Right, grey', color: '#94a3b8', text: 'profit if everyone is offered' }, { label: 'Right, navy', color: '#0b1c2f', text: 'profit offering only the customers the model picked' }]}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[10.5px] font-semibold">Predicted vs actual chance of buying</p>
                <GroupedBars height={210} format={(v) => pct(v)} series={[{ label: 'Predicted', color: '#94a3b8' }, { label: 'Actual', color: '#0b1c2f' }]}
                  groups={e.model.calibration.map((c, i) => ({ label: i === 0 ? 'Most likely' : i === e.model.calibration.length - 1 ? 'Least likely' : `Group ${i + 1}`, values: [c.predicted, c.actual] }))} />
              </div>
              <div>
                <p className="mb-1 text-[10.5px] font-semibold">Profit per held-out campaign: blanket vs behaviour-based</p>
                <GroupedBars height={210} format={(v) => inr(v, 0)} series={[{ label: 'Blanket promotion', color: '#94a3b8' }, { label: 'Behaviour-based', color: '#0b1c2f' }]}
                  groups={V.map((v) => ({ label: vLabel(v), values: [v.broadNet, v.realNet] }))} />
              </div>
            </div>
          </Panel>
          <p className="rounded-lg bg-[var(--navy)] px-4 py-3 text-[12px] font-medium leading-snug text-white">Customer behaviour helps predict who will respond to which promotion. Turning that prediction into a profit-aware decision, who to target and with what, beat promoting to everyone.</p>
        </section>

        {/* ---------------------------------------------------------- Advanced */}
        <section className="card">
          <button onClick={() => setAdv(!adv)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
            <ChevronDown className={`h-3.5 w-3.5 text-[var(--ink-3)] transition-transform ${adv ? '' : '-rotate-90'}`} />
            <span className="text-[12.5px] font-semibold">Advanced details</span>
            <span className="text-[10.5px] text-[var(--ink-3)]">past campaign results, incrementality, promotion types, business impact forecast and more validation views</span>
          </button>
          {adv && (
            <div className="space-y-4 border-t border-[var(--line)] p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Kpi label="Discount invested" value={inr(A.cost)} delta={dPct(A.cost, P.cost, null)} note={sub || `${A.campaigns} campaigns`} />
                <Kpi label="Net promo profit" value={inr(A.net)} tone={A.net < 0 ? 'bad' : 'good'} delta={dPct(A.net, P.net)} note={sub || 'past promotions'} />
                <Kpi label="Avg promo ROI" value={roiOf(A).toFixed(2)} tone={roiOf(A) < 0 ? 'bad' : undefined} delta={dAbs(roiOf(A), roiOf(P), (n) => n.toFixed(2))} note={sub || 'profit per ₹ of discount'} />
              </div>

              {A.campaigns === 0 ? (
                <p className="py-4 text-center text-[12px] text-[var(--ink-3)]">No campaigns match these filters in this period. Try All time or reset the filters.</p>
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
                        <Scatter height={240} dots={dots} xLabel="Discount invested" yLabel="Net profit" xFormat={(v) => inr(v, 0)} yFormat={(v) => inr(v, 0)} />
                      ) : (
                        <div className="-mx-4 max-h-[280px] overflow-auto">
                          <table className="w-full min-w-[720px] text-[11.5px]">
                            <thead className="sticky top-0 bg-white"><tr className="border-y border-[var(--line)] text-left text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                              {['Campaign', 'Offer', 'Window', 'Response', 'Discount', 'Net profit', 'ROI', ''].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                            </tr></thead>
                            <tbody>
                              {rows.map(({ campaign: c, agg }) => {
                                const v = verdictOf(roiOf(agg));
                                return (
                                  <tr key={c.id} className="border-b border-[var(--line-2)] last:border-0">
                                    <td className="px-3 py-2"><p className="font-semibold">{c.name}</p><p className="text-[10px] text-[var(--ink-3)]">{c.category}</p></td>
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
                    <Panel title="Incrementality" what="Estimated incremental response: how many promoted units were extra, against each customer's own baseline."
                      legend={[{ label: 'Sold', text: 'all units sold on promotion' }, { label: 'Bought anyway', color: 'var(--red)', text: "customers' own full-price baseline" }, { label: 'Extra', text: 'caused by the promotion' }]}>
                      <Waterfall height={230} format={(v) => int(v)} steps={[
                        { label: 'Sold on\npromotion', value: A.units, kind: 'total' },
                        { label: 'Bought\nanyway', value: -A.base, kind: 'delta', note: "Each customer's own baseline for the same days" },
                        { label: 'Estimated\nextra', value: A.units - A.base, kind: 'total' },
                      ]} />
                      <p className="mt-1 text-[10.5px] text-[var(--ink-3)]">An estimated {pct(incShareOf(A))} of promoted units were extra; {pct(leakOf(A))} of the discount went to sales that would have happened anyway. Estimated from each customer's own baseline, not a randomised test.</p>
                    </Panel>
                  </div>
                  <Panel title="Promotion type performance" what="Which kinds of promotion earned their discount back."
                    legend={[{ label: 'Bar', text: 'share of all discount spend' }, { label: 'ROI', text: 'net profit per ₹ of discount; red loses money' }, { label: 'Response', text: 'reached customers who bought on the promotion' }]}>
                    <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                      {promoGroups.map((g) => {
                        const roi = roiOf(g.a);
                        return (
                          <div key={g.key}>
                            <div className="flex items-baseline justify-between text-[11.5px]">
                              <span className="font-semibold">{g.label}</span>
                              <span className="num text-[11px]"><b style={{ color: roi < 0 ? 'var(--red)' : roi < 0.3 ? 'var(--amber)' : 'var(--green-dark)' }}>{roi.toFixed(2)} ROI</b> <span className="text-[var(--ink-3)]">· {pct(respOf(g.a))} response</span></span>
                            </div>
                            <div className="mt-1.5"><Meter value={g.share} color={roi < 0 ? 'var(--red)' : 'var(--navy)'} width={300} /></div>
                            <p className="mt-0.5 text-[10px] text-[var(--ink-3)]">{pct(g.share)} of spend · {g.camps} campaign{g.camps > 1 ? 's' : ''}</p>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                </>
              )}

              <Panel title="Business impact: traditional vs behaviour-based" what="Forecast for the six planned campaigns: the same offer to everyone, versus the best offer only for customers it pays off with."
                right={<Chip tone="green">{pct(1 - impact.beh.cost / impact.trad.cost)} less discount · {inr(impact.beh.net - impact.trad.net)} more profit</Chip>}
                legend={[{ label: 'Grey', color: '#94a3b8', text: 'traditional: 20% Discount to every recently active customer' }, { label: 'Navy', color: '#0b1c2f', text: 'behaviour-based: best promotion, only where it pays off' }, { label: 'Leakage', text: 'discount given to sales that would have happened anyway' }]}>
                <GroupedBars height={220} format={(v) => inr(v, 0)} series={[{ label: 'Traditional', color: '#94a3b8' }, { label: 'Behaviour-based', color: '#0b1c2f' }]}
                  groups={[
                    { label: 'Promotion cost', values: [impact.trad.cost, impact.beh.cost] },
                    { label: 'Discount leakage', values: [impact.trad.leak, impact.beh.leak] },
                    { label: 'Net profit', values: [Math.max(0, impact.trad.net), Math.max(0, impact.beh.net)] },
                  ]} />
                <div className="mt-1"><Legend items={[{ label: 'Traditional (20% Discount to all)', color: '#94a3b8' }, { label: 'Behaviour-based', color: '#0b1c2f' }]} /></div>
                <div className="mt-3 grid gap-3 text-[11.5px] sm:grid-cols-3">
                  {([
                    ['Customers contacted', int(impact.trad.contacts), int(impact.beh.contacts)],
                    ['ROI', (impact.trad.net / impact.trad.cost).toFixed(2), (impact.beh.net / impact.beh.cost).toFixed(2)],
                    ['Extra buyers caused', int(impact.trad.inc), int(impact.beh.inc)],
                  ] as [string, string, string][]).map(([l, a2, b2]) => (
                    <div key={l} className="rounded-lg bg-[var(--page)] p-3"><p className="text-[10px] text-[var(--ink-3)]">{l}</p><p className="num mt-0.5"><span className="text-[var(--ink-3)]">{a2}</span> → <b className="text-[14px]">{b2}</b></p></div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-[var(--ink-2)]">
                  Replaying the last {e.model.testCampaigns.length} campaigns with the model choosing who to contact returned ROI <b>{smart.roi.toFixed(2)}</b> vs <b>{broad.roi.toFixed(2)}</b> for discounting everyone, with {pct(1 - smart.discountCost / broad.discountCost)} less discount.
                </p>
              </Panel>

              <Panel title="More validation views" what="Further checks on the held-out campaigns."
                right={<FilterSelect value={valView} onChange={(v) => setValView(v as ValView)} options={[{ value: 'predicted', label: 'Predicted vs actual profit' }, { value: 'ranking', label: 'Buyers captured, best-ranked first' }, { value: 'skipped', label: 'What the model avoided' }]} />}
                legend={valView === 'predicted'
                  ? [{ label: 'Grey', color: '#94a3b8', text: 'profit / buyers the model expected' }, { label: 'Navy', color: '#0b1c2f', text: 'what actually happened' }, { label: 'Navy above grey', text: 'the model was cautious' }]
                  : valView === 'ranking'
                    ? [{ label: 'Line', text: 'share of all real buyers captured when contacting the best-ranked customers first; above the dashed line is better' }]
                    : [{ label: 'Contacted', text: 'actual profit from customers the model chose' }, { label: 'Skipped', text: 'profit (a loss) those left out would have made if offered' }, { label: 'Blanket', text: 'total if the offer went to all' }]}>
                {valView === 'predicted' && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div><p className="mb-1 text-[10.5px] font-semibold">Net profit of the targeted customers</p>
                      <GroupedBars height={200} format={(v) => inr(v, 0)} series={[{ label: 'Predicted', color: '#94a3b8' }, { label: 'Actual', color: '#0b1c2f' }]} groups={V.filter((v) => v.targeted > 0).map((v) => ({ label: vLabel(v), values: [v.predNet, v.realNet] }))} /></div>
                    <div><p className="mb-1 text-[10.5px] font-semibold">Customers who bought</p>
                      <GroupedBars height={200} format={(v) => int(v)} series={[{ label: 'Predicted', color: '#94a3b8' }, { label: 'Actual', color: '#0b1c2f' }]} groups={V.filter((v) => v.targeted > 0).map((v) => ({ label: vLabel(v), values: [v.predBuyers, v.realBuyers] }))} /></div>
                  </div>
                )}
                {valView === 'ranking' && (
                  <LineChart height={210} markers={false} yMax={1} xFormat={(v) => pct(v)} yFormat={(v) => pct(v)} xTicks={[0, 0.25, 0.5, 0.75, 1]} xLabel="Share of customers contacted"
                    series={[{ name: 'Model', color: '#0b1c2f', points: e.model.gains.map((g) => ({ x: g.pctCustomers, y: g.pctResponders })) }, { name: 'Random', color: '#94a3b8', dashed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]} />
                )}
                {valView === 'skipped' && (
                  <BarChart height={210} posColor="var(--navy)" negColor="var(--red)" format={(v) => inr(v, 0)} showValues
                    data={[
                      { label: 'Contacted', sub: `${int(vt.tgt)} offers`, value: vt.real, color: 'var(--green)' },
                      { label: 'Skipped', sub: 'if they had been offered', value: vt.skipped },
                      { label: 'Blanket promotion', sub: `${int(vt.reached)} offers`, value: vt.broad, color: '#94a3b8' },
                    ]} />
                )}
              </Panel>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function SectionHead({ letter, title, sub, right }: { letter: string; title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--navy)] text-[11px] font-bold text-white">{letter}</span>
        <div>
          <h2 className="text-[14px] font-bold tracking-tight">{title}</h2>
          <p className="text-[11px] text-[var(--ink-3)]">{sub}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

/** Headline result of the held-out backtest: behaviour-based targeting vs blanket promotion */
export function ValidationCallout({ className = '' }: { className?: string }) {
  const e = useEngine();
  const v = summariseValidation(e.validation);
  const wins = v.roi > v.broadRoi;
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3 ${wins ? 'border-[#bfe6d0] bg-[#f1faf5]' : 'border-[#f3d9b4] bg-[#fff8ee]'} ${className}`}>
      <div className="min-w-[260px] flex-1">
        <p className="text-[13px] font-bold tracking-tight">Behaviour-based targeting: ROI {v.roi.toFixed(2)} vs {v.broadRoi.toFixed(2)} for blanket promotion</p>
        <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">Held-out backtest: tested on {v.campaigns} campaigns not used for model training. The model chose who to target using only earlier data.</p>
      </div>
      <div className="flex items-center gap-2">
        <Chip tone="navy">AUC {e.model.aucTest.toFixed(2)}</Chip>
        <Chip tone={wins ? 'green' : 'amber'}>{inr(v.real)} profit vs {inr(v.broad)}</Chip>
      </div>
    </div>
  );
}

export function PageTop({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="border-b border-[var(--line)] bg-white px-6 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[16px] font-bold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">{sub}</p>
        </div>
        {right}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--ink-3)]">Demo uses simulated retail customer data; the same framework applies to real transaction, promotion and customer history.</p>
    </div>
  );
}
