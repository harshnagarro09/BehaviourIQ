import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Download, FileSpreadsheet, RefreshCw, RotateCcw, Search, ShoppingBasket, SlidersHorizontal, UserRoundCheck } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Help } from '@/components/Help';
import { Btn, Card, Chip, FilterSelect, Kpi, Panel, Tabs, WindowChip } from '@/components/ui';
import { PageTop } from '@/pages/Analytics';
import { BudgetView } from '@/pages/BudgetPlanner';
import { Takeaway } from '@/components/Takeaway';
import { audienceTakeaway } from '@/lib/takeaways';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import { TYPE_IDS } from '@/engine/insights';
import type { TypeId } from '@/engine/behaviour';
import {
  ACTIVITY_LABEL, applyFilters, audienceKpis, buildAudience, DEFAULT_AUDIENCE, exportTable, GOALS, LEVEL_LABEL, sortRows, STATUS_LABEL,
  type AudienceFilters, type AudienceRow, type Goal, type SortKey, type Status,
} from '@/engine/audience';
import { predictionFor } from '@/lib/targeting';
import { saveFile, toCsv, toXlsx } from '@/lib/download';
import { roiColor } from '@/lib/colors';
import { inr, int, pct } from '@/lib/fmt';

type Tab = 'find' | 'budget';

export function CustomerPrediction() {
  const { params, syncParams } = useApp();
  const [tab, setTabState] = useState<Tab>(() => (params.tab === 'budget' ? 'budget' : 'find'));
  const setTab = (t: Tab) => { setTabState(t); syncParams({ tab: t }); };
  return (
    <>
      <PageTop
        title="Customer Prediction"
        sub="Find the customers most likely to respond to your next promotion, see why, and download the list for your campaign"
        tabs={<Tabs value={tab} onChange={setTab} options={[{ id: 'find', label: 'Find customers' }, { id: 'budget', label: 'Plan the budget' }]} />}
      />
      <div className="space-y-5 p-6">
        {tab === 'find' ? <FindView /> : <BudgetView />}
      </div>
    </>
  );
}

// ============================================================================ FIND CUSTOMERS
const GOAL_ICON: Record<Goal, ReactNode> = {
  repeat: <RefreshCw className="h-4 w-4" />, winback: <UserRoundCheck className="h-4 w-4" />, category: <ShoppingBasket className="h-4 w-4" />, custom: <SlidersHorizontal className="h-4 w-4" />,
};
const STATUS_TONE: Record<Status, 'green' | 'amber' | 'neutral' | 'red'> = { target: 'green', optional: 'amber', hold: 'neutral', avoid: 'red' };
const POT_COLOR = { high: 'var(--green)', medium: '#f59e0b', low: '#94a3b8' } as const;
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'score', label: 'Most likely to respond' }, { id: 'uplift', label: 'Biggest uplift' }, { id: 'p1', label: 'Chance to buy with offer' },
  { id: 'recency', label: 'Longest since last order' }, { id: 'spend', label: 'Highest spend' }, { id: 'cid', label: 'Customer ID' },
];
const PAGE = 15;

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1 block text-[11.5px] font-semibold text-[var(--ink-2)]">{label}</span>{children}</label>;
}

function FindView() {
  const e = useEngine();
  const { params, syncParams } = useApp();
  const cats = e.ds.categories;
  const [category, setCategoryState] = useState(params.category && cats.includes(params.category) ? params.category : cats.includes('Snacks') ? 'Snacks' : cats[0]);
  const [offerKey, setOfferKey] = useState('recommended');
  const [goal, setGoal] = useState<Goal>('repeat');
  const [f, setF] = useState<AudienceFilters>(GOALS[0].filters);
  const [sort, setSort] = useState<SortKey>('score');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const setCategory = (c: string) => { setCategoryState(c); setOfferKey('recommended'); setLimit(PAGE); syncParams({ tab: 'find', category: c }); };
  const set = <K extends keyof AudienceFilters>(k: K, v: AudienceFilters[K]) => { setF({ ...f, [k]: v }); setLimit(PAGE); };
  const pickGoal = (g: Goal) => { setGoal(g); setF({ ...GOALS.find((x) => x.id === g)!.filters, search: f.search }); setSort(g === 'winback' ? 'score' : 'score'); setLimit(PAGE); };

  const P = useMemo(() => predictionFor(e, category), [e, category]);
  const A = useMemo(() => buildAudience(e, P, offerKey), [e, P, offerKey]);
  const rows = useMemo(() => sortRows(applyFilters(A.rows, f), sort), [A, f, sort]);
  const k = useMemo(() => audienceKpis(rows), [rows]);
  const goalDef = GOALS.find((g) => g.id === goal)!;
  const edited = JSON.stringify({ ...f, search: '' }) !== JSON.stringify({ ...goalDef.filters, search: '' });
  const eligible = P.promos.filter((p, i) => P.cells.get('persuadable')![i].eligible.ok);
  const offerName = offerKey === 'recommended' ? 'the recommended offer' : P.promos.find((p) => p.key === offerKey)?.label ?? '';

  const download = (kind: 'csv' | 'xlsx') => {
    const { head, data } = exportTable(rows, category);
    const name = `target_customers_${category.replace(/\s+/g, '_').toLowerCase()}_${goal}`;
    if (kind === 'csv') saveFile(`${name}.csv`, toCsv(head, data), 'text/csv;charset=utf-8');
    else saveFile(`${name}.xlsx`, toXlsx(head, data, 'Target customers'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  return (
    <>
      <section>
        <p className="mb-2 text-[13px] font-semibold">What do you want this promotion to achieve?</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {GOALS.map((g) => (
            <button key={g.id} onClick={() => pickGoal(g.id)} aria-pressed={goal === g.id}
              className={`card flex items-start gap-3 p-4 text-left transition-shadow hover:shadow-md ${goal === g.id ? 'ring-2 ring-[var(--navy)]' : ''}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${goal === g.id ? 'bg-[var(--navy)] text-white' : 'bg-[var(--page)] text-[var(--ink-2)]'}`}>{GOAL_ICON[g.id]}</span>
              <span><span className="block text-[13.5px] font-bold">{g.title}</span><span className="mt-0.5 block text-[12px] leading-snug text-[var(--ink-3)]">{g.text}</span></span>
            </button>
          ))}
        </div>
      </section>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-3 text-[13px] font-semibold">Who to include<WindowChip /></p>
          <div className="flex items-center gap-3">
            {edited && goal !== 'custom' && <button onClick={() => pickGoal(goal)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />Back to “{goalDef.title}”</button>}
            <button onClick={() => { setF({ ...DEFAULT_AUDIENCE }); setGoal('custom'); setLimit(PAGE); }} className="text-[12px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]">Clear all filters</button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Product category to promote"><FilterSelect value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label={<>Offer<Help term="uplift" /></>}><FilterSelect value={offerKey} onChange={(v) => { setOfferKey(v); setLimit(PAGE); }} options={[{ value: 'recommended', label: 'Recommended per type' }, ...eligible.map((p) => ({ value: p.key, label: p.label }))]} /></Field>
          <Field label="Customer type"><FilterSelect value={f.type} onChange={(v) => set('type', v as AudienceFilters['type'])} options={[{ value: 'all', label: 'All customer types' }, { value: 'notDog', label: 'All except Sleeping Dogs' }, ...TYPES.map((t) => ({ value: t.id, label: t.name }))]} /></Field>
          <Field label="Activity"><FilterSelect value={f.activity} onChange={(v) => set('activity', v as AudienceFilters['activity'])} options={[{ value: 'all', label: 'Any activity' }, { value: 'active', label: 'Active' }, { value: 'lapsing', label: 'Slowing down or inactive' }, { value: 'slowing', label: 'Slowing down' }, { value: 'inactive', label: 'Inactive' }]} /></Field>
          <Field label="How often they buy"><FilterSelect value={f.frequency} onChange={(v) => set('frequency', v as AudienceFilters['frequency'])} options={[{ value: 'all', label: 'Any frequency' }, { value: 'frequent', label: 'Frequent (3+ orders a month)' }, { value: 'regular', label: 'Regular (1.5 to 3 a month)' }, { value: 'occasional', label: 'Occasional (under 1.5)' }]} /></Field>
          <Field label="How much they spend"><FilterSelect value={f.spend} onChange={(v) => set('spend', v as AudienceFilters['spend'])} options={[{ value: 'all', label: 'Any spend' }, { value: 'high', label: 'High (top third)' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low (bottom third)' }]} /></Field>
          <Field label="How they react to offers"><FilterSelect value={f.responsiveness} onChange={(v) => set('responsiveness', v as AudienceFilters['responsiveness'])} options={[{ value: 'all', label: 'Any' }, { value: 'high', label: 'Often buy on offers (40%+)' }, { value: 'medium', label: 'Sometimes (15 to 40%)' }, { value: 'low', label: 'Rarely (under 15%)' }]} /></Field>
          <div className="flex flex-col justify-end gap-2 pb-0.5 text-[12.5px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.categoryBuyers} onChange={(ev) => set('categoryBuyers', ev.target.checked)} className="accent-[var(--navy)]" />Regular {category} buyers only</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.recommendedOnly} onChange={(ev) => set('recommendedOnly', ev.target.checked)} className="accent-[var(--navy)]" />Only customers we recommend</label>
          </div>
        </div>
      </Card>

      {A.blocked && (
        <p className="flex items-start gap-2 rounded-lg border border-[#f1d9a0] bg-[#fdf8e8] px-3.5 py-2.5 text-[12.5px] text-[#92400e]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />This offer is not allowed in {category}: {A.blocked} Nobody gets it; pick another offer.</p>
      )}

      <Takeaway>{audienceTakeaway({ customers: k.customers, total: A.rows.length, category, offer: offerName, targets: k.targets, buyersWith: k.buyersWith, buyersWithout: k.buyersWithout, roi: k.roi })}</Takeaway>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Customers in audience" value={int(k.customers)} note={`of ${int(A.rows.length)} · ${int(k.targets)} recommended`} />
        <Kpi label="Expected buyers" value={int(k.buyersWith)} note={`vs ${int(k.buyersWithout)} with no offer · next 14 days`} />
        <Kpi help="uplift" emphasis label="Extra buyers (uplift)" value={`+${int(k.extraBuyers)}`} tone="good" note="because of the offer" />
        <Kpi help="roi" label="Expected ROI" value={k.investment > 0 ? k.roi.toFixed(2) : '–'} tone={k.roi < 0 ? 'bad' : undefined} note={k.investment > 0 ? `on ${inr(k.investment, 0)} promo cost` : 'no offer in this audience'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="text-[13px] font-semibold">Who is in this audience</p>
          <p className="mb-3 text-[12px] text-[var(--ink-3)]">Customers by type, and the offer each type gets in {category}.</p>
          <div className="space-y-2.5">
            {TYPES.map((t) => {
              const n = rows.filter((r) => r.type === t.id).length;
              const off = A.offerByType[t.id];
              return (
                <div key={t.id} className="grid grid-cols-[130px_1fr_44px] items-center gap-3">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.name}</span>
                  <div><div className="h-3 rounded bg-[var(--line-2)]"><div className="h-full rounded" style={{ width: `${k.customers ? (n / k.customers) * 100 : 0}%`, background: t.color }} /></div>
                    <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">{t.id === 'dog' ? 'Never offered: buys less when offers run' : off ? `Gets ${off.label}` : 'No discount: no offer pays back'}</p></div>
                  <span className="num text-right text-[13px] font-semibold">{int(n)}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <p className="text-[13px] font-semibold">How likely they are to respond<Help term="responseScore" /></p>
          <p className="mb-3 text-[12px] text-[var(--ink-3)]">The response score ranks every customer by how much more likely the offer makes them to buy.</p>
          <div className="space-y-2.5">
            {(['high', 'medium', 'low'] as const).map((lv) => {
              const n = rows.filter((r) => r.potential === lv).length;
              return (
                <div key={lv} className="grid grid-cols-[130px_1fr_44px] items-center gap-3">
                  <span className="text-[12.5px] font-medium">{LEVEL_LABEL[lv]} <span className="font-normal text-[var(--ink-3)]">({lv === 'high' ? '70–100' : lv === 'medium' ? '40–69' : '0–39'})</span></span>
                  <div className="h-3 rounded bg-[var(--line-2)]"><div className="h-full rounded" style={{ width: `${k.customers ? (n / k.customers) * 100 : 0}%`, background: POT_COLOR[lv] }} /></div>
                  <span className="num text-right text-[13px] font-semibold">{int(n)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] leading-snug text-[var(--ink-3)]">Start with High: these customers are moved the most by the offer, so less of the discount goes to people who would buy anyway.</p>
        </Card>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <div><p className="text-[13px] font-semibold">Customer list</p><p className="text-[12px] text-[var(--ink-3)]">{int(rows.length)} customers in this audience. Click a row to see why.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2.5"><Search className="h-3.5 w-3.5 text-[var(--ink-3)]" /><input value={f.search} onChange={(ev) => set('search', ev.target.value)} placeholder="Customer ID" aria-label="Search customer ID" className="w-24 bg-transparent text-[12.5px] outline-none" /></div>
            <FilterSelect value={sort} onChange={(v) => setSort(v as SortKey)} options={SORTS.map((s) => ({ value: s.id, label: `Sort: ${s.label}` }))} />
            <Btn onClick={() => download('csv')} disabled={!rows.length}><Download className="h-3.5 w-3.5" />CSV</Btn>
            <Btn variant="navy" onClick={() => download('xlsx')} disabled={!rows.length}><FileSpreadsheet className="h-3.5 w-3.5" />Download Excel</Btn>
          </div>
        </div>
        {rows.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead><tr className="border-y border-[var(--line)] text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                {['Customer', 'Type', 'Response score', 'Chance to buy', 'Offer', 'Activity', 'Recommendation', 'Why', ''].map((h, i) => <th key={i} className={`py-2.5 ${i === 0 ? 'pl-4 pr-3' : 'px-3'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.slice(0, limit).map((r) => <CustomerRow key={r.cid} r={r} open={open === r.cid} onToggle={() => setOpen(open === r.cid ? null : r.cid)} category={category} />)}
              </tbody>
            </table>
          </div>
        ) : <p className="py-12 text-center text-[13px] text-[var(--ink-3)]">No customers match these filters. Loosen a filter or pick another goal.</p>}
        <div className="flex items-center justify-between px-4 py-3 text-[12px] text-[var(--ink-3)]">
          <span>Showing {int(Math.min(limit, rows.length))} of {int(rows.length)}. Downloads include all {int(rows.length)}.</span>
          {limit < rows.length && <button className="font-semibold text-[var(--ink)] hover:underline" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
        </div>
      </Card>

      <Panel title="Which offer each customer type gets, and why" what={`Offers are decided for the whole customer type in ${category}: the best offer that pays back and lifts buying by 15+ points.`} defaultOpen={false}>
        <OfferByType P={P} offerByType={A.offerByType} />
      </Panel>
    </>
  );
}

function CustomerRow({ r, open, onToggle, category }: { r: AudienceRow; open: boolean; onToggle: () => void; category: string }) {
  const t = TYPE_BY_ID[r.type];
  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer border-b border-[var(--line-2)] align-middle hover:bg-[var(--page)] ${open ? 'bg-[var(--page)]' : ''}`}>
        <td className="py-2.5 pl-4 pr-3 font-semibold">{r.cid}</td>
        <td className="px-3"><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name}</span></td>
        <td className="px-3"><span className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--line)]"><span className="block h-full rounded-full" style={{ width: `${r.score}%`, background: POT_COLOR[r.potential] }} /></span><span className="num w-7 font-semibold">{r.score}</span></span></td>
        <td className="num whitespace-nowrap px-3">{r.offer ? <>{pct(r.p0)} → <b>{pct(r.p1)}</b></> : pct(r.p0)}</td>
        <td className="whitespace-nowrap px-3">{r.offer ? r.offer.label : <span className="text-[var(--ink-3)]">No offer</span>}</td>
        <td className="whitespace-nowrap px-3">{ACTIVITY_LABEL[r.activity]}</td>
        <td className="px-3"><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip></td>
        <td className="max-w-[340px] px-3 text-[12px] text-[var(--ink-2)]"><span className="line-clamp-1">{r.reason}</span></td>
        <td className="pr-4"><ChevronDown className={`h-3.5 w-3.5 text-[var(--ink-3)] transition-transform ${open ? 'rotate-180' : ''}`} /></td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--line)] bg-[var(--page)]">
          <td colSpan={9} className="px-4 pb-4 pt-1">
            <div className="grid gap-5 rounded-lg bg-white p-4 ring-1 ring-[var(--line)] lg:grid-cols-[1.4fr_1fr]">
              <div>
                <p className="text-[12px] font-semibold">Why this recommendation</p>
                <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-[var(--ink-2)]">{r.reasons.map((s) => <li key={s} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-3)]" />{s}</li>)}</ul>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[12px]">
                {([
                  ['Last order', `${r.recency} days ago`], ['Usually orders every', `${Math.round(r.gap)} days`], ['Orders a month', r.ordersPerMonth.toFixed(1)], ['Total spend', inr(r.spend, 0)],
                  ['Favourite category', r.favCategory], [`${category} in basket`, pct(r.catShare)], ['Bought on past offers', `${r.responded} of ${r.offered}`], ['Expected promo cost', r.offer ? inr(r.investment, 0) : '–'],
                ] as [string, string][]).map(([l, v]) => <div key={l}><dt className="text-[11px] text-[var(--ink-3)]">{l}</dt><dd className="num font-semibold">{v}</dd></div>)}
              </dl>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function OfferByType({ P, offerByType }: { P: ReturnType<typeof predictionFor>; offerByType: Record<TypeId, { key: string; label: string } | null> }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[760px] text-[12.5px]">
        <thead><tr className="border-y border-[var(--line)] text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
          {['Customer type', 'Customers', 'Offer', 'Chance to buy', 'Expected ROI', 'Why'].map((h, i) => <th key={h} className={`py-2.5 ${i === 0 ? 'pl-4 pr-3' : 'px-3'}`}>{h}</th>)}
        </tr></thead>
        <tbody>
          {TYPE_IDS.map((t) => {
            const def = TYPE_BY_ID[t];
            const off = offerByType[t];
            const cell = off ? P.cells.get(t)!.find((c) => c.promo.key === off.key) : null;
            return (
              <tr key={t} className="border-b border-[var(--line-2)] align-top last:border-0">
                <td className="py-2.5 pl-4 pr-3 font-semibold"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: def.color }} />{def.name}</span></td>
                <td className="num px-3 py-2.5">{int(P.members.get(t)!.length)}</td>
                <td className="px-3 py-2.5">{off ? off.label : <span className="text-[var(--ink-3)]">No offer</span>}</td>
                <td className="num px-3 py-2.5">{cell ? <>{pct(cell.p0)} → <b>{pct(cell.p1)}</b></> : '–'}</td>
                <td className="num px-3 py-2.5 font-semibold" style={{ color: cell ? roiColor(cell.roi) : undefined }}>{cell ? cell.roi.toFixed(2) : '–'}</td>
                <td className="max-w-[420px] px-3 py-2.5 text-[12px] leading-snug text-[var(--ink-2)]">{def.play}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
