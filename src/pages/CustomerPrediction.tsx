import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useEngine } from '@/state';
import { Btn, Card, CardTitle, Chip, FilterSelect, Kpi, Meter, Panel, Toggle, TypeBadge } from '@/components/ui';
import { BarChart, DivergingBars, GroupedBars, HBars, Legend } from '@/components/charts';
import { PageTop } from '@/pages/Analytics';
import { compareOptions, explain, promoOptions, shortOffer, type PromoOption } from '@/engine/options';
import { activeAt, buildCtxs } from '@/engine/planner';
import type { Expectation } from '@/engine/economics';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import { isoOf } from '@/engine/data';
import { inr, int, pct, shortDate } from '@/lib/fmt';

type View = 'customer' | 'target';
type Group = 'target' | 'light' | 'none' | 'stronger' | 'skip';
const GROUPS: { id: Group; title: string; body: string; tone: 'green' | 'neutral' | 'amber' | 'red' }[] = [
  { id: 'target', title: 'High-probability responders', body: 'Offer lifts purchase chance by 10+ points and pays for itself', tone: 'green' },
  { id: 'light', title: 'Small but profitable lift', body: 'Pays off, but the lift is under 10 points', tone: 'neutral' },
  { id: 'stronger', title: 'Need a stronger incentive', body: 'Only a deeper offer gets them to 50%+, and it costs more than it earns', tone: 'amber' },
  { id: 'none', title: 'Do not need a discount', body: 'Already 35%+ likely to buy with no offer', tone: 'neutral' },
  { id: 'skip', title: 'Not worth a discount', body: 'Low response and no offer earns money', tone: 'red' },
];

/** The story in one line: what the question is and how every number on this page is produced. */
function FlowStrip() {
  const steps = ['Customer Behaviour', 'Predicted Response', 'Estimated Uplift', 'Targeting', 'Business Decision', 'Validation'];
  return (
    <div className="border-b border-[var(--line)] bg-[#f8fafc] px-6 py-2.5">
      <p className="text-[11.5px] text-[var(--ink-2)]"><b className="text-[var(--ink)]">The question:</b> can past customer behaviour predict who will respond to which promotion, and is it worth offering?</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {steps.map((t, i) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className="rounded-full border border-[var(--line)] bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-2)]">{t}</span>
            {i < steps.length - 1 && <span className="text-[10px] text-[var(--ink-3)]">→</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CustomerPrediction() {
  const e = useEngine();
  const [view, setView] = useState<View>(() => (window.location.hash.includes('view=target') ? 'target' : 'customer'));
  const [category, setCategory] = useState('Beverages');
  const [persona, setPersona] = useState('all');
  const [channel, setChannel] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('net');
  const [limit, setLimit] = useState(20);
  const [offerKey, setOfferKey] = useState('best');
  const [sel, setSel] = useState<string | null>(null);

  const cats = e.ds.categories;
  const channels = [...new Set(e.records.map((r) => r.b.topChannel))].sort();

  const S = useMemo(() => {
    const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), category, e.asOf);
    const options = promoOptions(e.ds, category);
    const promos = options.filter((o) => o.family !== 'none');
    const cmp = compareOptions(e.ds, e.model, ctxs, category, options);
    const x = (cid: string, k: string) => cmp.exps.get(k)!.get(cid)!;
    const best = new Map<string, { o: PromoOption; e: Expectation } | null>();
    for (const c of ctxs) {
      let top: { o: PromoOption; e: Expectation } | null = null;
      for (const o of promos) { const v = x(c.cid, o.key); if (v.net > 0 && v.uplift >= 0.03 && (!top || v.net > top.e.net)) top = { o, e: v }; }
      best.set(c.cid, top);
    }
    return { ctxs, options, promos, x, best };
  }, [e, category]);

  const rowsAll = useMemo(() => S.ctxs.map((c) => {
    const r = e.recById.get(c.cid)!;
    const b = S.best.get(c.cid) ?? null;
    return { cid: c.cid, r, b, p0: S.x(c.cid, 'none').p1 };
  }), [S, e]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rowsAll.filter((x) => (persona === 'all' || x.r.type === persona) && (channel === 'all' || x.r.b.topChannel === channel) && (!q || x.cid.toLowerCase().includes(q)));
    const key: Record<string, (x: (typeof out)[number]) => number> = {
      net: (x) => -(x.b?.e.net ?? -1e9), resp: (x) => -(x.b?.e.p1 ?? x.p0), uplift: (x) => -(x.b?.e.uplift ?? -1), recency: (x) => -x.r.b.recencyDays, id: (x) => +x.cid.slice(1),
    };
    return [...out].sort((a, b) => key[sort](a) - key[sort](b));
  }, [rowsAll, persona, channel, query, sort]);

  const filters = (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--line)] bg-white px-6 py-2.5">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-3)]">Filters</span>
      <FilterSelect value={category} onChange={(v) => { setCategory(v); setOfferKey('best'); }} options={cats.map((c) => ({ value: c, label: `Category: ${c}` }))} />
      <FilterSelect value={persona} onChange={setPersona} options={[{ value: 'all', label: 'All Customer Types' }, ...TYPES.map((t) => ({ value: t.id, label: t.name }))]} />
      <FilterSelect value={channel} onChange={setChannel} options={[{ value: 'all', label: 'All Channels' }, ...channels.map((c) => ({ value: c, label: c }))]} />
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2.5"><Search className="h-3 w-3 text-[var(--ink-3)]" /><input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Customer ID" className="w-24 bg-transparent text-[11.5px] outline-none" /></div>
      <span className="ml-auto text-[11px] text-[var(--ink-3)]">{filtered.length} of {rowsAll.length} recently active customers</span>
    </div>
  );

  return (
    <>
      <PageTop title="Customer Prediction" sub="What promotion will this customer respond to? Behaviour in, predicted response out, one customer at a time or as a target list"
        right={<Toggle value={view} onChange={setView} options={[{ id: 'customer', label: 'Customer view' }, { id: 'target', label: 'Target list' }]} />} />
      <FlowStrip />
      {filters}
      {view === 'customer'
        ? <CustomerView S={S} filtered={filtered} sel={sel} setSel={setSel} sort={sort} setSort={setSort} limit={limit} setLimit={setLimit} category={category} />
        : <TargetView S={S} filtered={filtered} offerKey={offerKey} setOfferKey={setOfferKey} category={category} />}
    </>
  );
}

type Props = { S: { ctxs: ReturnType<typeof buildCtxs>; options: PromoOption[]; promos: PromoOption[]; x: (cid: string, k: string) => Expectation; best: Map<string, { o: PromoOption; e: Expectation } | null> }; filtered: { cid: string; r: ReturnType<typeof useEngine>['records'][number]; b: { o: PromoOption; e: Expectation } | null; p0: number }[]; category: string };

function CustomerView({ S, filtered, sel, setSel, sort, setSort, limit, setLimit, category }: Props & { sel: string | null; setSel: (s: string) => void; sort: string; setSort: (s: string) => void; limit: number; setLimit: (n: number) => void }) {
  const cid = sel && filtered.some((x) => x.cid === sel) ? sel : filtered[0]?.cid;
  return (
    <div className="grid gap-4 p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="min-w-0 space-y-4">
      <Card pad={false} className="h-fit">
        <div className="flex items-center justify-between px-4 pt-4">
          <CardTitle title="Customers" sub={`Best promotion for ${category}, ranked`} />
          <FilterSelect value={sort} onChange={setSort} options={[{ value: 'net', label: 'Sort: expected profit' }, { value: 'resp', label: 'Sort: predicted response' }, { value: 'uplift', label: 'Sort: uplift' }, { value: 'recency', label: 'Sort: longest silent' }, { value: 'id', label: 'Sort: ID' }]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] text-[11.5px]">
            <thead><tr className="border-y border-[var(--line)] text-left text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              {['Customer', 'Customer type', 'Best promotion', 'Predicted Response', 'Profit'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.slice(0, limit).map((x) => (
                <tr key={x.cid} onClick={() => setSel(x.cid)} className={`cursor-pointer border-b border-[var(--line-2)] last:border-0 hover:bg-[var(--page)] ${cid === x.cid ? 'bg-[#eef6f2]' : ''}`}>
                  <td className="px-3 py-2 font-semibold">{x.cid}</td>
                  <td className="px-3"><TypeBadge type={x.r.type} /></td>
                  <td className="px-3">{x.b ? <b>{x.b.o.label}</b> : <span className="text-[var(--ink-3)]">No discount</span>}</td>
                  <td className="num px-3">{x.b ? <>{pct(x.p0)} → <b>{pct(x.b.e.p1)}</b></> : pct(x.p0)}</td>
                  <td className="num px-3 font-semibold">{x.b ? inr(x.b.e.net) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-[11px] text-[var(--ink-3)]">
          <span>Showing {Math.min(limit, filtered.length)} of {filtered.length}</span>
          {limit < filtered.length && <button className="font-semibold text-[var(--ink)] hover:underline" onClick={() => setLimit(limit + 20)}>Show more</button>}
        </div>
      </Card>
      <Insights S={S} filtered={filtered} category={category} />
      </div>
      {cid ? <Detail key={cid + category} cid={cid} S={S} category={category} /> : <Card><p className="py-10 text-center text-[12px] text-[var(--ink-3)]">No customers match these filters.</p></Card>}
    </div>
  );
}

const priceSensitivity = (p: number) => (p >= 0.4 ? 'High' : p >= 0.15 ? 'Medium' : 'Low');

function StepTag({ n, text }: { n: number; text: string }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-3)]">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--navy)] text-[9px] text-white">{n}</span>{text}
    </p>
  );
}

function Detail({ cid, S, category }: { cid: string; S: Props['S']; category: string }) {
  const e = useEngine();
  const r = e.recById.get(cid)!;
  const b = r.b;
  const best = S.best.get(cid);
  const ctx = S.ctxs.find((c) => c.cid === cid)!;
  const none = S.x(cid, 'none');
  // promotion with the highest predicted response, which is not always the one worth offering
  const hr = S.promos.reduce((acc, o) => (S.x(cid, o.key).p1 > S.x(cid, acc.key).p1 ? o : acc), S.promos[0]);
  const [optKey, setOptKey] = useState<string | null>(null);
  const [pView, setPView] = useState<'table' | 'chart' | 'money'>('table');
  const shown = S.promos.find((o) => o.key === (optKey ?? best?.o.key ?? hr.key)) ?? hr;
  const xs = S.x(cid, shown.key);
  const upts = Math.round(xs.uplift * 100);
  const fx = useMemo(() => explain(e.model, ctx, shown.depth, shown.mechanic, category).sort((a, c) => Math.abs(c.effect) - Math.abs(a.effect)), [e, ctx, shown, category]);
  const maxAbs = Math.max(...fx.map((f) => Math.abs(f.effect)), 0.01);
  const hist = e.perCustomer.get(cid) ?? [];
  const ups = fx.filter((f) => f.effect > 0.05).slice(0, 3);
  const downs = fx.filter((f) => f.effect < -0.05).slice(0, 2);
  const hrx = S.x(cid, hr.key);
  const topCats = Object.entries(b.catShare).sort((a, c) => c[1] - a[1]).slice(0, 2).map(([c, sh]) => `${c} ${pct(sh)}`).join(', ');

  const summary: [string, string, string?][] = [
    ['Orders / month', b.ordersPerMonth.toFixed(1)],
    ['Order value', inr(b.avgOrderValue, 0)],
    ['Promo usage', pct(b.promoReliance), 'of purchases made on promotion'],
    ['Price sensitivity', priceSensitivity(b.promoReliance), b.avgDiscAccepted ? `takes ${b.avgDiscAccepted.toFixed(0)}% off on average` : 'no discounts taken yet'],
    [`${category} affinity`, pct(b.catShare[category] ?? 0), 'of their basket'],
    ['Brand affinity', pct(b.ourShareFull), 'of full-price buys are our brand'],
    ['Basket size', `${b.linesPerOrder.toFixed(1)} items`, 'per order'],
    ['Recency', `${b.recencyDays}d ago`, 'last order'],
  ];
  const more: [string, string][] = [
    ['Total spend', inr(b.totalSpend)], ['Top categories', topCats], ['Promo response', `${b.respondedCampaigns} of ${b.activeCampaigns} campaigns`],
    ['Weekend orders', pct(b.weekendShare)], ['Preferred channel', `${b.topChannel} ${pct(b.channelShare[b.topChannel] ?? 0)}`], ['Customer since', shortDate(isoOf(b.firstDay))],
  ];
  const skipReason = none.p1 >= 0.35
    ? 'This customer is already likely to buy without any offer, so a discount would mostly give margin away.'
    : 'No promotion earns more from this customer than it costs, or the lift is too small (under 3 points) to rely on.';

  return (
    <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:h-fit">
      {/* 1 · behaviour */}
      <Card>
        <StepTag n={1} text="Behaviour summary" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5"><p className="text-[16px] font-bold">{cid}</p><Chip tone="navy">Customer type</Chip><TypeBadge type={r.type} /><span className="text-[10.5px] text-[var(--ink-3)]">{TYPE_BY_ID[r.type].tagline}</span></div>
          <span className="text-[10.5px] text-[var(--ink-3)]">{b.nOrders} orders</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {summary.map(([l, v, n]) => (
            <div key={l}><dt className="text-[10px] text-[var(--ink-3)]">{l}</dt><dd className="num text-[13px] font-semibold">{v}</dd>{n && <dd className="text-[9.5px] leading-tight text-[var(--ink-3)]">{n}</dd>}</div>
          ))}
        </dl>
        <details className="mt-3 border-t border-[var(--line)] pt-2.5 text-[10.5px] text-[var(--ink-2)]">
          <summary className="cursor-pointer font-semibold">More behaviour details and why this customer type</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">{more.map(([l, v]) => <div key={l}><dt className="text-[9.5px] text-[var(--ink-3)]">{l}</dt><dd className="num font-semibold">{v}</dd></div>)}</dl>
          <p className="mt-2"><b>Why this type:</b> {r.reasons.join('. ')}.</p>
        </details>
      </Card>

      {/* 2 + 3 · predicted response and uplift */}
      <Panel flush title="2 · Predicted Response and estimated uplift: with vs without a promotion"
        what={`Chance this customer buys ${category} in the next 14 days. The model is asked twice: without a promotion (P0) and with each promotion (P1). Estimated uplift = P1 − P0.`}
        right={<Toggle value={pView} onChange={setPView} options={[{ id: 'table', label: 'Response' }, { id: 'chart', label: 'Charts' }, { id: 'money', label: 'Financial detail' }]} />}
        legend={[
          { label: 'P0', text: 'predicted chance with no promotion' }, { label: 'P1', text: 'predicted chance with the promotion' },
          { label: 'Uplift', text: 'P1 − P0 in percentage points (an estimate from behaviour, not a randomised test)' },
          { label: 'Highest response', color: '#f59e0b', text: 'promotion with the highest P1' }, { label: 'Best decision', color: 'var(--green)', text: 'promotion with the highest expected profit that clears the targeting rule' },
        ]}>
        <div className="mx-4 mb-3 rounded-xl bg-[var(--navy)] px-4 py-3 text-white">
          <p className="text-[10px] uppercase tracking-wider text-white/55">Customer {cid} · {shown.label}{shown.key === best?.o.key ? ' (best decision)' : shown.key === hr.key ? ' (highest response)' : ''}</p>
          <p className="num mt-1 text-[18px] font-bold leading-tight">
            {pct(none.p1)} <span className="text-[12px] font-medium text-white/60">without promotion</span> → {pct(xs.p1)} <span className="text-[12px] font-medium text-white/60">with {shown.label}</span>
            <span className="ml-3 rounded-md px-2 py-0.5 text-[14px]" style={{ background: upts >= 0 ? 'var(--green)' : 'var(--red)' }}>{upts >= 0 ? '+' : ''}{upts} pts</span>
          </p>
        </div>
        {pView === 'table' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[11.5px]">
              <thead><tr className="border-y border-[var(--line)] text-right text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                <th className="px-4 py-2 text-left">Promotion</th><th className="px-3 py-2">Without (P0)</th><th className="px-3 py-2 text-left">With promotion (P1)</th><th className="px-3 py-2">Estimated uplift</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-[var(--line-2)] text-right text-[var(--ink-2)]"><td className="px-4 py-2 text-left font-medium">No Promotion</td><td className="num px-3 font-semibold">{pct(none.p1)}</td><td className="px-3 text-left text-[10.5px] text-[var(--ink-3)]">baseline</td><td className="px-3">–</td></tr>
                {S.promos.map((o) => {
                  const x = S.x(cid, o.key);
                  const isBest = best?.o.key === o.key;
                  const isHr = hr.key === o.key;
                  return (
                    <tr key={o.key} onClick={() => setOptKey(o.key)} className={`cursor-pointer border-b border-[var(--line-2)] text-right last:border-0 ${isBest ? 'bg-[#f0fdf7]' : 'hover:bg-[var(--page)]'} ${shown.key === o.key ? 'ring-1 ring-inset ring-[var(--navy)]' : ''}`}>
                      <td className="px-4 py-2 text-left"><span className="font-semibold">{o.label}</span> <span className="ml-1 inline-flex gap-1">{isBest && <Chip tone="green">Best decision</Chip>}{isHr && <Chip tone="amber">Highest response</Chip>}</span></td>
                      <td className="num px-3 text-[var(--ink-2)]">{pct(none.p1)}</td>
                      <td className="px-3 text-left"><Meter value={x.p1} color={isBest ? 'var(--green)' : 'var(--navy)'} width={90} /> <span className="num ml-1.5 font-semibold">{pct(x.p1)}</span></td>
                      <td className="num px-3 font-semibold">{x.uplift >= 0 ? '+' : ''}{Math.round(x.uplift * 100)} pts</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pView === 'chart' && (
          <div className="grid gap-4 px-4 pb-3 pt-1 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[10.5px] font-semibold">Predicted Response</p>
              <BarChart height={190} format={(v) => pct(v)} showValues color="var(--navy)"
                data={[{ label: 'None', value: none.p1, color: '#94a3b8' }, ...S.promos.map((o) => ({ label: shortOffer(o.label), value: S.x(cid, o.key).p1, color: best?.o.key === o.key ? 'var(--green)' : 'var(--navy)' }))]} />
            </div>
            <div>
              <p className="mb-1 text-[10.5px] font-semibold">Expected net profit</p>
              <BarChart height={190} format={(v) => inr(v, 0)} showValues posColor="var(--navy)" negColor="var(--red)"
                data={S.promos.map((o) => ({ label: shortOffer(o.label), value: S.x(cid, o.key).net, color: best?.o.key === o.key ? 'var(--green)' : undefined }))} />
            </div>
          </div>
        )}
        {pView === 'money' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[11.5px]">
              <thead><tr className="border-y border-[var(--line)] text-right text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                <th className="px-4 py-2 text-left">Promotion</th>{['Predicted Response', 'Uplift', 'Revenue', 'Margin', 'Cost', 'Net profit', 'ROI'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
              </tr></thead>
              <tbody>
                {S.promos.map((o) => {
                  const x = S.x(cid, o.key);
                  return (
                    <tr key={o.key} onClick={() => setOptKey(o.key)} className={`cursor-pointer border-b border-[var(--line-2)] text-right last:border-0 ${best?.o.key === o.key ? 'bg-[#f0fdf7]' : 'hover:bg-[var(--page)]'}`}>
                      <td className="px-4 py-2 text-left font-semibold">{o.label}</td><td className="num px-3">{pct(x.p1)}</td><td className="num px-3">{x.uplift >= 0 ? '+' : ''}{Math.round(x.uplift * 100)} pts</td>
                      <td className="num px-3">{inr(x.revenue, 0)}</td><td className="num px-3" style={{ color: x.profitOffer < 0 ? 'var(--red)' : undefined }}>{inr(x.profitOffer, 0)}</td>
                      <td className="num px-3">{inr(x.discountCost, 0)}</td><td className="num px-3 font-semibold" style={{ color: x.net < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{inr(x.net, 0)}</td>
                      <td className="num px-3">{x.discountCost > 0 ? (x.net / x.discountCost).toFixed(2) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 pb-3 pt-2 text-[10px] text-[var(--ink-3)]">Click a promotion to see why it is predicted. Estimated from observed behaviour and each customer's own baseline, not from a randomised test.</p>
      </Panel>

      {/* 4 · why */}
      <Card>
        <StepTag n={3} text={`Why: ${shown.label}`} />
        <p className="text-[12px] leading-relaxed text-[var(--ink-2)]">
          The model predicts <b className="text-[var(--ink)]">{pct(xs.p1)}</b> with {shown.label} (against {pct(none.p1)} without) mainly because:
        </p>
        <ul className="mt-2 space-y-1.5 text-[11.5px] leading-snug text-[var(--ink-2)]">
          {ups.map((x) => <li key={x.factor} className="flex gap-2"><span className="font-bold text-[var(--green)]">▲</span><span><b className="text-[var(--ink)]">{x.factor}</b> raises it: {x.reading}.</span></li>)}
          {downs.map((x) => <li key={x.factor} className="flex gap-2"><span className="font-bold text-[var(--amber)]">▼</span><span><b className="text-[var(--ink)]">{x.factor}</b> holds it back: {x.reading}.</span></li>)}
          {!ups.length && !downs.length && <li className="text-[var(--ink-3)]">No single behaviour stands out; this customer is close to average.</li>}
        </ul>
        <details className="mt-3 border-t border-[var(--line)] pt-2.5 text-[10.5px] text-[var(--ink-2)]">
          <summary className="cursor-pointer font-semibold">All behaviour factors</summary>
          <p className="mb-2 mt-1.5 text-[10px] text-[var(--ink-3)]">Green to the right raises the predicted response compared with an average customer; orange to the left holds it back. Longer means stronger.</p>
          <div className="space-y-1.5">
            {fx.map((x) => (
              <div key={x.factor} className="flex items-center gap-2.5 text-[11px]">
                <span className="w-[170px] shrink-0 truncate font-medium">{x.factor}</span>
                <div className="relative h-3.5 flex-1">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--line)]" />
                  <div className="absolute inset-y-0.5 rounded-sm" style={{ left: x.effect >= 0 ? '50%' : `${50 - (Math.abs(x.effect) / maxAbs) * 50}%`, width: `${(Math.abs(x.effect) / maxAbs) * 50}%`, background: x.effect >= 0 ? 'var(--green)' : 'var(--amber)' }} />
                </div>
                <span className="num w-10 text-right text-[10.5px] text-[var(--ink-3)]">{x.effect >= 0 ? '+' : ''}{x.effect.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </details>
      </Card>

      {/* 5 · business decision */}
      <Card className={best ? 'border-[#a7e8c8]' : 'border-[#e5c4c4]'}>
        <StepTag n={4} text="Business decision" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md px-3 py-1.5 text-[13px] font-bold tracking-wide text-white" style={{ background: best ? 'var(--green-dark)' : '#b91c1c' }}>{best ? 'TARGET' : "DON'T TARGET"}</span>
          {best
            ? <p className="text-[12px] leading-snug text-[var(--ink-2)]">Offer <b className="text-[var(--ink)]">{best.o.label}</b>. Expected profit <b className="text-[var(--ink)]">{inr(best.e.net)}</b> per customer over 14 days (discount cost {inr(best.e.discountCost)}, ROI {(best.e.discountCost ? best.e.net / best.e.discountCost : 0).toFixed(2)}), after the margin they would have earned anyway and stock borrowed from later weeks.</p>
            : <p className="text-[12px] leading-snug text-[var(--ink-2)]">{skipReason}</p>}
        </div>
        {hr.key !== best?.o.key && (
          <div className="mt-3 rounded-lg border border-[#f1d9a0] bg-[#fdf8e8] px-3 py-2.5 text-[11.5px] leading-snug text-[#7a5200]">
            <b>Highest response is not the most profitable.</b> {hr.label} has the highest predicted response ({pct(hrx.p1)}, {hrx.uplift >= 0 ? '+' : ''}{Math.round(hrx.uplift * 100)} pts) but {hrx.net < 0 ? 'loses' : 'earns only'} {inr(Math.abs(hrx.net))} per customer
            {best ? <>, while {best.o.label} earns {inr(best.e.net)}.</> : <>, and no promotion is worth offering to this customer.</>}
          </div>
        )}
        <p className="mb-1 mt-3 text-[10px] font-semibold text-[var(--ink-2)]">Expected profit per customer, by promotion</p>
        <DivergingBars labelW={120} format={(v) => inr(v, 0)} rows={S.promos.map((o) => ({ label: shortOffer(o.label), value: S.x(cid, o.key).net, color: best?.o.key === o.key ? 'var(--green)' : 'var(--navy)' }))} />
      </Card>

      <Panel title="Past promotions" what="Which previous campaigns this customer bought on." defaultOpen={false}
        legend={[{ label: 'Green chip', color: 'var(--green)', text: 'Bought on that promotion.' }, { label: 'Grey chip', color: '#e2e8f0', text: 'Active but did not respond.' }, { label: 'Pale chip', color: '#eef1f6', text: 'Not yet a customer or not active then.' }]}>
        <div className="flex flex-wrap gap-1.5">
          {e.results.map((res) => {
            const h = hist.find((x) => x.campaignId === res.campaign.id);
            return <span key={res.campaign.id} title={`${res.campaign.name}: ${!h ? 'not active' : h.bought ? 'bought on promo' : 'no response'}`} className="flex h-6 items-center rounded px-2 text-[10px] font-medium" style={{ background: !h ? '#eef1f6' : h.bought ? 'var(--green)' : '#e2e8f0', color: h?.bought ? '#fff' : 'var(--ink-3)' }}>{res.campaign.name.split(' ')[0]}</span>;
          })}
        </div>
      </Panel>
    </div>
  );
}

function TargetView({ S, filtered, offerKey, setOfferKey, category }: Props & { offerKey: string; setOfferKey: (k: string) => void }) {
  const offer = S.promos.find((o) => o.key === offerKey) ?? null; // null = each customer's own best

  const rows = useMemo(() => filtered.map((row) => {
    const x = offer ? S.x(row.cid, offer.key) : row.b?.e ?? null;
    const used = offer ?? row.b?.o ?? null;
    const maxP = Math.max(...S.promos.map((o) => S.x(row.cid, o.key).p1));
    let g: Group;
    if (x && x.net > 0 && x.uplift >= 0.03) g = x.uplift >= 0.1 ? 'target' : 'light';
    else if (row.p0 >= 0.35) g = 'none';
    else if (maxP >= 0.5) g = 'stronger';
    else g = 'skip';
    return { ...row, x, used, g };
  }), [filtered, offer, S]);

  const targeted = rows.filter((r) => r.g === 'target' || r.g === 'light');
  const sum = (f: (r: (typeof rows)[number]) => number) => targeted.reduce((s, r) => s + f(r), 0);
  const cost = sum((r) => r.x!.discountCost);
  const net = sum((r) => r.x!.net);
  const inc = sum((r) => r.x!.uplift);
  // the traditional alternative: 20% off to every customer in view
  const tradOpt = S.promos.find((o) => o.key === 'pct20')!;
  const trad = filtered.reduce((a, r) => { const x = S.x(r.cid, tradOpt.key); a.cost += x.discountCost; a.net += x.net; return a; }, { cost: 0, net: 0 });
  const list = [...targeted].sort((a, b) => b.x!.net - a.x!.net);

  const exportCsv = () => {
    const head = ['customer_id', 'customer_type', 'promotion', 'response_without_offer', 'response_with_offer', 'uplift_pts', 'expected_profit', 'discount_cost', 'group'];
    const lines = list.map((r) => [r.cid, r.r.type, r.used?.label ?? '', r.p0.toFixed(3), r.x!.p1.toFixed(3), (r.x!.uplift * 100).toFixed(1), r.x!.net.toFixed(0), r.x!.discountCost.toFixed(0), r.g].join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `target_list_${category.replace(/\s/g, '_')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect value={offerKey} onChange={setOfferKey} options={[{ value: 'best', label: "Each customer's best promotion" }, ...S.promos.map((o) => ({ value: o.key, label: `Offer: ${o.label}` }))]} />
        <span className="text-[11px] text-[var(--ink-3)]">Customers are contacted only where the offer earns more than it costs.</span>
        <Btn variant="navy" className="ml-auto" onClick={exportCsv} disabled={!list.length}><Download className="h-3 w-3" />Export target list (CSV)</Btn>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Customers to contact" value={int(targeted.length)} note={`of ${int(filtered.length)} in view · ${pct(targeted.length / Math.max(1, filtered.length))}`} />
        <Kpi label="Extra buyers expected" value={int(inc)} note="because of the offer" />
        <Kpi label="Discount cost" value={inr(cost)} note={`vs ${inr(trad.cost)} for 20% off to all`} />
        <Kpi label="Net profit" value={inr(net)} tone={net < 0 ? 'bad' : 'good'} note={`vs ${inr(trad.net)} for 20% off to all`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {GROUPS.map((g) => {
          const rs = rows.filter((r) => r.g === g.id);
          const avg = rs.length ? rs.reduce((s, r) => s + (r.x?.p1 ?? r.p0), 0) / rs.length : 0;
          const avg0 = rs.length ? rs.reduce((s, r) => s + r.p0, 0) / rs.length : 0;
          return (
            <div key={g.id} className="card p-3.5">
              <Chip tone={g.tone}>{g.title}</Chip>
              <p className="num mt-2 text-[22px] font-bold leading-none">{rs.length}</p>
              <p className="mt-1.5 min-h-[30px] text-[10.5px] leading-snug text-[var(--ink-3)]">{g.body}</p>
              <p className="num mt-1 text-[10.5px] text-[var(--ink-2)]">{pct(avg0)} → {pct(avg)} avg chance</p>
            </div>
          );
        })}
      </div>

      <Card pad={false}>
        <div className="px-4 pt-4"><CardTitle title="Target list" sub={`Ranked by expected profit for ${category}. Export includes every contacted customer.`} /></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[11.5px]">
            <thead><tr className="border-y border-[var(--line)] text-left text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              {['#', 'Customer', 'Customer type', 'Promotion', 'Without offer', 'With offer', 'Uplift', 'Expected profit'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {list.slice(0, 30).map((r, i) => (
                <tr key={r.cid} className="border-b border-[var(--line-2)] last:border-0">
                  <td className="px-3 py-2 text-[var(--ink-3)]">{i + 1}</td><td className="px-3 font-semibold">{r.cid}</td>
                  <td className="px-3"><TypeBadge type={r.r.type} /></td>
                  <td className="px-3 font-medium">{r.used?.label}</td><td className="num px-3">{pct(r.p0)}</td><td className="num px-3 font-semibold">{pct(r.x!.p1)}</td>
                  <td className="num px-3">+{Math.round(r.x!.uplift * 100)} pts</td><td className="num px-3 font-semibold" style={{ color: 'var(--green-dark)' }}>{inr(r.x!.net)}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-[var(--ink-3)]">No customer clears the bar for this offer. Try each customer's best promotion.</td></tr>}
            </tbody>
          </table>
        </div>
        {list.length > 30 && <p className="px-4 py-3 text-[11px] text-[var(--ink-3)]">Showing the top 30 of {list.length}. Export for the full list.</p>}
      </Card>
    </div>
  );
}

/** Roll-ups for the customers currently in view: fills the space under the list and answers "what does this group respond to?" */
function Insights({ filtered, category }: Props) {
  const [view, setView] = useState('mix');
  const mix = new Map<string, number>();
  filtered.forEach((x) => { const k = x.b ? shortOffer(x.b.o.label) : 'No discount'; mix.set(k, (mix.get(k) ?? 0) + 1); });
  const mixRows = [...mix.entries()].sort((a, b) => b[1] - a[1]);
  const byType = TYPES.map((t) => {
    const rs = filtered.filter((x) => x.r.type === t.id);
    return { t, n: rs.length, net: rs.reduce((s, x) => s + (x.b?.e.net ?? 0), 0) };
  }).filter((g) => g.n > 0);
  const bySeg = TYPES.map((sg) => {
    const rs = filtered.filter((x) => x.r.type === sg.id);
    const avg = (f: (x: (typeof rs)[number]) => number) => (rs.length ? rs.reduce((s, x) => s + f(x), 0) / rs.length : 0);
    return { name: sg.short, n: rs.length, none: avg((x) => x.p0), best: avg((x) => x.b?.e.p1 ?? x.p0) };
  }).filter((g) => g.n > 0);
  return (
    <Panel title="Summary of the customers in view" what={`Roll-ups for the ${filtered.length} customers matching the filters. Pick a view from the dropdown.`}
      right={<FilterSelect value={view} onChange={setView} options={[{ value: 'mix', label: 'Best promotion mix' }, { value: 'profit', label: 'Profit by customer type' }, { value: 'lift', label: 'Response lift by customer type' }]} />}
      legend={view === 'mix' ? [{ label: 'Bar', text: `Number of customers for whom each ${category} promotion earns the most. No discount means nothing pays off.` }]
        : view === 'profit' ? [{ label: 'Bar', text: 'Expected profit if every customer in view gets their own best promotion, summed by customer type. Colours match the customer types.' }]
        : [{ label: 'Grey', color: '#94a3b8', text: 'Average chance of buying with no promotion.' }, { label: 'Navy', color: '#0b1c2f', text: "Average chance with each customer's best promotion. The gap is the lift." }]}>
      {view === 'mix' && <HBars labelW={110} format={(v) => String(v)} rows={mixRows.map(([l, v]) => ({ label: l, value: v, color: l === 'No discount' ? '#94a3b8' : 'var(--navy)' }))} />}
      {view === 'profit' && <BarChart height={200} posColor="var(--green)" negColor="var(--red)" format={(v) => inr(v, 0)} data={byType.map((g) => ({ label: g.t.short, value: g.net, color: g.t.color, tip: <><b>{g.t.name}</b><br />{g.n} customers · {inr(g.net)}</> }))} />}
      {view === 'lift' && (
        <>
          <GroupedBars height={200} format={(v) => pct(v)} series={[{ label: 'No promotion', color: '#94a3b8' }, { label: 'Best promotion', color: '#0b1c2f' }]} groups={bySeg.map((g) => ({ label: g.name, values: [g.none, g.best] }))} />
          <div className="mt-1"><Legend items={[{ label: 'No promotion', color: '#94a3b8' }, { label: 'Best promotion', color: '#0b1c2f' }]} /></div>
        </>
      )}
    </Panel>
  );
}
