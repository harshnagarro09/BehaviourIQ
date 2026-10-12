// Behaviour Analytics > Customer types: who the customer groups are, what they buy (down to SKU), and where a group
// contains customers who behave differently enough to deserve their own segment. All figures come from actual order lines
// in the chosen period (engine/groupInsights.ts); the promotion-response analysis is kept in a folded section.
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing, Check, ChevronDown, Lightbulb, Megaphone, Package, RotateCcw, ShoppingBag, SlidersHorizontal, Users } from 'lucide-react';
import { useEngine } from '@/state';
import { Picker } from '@/components/Picker';
import { useProductFilter } from '@/components/ProductScope';
import { Chip } from '@/components/ui';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import type { TypeId } from '@/engine/behaviour';
import { skuCatalog } from '@/engine/products';
import {
  applyRules, behaviourAlerts, customerFacts, leaning, METRIC_TEXT, monthsIn, purchases, ruleDefs,
  type Alert, type Period, type Purchases, type RuleKey, type Rules, type Slice,
} from '@/engine/groupInsights';
import { dateLabel, inr, int, pct } from '@/lib/fmt';
import { isoOf } from '@/engine/data';

type PeriodKey = '3m' | '6m' | '12m' | 'all';
const PERIODS: { id: PeriodKey; label: string; days: number }[] = [
  { id: '3m', label: '3 months', days: 92 }, { id: '6m', label: '6 months', days: 183 }, { id: '12m', label: '12 months', days: 365 }, { id: 'all', label: 'All time', days: 1e6 },
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

/** the small two-option switch used on this page */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--page)] p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`rounded-md px-3 py-1 text-[12px] font-semibold transition-colors ${value === o.id ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink)]'}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function CustomerGroups({ promo }: { promo: ReactNode }) {
  const e = useEngine();
  const [period, setPeriod] = useState<PeriodKey>('6m');
  const [groupId, setGroupId] = useState<GroupId>('all');
  const [rules, setRules] = useState<Rules>({});
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const products = useProductFilter(catalog);

  const p: Period = useMemo(() => {
    const days = PERIODS.find((x) => x.id === period)!.days;
    return { from: Math.max(e.ds.minDay, e.ds.maxDay - days + 1), to: e.ds.maxDay };
  }, [e, period]);
  const facts = useMemo(() => customerFacts(e.ds, e.typeOf, p), [e, p]);
  const defs = useMemo(() => ruleDefs(facts), [facts]);
  const alerts = useMemo(() => behaviourAlerts(facts, defs), [facts, defs]);

  const ids = useMemo(() => new Set(products.picked.map((s) => s.productId)), [products.picked]);
  const scope = useMemo(() => (products.isAll ? () => true : (l: { productId: string }) => ids.has(l.productId)), [products.isAll, ids]);
  const inGroup = (id: GroupId) => (id === 'all' ? facts : facts.filter((f) => f.type === id));
  const group = useMemo(() => applyRules(groupId === 'all' ? facts : facts.filter((f) => f.type === groupId), defs, rules), [facts, defs, rules, groupId]);
  const G = useMemo(() => purchases(e.ds, new Set(group.map((f) => f.cid)), p, scope), [e, group, p, scope]);
  const A = useMemo(() => purchases(e.ds, new Set(facts.map((f) => f.cid)), p, scope), [e, facts, p, scope]);
  const cards = useMemo(() => (['all', ...TYPES.map((t) => t.id)] as GroupId[]).map((id) => {
    const fs = inGroup(id);
    const P = purchases(e.ds, new Set(fs.map((f) => f.cid)), p, scope);
    return { id, n: fs.length, P };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- inGroup is derived from facts
  }), [e, facts, p, scope]);

  const months = monthsIn(p);
  const ruleCount = Object.values(rules).filter(Boolean).length;
  const groupName = groupLabel(groupId, rules, defs);
  const explore = (a: Alert) => { setGroupId(a.type); setRules({ [a.rule.key]: a.rule.value }); products.reset(); };

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ toolbar */}
      <section className="card p-4">
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
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
        <p className="mt-3 flex flex-wrap items-center gap-x-1 border-t border-[var(--line-2)] pt-2.5 text-[11.5px] text-[var(--ink-3)]">
          Purchases from {dateLabel(isoOf(p.from))} to {dateLabel(isoOf(p.to))} · <b className="font-semibold text-[var(--ink-2)]">{int(facts.length)}</b> customers bought something in this period
          {!products.isAll && <> · showing <b className="font-semibold text-[var(--ink-2)]">{products.label}</b> <button onClick={products.reset} className="ml-1 inline-flex items-center gap-1 font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />All products</button></>}
        </p>
      </section>

      {/* ------------------------------------------------------------ pick a group */}
      <section>
        <p className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">Choose a customer group</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => <GroupCard key={c.id} id={c.id} n={c.n} total={facts.length} P={c.P} months={months} on={groupId === c.id} onClick={() => setGroupId(c.id)} />)}
        </div>
      </section>

      <section className="card p-4">
        <SectionHead icon={<SlidersHorizontal className="h-4 w-4" />} title="Narrow the group"
          sub={<>Optional. Combine any of these to look at a smaller group of {groupId === 'all' ? 'customers' : TYPE_BY_ID[groupId].name}.</>}
          right={<>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${group.length < SMALL ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#eef3fa] text-[var(--navy)]'}`}><Users className="h-3.5 w-3.5" />{int(group.length)} customers</span>
            {ruleCount > 0 && <button onClick={() => setRules({})} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-[var(--ink-2)] hover:bg-[var(--page)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />Clear {ruleCount}</button>}
          </>} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {defs.map((d) => (
            <Picker key={d.key} label={d.label} value={rules[d.key] ?? 'all'} searchable={false} active={!!rules[d.key]}
              onChange={(v) => setRules({ ...rules, [d.key]: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: d.any }, ...d.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))]} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ what the group buys */}
      {group.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-14 text-center"><Users className="h-6 w-6 text-[var(--ink-3)]" /><p className="text-[13.5px] font-semibold">No customers match this combination</p><p className="text-[12.5px] text-[var(--ink-3)]">Remove a condition above to see results.</p></div>
      ) : (
        <>
          <Summary color={colorOf(groupId)} name={groupName} n={group.length} G={G} A={A} months={months} small={group.length < SMALL} scoped={!products.isAll} scopeLabel={products.label} />
          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Mix color={colorOf(groupId)} same={groupId === 'all' && ruleCount === 0} G={G} A={A} level={products.picked.length <= 1 ? 'sku' : new Set(products.picked.map((s) => s.category)).size === 1 ? 'sku' : 'category'} />
            <TopProducts G={G} A={A} customers={group.length} same={groupId === 'all' && ruleCount === 0} />
          </div>
        </>
      )}

      <Alerts alerts={alerts} onExplore={explore} />

      <Fold title="How each group responds to promotions" sub="Which promotion types worked for each customer type in past campaigns, and which behaviours predict a response.">{promo}</Fold>
    </div>
  );
}

const plainName = (id: GroupId) => (id === 'all' ? 'All customers' : TYPE_BY_ID[id].name);
function groupLabel(id: GroupId, rules: Rules, defs: ReturnType<typeof ruleDefs>) {
  const parts = defs.flatMap((d) => {
    const o = d.options.find((x) => x.value === rules[d.key]);
    if (!o) return [];
    return [d.key === 'channel' ? `mainly ${o.label === 'Store' ? 'in store' : o.label === 'App' ? 'in the app' : 'online'}` : d.key === 'category' ? `favourite category ${o.label}` : o.label.toLowerCase()];
  });
  return parts.length ? `${plainName(id)}: ${parts.join(', ')}` : plainName(id);
}
const perCustMonth = (P: Purchases, n: number, months: number) => (n ? P.spend / n / months : 0);

function GroupCard({ id, n, total, P, months, on, onClick }: { id: GroupId; n: number; total: number; P: Purchases; months: number; on: boolean; onClick: () => void }) {
  const t = id === 'all' ? null : TYPE_BY_ID[id];
  const top = P.categories[0];
  const color = colorOf(id);
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`relative flex h-full flex-col overflow-hidden rounded-xl border bg-white px-3.5 pb-3 pt-4 text-left shadow-[0_1px_2px_rgba(11,28,47,0.05)] ${on ? 'border-transparent' : 'border-[var(--line)]'}`}
      style={on ? { boxShadow: `0 0 0 2px ${color}, 0 6px 16px ${color}22`, background: `linear-gradient(180deg, ${color}0d, #fff 60%)` } : undefined}>
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-[13px] font-bold">{plainName(id)}</span>
        </span>
        {on && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white" style={{ background: color }}><Check className="h-3 w-3" /></span>}
      </span>
      <span className="mt-0.5 min-h-[30px] text-[11px] leading-snug text-[var(--ink-3)]">{t ? t.tagline : 'Everyone who bought in the period'}</span>
      <span className="mt-2 grid grid-cols-2 gap-x-3 border-t border-[var(--line-2)] pt-2">
        <Stat label="Customers" value={int(n)} sub={id === 'all' ? 'in the period' : `${pct(total ? n / total : 0)} of all`} />
        <Stat label="Monthly spend" value={inr(perCustMonth(P, n, months))} sub="per customer" />
      </span>
      <span className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] text-[var(--ink-3)]">
        <ShoppingBag className="h-3 w-3 shrink-0" />{top ? <span className="truncate">Buys most: <b className="font-semibold text-[var(--ink-2)]">{top.label}</b></span> : 'No purchases in these products'}
      </span>
    </button>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <span className="block">
      <span className="block whitespace-nowrap text-[10.5px] font-medium text-[var(--ink-3)]">{label}</span>
      <span className="num block text-[15px] font-bold leading-tight tracking-tight">{value}</span>
      {sub && <span className="block text-[10.5px] text-[var(--ink-3)]">{sub}</span>}
    </span>
  );
}

// ------------------------------------------------------------------------ summary + key numbers
function Summary({ color, name, n, G, A, months, small, scoped, scopeLabel }: { color: string; name: string; n: number; G: Purchases; A: Purchases; months: number; small: boolean; scoped: boolean; scopeLabel: string }) {
  const spendG = perCustMonth(G, n, months), spendA = perCustMonth(A, A.customers, months);
  const ordG = n ? G.orders / n / months : 0, ordA = A.customers ? A.orders / A.customers / months : 0;
  const dealG = G.spend ? G.promoSpend / G.spend : 0, dealA = A.spend ? A.promoSpend / A.spend : 0;
  const reachG = n ? G.buyers / n : 0, reachA = A.customers ? A.buyers / A.customers : 0;
  const topCat = G.categories[0], topSku = G.skus[0];
  const lean = G.categories.map((c) => ({ c, l: leaning(c, G, A.categories.find((x) => x.key === c.key), A.spend) })).filter((x) => x.l !== null && x.l >= 1.25).sort((a, b) => b.l! - a.l!)[0];
  const cmp = (a: number, b: number) => (b > 0 ? a / b : 1);
  const word = (r: number) => (r >= 1.15 ? 'more than' : r <= 0.87 ? 'less than' : 'about the same as');
  const isAll = name === 'All customers';
  return (
    <section className="card overflow-hidden">
      <div className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3" style={{ background: `linear-gradient(90deg, ${color}12, ${color}05)` }}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm" style={{ color }}><Lightbulb className="h-3.5 w-3.5" /></span>
        <p className="pt-0.5 text-[12.5px] leading-relaxed text-[var(--ink)]">
          {G.spend <= 0 ? <><b>{name}</b> did not buy {scoped ? scopeLabel : 'anything'} in this period.</> : <>
            <b>{name}</b> ({int(n)} customers) spend about <b>{inr(spendG)}</b> a month each{scoped ? ` on ${scopeLabel}` : ''}{!isAll && <>, {word(cmp(spendG, spendA))} the average customer</>}.
            {topCat && !scoped && <> Most of it goes on <b>{topCat.label}</b> ({pct(topCat.spend / G.spend)} of their spend)</>}
            {topSku && <>{!scoped && topCat ? ', and their' : ' Their'} top product is <b>{topSku.label}</b>.</>}
            {!isAll && lean && lean.c.key !== topCat?.key && <> Compared with everyone, they lean towards <b>{lean.c.label}</b> ({lean.l!.toFixed(1)}× the usual share).</>}
            {' '}{pct(dealG)} of their spending is on deals{!isAll && ` (average ${pct(dealA)})`}.
          </>}
        </p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line-2)] lg:grid-cols-4 lg:divide-y-0">
        <Key label={scoped ? 'Bought these products' : 'Customers'} value={scoped ? pct(reachG) : int(n)} vs={scoped ? `${pct(reachA)} of all customers` : isAll ? 'bought in the period' : `${pct(A.customers ? n / A.customers : 0)} of all customers`} />
        <Key label="Spend a month" value={inr(spendG)} vs={isAll ? 'per customer' : `vs ${inr(spendA)} average`} ratio={isAll ? undefined : cmp(spendG, spendA)} />
        <Key label="Orders a month" value={ordG.toFixed(1)} vs={isAll ? 'per customer' : `vs ${ordA.toFixed(1)} average`} ratio={isAll ? undefined : cmp(ordG, ordA)} />
        <Key label="Bought on deals" value={pct(dealG)} vs={isAll ? 'of spending' : `vs ${pct(dealA)} average`} ratio={isAll ? undefined : cmp(dealG, dealA)} neutral />
      </div>
      {small && <p className="flex items-center gap-2 border-t border-[var(--line)] bg-[#fef3c7] px-4 py-1.5 text-[11.5px] text-[#92400e]"><AlertTriangle className="h-3.5 w-3.5" />Only {int(n)} customers: treat these patterns as a hint, not a rule.</p>}
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
      <SectionHead icon={<ShoppingBag className="h-4 w-4" />} color={color} title="What they buy"
        sub={<>Share of this group's spending{d === 'sku' ? ' by product' : d === 'brand' ? ' by brand' : ' by category'}, compared with all customers.</>}
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
                  <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(r.spend / max) * 100}%`, background: color }} />
                  {allShare > 0 && <div className="absolute -top-[3px] h-4 w-[3px] rounded-full bg-[var(--amber)] ring-2 ring-white" style={{ left: `calc(${Math.min(100, ((allShare * G.spend) / max) * 100)}% - 1.5px)` }} title={`All customers: ${pct(allShare)}`} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--ink-3)]"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full" style={{ background: color }} />This group</span><span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-[3px] rounded-full bg-[var(--amber)]" />All customers</span></p>
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
      <div className="px-4 pt-4"><SectionHead icon={<Package className="h-4 w-4" />} title="Products they buy most" sub="From their actual orders in the period." /></div>
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
      {G.skus.length > 8 && <button onClick={() => setAll(!all)} className={`${same ? 'mt-auto' : ''} mx-4 my-2.5 inline-flex items-center gap-1 self-start text-[12px] font-semibold text-[var(--navy)] hover:underline`}>{all ? 'Show top 8' : `Show all ${G.skus.length} products`}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${all ? 'rotate-180' : ''}`} /></button>}
    </section>
  );
}

// ------------------------------------------------------------------------ behaviour alerts
const RULE_PHRASE: Record<RuleKey, (label: string) => string> = {
  spend: (l) => `are ${l.toLowerCase()}`,
  frequency: (l) => `are ${l.toLowerCase()}`,
  visit: (l) => (l === 'Shopped recently' ? 'shopped in the last 30 days' : l === 'Slowing down' ? 'last shopped 31–90 days ago' : 'have not shopped for 90+ days'),
  deals: (l) => (l === 'Mostly on deals' ? 'buy mostly on deals' : l === 'Mostly full price' ? 'buy mostly at full price' : 'buy a mix of deals and full price'),
  channel: (l) => `shop mainly ${l === 'Store' ? 'in store' : l === 'App' ? 'in the app' : 'online'}`,
  category: (l) => `spend most on ${l}`,
};

function alertText(a: Alert) {
  const t = TYPE_BY_ID[a.type];
  const m = METRIC_TEXT[a.metric];
  const more = a.inside > a.rest;
  const ratio = more ? a.inside / a.rest : a.rest / Math.max(1e-9, a.inside);
  const what = a.metric === 'catShare' ? `${a.category}'s share of their spending` : m.name;
  const title = `${int(a.n)} ${t.name} who ${RULE_PHRASE[a.rule.key](a.rule.label)} ${a.metric === 'catShare' ? `spend ${more ? 'more' : 'less'} of their money on ${a.category}` : a.metric === 'dealShare' ? `buy on deals ${more ? 'more' : 'less'} often` : a.metric === 'spendPerMonth' ? `spend ${more ? 'more' : 'less'} each month` : `shop ${more ? 'more' : 'less'} often`}`;
  const data = `${what[0].toUpperCase() + what.slice(1)}: ${m.fmt(a.inside)} for them, against ${m.fmt(a.rest)} for the other ${int(a.of - a.n)} ${t.name} (${ratio.toFixed(1)}× ${more ? 'higher' : 'lower'}).`;
  const why = `They are ${pct(a.n / a.of)} of the group but behave clearly differently, and a gap this size is very unlikely to be chance. If you plan for ${t.name} as one group, these customers may need their own offer or message, so it could be worth treating them as a separate segment.`;
  return { title, data, why };
}

function Alerts({ alerts, onExplore }: { alerts: Alert[]; onExplore: (a: Alert) => void }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3">
        <SectionHead icon={<BellRing className="h-4 w-4" />} color={alerts.length ? '#b45309' : '#0f7a55'} title="Behaviour alerts"
          sub="Customers inside a group who behave clearly differently from the rest of it. Only strong, consistent differences with enough customers are shown."
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

function Fold({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fafbfd]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${NAVY}14`, color: NAVY }}><Megaphone className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-bold tracking-tight">{title}</span><span className="block text-[11.5px] text-[var(--ink-3)]">{sub}</span></span>
        <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink-2)]">{open ? 'Hide' : 'Show'}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /></span>
      </button>
      {open && <div className="space-y-4 border-t border-[var(--line)] bg-[var(--page)] p-4">{children}</div>}
    </section>
  );
}

