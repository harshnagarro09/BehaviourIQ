// Behaviour Analytics > Customer types. One filter area (period, products, and optional customer filters) drives the page:
//   customer groups      pick one of the four types (or everyone)
//   at a glance          the key facts about the chosen customers and how to treat them
//   detail tabs          what they buy | promotion response (same customers, period, products) | behaviour alerts
// All figures come from actual order lines in the chosen period (engine/groupInsights.ts) and the per-customer campaign
// results (engine/campaigns.ts via lib/analytics.ts).
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing, Check, ChevronDown, Megaphone, Package, RotateCcw, ShoppingBag, SlidersHorizontal, Target, Users, X } from 'lucide-react';
import { useEngine } from '@/state';
import { Picker } from '@/components/Picker';
import { useProductFilter } from '@/components/ProductScope';
import { Help } from '@/components/Help';
import { FitHeat } from '@/components/charts';
import { Chip } from '@/components/ui';
import { TYPE_ACTION } from '@/lib/types';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import type { TypeId } from '@/engine/behaviour';
import { skuCatalog } from '@/engine/products';
import { offerName } from '@/engine/options';
import { MECH_HOW, MECH_LABEL, MECH_ORDER, type MechKey } from '@/engine/mechanics';
import {
  applyRules, behaviourAlerts, customerFacts, leaning, METRIC_TEXT, monthsIn, purchases, ruleDefs,
  type Alert, type CustomerFacts, type Period, type Purchases, type RuleDef, type RuleKey, type Rules, type Slice,
} from '@/engine/groupInsights';
import { aggregateByCampaignFor, incShareOf, mechOf, respOf, roiOf, sumAggs, type Agg } from '@/lib/analytics';
import { driversOf } from '@/lib/targeting';
import { rateFill, roiColor, roiFill } from '@/lib/colors';
import type { GlossaryKey } from '@/lib/glossary';
import { dateLabel, inr, int, pct, shortDate } from '@/lib/fmt';
import { isoOf, type Campaign } from '@/engine/data';

type PeriodKey = '3m' | '6m' | '12m' | 'all';
const PERIODS: { id: PeriodKey; label: string; phrase: string; days: number }[] = [
  { id: '3m', label: '3 months', phrase: 'the last 3 months', days: 92 }, { id: '6m', label: '6 months', phrase: 'the last 6 months', days: 183 },
  { id: '12m', label: '12 months', phrase: 'the last 12 months', days: 365 }, { id: 'all', label: 'All time', phrase: 'all time', days: 1e6 },
];
type GroupId = 'all' | TypeId;
const SMALL = 30; // below this many customers, patterns may be chance
const MIN_REACH = 8; // below this many reached customers, a promotion result is not read
const NAVY = '#0b1c2f';
const colorOf = (id: GroupId) => (id === 'all' ? NAVY : TYPE_BY_ID[id].color);

/** one header style for every card on the page: icon tile, title, one-line explanation, optional controls on the right */
function SectionHead({ icon, title, sub, right, color = NAVY }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; color?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg [&>svg]:h-3.5 [&>svg]:w-3.5" style={{ background: `${color}14`, color }}>{icon}</span>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-bold leading-tight tracking-tight text-[var(--ink)]">{title}</h3>
          {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-3)]">{sub}</p>}
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** the small switch used on this page */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--page)] p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`whitespace-nowrap rounded-md px-3 py-1 text-[12px] font-semibold transition-colors ${value === o.id ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink)]'}`}>{o.label}</button>
      ))}
    </div>
  );
}

function More({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--navy)] hover:underline">
      {children}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

export function CustomerGroups() {
  const e = useEngine();
  const [period, setPeriod] = useState<PeriodKey>('6m');
  const [groupId, setGroupId] = useState<GroupId>('all');
  const [rawRules, setRules] = useState<Rules>({});
  const [narrow, setNarrow] = useState(false);
  const [tab, setTab] = useState<'buy' | 'promo' | 'alerts'>('buy');
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const products = useProductFilter(catalog);

  const pdef = PERIODS.find((x) => x.id === period)!;
  const p: Period = useMemo(() => ({ from: Math.max(e.ds.minDay, e.ds.maxDay - pdef.days + 1), to: e.ds.maxDay }), [e, pdef]);
  const facts = useMemo(() => customerFacts(e.ds, e.typeOf, p), [e, p]);
  const ids = useMemo(() => new Set(products.picked.map((s) => s.productId)), [products.picked]);
  const scope = useMemo(() => (products.isAll ? () => true : (l: { productId: string }) => ids.has(l.productId)), [products.isAll, ids]);
  // the customer filters follow the product filter: "Bought on promotion" lists only promotions the chosen products were bought under
  const inScope = useMemo(() => (products.isAll ? undefined : (pid: string) => ids.has(pid)), [products.isAll, ids]);
  const defs = useMemo(() => ruleDefs(facts, e.ds.campaigns, inScope), [facts, e, inScope]);
  // a pick that no longer exists under the current filters (e.g. a promotion from another category) is not applied
  const rules = useMemo<Rules>(() => Object.fromEntries(Object.entries(rawRules).filter(([k, v]) => v && defs.find((d) => d.key === k)?.options.some((o) => o.value === v))), [rawRules, defs]);
  // alerts describe whole customer types, so they are read over all products
  const alerts = useMemo(() => behaviourAlerts(facts, ruleDefs(facts)), [facts]);
  const inGroup = (id: GroupId) => (id === 'all' ? facts : facts.filter((f) => f.type === id));
  const group = useMemo(() => applyRules(groupId === 'all' ? facts : facts.filter((f) => f.type === groupId), defs, rules), [facts, defs, rules, groupId]);
  const groupIds = useMemo(() => new Set(group.map((f) => f.cid)), [group]);
  const allIds = useMemo(() => new Set(facts.map((f) => f.cid)), [facts]);
  const G = useMemo(() => purchases(e.ds, groupIds, p, scope), [e, groupIds, p, scope]);
  const A = useMemo(() => purchases(e.ds, allIds, p, scope), [e, allIds, p, scope]);
  const cards = useMemo(() => (['all', ...TYPES.map((t) => t.id)] as GroupId[]).map((id) => {
    const fs = inGroup(id);
    return { id, n: fs.length, P: purchases(e.ds, new Set(fs.map((f) => f.cid)), p, scope) };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- inGroup is derived from facts
  }), [e, facts, p, scope]);

  // promotions that ran in the period, in the categories of the chosen products (promotions run at category level)
  const cats = useMemo(() => (products.isAll ? null : new Set(products.picked.map((s) => s.category))), [products.isAll, products.picked]);
  const camps = useMemo(() => e.ds.campaigns.filter((c) => c.end >= p.from && c.start <= p.to && (!cats || cats.has(c.category))), [e, p, cats]);

  const months = monthsIn(p);
  const ruleCount = Object.values(rules).filter(Boolean).length;
  const groupName = groupLabel(groupId, rules, defs);
  const explore = (a: Alert) => {
    setGroupId(a.type); setRules({ [a.rule.key]: a.rule.value }); products.reset(); setNarrow(true); setTab('buy');
    document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const empty = group.length === 0;
  const activeRules = defs.flatMap((d) => { const o = d.options.find((x) => x.value === rules[d.key]); return o ? [{ key: d.key, text: `${d.label}: ${o.label}` }] : []; });
  const anyFilter = ruleCount > 0 || !products.isAll || period !== '6m';
  const clearAll = () => { setRules({}); products.reset(); setPeriod('6m'); };
  const same = groupId === 'all' && ruleCount === 0;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ one filter area for the whole page */}
      <section className="card">
        <div className="grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">Period</span>
            <div className="flex h-10 w-full rounded-lg border border-[var(--line)] bg-white p-1 lg:w-auto">
              {PERIODS.map((x) => (
                <button key={x.id} onClick={() => setPeriod(x.id)} className={`flex-1 whitespace-nowrap rounded-md px-3 text-[12.5px] font-semibold transition-colors lg:flex-none ${period === x.id ? 'bg-[var(--navy)] text-white shadow-sm' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{x.label}</button>
              ))}
            </div>
          </div>
          {products.pickers[0]}{products.pickers[1]}{products.pickers[2]}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line-2)] px-4 py-2.5">
          <button onClick={() => setNarrow(!narrow)} aria-expanded={narrow}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${narrow || ruleCount ? 'border-[var(--navy)] bg-[#eef3fa] text-[var(--navy)]' : 'border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-3)]'}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />Customer filters{ruleCount > 0 && <span className="rounded-full bg-[var(--navy)] px-1.5 text-[10.5px] text-white">{ruleCount}</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${narrow ? 'rotate-180' : ''}`} />
          </button>
          {activeRules.map((r) => (
            <span key={r.key} className="inline-flex items-center gap-1 rounded-full bg-[var(--page)] py-1 pl-2.5 pr-1.5 text-[11.5px] font-medium text-[var(--ink-2)]">
              {r.text}<button onClick={() => setRules({ ...rules, [r.key]: undefined })} aria-label={`Remove ${r.text}`} className="rounded-full p-0.5 hover:bg-white"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {!narrow && !ruleCount && <span className="text-[11.5px] text-[var(--ink-3)]">Spending, shopping habits, last visit, deals, channel or a promotion they bought on</span>}
          <span className="ml-auto flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--ink-3)]">
            <span>{dateLabel(isoOf(p.from))} – {dateLabel(isoOf(p.to))}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${group.length < SMALL ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#eef3fa] text-[var(--navy)]'}`}><Users className="h-3.5 w-3.5" />{int(group.length)} of {int(facts.length)} customers</span>
            {anyFilter && <button onClick={clearAll} className="inline-flex items-center gap-1 font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />Reset all</button>}
          </span>
        </div>
        {narrow && (
          <div className="grid gap-3 border-t border-[var(--line-2)] bg-[#fafbfd] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {defs.map((d) => (
              <Picker key={d.key} label={d.label} value={rules[d.key] ?? 'all'} searchable={d.options.length > 8} placeholder="Search promotions" active={!!rules[d.key]}
                onChange={(v) => setRules({ ...rules, [d.key]: v === 'all' ? undefined : v })}
                options={[{ value: 'all', label: d.any }, ...d.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint, group: o.group }))]} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ customer groups */}
      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-[15px] font-bold tracking-tight">Customer groups</h2>
          <p className="text-[12px] text-[var(--ink-3)]">Every customer is one of four types, based on how they react to offers. Click a group to focus the page on it.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => <GroupCard key={c.id} id={c.id} n={c.n} total={facts.length} P={c.P} A={A} months={months} on={groupId === c.id} onClick={() => setGroupId(c.id)} />)}
        </div>
      </section>

      {/* ------------------------------------------------------------ the key insight */}
      {empty
        ? <div className="card flex flex-col items-center gap-2 py-10 text-center"><Users className="h-6 w-6 text-[var(--ink-3)]" /><p className="text-[13.5px] font-semibold">No customers match this combination</p><p className="text-[12.5px] text-[var(--ink-3)]">Remove a customer filter to see results.</p></div>
        : <Summary groupId={groupId} name={groupName} n={group.length} G={G} A={A} months={months} small={group.length < SMALL} scoped={!products.isAll} scopeLabel={products.label} />}

      {/* ------------------------------------------------------------ details, one topic at a time */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" className="inline-flex rounded-xl border border-[var(--line)] bg-white p-1 shadow-[0_1px_2px_rgba(11,28,47,0.04)]">
            {([['buy', 'What they buy', <ShoppingBag key="i" className="h-3.5 w-3.5" />], ['promo', 'Promotion response', <Megaphone key="i" className="h-3.5 w-3.5" />], ['alerts', `Behaviour alerts${alerts.length ? ` (${alerts.length})` : ''}`, <BellRing key="i" className="h-3.5 w-3.5" />]] as const).map(([id, label, icon]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${tab === id ? 'bg-[var(--navy)] text-white shadow-sm' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{icon}{label}</button>
            ))}
          </div>
          <p className="max-w-[620px] text-[12px] leading-snug text-[var(--ink-3)]">
            {tab === 'buy' && <>Where <b className="font-semibold text-[var(--ink-2)]">{groupName}</b> spend their money{products.isAll ? '' : ` within ${products.label}`}, compared with all customers.</>}
            {tab === 'promo' && <>Past promotions for the same {int(group.length)} customers in {pdef.phrase}{cats ? ` (${[...cats].join(', ')} promotions: they run at category level)` : ''}.</>}
            {tab === 'alerts' && <>Customers inside a group who behave clearly differently from the rest of it in {pdef.phrase}.</>}
          </p>
        </div>
        {tab === 'buy' && (empty ? null : (
          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Mix color={NAVY} same={same} G={G} A={A} level={products.picked.length <= 1 ? 'sku' : new Set(products.picked.map((s) => s.category)).size === 1 ? 'sku' : 'category'} />
            <TopProducts G={G} A={A} customers={group.length} same={same} />
          </div>
        ))}
        {tab === 'promo' && !empty && <GroupResponse ids={groupIds} allIds={allIds} name={groupName} color={NAVY} isAll={same} camps={camps} facts={facts} defs={defs} rules={rules} inScope={inScope} />}
        {tab === 'alerts' && <Alerts alerts={alerts} onExplore={explore} />}
      </section>
    </div>
  );
}

const plainName = (id: GroupId) => (id === 'all' ? 'All customers' : TYPE_BY_ID[id].name);
function groupLabel(id: GroupId, rules: Rules, defs: RuleDef[]) {
  const parts = defs.flatMap((d) => {
    const o = d.options.find((x) => x.value === rules[d.key]);
    if (!o) return [];
    return [d.key === 'channel' ? `mainly ${o.label === 'Store' ? 'in store' : o.label === 'App' ? 'in the app' : 'online'}` : d.key === 'promo' ? `bought on ${o.label}` : o.label.toLowerCase()];
  });
  return parts.length ? `${plainName(id)}: ${parts.join(', ')}` : plainName(id);
}
const perCustMonth = (P: Purchases, n: number, months: number) => (n ? P.spend / n / months : 0);

/** the category a group leans to most compared with everyone (needs enough buyers and a real difference) */
function standsOut(P: Purchases, A: Purchases) {
  return P.categories
    .map((c) => ({ c, l: leaning(c, P, A.categories.find((x) => x.key === c.key), A.spend) }))
    .filter((x) => x.l !== null && x.l >= 1.2 && P.spend > 0 && x.c.spend / P.spend >= 0.05)
    .sort((a, b) => b.l! - a.l!)[0];
}

function GroupCard({ id, n, total, P, A, months, on, onClick }: { id: GroupId; n: number; total: number; P: Purchases; A: Purchases; months: number; on: boolean; onClick: () => void }) {
  const t = id === 'all' ? null : TYPE_BY_ID[id];
  const top = P.categories[0];
  const lean = id === 'all' ? undefined : standsOut(P, A);
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`flex h-full flex-col rounded-lg border bg-white px-3.5 py-3 text-left ${on ? 'border-[var(--navy)] shadow-[inset_0_0_0_1px_var(--navy)]' : 'border-[var(--line)] hover:border-[#c9d2de]'}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(id) }} />
          <span className="truncate text-[13px] font-semibold text-[var(--ink)]">{plainName(id)}</span>
        </span>
        {on && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--navy)]" />}
      </span>
      <span className="mt-0.5 truncate text-[11px] text-[var(--ink-3)]">{t ? t.tagline : 'Everyone who bought in the period'}</span>
      <span className="mt-2.5 flex items-baseline justify-between gap-2">
        <span><span className="num text-[17px] font-bold leading-none tracking-tight">{int(n)}</span> <span className="text-[11px] text-[var(--ink-3)]">{id === 'all' ? 'customers' : `· ${pct(total ? n / total : 0)}`}</span></span>
        <span className="text-right"><span className="num text-[13px] font-semibold">{inr(perCustMonth(P, n, months))}</span><span className="text-[10.5px] text-[var(--ink-3)]"> /month</span></span>
      </span>
      <span className="mt-2.5 space-y-0.5 border-t border-[var(--line-2)] pt-2 text-[11px] text-[var(--ink-3)]">
        <span className="block truncate">{top ? <>Most spend: <b className="font-semibold text-[var(--ink-2)]">{top.label}</b> ({pct(P.spend ? top.spend / P.spend : 0)})</> : 'No purchases in these products'}</span>
        {id !== 'all' && top && <span className="block truncate">{lean ? <>Stands out: <b className="font-semibold text-[var(--ink-2)]">{lean.c.label}</b> {lean.l!.toFixed(1)}× usual</> : 'Buys a typical mix'}</span>}
      </span>
    </button>
  );
}


// ------------------------------------------------------------------------ summary + key numbers
function Summary({ groupId, name, n, G, A, months, small, scoped, scopeLabel }: { groupId: GroupId; name: string; n: number; G: Purchases; A: Purchases; months: number; small: boolean; scoped: boolean; scopeLabel: string }) {
  const color = colorOf(groupId);
  const spendG = perCustMonth(G, n, months), spendA = perCustMonth(A, A.customers, months);
  const ordG = n ? G.orders / n / months : 0, ordA = A.customers ? A.orders / A.customers / months : 0;
  const dealG = G.spend ? G.promoSpend / G.spend : 0, dealA = A.spend ? A.promoSpend / A.spend : 0;
  const reachG = n ? G.buyers / n : 0, reachA = A.customers ? A.buyers / A.customers : 0;
  const topCat = G.categories[0], topSku = G.skus[0];
  const lean = standsOut(G, A);
  const cmp = (a: number, b: number) => (b > 0 ? a / b : 1);
  const word = (r: number) => (r >= 1.15 ? 'more than' : r <= 0.87 ? 'less than' : 'about the same as');
  const isAll = name === 'All customers';
  const t = groupId === 'all' ? null : TYPE_BY_ID[groupId];
  const action = groupId === 'all' ? null : TYPE_ACTION[groupId];
  return (
    <section className="card overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="px-5 pb-3 pt-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">At a glance</p>
            <h3 className="mt-0.5 text-[16px] font-bold tracking-tight" >{groupId !== 'all' && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: color }} />}{name}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink)]">
              {G.spend <= 0 ? <>They did not buy {scoped ? scopeLabel : 'anything'} in this period.</> : <>
                {int(n)} customers spending about <b>{inr(spendG)}</b> a month each{scoped ? ` on ${scopeLabel}` : ''}{!isAll && <>, {word(cmp(spendG, spendA))} the average customer</>}.
                {topCat && !scoped && <> Most of it goes on <b>{topCat.label}</b> ({pct(topCat.spend / G.spend)})</>}
                {topSku && <>{!scoped && topCat ? '; top product ' : ' Top product: '}<b>{topSku.label}</b>.</>}
                {!isAll && lean && <> They lean towards <b>{lean.c.label}</b> ({lean.l!.toFixed(1)}× the usual share).</>}
              </>}
            </p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line-2)] border-t border-[var(--line-2)] sm:grid-cols-4 sm:divide-y-0">
            <Key label={scoped ? 'Bought these products' : 'Customers'} value={scoped ? pct(reachG) : int(n)} vs={scoped ? `${pct(reachA)} of all customers` : isAll ? 'bought in the period' : `${pct(A.customers ? n / A.customers : 0)} of all customers`} />
            <Key label="Spend a month" value={inr(spendG)} vs={isAll ? 'per customer' : `vs ${inr(spendA)} average`} ratio={isAll ? undefined : cmp(spendG, spendA)} />
            <Key label="Orders a month" value={ordG.toFixed(1)} vs={isAll ? 'per customer' : `vs ${ordA.toFixed(1)} average`} ratio={isAll ? undefined : cmp(ordG, ordA)} />
            <Key label="Bought on deals" value={pct(dealG)} vs={isAll ? 'of spending' : `vs ${pct(dealA)} average`} ratio={isAll ? undefined : cmp(dealG, dealA)} neutral />
          </div>
        </div>
        <aside className="border-t border-[var(--line-2)] px-5 py-4 lg:border-l lg:border-t-0 bg-[#fafbfd]">
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]"><Target className="h-3.5 w-3.5" />How to treat them</p>
          {t && action ? <>
            <p className="mt-2"><Chip tone={action.tone}>{action.label}</Chip></p>
            <p className="mt-2 text-[12.5px] leading-snug text-[var(--ink)]">{t.play}</p>
            <p className="mt-2 text-[11.5px] leading-snug text-[var(--ink-3)]"><b className="font-semibold text-[var(--ink-2)]">Why this group:</b> {t.signature}</p>
          </> : (
            <p className="mt-2 text-[12.5px] leading-snug text-[var(--ink-2)]">Each type needs a different approach. Pick a customer group above to see how to treat it in your promotions.</p>
          )}
        </aside>
      </div>
      {small && <p className="flex items-center gap-2 border-t border-[var(--line)] bg-[#fef3c7] px-5 py-1.5 text-[11.5px] text-[#92400e]"><AlertTriangle className="h-3.5 w-3.5" />Only {int(n)} customers: treat these patterns as a hint, not a rule.</p>}
    </section>
  );
}

function Key({ label, value, vs, ratio, neutral = false }: { label: string; value: string; vs: string; ratio?: number; neutral?: boolean }) {
  const up = ratio !== undefined && ratio >= 1.15, down = ratio !== undefined && ratio <= 0.87;
  return (
    <div className="px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">{label}</p>
      <p className="mt-1 flex items-center gap-2">
        <span className="num text-[18px] font-bold leading-none tracking-tight">{value}</span>
        {(up || down) && (
          <span className="rounded-full px-1.5 py-[1px] text-[11px] font-semibold"
            style={neutral ? { background: '#eef1f6', color: 'var(--ink-2)' } : up ? { background: 'var(--green-bg)', color: 'var(--green-dark)' } : { background: 'var(--red-bg)', color: '#b91c1c' }}>
            {up ? '▲' : '▼'} {Math.abs(Math.round((ratio! - 1) * 100))}%
          </span>
        )}
      </p>
      <p className="mt-1 text-[11px] text-[var(--ink-3)]">{vs}</p>
    </div>
  );
}

// ------------------------------------------------------------------------ what they buy
function Mix({ G, A, level, same, color }: { G: Purchases; A: Purchases; level: 'category' | 'sku'; same: boolean; color: string }) {
  const [dim, setDim] = useState<'category' | 'brand'>('category');
  const d = level === 'sku' ? 'sku' : dim;
  const rows = (d === 'sku' ? G.skus : d === 'brand' ? G.brands : G.categories).slice(0, 8);
  const allRows = d === 'sku' ? A.skus : d === 'brand' ? A.brands : A.categories;
  const max = Math.max(1e-9, ...rows.map((r) => r.spend));
  return (
    <section className="card flex h-full flex-col p-4">
      <SectionHead icon={<ShoppingBag className="h-4 w-4" />} color={color} title="Share of their spending"
        sub={<>By {d === 'sku' ? 'product' : d === 'brand' ? 'brand' : 'category'}, biggest first. The chip says whether they spend more or less of their money here than customers overall.</>}
        right={level === 'category' ? <Seg value={dim} onChange={setDim} options={[{ id: 'category', label: 'Categories' }, { id: 'brand', label: 'Brands' }]} /> : undefined} />
      {!rows.length ? <p className="py-10 text-center text-[13px] text-[var(--ink-3)]">No purchases to show.</p> : (
        <ul className="mt-3.5 space-y-2.5">
          {rows.map((r) => {
            const share = G.spend ? r.spend / G.spend : 0;
            const allShare = A.spend ? (allRows.find((x) => x.key === r.key)?.spend ?? 0) / A.spend : 0;
            return (
              <li key={r.key}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-3">
                  <span className="min-w-0 truncate text-[12px] font-semibold text-[var(--ink)]" title={r.sub}>{r.label}</span>
                  <span className="flex justify-end">{!same && <LeanChip item={r} G={G} A={A} all={allRows} />}</span>
                  <span className="num text-right text-[12px] font-bold">{pct(share)}</span>
                </div>
                <div className="relative mt-1 h-2 rounded-full bg-[var(--line-2)]">
                  <div className="h-full rounded-full" style={{ width: `${(r.spend / max) * 100}%`, background: color }} />
                  {!same && allShare > 0 && <div className="absolute -top-[3px] h-4 w-[3px] rounded-full bg-[var(--amber)] ring-2 ring-white" style={{ left: `calc(${Math.min(100, ((allShare * G.spend) / max) * 100)}% - 1.5px)` }} title={`All customers: ${pct(allShare)}`} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!same && <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--ink-3)]"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full" style={{ background: color }} />This group</span><span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-[3px] rounded-full bg-[var(--amber)]" />All customers</span></p>}
      {d !== 'brand' && G.brands.length > 1 && <BrandSplit G={G} A={A} />}
    </section>
  );
}

const BRAND_COLORS = ['var(--navy)', '#2a78d6', '#1baf7a', '#e0a526', '#8b8a85', '#d64545'];

/** which brands the group's money goes to, next to the split for all customers */
function BrandSplit({ G, A }: { G: Purchases; A: Purchases }) {
  const order = A.brands.map((b) => b.key);
  const color = (k: string) => BRAND_COLORS[Math.max(0, order.indexOf(k)) % BRAND_COLORS.length];
  const bar = (P: Purchases) => (
    <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-white">
      {order.map((k) => { const b = P.brands.find((x) => x.key === k); const w = P.spend ? (b?.spend ?? 0) / P.spend : 0; return w > 0 ? <div key={k} style={{ width: `${w * 100}%`, background: color(k) }} title={`${k}: ${pct(w)}`} /> : null; })}
    </div>
  );
  const top = G.brands[0];
  return (
    <div className="mt-auto pt-3.5"><div className="rounded-xl bg-[var(--page)] px-3.5 py-3">
      <p className="text-[12px] font-semibold">Brands they choose</p>
      <p className="text-[12px] text-[var(--ink-3)]">{top ? <><b className="text-[var(--ink-2)]">{top.label}</b> gets {pct(G.spend ? top.spend / G.spend : 0)} of their spending{A.spend ? ` (all customers: ${pct((A.brands.find((x) => x.key === top.key)?.spend ?? 0) / A.spend)})` : ''}.</> : 'No purchases.'}</p>
      <div className="mt-2 grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--ink-3)]">
        <span>This group</span>{bar(G)}
        <span>All customers</span>{bar(A)}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-2)]">
        {order.map((k) => { const b = G.brands.find((x) => x.key === k); return <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color(k) }} />{k} <b className="num">{pct(G.spend ? (b?.spend ?? 0) / G.spend : 0)}</b></span>; })}
      </p>
    </div></div>
  );
}

/** always says something: more than usual, about usual, less than usual, or that too few customers bought it to tell */
function LeanChip({ item, G, A, all }: { item: Slice; G: Purchases; A: Purchases; all: Slice[] }) {
  const l = leaning(item, G, all.find((x) => x.key === item.key), A.spend);
  const base = 'inline-flex min-w-[88px] items-center justify-center whitespace-nowrap rounded-full px-2 py-[2px] text-[10.5px] font-semibold';
  if (l === null) return <span className={`${base} text-[var(--ink-3)]`} style={{ background: '#f3f5f8' }} title="Fewer than 8 customers in this group bought it, so a comparison would be unreliable">Too few buyers</span>;
  if (l >= 1.25) return <span className={base} style={{ background: 'var(--green-bg)', color: 'var(--green-dark)' }} title="This group puts more of its spending here than customers overall">▲ {l.toFixed(1)}× usual</span>;
  if (l <= 0.8) return <span className={base} style={{ background: '#fef3c7', color: '#92400e' }} title="This group puts less of its spending here than customers overall">▼ {l.toFixed(1)}× usual</span>;
  return <span className={`${base} text-[var(--ink-2)]`} style={{ background: '#eef1f6' }} title="This group buys it about as much as customers overall">≈ About usual</span>;
}

function TopProducts({ G, A, customers, same }: { G: Purchases; A: Purchases; customers: number; same: boolean }) {
  const [all, setAll] = useState(false);
  const rows = all ? G.skus : G.skus.slice(0, 8);
  return (
    <section className="card flex h-full flex-col overflow-hidden">
      <div className="px-4 pt-4"><SectionHead icon={<Package className="h-4 w-4" />} title="Products they buy most" sub="From their actual orders in the period, by spend." /></div>
      {!rows.length ? <p className="py-10 text-center text-[13px] text-[var(--ink-3)]">No purchases to show.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[500px] text-[12px]">
            <thead><tr className="whitespace-nowrap border-y border-[var(--line)] bg-[var(--page)] text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
              <th className="px-4 py-2 text-left">Product</th><th className="px-3 py-2" title="Share of the group's customers who bought it at least once">Bought by</th><th className="px-3 py-2">Units</th><th className="px-3 py-2">Spend</th>{!same && <th className="whitespace-nowrap px-4 py-2 text-center" title="This group's share of spending on the product compared with all customers' share. 2× usual means twice as much of their money goes to it.">Vs all customers</th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--line-2)] text-right transition-colors last:border-0 hover:bg-[#fafbfd]">
                  <td className="px-4 py-1.5 text-left"><span className="block font-semibold text-[var(--ink)]">{r.label}</span><span className="block text-[10.5px] text-[var(--ink-3)]">{r.sub}</span></td>
                  <td className="num px-3">{pct(customers ? r.buyers / customers : 0)}</td>
                  <td className="num px-3">{int(r.units)}</td>
                  <td className="num px-3 font-semibold">{inr(r.spend)}</td>
                  {!same && <td className="px-4 text-center"><LeanChip item={r} G={G} A={A} all={A.skus} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!same && rows.length > 0 && <p className="mt-auto border-t border-[var(--line-2)] bg-[var(--page)] px-4 py-2 text-[11px] leading-snug text-[var(--ink-3)]">“2.0× usual” means this group puts twice as much of its spending on the product as customers overall do. “About usual” means roughly the same.</p>}
      {G.skus.length > 8 && <div className={`${same ? 'mt-auto' : ''} px-4 py-2.5`}><More open={all} onClick={() => setAll(!all)}>{all ? 'Show top 8' : `Show all ${G.skus.length} products`}</More></div>}
    </section>
  );
}

// ------------------------------------------------------------------------ promotion response
type RMetric = 'resp' | 'roi' | 'uplift';
const RMET: Record<RMetric, { label: string; get: (a: Agg) => number; fmt: (v: number) => string; help: GlossaryKey; what: string }> = {
  resp: { label: 'Redemption rate', get: respOf, fmt: (v) => pct(v), help: 'redemption', what: 'share of customers who bought on the offer' },
  roi: { label: 'Promo ROI', get: roiOf, fmt: (v) => v.toFixed(2), help: 'roi', what: 'extra margin for every ₹1 of promo cost' },
  uplift: { label: 'Extra sales share', get: incShareOf, fmt: (v) => pct(v), help: 'uplift', what: 'share of their promotion purchases that were extra' },
};
const offerOf = (c: Campaign) => offerName(c.mechanic, c.depth, c.flat, c.minSpend);

function GroupResponse({ ids, allIds, name, color, isAll, camps, facts, defs, rules, inScope }: {
  ids: Set<string>; allIds: Set<string>; name: string; color: string; isAll: boolean; camps: Campaign[]; facts: CustomerFacts[]; defs: RuleDef[]; rules: Rules;
  inScope?: (productId: string) => boolean; // brand / category / SKU filter: promotion results for those products only
}) {
  const e = useEngine();
  const [metric, setMetric] = useState<RMetric>('resp');
  const [view, setView] = useState<'types' | 'promos'>('types');
  const [open, setOpen] = useState<MechKey | null>(null);
  const [compare, setCompare] = useState(false);
  const [why, setWhy] = useState(false);
  const M = RMET[metric];

  const byCamp = useMemo(() => aggregateByCampaignFor(e, camps, (cid) => ids.has(cid), inScope), [e, camps, ids, inScope]);
  const allByCamp = useMemo(() => aggregateByCampaignFor(e, camps, (cid) => allIds.has(cid), inScope), [e, camps, allIds, inScope]);
  const G = sumAggs([...byCamp.values()]);
  const All = sumAggs([...allByCamp.values()]);
  const types = MECH_ORDER.map((k) => {
    const cs = camps.filter((c) => mechOf(c) === k);
    return { k, cs, a: sumAggs(cs.map((c) => byCamp.get(c.id)!)) };
  }).filter((t) => t.cs.length > 0);
  const readable = types.filter((t) => t.a.reached >= MIN_REACH).sort((x, y) => M.get(y.a) - M.get(x.a));
  const thin = types.filter((t) => t.a.reached < MIN_REACH);
  const promos = camps.map((c) => ({ c, a: byCamp.get(c.id)! })).filter((x) => x.a.reached > 0)
    .sort((x, y) => (y.a.reached >= MIN_REACH ? 1 : 0) - (x.a.reached >= MIN_REACH ? 1 : 0) || M.get(y.a) - M.get(x.a));
  const vals = readable.map((t) => M.get(t.a));
  const maxAbs = Math.max(1e-9, ...vals.map(Math.abs));
  const hasNeg = vals.some((v) => v < 0);
  const zero = hasNeg ? 50 : 0, span = hasNeg ? 50 : 100;
  const best = readable[0];

  // the same comparison for every customer type, with the same narrowing rules applied inside each type
  const grid = useMemo(() => {
    if (!compare) return null;
    const mechs = types.map((t) => t.k);
    const rows = TYPES.map((t) => {
      const set = new Set(applyRules(facts.filter((f) => f.type === t.id), defs, rules).map((f) => f.cid));
      const bc = aggregateByCampaignFor(e, camps, (cid) => set.has(cid), inScope);
      return { t, n: set.size, cells: mechs.map((k) => { const a = sumAggs(camps.filter((c) => mechOf(c) === k).map((c) => bc.get(c.id)!)); return a.reached >= MIN_REACH ? a : null; }) };
    }).filter((r) => r.n > 0);
    return { mechs, rows };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- types is derived from camps
  }, [compare, e, camps, facts, defs, rules, inScope]);

  if (!camps.length) return <div className="card py-12 text-center text-[13px] text-[var(--ink-3)]">No promotions ran for these products in this period. Pick a longer period or other products.</div>;
  if (G.reached < MIN_REACH) return <div className="card py-12 text-center text-[13px] text-[var(--ink-3)]">Too few of these customers were reached by the {camps.length} promotions in this period to read a response. Widen the group or the period.</div>;

  return (
    <section className="card overflow-hidden">
      <div className="px-4 pt-4">
        <SectionHead icon={<Megaphone className="h-4 w-4" />} color={color} title={`Promotion response of ${name}`}
          sub={`${camps.length} promotion${camps.length > 1 ? 's' : ''} ran · ${int(G.reached)} times one of these customers was reached by one`}
          right={<Seg value={metric} onChange={setMetric} options={[{ id: 'resp', label: 'Redemption' }, { id: 'roi', label: 'ROI' }, { id: 'uplift', label: 'Extra sales' }]} />} />
      </div>

      {/* the group's overall response next to all customers */}
      <div className="mt-3 grid grid-cols-3 divide-x divide-[var(--line-2)] border-y border-[var(--line)] bg-[var(--page)]">
        {(['resp', 'roi', 'uplift'] as RMetric[]).map((k) => {
          const g = RMET[k].get(G), a = RMET[k].get(All);
          return (
            <div key={k} className={`px-4 py-2.5 ${k === metric ? 'bg-white' : ''}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">{RMET[k].label}<Help term={RMET[k].help} /></p>
              <p className="num mt-1 text-[18px] font-bold leading-none" style={{ color: k === 'roi' ? roiColor(g) : undefined }}>{RMET[k].fmt(g)}</p>
              <p className="mt-1 text-[11px] text-[var(--ink-3)]">{isAll ? RMET[k].what : `all customers: ${RMET[k].fmt(a)}`}</p>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-4">
        {best && <p className="mb-3 text-[12.5px] leading-snug text-[var(--ink)]"><b>{MECH_LABEL[best.k]}</b> worked best for {isAll ? 'customers' : 'this group'} on {M.label.toLowerCase()} ({M.fmt(M.get(best.a))}){readable.length > 1 ? <>, <b>{MECH_LABEL[readable[readable.length - 1].k]}</b> the least ({M.fmt(M.get(readable[readable.length - 1].a))})</> : ''}.</p>}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Seg value={view} onChange={setView} options={[{ id: 'types', label: `By promotion type (${types.length})` }, { id: 'promos', label: `Each promotion (${promos.length})` }]} />
          <span className="text-[11px] text-[var(--ink-3)]">{M.label}: {M.what}</span>
        </div>

        {view === 'types' ? (
          <div className="divide-y divide-[var(--line-2)]">
            {readable.map((t, i) => {
              const v = M.get(t.a);
              const w = (Math.abs(v) / maxAbs) * span;
              const on = open === t.k;
              return (
                <div key={t.k}>
                  <button onClick={() => setOpen(on ? null : t.k)} aria-expanded={on} title={MECH_HOW[t.k]}
                    className="grid w-full grid-cols-[minmax(140px,210px)_1fr_64px_16px] items-center gap-4 rounded-lg px-2 py-2 text-left hover:bg-[var(--page)]">
                    <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{MECH_LABEL[t.k]}{i === 0 && readable.length > 1 && <span className="ml-2 align-middle"><Chip tone="green">Best</Chip></span>}</span><span className="block text-[11px] text-[var(--ink-3)]">{t.cs.length} promotion{t.cs.length > 1 ? 's' : ''} · {int(t.a.reached)} reached</span></span>
                    <span className="relative block h-3.5">
                      <span className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ left: `${zero}%` }} />
                      <span className="absolute inset-y-0 rounded" style={{ left: v >= 0 ? `${zero}%` : `${zero - w}%`, width: `${Math.max(0.8, w)}%`, background: v < 0 ? 'var(--red)' : i === 0 ? 'var(--green)' : color, opacity: v < 0 || i === 0 ? 1 : 0.75 }} />
                    </span>
                    <span className="num text-right text-[13.5px] font-bold" style={{ color: metric === 'roi' ? roiColor(v) : v < 0 ? 'var(--red)' : undefined }}>{M.fmt(v)}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-[var(--ink-3)] transition-transform ${on ? 'rotate-180' : ''}`} />
                  </button>
                  {on && <div className="mb-2 ml-2"><PromoTable rows={t.cs.map((c) => ({ c, a: byCamp.get(c.id)! }))} metric={metric} /></div>}
                </div>
              );
            })}
            {thin.length > 0 && <p className="px-2 pt-2.5 text-[11.5px] text-[var(--ink-3)]">Not enough of these customers were reached to read: {thin.map((t) => MECH_LABEL[t.k]).join(', ')}.</p>}
          </div>
        ) : <PromoTable rows={promos} metric={metric} />}

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--line-2)] pt-3">
          <More open={compare} onClick={() => setCompare(!compare)}>{compare ? 'Hide comparison' : 'Compare all customer types side by side'}</More>
          <More open={why} onClick={() => setWhy(!why)}>{why ? 'Hide' : 'What makes a customer respond?'}</More>
        </div>
        {compare && grid && (
          <div className="mt-3">
            <p className="mb-2 text-[11.5px] text-[var(--ink-3)]">{M.label} by customer type and promotion type, for the same period, products{Object.values(rules).some(Boolean) ? ' and narrowing conditions' : ''}. “–” means too few customers to read.</p>
            <FitHeat rows={grid.rows.map((r) => r.t.name)} cols={grid.mechs.map((k) => MECH_LABEL[k].replace(' (Points)', '').replace(' on Min Spend', ''))} rowW={120}
              value={(r, c) => { const a = grid.rows[r].cells[c]; return a ? M.get(a) : -99; }}
              color={(v) => (v === -99 ? '#f6f7f9' : metric === 'roi' ? roiFill(v) : rateFill(v))}
              label={(v) => (v === -99 ? '–' : metric === 'roi' ? v.toFixed(1) : `${Math.round(v * 100)}%`)}
              tip={(r, c) => { const a = grid.rows[r].cells[c]; return <><b>{grid.rows[r].t.name} · {MECH_LABEL[grid.mechs[c]]}</b>{a ? <div>Redemption {pct(respOf(a))} · ROI {roiOf(a).toFixed(2)} · {int(a.reached)} reached</div> : <div>Too few customers to read</div>}</>; }} />
          </div>
        )}
        {why && <Drivers />}
      </div>
    </section>
  );
}

function PromoTable({ rows, metric }: { rows: { c: Campaign; a: Agg }[]; metric: RMetric }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-[var(--line)]">
      <table className="w-full min-w-[620px] text-[12px]">
        <thead className="sticky top-0 bg-[var(--page)]"><tr className="border-b border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
          <th className="px-3 py-2 text-left">Promotion</th><th className="px-2 py-2 text-left">Offer</th><th className="px-2 py-2" title="Customers in this group who shopped in the 90 days before the promotion">Reached</th><th className="px-2 py-2">Bought on it</th><th className={`px-2 py-2 ${metric === 'resp' ? 'text-[var(--ink)]' : ''}`}>Redemption</th><th className={`px-2 py-2 ${metric === 'uplift' ? 'text-[var(--ink)]' : ''}`}>Extra sales</th><th className={`px-3 py-2 ${metric === 'roi' ? 'text-[var(--ink)]' : ''}`}>ROI</th>
        </tr></thead>
        <tbody>
          {rows.map(({ c, a }) => {
            const few = a.reached < MIN_REACH;
            return (
              <tr key={c.id} className={`border-b border-[var(--line-2)] text-right last:border-0 ${few ? 'text-[var(--ink-3)]' : ''}`}>
                <td className="px-3 py-1.5 text-left"><span className="block font-semibold">{c.name}</span><span className="block text-[10.5px] text-[var(--ink-3)]">{c.category} · {shortDate(isoOf(c.start))} – {shortDate(isoOf(c.end))}</span></td>
                <td className="px-2 text-left">{offerOf(c)}</td>
                <td className="num px-2">{int(a.reached)}</td>
                <td className="num px-2">{int(a.buyers)}</td>
                <td className="num px-2 font-semibold">{few ? '–' : pct(respOf(a))}</td>
                <td className="num px-2">{few ? '–' : pct(incShareOf(a))}</td>
                <td className="num px-3 font-semibold" style={{ color: few ? undefined : roiColor(roiOf(a)) }}>{few ? <span title="Too few customers reached to read">few</span> : roiOf(a).toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** which behaviours predict a response: read across ALL customers and promotions, so it does not change with the filters */
function Drivers() {
  const e = useEngine();
  const [all, setAll] = useState(false);
  const drivers = useMemo(() => driversOf(e), [e]);
  const shown = all ? drivers : drivers.slice(0, 3);
  const dMax = Math.max(...drivers.flatMap((x) => x.bands.map((b) => b.rate)), 0.01);
  return (
    <div className="mt-3 rounded-xl bg-[var(--page)] p-4">
      <p className="text-[12.5px] font-semibold">What makes a customer respond</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-3)]">Measured across all customers and all past promotions (not affected by the filters). Customers are split into five equal groups on each behaviour, from lowest to highest; taller bars mean more of that group bought on the offer.</p>
      <div className="mt-3 space-y-3.5">
        {shown.map((d) => (
          <div key={d.key} className="flex items-center gap-4" title={d.bands.map((b, i) => `Group ${i + 1}: ${pct(b.rate)}`).join(' · ')}>
            <div className="w-[180px] shrink-0">
              <p className="text-[12.5px] font-semibold">{d.label}</p>
              <p className="text-[11px] text-[var(--ink-3)]">{d.direction === 'higher' ? 'Higher → responds more' : d.direction === 'lower' ? 'Higher → responds less' : 'No simple pattern'}</p>
            </div>
            <div className="flex h-9 flex-1 items-end gap-[3px]">
              {d.bands.map((b, i) => <div key={i} className="flex-1 rounded-t" style={{ height: `${Math.max(6, (b.rate / dMax) * 100)}%`, background: 'var(--navy)', opacity: 0.35 + 0.13 * i }} />)}
            </div>
            <span className="num w-[76px] shrink-0 text-right text-[12px] text-[var(--ink-2)]">{pct(d.bands[0].rate)} → <b>{pct(d.bands[4].rate)}</b></span>
          </div>
        ))}
      </div>
      {drivers.length > 3 && <div className="mt-3"><More open={all} onClick={() => setAll(!all)}>{all ? 'Show the top 3 only' : `Show all ${drivers.length} behaviours`}</More></div>}
    </div>
  );
}

// ------------------------------------------------------------------------ behaviour alerts
const RULE_PHRASE: Record<RuleKey, (label: string) => string> = {
  spend: (l) => `are ${l.toLowerCase()}`,
  frequency: (l) => `are ${l.toLowerCase()}`,
  visit: (l) => (l === 'Shopped recently' ? 'shopped in the last 30 days' : l === 'Slowing down' ? 'last shopped 31–90 days ago' : 'have not shopped for 90+ days'),
  deals: (l) => (l === 'Mostly on deals' ? 'buy mostly on deals' : l === 'Mostly full price' ? 'buy mostly at full price' : 'buy a mix of deals and full price'),
  channel: (l) => `shop mainly ${l === 'Store' ? 'in store' : l === 'App' ? 'in the app' : 'online'}`,
  promo: (l) => `bought on ${l}`,
};

function alertText(a: Alert) {
  const t = TYPE_BY_ID[a.type];
  const m = METRIC_TEXT[a.metric];
  const more = a.inside > a.rest;
  const ratio = more ? a.inside / a.rest : a.rest / Math.max(1e-9, a.inside);
  const what = a.metric === 'catShare' ? `${a.category}'s share of their spending` : m.name;
  const title = `${int(a.n)} ${t.name} who ${RULE_PHRASE[a.rule.key](a.rule.label)} ${a.metric === 'catShare' ? `spend ${more ? 'more' : 'less'} of their money on ${a.category}` : a.metric === 'dealShare' ? `buy on deals ${more ? 'more' : 'less'} often` : a.metric === 'spendPerMonth' ? `spend ${more ? 'more' : 'less'} each month` : `shop ${more ? 'more' : 'less'} often`}`;
  const data = `${what[0].toUpperCase() + what.slice(1)}: ${m.fmt(a.inside)} for them, against ${m.fmt(a.rest)} for the other ${int(a.of - a.n)} ${t.name} (${ratio.toFixed(1)}× ${more ? 'higher' : 'lower'}).`;
  const why = `They are ${pct(a.n / a.of)} of the group but behave clearly differently, and a gap this size is very unlikely to be chance. If you plan for ${t.name} as one group, these customers may need their own offer or message.`;
  return { title, data, why };
}

function Alerts({ alerts, onExplore }: { alerts: Alert[]; onExplore: (a: Alert) => void }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3">
        <SectionHead icon={<BellRing className="h-4 w-4" />} color={alerts.length ? '#b45309' : '#0f7a55'} title="Behaviour alerts"
          sub="Only strong, consistent differences with enough customers are shown."
          right={<Chip tone={alerts.length ? 'amber' : 'green'}>{alerts.length ? `${alerts.length} worth a look` : 'Nothing unusual'}</Chip>} />
      </div>
      {!alerts.length ? (
        <p className="border-t border-[var(--line)] px-4 py-5 text-center text-[12px] text-[var(--ink-3)]">In this period, every group behaves consistently: the differences inside each group are within normal variation.</p>
      ) : (
        <ul className="space-y-2.5 border-t border-[var(--line)] bg-[var(--page)] p-3">
          {alerts.map((a, i) => {
            const x = alertText(a);
            const c = TYPE_BY_ID[a.type].color;
            return (
              <li key={i} className="relative grid gap-3 overflow-hidden rounded-xl border border-[var(--line)] bg-white px-4 py-3 pl-5 shadow-[0_1px_2px_rgba(11,28,47,0.04)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: c }} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold leading-snug">
                    <span className="rounded-full px-2 py-[1px] text-[10.5px] font-semibold uppercase tracking-wider" style={{ background: `${c}18`, color: c }}>{TYPE_BY_ID[a.type].name}</span>
                    {x.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-[var(--ink)]">{x.data}</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-3)]">{x.why}</p>
                </div>
                <button onClick={() => onExplore(a)} className="justify-self-start whitespace-nowrap rounded-lg bg-[var(--navy)] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm hover:opacity-90 md:justify-self-end">Look at this group →</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
