import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Download, FileSpreadsheet, RefreshCw, RotateCcw, Search, ShoppingBasket, SlidersHorizontal, UserRoundCheck } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Help } from '@/components/Help';
import { Btn, Card, Chip, FilterSelect, Kpi, NextStep, Tabs, WindowChip } from '@/components/ui';
import { PageTop } from '@/pages/Analytics';
import { BudgetView } from '@/pages/BudgetPlanner';
import { Takeaway } from '@/components/Takeaway';
import { audienceTakeaway } from '@/lib/takeaways';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import type { TypeId } from '@/engine/behaviour';
import {
  ACTIVITY_LABEL, ALL_CATEGORIES, applyFilters, audienceKpis, buildAudience, buildAudienceAll, DEFAULT_AUDIENCE, describeFilters, exportTable, GOALS, LEVEL_LABEL, sortRows, STATUS_LABEL,
  type AudienceFilters, type AudienceRow, type Goal, type SharedAudience, type SortKey, type Status,
} from '@/engine/audience';
import { predictionFor } from '@/lib/targeting';
import { saveFile, toCsv, toXlsx } from '@/lib/download';
import { roiColor } from '@/lib/colors';
import { inr, int, pct } from '@/lib/fmt';

type Tab = 'find' | 'budget';

export function CustomerPrediction() {
  const { params, syncParams } = useApp();
  const [tab, setTabState] = useState<Tab>(() => (params.tab === 'budget' ? 'budget' : 'find'));
  const setTab = (t: Tab) => { setTabState(t); syncParams({ tab: t }); document.getElementById('main-scroll')?.scrollTo({ top: 0 }); };
  // the audience built in Find customers; Plan the budget plans for it
  const [audience, setAudience] = useState<SharedAudience | null>(null);
  return (
    <>
      <PageTop
        title="Customer Prediction"
        sub="Who to target with the next promotion and why, then how to spend the budget on them"
        tabs={<Tabs value={tab} onChange={setTab} options={[{ id: 'find', label: 'Find customers' }, { id: 'budget', label: 'Plan the budget' }]} />}
      />
      <div className="space-y-5 p-6">
        {/* both tabs stay mounted (only one is shown), so switching never loses a selection */}
        <div hidden={tab !== 'find'} className="space-y-5"><FindView onAudience={setAudience} onPlan={() => setTab('budget')} /></div>
        <div hidden={tab !== 'budget'}><BudgetView audience={audience} onFind={() => setTab('find')} /></div>
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

function FindView({ onAudience, onPlan }: { onAudience: (a: SharedAudience) => void; onPlan: () => void }) {
  const e = useEngine();
  const { params, syncParams } = useApp();
  const cats = e.ds.categories;
  const [category, setCategoryState] = useState(params.category && (params.category === ALL_CATEGORIES || cats.includes(params.category)) ? params.category : ALL_CATEGORIES);
  const [offerKey, setOfferKey] = useState('recommended');
  const [goal, setGoal] = useState<Goal>('repeat');
  const [f, setF] = useState<AudienceFilters>(GOALS[0].filters);
  const [sort, setSort] = useState<SortKey>('score');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const setCategory = (c: string) => { setCategoryState(c); setOfferKey('recommended'); setLimit(PAGE); syncParams({ tab: 'find', category: c }); };
  const set = <K extends keyof AudienceFilters>(k: K, v: AudienceFilters[K]) => { setF({ ...f, [k]: v }); setLimit(PAGE); };
  const pickGoal = (g: Goal) => { setGoal(g); setF({ ...GOALS.find((x) => x.id === g)!.filters, search: f.search }); setSort(g === 'winback' ? 'score' : 'score'); setLimit(PAGE); };

  // "All categories": every customer is scored for the category where an offer helps them most (see buildAudienceAll)
  const isAll = category === ALL_CATEGORIES;
  const P = useMemo(() => (isAll ? null : predictionFor(e, category)), [e, category, isAll]);
  const A = useMemo(() => (isAll
    ? { ...buildAudienceAll(e, (c) => predictionFor(e, c)), blocked: undefined as string | undefined }
    : { ...buildAudience(e, P!, offerKey), varies: new Set<TypeId>() }), [e, P, offerKey, isAll]);
  const rows = useMemo(() => sortRows(applyFilters(A.rows, f), sort), [A, f, sort]);
  const k = useMemo(() => audienceKpis(rows), [rows]);
  const goalDef = GOALS.find((g) => g.id === goal)!;
  useEffect(() => {
    onAudience({ category, goal: goal === 'custom' ? 'Custom audience' : goalDef.title, ids: rows.map((r) => r.cid), criteria: describeFilters(f, category), total: A.rows.length });
  }, [rows, category, goal, goalDef.title, f, A.rows.length, onAudience]);
  const edited = JSON.stringify({ ...f, search: '' }) !== JSON.stringify({ ...goalDef.filters, search: '' });
  const eligible = P ? P.promos.filter((p, i) => P.cells.get('persuadable')![i].eligible.ok) : [];
  const offerName = offerKey === 'recommended' || !P ? 'the recommended offer' : P.promos.find((p) => p.key === offerKey)?.label ?? '';
  const where = isAll ? 'the category promoted to them' : category;

  const download = (kind: 'csv' | 'xlsx') => {
    const { head, data } = exportTable(rows);
    const name = `target_customers_${category.replace(/\s+/g, '_').toLowerCase()}_${goal}`;
    if (kind === 'csv') saveFile(`${name}.csv`, toCsv(head, data), 'text/csv;charset=utf-8');
    else saveFile(`${name}.xlsx`, toXlsx(head, data, 'Target customers'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-3 text-[13px] font-semibold">What should the promotion achieve?<WindowChip /></p>
          <div className="flex items-center gap-3">
            {edited && goal !== 'custom' && <button onClick={() => pickGoal(goal)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />Back to “{goalDef.title}”</button>}
            <button onClick={() => { setF({ ...DEFAULT_AUDIENCE }); setGoal('custom'); setLimit(PAGE); }} className="text-[12px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]">Clear all filters</button>
          </div>
        </div>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Goal">
          {GOALS.map((g) => (
            <button key={g.id} role="radio" aria-checked={goal === g.id} onClick={() => pickGoal(g.id)}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left ${goal === g.id ? 'border-[var(--navy)] bg-[#eef3fa]' : 'border-[var(--line)] bg-white hover:border-[#c9d2de]'}`}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5 ${goal === g.id ? 'bg-[var(--navy)] text-white' : 'bg-[var(--page)] text-[var(--ink-2)]'}`}>{GOAL_ICON[g.id]}</span>
              <span className="min-w-0"><span className={`block text-[12.5px] font-bold ${goal === g.id ? 'text-[var(--navy)]' : ''}`}>{g.title}</span><span className="block text-[11.5px] leading-snug text-[var(--ink-3)]">{g.text}</span></span>
            </button>
          ))}
        </div>
        <p className="mt-4 border-t border-[var(--line-2)] pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">Who to include</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Product category to promote"><FilterSelect value={category} onChange={setCategory} options={[{ value: ALL_CATEGORIES, label: 'All categories' }, ...cats.map((c) => ({ value: c, label: c }))]} /></Field>
          <Field label={<>Offer<Help term="uplift" /></>}><FilterSelect value={offerKey} onChange={(v) => { setOfferKey(v); setLimit(PAGE); }} options={[{ value: 'recommended', label: isAll ? 'Recommended per type and category' : 'Recommended per type' }, ...eligible.map((p) => ({ value: p.key, label: p.label }))]} /></Field>
          <Field label="Customer type"><FilterSelect value={f.type} onChange={(v) => set('type', v as AudienceFilters['type'])} options={[{ value: 'all', label: 'All customer types' }, { value: 'notDog', label: 'All except Sleeping Dogs' }, ...TYPES.map((t) => ({ value: t.id, label: t.name }))]} /></Field>
          <Field label="Activity"><FilterSelect value={f.activity} onChange={(v) => set('activity', v as AudienceFilters['activity'])} options={[{ value: 'all', label: 'Any activity' }, { value: 'active', label: 'Active' }, { value: 'lapsing', label: 'Slowing down or inactive' }, { value: 'slowing', label: 'Slowing down' }, { value: 'inactive', label: 'Inactive' }]} /></Field>
          <Field label="How often they buy"><FilterSelect value={f.frequency} onChange={(v) => set('frequency', v as AudienceFilters['frequency'])} options={[{ value: 'all', label: 'Any frequency' }, { value: 'frequent', label: 'Frequent (3+ orders a month)' }, { value: 'regular', label: 'Regular (1.5 to 3 a month)' }, { value: 'occasional', label: 'Occasional (under 1.5)' }]} /></Field>
          <Field label="How much they spend"><FilterSelect value={f.spend} onChange={(v) => set('spend', v as AudienceFilters['spend'])} options={[{ value: 'all', label: 'Any spend' }, { value: 'high', label: 'High (top third)' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low (bottom third)' }]} /></Field>
          <Field label="How they react to offers"><FilterSelect value={f.responsiveness} onChange={(v) => set('responsiveness', v as AudienceFilters['responsiveness'])} options={[{ value: 'all', label: 'Any' }, { value: 'high', label: 'Often buy on offers (40%+)' }, { value: 'medium', label: 'Sometimes (15 to 40%)' }, { value: 'low', label: 'Rarely (under 15%)' }]} /></Field>
          <div className="flex flex-col justify-end gap-2 pb-0 text-[12.5px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.categoryBuyers} onChange={(ev) => set('categoryBuyers', ev.target.checked)} className="accent-[var(--navy)]" />Regular {isAll ? 'buyers of the category' : `${category} buyers`} only</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.recommendedOnly} onChange={(ev) => set('recommendedOnly', ev.target.checked)} className="accent-[var(--navy)]" />Only customers we recommend</label>
          </div>
        </div>
      </Card>

      {A.blocked && (
        <p className="flex items-start gap-2 rounded-lg border border-[#f1d9a0] bg-[#fdf8e8] px-3.5 py-2.5 text-[12.5px] text-[#92400e]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />This offer is not allowed in {category}: {A.blocked} Nobody gets it; pick another offer.</p>
      )}

      <Takeaway>{audienceTakeaway({ customers: k.customers, total: A.rows.length, category: where, offer: offerName, offered: k.offered, targets: k.targets, buyersWith: k.buyersWith, buyersWithout: k.buyersWithout, roi: k.roi })}</Takeaway>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Customers in audience" value={int(k.customers)} note={`of ${int(A.rows.length)} · ${int(k.offered)} would get an offer`} />
        <Kpi label="Expected buyers" value={int(k.buyersWith)} note={`vs ${int(k.buyersWithout)} with no offer · next 14 days`} />
        <Kpi help="uplift" emphasis label="Extra buyers (uplift)" value={`+${int(k.extraBuyers)}`} tone="good" note={`from the ${int(k.offered)} who get the offer`} />
        <Kpi help="roi" label="Expected ROI" value={k.investment > 0 ? k.roi.toFixed(2) : '–'} tone={k.roi < 0 ? 'bad' : undefined} note={k.investment > 0 ? `on ${inr(k.investment, 0)} promotion cost` : 'no offer in this audience'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="text-[13px] font-semibold">Who is in this audience, and who gets an offer</p>
          <p className="mb-3 text-[12px] text-[var(--ink-3)]">The {int(k.customers)} customers by type. The dark part of each bar gets the offer in {where}; the light part is held back. Hover a group for how to treat it.</p>
          <div className="space-y-3">
            {TYPES.map((t) => {
              const inType = rows.filter((r) => r.type === t.id);
              const n = inType.length;
              const got = inType.filter((r) => r.offer).length;
              const off = A.offerByType[t.id];
              // the same per-group figures the KPIs add up: buying chance without and with the offer, and return on its cost
              const p0 = n ? inType.reduce((s, r) => s + r.p0, 0) / n : 0;
              const p1 = n ? inType.reduce((s, r) => s + (r.offer ? r.p1 : r.p0), 0) / n : 0;
              const inv = inType.reduce((s, r) => s + r.investment, 0);
              const roi = inv > 0 ? inType.reduce((s, r) => s + r.incMargin, 0) / inv : null;
              return (
                <div key={t.id} className="grid grid-cols-[130px_1fr_92px] items-start gap-3" title={t.play}>
                  <span className="flex items-center gap-2 pt-px text-[12.5px] font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.name}</span>
                  <div>
                    <div className="flex h-3 overflow-hidden rounded bg-[var(--line-2)]" title={`${int(got)} get the offer, ${int(n - got)} held back`}>
                      <div style={{ width: `${k.customers ? (got / k.customers) * 100 : 0}%`, background: t.color }} />
                      <div style={{ width: `${k.customers ? ((n - got) / k.customers) * 100 : 0}%`, background: t.color, opacity: 0.28 }} />
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-3)]">{t.id === 'dog' ? 'Never offered: they buy less when offers run' : A.varies.has(t.id) ? 'Get the best offer for the category promoted to them' : off ? `Get ${off.label}` : t.id === 'sure' ? 'Held back: they buy anyway, a discount only gives margin away' : 'Held back: offers barely move them, so none pays back'}{got > 0 && roi !== null && <> · buying chance {pct(p0)} → <b className="font-semibold text-[var(--ink-2)]">{pct(p1)}</b> · ROI <b className="font-semibold" style={{ color: roiColor(roi) }}>{roi.toFixed(2)}</b></>}</p>
                  </div>
                  <span className="num text-right text-[12px] leading-tight"><b className="text-[13px]">{int(n)}</b> <span className="text-[var(--ink-3)]">({pct(k.customers ? n / k.customers : 0)})</span><span className="block text-[11px] text-[var(--ink-3)]">{int(got)} get offer</span></span>
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
                {rows.slice(0, limit).map((r) => <CustomerRow key={r.cid} r={r} open={open === r.cid} onToggle={() => setOpen(open === r.cid ? null : r.cid)} showCategory={isAll} />)}
              </tbody>
            </table>
          </div>
        ) : <p className="py-12 text-center text-[13px] text-[var(--ink-3)]">No customers match these filters. Loosen a filter or pick another goal.</p>}
        <div className="flex items-center justify-between px-4 py-3 text-[12px] text-[var(--ink-3)]">
          <span>Showing {int(Math.min(limit, rows.length))} of {int(rows.length)}. Downloads include all {int(rows.length)}.</span>
          {limit < rows.length && <button className="font-semibold text-[var(--ink)] hover:underline" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
        </div>
      </Card>

      {rows.length > 0 && <NextStep text={<>Decide how much to spend on these <b className="font-semibold text-[var(--ink)]">{int(rows.length)} customers</b>, on which products and with which discounts.</>} action="Plan the budget" onClick={onPlan} />}
    </>
  );
}

function CustomerRow({ r, open, onToggle, showCategory }: { r: AudienceRow; open: boolean; onToggle: () => void; showCategory: boolean }) {
  const category = r.category;
  const t = TYPE_BY_ID[r.type];
  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer border-b border-[var(--line-2)] align-middle hover:bg-[var(--page)] ${open ? 'bg-[var(--page)]' : ''}`}>
        <td className="py-2.5 pl-4 pr-3 font-semibold">{r.cid}</td>
        <td className="px-3"><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name}</span></td>
        <td className="px-3"><span className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--line)]"><span className="block h-full rounded-full" style={{ width: `${r.score}%`, background: POT_COLOR[r.potential] }} /></span><span className="num w-7 font-semibold">{r.score}</span></span></td>
        <td className="num whitespace-nowrap px-3">{r.offer ? <>{pct(r.p0)} → <b>{pct(r.p1)}</b></> : pct(r.p0)}</td>
        <td className="whitespace-nowrap px-3">{r.offer ? r.offer.label : <span className="text-[var(--ink-3)]">No offer</span>}{showCategory && <span className="block text-[11px] text-[var(--ink-3)]">{category}</span>}</td>
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
