import { useMemo, useState, type ReactNode } from 'react';
import { Download, Search } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import type { Behaviour } from '@/engine/behaviour';
import { Help, Lbl } from '@/components/Help';
import { Btn, Card, CardTitle, Chip, FilterSelect, Meter, Panel, TypeBadge, ViewToggle, WindowChip } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { PageTop } from '@/pages/Analytics';
import { behaviourSignals, compareOptions, promoOptions, shortOffer, type PromoOption } from '@/engine/options';
import { activeAt, buildCtxs } from '@/engine/planner';
import type { Expectation } from '@/engine/economics';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import { isoOf } from '@/engine/data';
import { inr, int, pct, shortDate } from '@/lib/fmt';
import { SIM_WINDOW_DAYS as PREDICTION_WINDOW_DAYS } from '@/engine/simulation';
import { Takeaway } from '@/components/Takeaway';
import { customerTakeaway } from '@/lib/takeaways';

type Group = 'target' | 'light' | 'none' | 'stronger' | 'skip';

export function CustomerPrediction() {
  const e = useEngine();
  const { params, syncParams } = useApp();
  const [category, setCategory] = useState('Beverages');
  const [persona, setPersona] = useState('all');
  const [channel, setChannel] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('id');
  const [limit, setLimit] = useState(12);
  const [sel, setSelState] = useState<string | null>(params.id ?? null);
  const setSel = (id: string) => { setSelState(id); syncParams({ id }); };

  const cats = e.ds.categories;
  const channels = [...new Set(e.records.map((r) => r.b.topChannel))].sort();

  const S = useMemo(() => {
    const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), category, e.asOf);
    const options = promoOptions(e.ds, category);
    const promos = options.filter((o) => o.family !== 'none');
    const cmp = compareOptions(e.ds, ctxs, category, options, e.assumptions);
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
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-white px-4 py-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-3)]">Filters</span>
      <FilterSelect value={category} onChange={(v) => { setCategory(v); }} options={cats.map((c) => ({ value: c, label: `Category: ${c}` }))} />
      <span className="flex items-center"><FilterSelect value={persona} onChange={setPersona} options={[{ value: 'all', label: 'All Customer Types' }, ...TYPES.map((t) => ({ value: t.id, label: t.name }))]} /><Help term="allTypes" below /></span>
      <FilterSelect value={channel} onChange={setChannel} options={[{ value: 'all', label: 'All Channels' }, ...channels.map((c) => ({ value: c, label: c }))]} />
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2.5"><Search className="h-3 w-3 text-[var(--ink-3)]" /><input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Customer ID" className="w-24 bg-transparent text-[12.5px] outline-none" /></div>
      <span className="ml-auto text-[12px] text-[var(--ink-3)]">{filtered.length} of {rowsAll.length} recently active customers</span>
    </div>
  );

  return (
    <>
      <PageTop title="Customer Prediction" sub="What promotion will this customer respond to? Behaviour in, simulated response out, one customer at a time" />
      {filters}
      <CustomerView S={S} filtered={filtered} sel={sel} setSel={setSel} sort={sort} setSort={setSort} limit={limit} setLimit={setLimit} category={category} />
    </>
  );
}

type Props = { S: { ctxs: ReturnType<typeof buildCtxs>; options: PromoOption[]; promos: PromoOption[]; x: (cid: string, k: string) => Expectation; best: Map<string, { o: PromoOption; e: Expectation } | null> }; filtered: { cid: string; r: ReturnType<typeof useEngine>['records'][number]; b: { o: PromoOption; e: Expectation } | null; p0: number }[]; category: string };

function CustomerView({ S, filtered, sel, setSel, sort, setSort, limit, setLimit, category }: Props & { sel: string | null; setSel: (s: string) => void; sort: string; setSort: (s: string) => void; limit: number; setLimit: (n: number) => void }) {
  const DEFAULT_CUSTOMER = 'C0407'; // shown in the detail panels until another customer is clicked
  const cid = sel && filtered.some((x) => x.cid === sel) ? sel : filtered.some((x) => x.cid === DEFAULT_CUSTOMER) ? DEFAULT_CUSTOMER : filtered[0]?.cid;
  const pick = cid ? S.best.get(cid) : null;
  return (
    <div className="space-y-3 p-4">
    {cid ? <div><Takeaway>{customerTakeaway({ cid, p0: S.x(cid, 'none').p0, best: pick ? { label: pick.o.label, p1: pick.e.p1, net: pick.e.net } : null })}</Takeaway></div> : null}
    <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex min-w-0 flex-col gap-3 [&>*:last-child]:flex-1">
      <Card pad={false} className="h-fit">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div><CardTitle title="Customers" sub={`Best promotion for ${category}, customer by customer`} /><div className="mt-1"><WindowChip /></div></div>
          <FilterSelect value={sort} onChange={setSort} options={[{ value: 'id', label: 'Sort: Customer ID' }, { value: 'net', label: 'Sort: expected profit' }, { value: 'resp', label: 'Sort: simulated response' }, { value: 'uplift', label: 'Sort: uplift' }, { value: 'recency', label: 'Sort: longest silent' }]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[470px] text-[12.5px]">
            <thead><tr className="border-y border-[var(--line)] text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              {['Customer', 'Type', 'Best promotion', 'Response', `Profit (${PREDICTION_WINDOW_DAYS}d)`].map((h, i, a) => <th key={h} className={`whitespace-nowrap py-2 ${i === 0 ? 'pl-4 pr-2.5' : i === a.length - 1 ? 'pl-2.5 pr-4' : 'px-2.5'}`}><Lbl t={h} /></th>)}
            </tr></thead>
            <tbody>
              {filtered.slice(0, limit).map((x) => (
                <tr key={x.cid} onClick={() => setSel(x.cid)} className={`cursor-pointer border-b border-[var(--line-2)] last:border-0 hover:bg-[var(--page)] ${cid === x.cid ? 'bg-[#eef6f2]' : ''}`}>
                  <td className="py-2 pl-4 pr-2.5 font-semibold">{x.cid}</td>
                  <td className="px-2.5"><TypeBadge type={x.r.type} /></td>
                  <td className="px-2.5">{x.b ? <b>{x.b.o.label}</b> : <span className="text-[var(--ink-3)]">No discount</span>}</td>
                  <td className="num whitespace-nowrap px-2.5">{x.b ? <>{pct(x.p0)} → <b>{pct(x.b.e.p1)}</b></> : pct(x.p0)}</td>
                  <td className="num pl-2.5 pr-4 font-semibold">{x.b ? inr(x.b.e.net) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-[12px] text-[var(--ink-3)]">
          <span>Showing {Math.min(limit, filtered.length)} of {filtered.length}</span>
          {limit < filtered.length && <button className="font-semibold text-[var(--ink)] hover:underline" onClick={() => setLimit(limit + 12)}>Show more</button>}
        </div>
      </Card>
      <TargetSummary S={S} filtered={filtered} category={category} />
      </div>
      <div className="flex min-w-0 flex-col gap-3 [&>*:last-child]:flex-1">
        {cid ? <Detail key={cid + category} cid={cid} S={S} category={category} /> : <Card><p className="py-10 text-center text-[13px] text-[var(--ink-3)]">No customers match these filters.</p></Card>}
      </div>
    </div>
    {cid && <SignalsChart key={'s' + cid + category} cid={cid} S={S} category={category} />}
    </div>
  );
}

function Detail({ cid, S, category }: { cid: string; S: Props['S']; category: string }) {
  const e = useEngine();
  const r = e.recById.get(cid)!;
  const b = r.b;
  const best = S.best.get(cid);
  const [optKey, setOptKey] = useState<string | null>(null);
  const [pView, setPView] = useState<'chart' | 'table'>('chart');
  const shown = S.promos.find((o) => o.key === (optKey ?? best?.o.key)) ?? S.promos[1];
  const none = S.x(cid, 'none');
  const topCats = Object.entries(b.catShare).sort((a, c) => c[1] - a[1]).slice(0, 2).map(([c, s]) => `${c} ${pct(s)}`).join(', ');
  const feats: [string, string][] = [
    ['Orders / month', b.ordersPerMonth.toFixed(1)], ['Last order', `${b.recencyDays}d ago`], ['Total spend', inr(b.totalSpend)], ['Order value', inr(b.avgOrderValue, 0)],
    ['Items / order', b.linesPerOrder.toFixed(1)], ['Top categories', topCats], ['On promotion', pct(b.promoReliance)], ['Avg discount taken', b.avgDiscAccepted ? `${b.avgDiscAccepted.toFixed(0)}%` : 'none yet'],
    ['Promo response', `${b.respondedCampaigns} of ${b.activeCampaigns}`], ['Full-price buys / month', b.fullPriceBuysPerMonth.toFixed(1)], ['Weekend orders', pct(b.weekendShare)], ['Preferred channel', `${b.topChannel} ${pct(b.channelShare[b.topChannel] ?? 0)}`],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3 [&>*:last-child]:flex-1">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5"><p className="text-[16px] font-bold">{cid}</p><Chip tone="navy">Customer type</Chip><TypeBadge type={r.type} /><span className="text-[11.5px] text-[var(--ink-3)]">{TYPE_BY_ID[r.type].tagline}</span></div>
          <span className="text-[11.5px] text-[var(--ink-3)]">customer since {shortDate(isoOf(b.firstDay))} · {b.nOrders} orders</span>
        </div>
        <p className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Behavioural features</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
          {feats.map(([l, v]) => <div key={l}><dt className="text-[11px] text-[var(--ink-3)]">{l}</dt><dd className="num text-[13px] font-semibold">{v}</dd></div>)}
        </dl>
        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">From behaviour to decision</p>
          <ol className="grid gap-2 sm:grid-cols-4">
            {([
              ['1 Behaviour', '#2a78d6', r.reasons.join('. ') + '.'],
              ['2 Insight', '#8a63d2', `${TYPE_BY_ID[r.type].name}: ${TYPE_BY_ID[r.type].tagline.toLowerCase()}.`],
              ['3 Decision', '#eb6834', best ? `Offer ${best.o.label}. ${TYPE_BY_ID[r.type].play}` : `No discount. ${TYPE_BY_ID[r.type].play}`],
              ['4 Outcome', 'var(--green)', best ? `Chance of buying ${pct(none.p1)} → ${pct(best.e.p1)}; net profit about ${inr(best.e.net, 0)} over ${PREDICTION_WINDOW_DAYS} days.` : `Keeps margin: ${pct(none.p1)} chance of buying anyway, and no offer adds profit.`],
            ] as [string, string, string][]).map(([t, c, x]) => (
              <li key={t} className="rounded-lg bg-[var(--page)] p-2.5" style={{ borderTop: `3px solid ${c}` }}>
                <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: c }}>{t}</p>
                <p className="mt-1 text-[11.5px] leading-snug text-[var(--ink-2)]">{x}</p>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <Panel flush title={`What will ${cid} respond to?`} what={`Simulated chance of buying ${category} in the next ${PREDICTION_WINDOW_DAYS} days and what each promotion would earn from this customer over the same ${PREDICTION_WINDOW_DAYS} days.`}
        right={<ViewToggle value={pView} onChange={setPView} />}
        legend={[
          { label: 'Grey bar / None', color: '#94a3b8', text: 'Chance of buying with no promotion at all.' },
          { label: 'Green bar', color: 'var(--green)', text: 'The promotion that earns the most from this customer.' },
          { label: 'Navy bars', color: 'var(--navy)', text: 'Other promotions.' },
          { label: 'Profit chart', text: 'Simulated net profit per customer for each promotion. Red means the discount costs more than it earns. Click a row in the table to see why in the next card.' },
        ]}>
        {pView === 'chart' ? (
          <div className="grid gap-4 px-4 pb-3 pt-1 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11.5px] font-semibold">Simulated chance of buying</p>
              <BarChart height={190} format={(v) => pct(v)} showValues color="var(--navy)"
                data={[{ label: 'None', value: none.p1, color: '#94a3b8' }, ...S.promos.map((o) => ({ label: shortOffer(o.label), value: S.x(cid, o.key).p1, color: best?.o.key === o.key ? 'var(--green)' : 'var(--navy)' }))]} />
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-semibold">{`Simulated profit over ${PREDICTION_WINDOW_DAYS} days`}</p>
              <BarChart height={190} format={(v) => inr(v, 0)} showValues posColor="var(--navy)" negColor="var(--red)"
                data={S.promos.map((o) => ({ label: shortOffer(o.label), value: S.x(cid, o.key).net, color: best?.o.key === o.key ? 'var(--green)' : undefined }))} />
            </div>
          </div>
        ) : (<div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[12.5px]">
            <thead><tr className="border-y border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              <th className="px-4 py-2 text-left">Promotion</th><th className="px-3 py-2 text-left">Simulated response</th>{['Uplift', 'Revenue', 'Margin', 'Cost', 'Net profit', 'ROI'].map((h) => <th key={h} className="px-3 py-2"><Lbl t={h} /></th>)}
            </tr></thead>
            <tbody>
              <tr className="border-b border-[var(--line-2)] text-right"><td className="px-4 py-2 text-left font-medium">No promotion</td><td className="px-3 text-left"><Meter value={none.p1} color="#94a3b8" width={70} /> <span className="num ml-1.5 font-semibold">{pct(none.p1)}</span></td><td colSpan={6} /></tr>
              {S.promos.map((o) => {
                const x = S.x(cid, o.key);
                const isBest = best?.o.key === o.key;
                return (
                  <tr key={o.key} onClick={() => setOptKey(o.key)} className={`cursor-pointer border-b border-[var(--line-2)] text-right last:border-0 ${isBest ? 'bg-[#f0fdf7]' : 'hover:bg-[var(--page)]'} ${shown.key === o.key ? 'ring-1 ring-inset ring-[var(--navy)]' : ''}`}>
                    <td className="px-4 py-2 text-left"><span className="font-semibold">{o.label}</span> {isBest && <Chip tone="green">Best</Chip>}</td>
                    <td className="px-3 text-left"><Meter value={x.p1} color={x.net > 0 ? 'var(--navy)' : '#cbd5e1'} width={70} /> <span className="num ml-1.5 font-semibold">{pct(x.p1)}</span></td>
                    <td className="num px-3">+{Math.round(x.uplift * 100)} pts</td><td className="num px-3">{inr(x.revenue, 0)}</td>
                    <td className="num px-3" style={{ color: x.profitOffer < 0 ? 'var(--red)' : undefined }}>{inr(x.profitOffer, 0)}</td><td className="num px-3">{inr(x.discountCost, 0)}</td>
                    <td className="num px-3 font-semibold" style={{ color: x.net < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{inr(x.net, 0)}</td>
                    <td className="num px-3">{x.discountCost > 0 ? (x.net / x.discountCost).toFixed(2) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>)}
        <p className="px-4 py-3 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
          {best
            ? <>Recommended: <b>{best.o.label}</b>. It lifts the chance of buying from {pct(none.p1)} to <b>{pct(best.e.p1)}</b> and earns about <b>{inr(best.e.net)}</b> after the discount given and any stock borrowed from future purchases.</>
            : <>Recommended: <b>no discount</b>. {none.p1 >= 0.35 ? 'This customer is already likely to buy without any offer, so a discount would mostly give margin away.' : 'No promotion earns more from this customer than it costs.'}</>}
        </p>
      </Panel>
    </div>
  );
}

/** each customer's best offer, classified into the five "who to contact" groups */
function targetRows(S: Props['S'], filtered: Props['filtered']) {
  return filtered.map((row) => {
    const x = row.b?.e ?? null;
    const used = row.b?.o ?? null;
    const maxP = Math.max(...S.promos.map((o) => S.x(row.cid, o.key).p1));
    let g: Group;
    if (x && x.net > 0 && x.uplift >= 0.03) g = x.uplift >= 0.1 ? 'target' : 'light';
    else if (row.p0 >= 0.35) g = 'none';
    else if (maxP >= 0.5) g = 'stronger';
    else g = 'skip';
    return { ...row, x, used, g };
  });
}

/** Who to contact: totals for contacting only the customers an offer pays off for, vs 20% off to everyone, and the CSV export */
function TargetSummary({ S, filtered, category }: Props) {
  const rows = useMemo(() => targetRows(S, filtered), [S, filtered]);
  const targeted = rows.filter((r) => r.g === 'target' || r.g === 'light');
  const sum = (fn: (r: (typeof rows)[number]) => number) => targeted.reduce((a, r) => a + fn(r), 0);
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

  const stats: [string, string, string, ReactNode?][] = [
    ['Customers to contact', int(targeted.length), `of ${int(filtered.length)} in view · ${pct(targeted.length / Math.max(1, filtered.length))}`],
    ['Extra buyers expected', int(inc), 'because of the offer'],
    ['Discount cost', inr(cost), `vs ${inr(trad.cost)} for 20% off to all`],
    ['Net profit', inr(net), `vs ${inr(trad.net)} for 20% off to all`, <Help key="h" term="netProfit" />],
  ];
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><CardTitle title="Who to contact" sub="Each customer's best promotion, only where it earns more than it costs" /></div>
        <Btn variant="navy" className="shrink-0" onClick={exportCsv} disabled={!list.length}><Download className="h-3 w-3" />Export target list (CSV)</Btn>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map(([l, v, note, help]) => (
          <div key={l} className="rounded-lg bg-[var(--page)] p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">{l}{help}</p>
            <p className="num mt-1 text-[18px] font-bold leading-none" style={{ color: l === 'Net profit' ? (net < 0 ? 'var(--red)' : 'var(--green-dark)') : undefined }}>{v}</p>
            <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">{note}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

const TONE = {
  up: { color: 'var(--green)', label: 'Supports response' },
  down: { color: 'var(--amber)', label: 'Holds back / buys anyway' },
  flat: { color: '#94a3b8', label: 'Neutral' },
} as const;

// numeric behaviour behind each signal, used to rank the customer against everyone else
const METRIC: Record<string, (b: Behaviour) => number> = {
  'Previous promotion response': (b) => b.respRate,
  'Purchase frequency': (b) => b.ordersPerMonth,
  'Product affinity': (b) => b.topCategoryShare,
  'Price sensitivity': (b) => b.promoReliance,
  'Recency': (b) => b.recencyDays,
  'Existing buying of our brand': (b) => b.fullPriceBuysPerMonth,
  'Timing preference': (b) => b.avgInterval,
  'Basket behaviour': (b) => b.linesPerOrder,
};

/** The behaviours as one chart: each bar is where this customer ranks among all customers; hover a row for details */
function SignalsChart({ cid, S, category }: { cid: string; S: Props['S']; category: string }) {
  const e = useEngine();
  const ctx = S.ctxs.find((c) => c.cid === cid)!;
  const signals = useMemo(() => behaviourSignals(ctx, category), [ctx, category]);
  const [hover, setHover] = useState<string | null>(null);
  const rank = (name: string) => {
    const f = METRIC[name];
    const mine = f(ctx.b);
    const all = e.records.map((r) => f(r.b));
    return all.filter((v) => v < mine).length / Math.max(1, all.length - 1);
  };
  return (
    <Panel title="Behaviour signals behind this simulation" what={`Where ${cid} ranks among all customers on each behaviour. Hover a bar for the details.`} defaultOpen={false}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ink-3)]">
        {(Object.keys(TONE) as (keyof typeof TONE)[]).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: TONE[k].color }} />{TONE[k].label}</span>)}
      </div>
      <div className="space-y-1">
        {signals.map((f) => {
          const r = rank(f.factor);
          return (
            <div key={f.factor} className="relative" onMouseEnter={() => setHover(f.factor)} onMouseLeave={() => setHover(null)}>
              <div className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${hover === f.factor ? 'bg-[var(--page)]' : ''}`}>
                <span className="w-[178px] shrink-0 truncate text-[12px] font-medium">{f.factor}</span>
                <div className="relative h-3 flex-1 rounded-full bg-[var(--line-2)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, r * 100)}%`, background: TONE[f.tone].color }} />
                  <span className="absolute inset-y-[-2px] left-1/2 w-px bg-[var(--ink-3)] opacity-50" />
                </div>
                <span className="num w-9 shrink-0 text-right text-[11.5px] font-semibold">{Math.round(r * 100)}%</span>
              </div>
              {hover === f.factor && (
                <div className="absolute left-[190px] top-full z-20 mt-0.5 w-[300px] rounded-md bg-[var(--navy)] px-3 py-2 text-[12px] leading-snug text-white shadow-lg">
                  <p className="font-semibold">{f.factor}</p>
                  <p className="mt-0.5 first-letter:uppercase">{f.reading}.</p>
                  <p className="mt-1 text-white/70">{f.use}</p>
                  <p className="mt-1 text-[11px] font-semibold" style={{ color: f.tone === 'up' ? '#6ee7b7' : f.tone === 'down' ? '#fcd34d' : '#cbd5e1' }}>{TONE[f.tone].label}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 border-t border-[var(--line)] pt-2 text-[11px] leading-snug text-[var(--ink-3)]">Bar length = share of customers this one is above (the line marks the typical customer). A long bar is a lot of that behaviour, not necessarily a good thing; the colour says how it affects the response to an offer.</p>
    </Panel>
  );
}
