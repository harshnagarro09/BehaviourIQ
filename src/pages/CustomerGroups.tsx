// Behaviour Analytics > Customer types: the first stage of the story (understand customers). One filter area (period,
// products, and optional customer filters) drives the page, top to bottom:
//   customer groups      pick one of the four types (or everyone)
//   at a glance          the key facts about the chosen customers and how to treat them
//   what they buy        categories, brands and products, against all customers
//   behaviour alerts     customers inside a group who behave clearly differently
// How each group responded to past promotions is on Promotion results (the next stage). All figures come from actual order
// lines in the chosen period (engine/groupInsights.ts).
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing, Check, ChevronDown, Package, RotateCcw, ShoppingBag, SlidersHorizontal, Target, Users, X } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import type { Shift, ShiftFrom } from '@/engine/shifts';
import { Picker } from '@/components/Picker';
import { useProductFilter } from '@/components/ProductScope';
import { Chip, NextStep } from '@/components/ui';
import { TYPE_ACTION } from '@/lib/types';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import type { TypeId } from '@/engine/behaviour';
import { skuCatalog } from '@/engine/products';
import {
  applyRules, behaviourAlerts, customerFacts, leaning, monthsIn, purchases, ruleDefs,
  type Alert, type Period, type Purchases, type RuleDef, type Rules, type Slice,
} from '@/engine/groupInsights';
import { driversOf } from '@/lib/targeting';
import { alertText, shiftText } from '@/lib/alerts';
import { planShifts } from '@/lib/plan';
import { dateLabel, inr, int, pct } from '@/lib/fmt';
import { isoOf } from '@/engine/data';

type PeriodKey = '3m' | '6m' | '12m' | 'all';
const PERIODS: { id: PeriodKey; label: string; phrase: string; days: number }[] = [
  { id: '3m', label: '3 months', phrase: 'the last 3 months', days: 92 }, { id: '6m', label: '6 months', phrase: 'the last 6 months', days: 183 },
  { id: '12m', label: '12 months', phrase: 'the last 12 months', days: 365 }, { id: 'all', label: 'All time', phrase: 'all time', days: 1e6 },
];
type GroupId = 'all' | TypeId;
const SMALL = 30; // below this many customers, patterns may be chance
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

export function CustomerGroups({ onNext }: { onNext: () => void }) {
  const e = useEngine();
  const [period, setPeriod] = useState<PeriodKey>('6m');
  const [groupId, setGroupId] = useState<GroupId>('all');
  const [rawRules, setRules] = useState<Rules>({});
  const [narrow, setNarrow] = useState(false);
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

  const months = monthsIn(p);
  const ruleCount = Object.values(rules).filter(Boolean).length;
  const groupName = groupLabel(groupId, rules, defs);
  const explore = (a: Alert) => {
    setGroupId(a.type); setRules({ [a.rule.key]: a.rule.value }); products.reset(); setNarrow(true);
    document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // customers whose last 3 months differ from their type: fixed to the last 3 months, whatever period is picked above
  const shifts = useMemo(() => planShifts(e), [e]);
  const { plan, setPlan, go } = useApp();
  const planShift = (from: ShiftFrom) => { setPlan({ ...plan, wakeUp: [...new Set([...plan.wakeUp, from])] }, 'Behaviour Analytics'); go('planning'); };
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
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-bold tracking-tight">Customer groups</h2>
          <p className="text-[12px] text-[var(--ink-3)]">Every customer is one of four types, based on how they react to offers. Click a group to focus the page on it.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => <GroupCard key={c.id} id={c.id} n={c.n} total={facts.length} P={c.P} months={months} on={groupId === c.id} onClick={() => setGroupId(c.id)} />)}
        </div>
      </section>

      {/* ------------------------------------------------------------ the key insight */}
      {empty
        ? <div className="card flex flex-col items-center gap-2 py-10 text-center"><Users className="h-6 w-6 text-[var(--ink-3)]" /><p className="text-[13.5px] font-semibold">No customers match this combination</p><p className="text-[12.5px] text-[var(--ink-3)]">Remove a customer filter to see results.</p></div>
        : <Summary groupId={groupId} name={groupName} n={group.length} G={G} A={A} months={months} small={group.length < SMALL} scoped={!products.isAll} scopeLabel={products.label} />}

      {/* ------------------------------------------------------------ what they buy */}
      {!empty && (
        <section>
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-bold tracking-tight">What they buy</h2>
            <p className="text-[12px] text-[var(--ink-3)]">{groupId === 'all' ? 'Where customers spend their money' : `Where ${groupName} spend their money`}{products.isAll ? '' : ` within ${products.label}`}{groupId === 'all' ? '.' : ', compared with all customers.'}</p>
          </div>
          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Mix color={NAVY} same={same} G={G} A={A} level={products.picked.length <= 1 ? 'sku' : new Set(products.picked.map((s) => s.category)).size === 1 ? 'sku' : 'category'} />
            <TopProducts G={G} A={A} customers={group.length} same={same} />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ customers who behave differently */}
      <Alerts alerts={alerts} shifts={shifts} period={pdef.phrase} onExplore={explore} onPlan={planShift} />

      <NextStep text="See which promotions these customer groups responded to, and what the promotions returned." action="Promotion results" onClick={onNext} />
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

function GroupCard({ id, n, total, P, months, on, onClick }: { id: GroupId; n: number; total: number; P: Purchases; months: number; on: boolean; onClick: () => void }) {
  const t = id === 'all' ? null : TYPE_BY_ID[id];
  const top = P.categories[0];
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
      <span className="mt-0.5 text-[11px] leading-snug text-[var(--ink-3)]">{t ? t.tagline : 'Everyone who bought in the period'}</span>
      <span className="my-2.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span><span className="num text-[17px] font-bold leading-none tracking-tight">{int(n)}</span> <span className="text-[11px] text-[var(--ink-3)]">{id === 'all' ? 'customers' : `· ${pct(total ? n / total : 0)}`}</span></span>
        <span className="text-right"><span className="num text-[13px] font-semibold">{inr(perCustMonth(P, n, months))}</span><span className="text-[10.5px] text-[var(--ink-3)]"> /month</span></span>
      </span>
      <span className="mt-auto space-y-0.5 border-t border-[var(--line-2)] pt-2 text-[11px] text-[var(--ink-3)]">
        <span className="block leading-snug">{top ? <>Most spend: <b className="font-semibold text-[var(--ink-2)]">{top.label}</b> ({pct(P.spend ? top.spend / P.spend : 0)})</> : 'No purchases in these products'}</span>
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

/** which behaviours predict a response: read across ALL customers and promotions, so it does not change with the filters */
export function Drivers() {
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
function Alerts({ alerts, shifts, period, onExplore, onPlan }: { alerts: Alert[]; shifts: Shift[]; period: string; onExplore: (a: Alert) => void; onPlan: (from: ShiftFrom) => void }) {
  const total = alerts.length + shifts.length;
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3">
        <SectionHead icon={<BellRing className="h-4 w-4" />} color={total ? '#b45309' : '#0f7a55'} title="Behaviour alerts"
          sub={`Customers inside a group who behave clearly differently from the rest of it in ${period}, and customers whose last 3 months no longer match their type. Only strong, consistent differences are shown.`}
          right={<Chip tone={total ? 'amber' : 'green'}>{total ? `${total} worth a look` : 'Nothing unusual'}</Chip>} />
      </div>
      {!total ? (
        <p className="border-t border-[var(--line)] px-4 py-5 text-center text-[12px] text-[var(--ink-3)]">In this period, every group behaves consistently: the differences inside each group are within normal variation.</p>
      ) : (
        <ul className="space-y-2.5 border-t border-[var(--line)] bg-[var(--page)] p-3">
          {shifts.map((sh) => {
            const x = shiftText(sh);
            const c = TYPE_BY_ID[sh.from].color;
            return (
              <li key={sh.from} className="relative grid gap-3 overflow-hidden rounded-xl border border-[var(--line)] bg-white px-4 py-3 pl-5 shadow-[0_1px_2px_rgba(11,28,47,0.04)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: c }} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold leading-snug">
                    <span className="rounded-full px-2 py-[1px] text-[10.5px] font-semibold uppercase tracking-wider" style={{ background: `${c}18`, color: c }}>{TYPE_BY_ID[sh.from].name}</span>
                    {x.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-[var(--ink)]">{x.data}</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-3)]">{x.why}</p>
                </div>
                <button onClick={() => onPlan(sh.from)} className="justify-self-start whitespace-nowrap rounded-lg bg-[var(--navy)] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm hover:opacity-90 md:justify-self-end">Plan for them →</button>
              </li>
            );
          })}
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
