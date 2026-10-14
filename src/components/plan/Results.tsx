// Planning > your plan against the recommended plan: summary, comparison, budget split, discount options, products.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Download, Package, Percent, Users, Wallet } from 'lucide-react';
import { useEngine } from '@/state';
import { SourceChip } from '@/components/ui';
import { GroupedBars } from '@/components/charts';
import { TYPE_BY_ID } from '@/engine/segments';
import { objectiveValue, type SegPromo } from '@/engine/targeting';
import type { TypeId } from '@/engine/behaviour';
import { ElasticityModel } from '@/engine/elasticity';
import { activation, optimise, qualifies, type Allocation as Alloc, type OptItem, type OptSettings, type Plan } from '@/engine/optimizer';
import { explainPlan, pastPractice, rollDown, unallocated, type CategoryAdvice, type PastPlan, type SkuAllocation } from '@/engine/budgetScope';
import { type Sku } from '@/engine/products';
import { returnRows } from '@/engine/returns';
import { reliabilityFor } from '@/lib/targeting';
import { likelyRange } from '@/engine/reliability';
import { segName, type PlanResult } from '@/lib/plan';
import { roiColor } from '@/lib/colors';
import { saveFile, toCsv, toXlsx } from '@/lib/download';
import { inr, int, money, pct } from '@/lib/fmt';
import { per1, list } from './shared';

export function Results({ r, model, label }: { r: PlanResult; model: ElasticityModel; label: string }) {
  const e = useEngine();
  const { items, settings, range, plan, rec, groups } = r;
  const rangeLabel = label, customers = r.ids.length;
  const free = useMemo(() => (settings.limits ? optimise(items, { ...settings, limits: undefined }) : null), [items, settings]);
  const advice = useMemo(() => explainPlan(plan, free, items), [plan, free, items]);
  const bau = useMemo(() => pastPractice(e.results, items, range, settings.budget), [e, items, range, settings.budget]);
  const skuRows = useMemo(() => rollDown(plan, range), [plan, range]);
  const left = unallocated(plan, free);
  const reached = r.reached;
  const recAdvice = useMemo(() => (rec ? explainPlan(rec.plan, null, rec.items) : []), [rec]);
  const [view, setView] = useState<'yours' | 'rec'>('yours');
  const shown = view === 'rec' && rec ? { ...rec, advice: recAdvice } : { plan, settings, items, advice };
  const why = useCallback((al: Alloc) => whyOffer(al, shown.items.find((i) => i.id === al.item.id), shown.settings, model), [shown.items, shown.settings, model]);
  const [focus, setFocus] = useState<string | null>(null);
  const focusId = shown.plan.allocations.some((x) => x.item.id === focus) || shown.items.some((i) => i.id === focus && i.members.length) ? focus : shown.plan.allocations[0]?.item.id ?? null;

  const exportPlan = (kind: 'xlsx' | 'csv') => {
    const head = ['Planned for', 'Brand', 'Category', 'SKU id', 'SKU', 'Customer group', 'Offer', 'Discount depth set by', 'Share of group offered', 'Budget (Rs)', 'Expected extra units', 'Expected extra sales (Rs)', 'Expected extra profit (Rs)', 'Profit per Rs 1 (ROI)', 'Why'];
    const who = `${label} (${customers} customers)`;
    const rows = skuRows.map((r) => {
      const al = plan.allocations.find((x) => x.item.category === r.sku.category && x.item.type === r.type && x.item.segment === r.segment);
      const src = al?.cell.promo.family !== 'price' && al?.cell.promo.family !== 'threshold' ? 'Past response to this kind of offer' : al?.cell.depthSource === 'elasticity' ? 'How sales moved with past discounts' : 'Assumption (deeper than any past discount)';
      const units = al ? al.incUnits * (r.spend / Math.max(1e-9, al.spend)) : 0;
      return [who, r.sku.brand, r.sku.category, r.sku.productId, r.sku.product, segName(r), r.offer, src, al ? pct(al.coverage) : '', Math.round(r.spend), Math.round(units), Math.round(r.incRevenue), Math.round(r.incMargin), r.spend > 0 ? +(r.incMargin / r.spend).toFixed(2) : 0, al ? whyOffer(al, items.find((i) => i.id === al.item.id), settings, model) : ''];
    });
    if (kind === 'csv') saveFile('promotion_budget_plan.csv', toCsv(head, rows), 'text/csv;charset=utf-8');
    else saveFile('promotion_budget_plan.xlsx', toXlsx(head, rows, 'Budget plan'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const exportAudience = () => saveFile('campaign_customer_list.csv', toCsv(['customer_id', 'customer_group', 'category', 'products', 'offer', 'group'],
    activation(plan).map((x) => [x.cid, TYPE_BY_ID[x.type].name, x.category, rangeLabel, x.offer, x.group])), 'text/csv;charset=utf-8');

  return (
    <div className="space-y-4">
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Summary plan={plan} advice={advice} customers={customers} budget={settings.budget} left={left} reached={reached} changes={recChanges(plan, settings.budget, rec, groups)} hasRec={!!rec} bau={bau.incMargin} />
        <Compare yours={{ plan, reached, budget: settings.budget }} rec={rec} />
      </div>
      {plan.allocations.length > 0 || (rec?.plan.allocations.length ?? 0) > 0 ? (
        <Fold title="Where the money goes, and the discount options" sub={`${plan.allocations.length} customer group × category budgets · compare every discount for any of them`} right={<DownloadMenu onExport={exportPlan} onAudience={exportAudience} />}>
          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <AllocationChart plan={shown.plan} advice={shown.advice} focusId={focusId} onFocus={setFocus} why={why}
              view={rec ? <PlanSwitch value={view} onChange={setView} /> : undefined} />
            <DiscountChart item={shown.items.find((i) => i.id === focusId)} plan={shown.plan} settings={shown.settings} items={shown.items} onFocus={setFocus} />
          </div>
        </Fold>
      ) : null}
      <Fold title="Products, and your plan vs the usual way" sub="Budget and extra profit for each product, and how the plan differs from splitting the money like past spend">
        <Details plan={plan} bau={bau} advice={advice} range={range} rows={skuRows} />
      </Fold>
    </div>
  );
}

/** a section that opens on demand, so the page stays short */
export function Fold({ title, sub, right, children }: { title: string; sub: string; right?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--ink-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
          <span className="min-w-0"><span className="block text-[13.5px] font-bold">{title}</span><span className="block text-[11.5px] text-[var(--ink-3)]">{sub}</span></span>
        </button>
        {right}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

function PlanSwitch({ value, onChange }: { value: 'yours' | 'rec'; onChange: (v: 'yours' | 'rec') => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--page)] p-0.5" role="radiogroup" aria-label="Plan shown">
      {([['yours', 'Your plan'], ['rec', 'Recommended']] as const).map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${value === v ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink)]'}`}>{l}</button>
      ))}
    </div>
  );
}

/** What the recommended plan does differently from yours, in plain words */
function recChanges(y: Plan, yb: number, rec: { plan: Plan; settings: OptSettings } | null, groups: Set<TypeId>): string[] {
  if (!rec) return [];
  const r = rec.plan;
  const out: string[] = [];
  for (const t of [...new Set(r.allocations.map((a) => a.item.type))].filter((x) => !groups.has(x))) {
    const al = r.allocations.filter((a) => a.item.type === t);
    out.push(`Add ${TYPE_BY_ID[t].name}: ${int(al.reduce((s, a) => s + a.treated, 0))} customers, about ${money(al.reduce((s, a) => s + a.incMargin, 0))} extra profit.`);
  }
  if (y.allocations.some((a) => a.item.type === 'dog')) out.push('Leave out Sleeping Dogs: offers make them buy less.');
  const rb = rec.settings.budget;
  if (rb < yb * 0.95) out.push(`Budget ${money(rb)} instead of ${money(yb)}: beyond that, more money earns less than it costs here.`);
  else if (rb > yb * 1.05) out.push(`Budget ${money(rb)} instead of ${money(yb)}: returns keep paying off up to that level.`);
  for (const a of r.allocations) {
    const mine = y.allocations.find((x) => x.item.id === a.item.id);
    if (mine && mine.cell.promo.key !== a.cell.promo.key) out.push(`${a.item.category} · ${segName(a.item)}: ${a.cell.promo.label} instead of ${mine.cell.promo.label}.`);
  }
  return out;
}

/** Your plan next to the recommended plan, measure by measure */
function Compare({ yours, rec }: { yours: { plan: Plan; reached: number; budget: number }; rec: { plan: Plan; settings: OptSettings; reached: number } | null }) {
  const y = yours.plan, r = rec?.plan;
  const e = useEngine();
  const band = reliabilityFor(e).band;
  const rng = (v: number) => { const x = likelyRange(v, band); return `${money(x.low)} – ${money(x.high)}`; };
  const rows: { k: string; a: string; b: string; d?: number; sub?: boolean }[] = [
    { k: 'Budget used', a: `${money(y.spend)} of ${money(yours.budget)}`, b: r ? `${money(r.spend)} of ${money(rec!.settings.budget)}` : '–' },
    { k: 'Customers with an offer', a: int(yours.reached), b: r ? int(rec!.reached) : '–' },
    { k: 'Extra units', a: int(y.incUnits), b: r ? int(r.incUnits) : '–', d: r ? r.incUnits - y.incUnits : undefined },
    { k: 'Extra sales', a: money(y.incRevenue), b: r ? money(r.incRevenue) : '–', d: r ? r.incRevenue - y.incRevenue : undefined },
    { k: 'Extra profit', a: money(y.incMargin), b: r ? money(r.incMargin) : '–', d: r ? r.incMargin - y.incMargin : undefined },
    { k: 'Likely range', a: rng(y.incMargin), b: r ? rng(r.incMargin) : '–', sub: true },
    { k: 'ROI (profit per ₹1)', a: y.spend > 0 ? per1(y.roi) : '–', b: r && r.spend > 0 ? per1(r.roi) : '–' },
  ];
  return (
    <section className="card flex flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-bold tracking-tight">Your plan vs recommended</h2>
        <span title="Both are estimates built by the same stated rules: customers' past response to offers, how sales moved with past discounts, product costs and the budget. The recommended plan only changes the customer groups (never Sleeping Dogs) and the budget level; your settings are not changed."><SourceChip kind="simulated" /></span>
      </div>
      <table className="mt-3 w-full text-[12.5px]">
        <thead><tr className="border-b border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
          <th className="py-2 text-left font-semibold" /><th className="px-2 py-2">Your plan</th><th className="py-2 pl-2">Recommended</th>
        </tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.k} className="border-b border-[var(--line-2)] text-right last:border-0">
              <td className={`text-left text-[var(--ink-2)] ${x.sub ? 'pb-2 pl-3 text-[11.5px] text-[var(--ink-3)]' : 'py-2'}`}>{x.k}</td>
              <td className={`num px-2 ${x.sub ? 'pb-2 text-[11.5px] text-[var(--ink-3)]' : 'py-2 font-semibold'}`}>{x.a}</td>
              <td className={`num pl-2 ${x.sub ? 'pb-2 text-[11.5px] text-[var(--ink-3)]' : 'py-2 font-semibold'}`}>{x.b}{x.d !== undefined && Math.abs(x.d) >= 1 && <span className="ml-1.5 text-[11px] font-semibold" style={{ color: x.d > 0 ? 'var(--green-dark)' : 'var(--red)' }}>{x.d > 0 ? '+' : '−'}{x.k === 'Extra units' ? int(Math.abs(x.d)) : money(Math.abs(x.d))}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** who to target, what to promote, which discount, how to split the budget: one line each, straight from the plan */
function Summary({ plan, advice, customers, budget, left, reached, changes, hasRec, bau }: {
  plan: Plan; advice: CategoryAdvice[]; customers: number; budget: number; left: { amount: number; text: string }; reached: number; changes: string[]; hasRec: boolean; bau: number;
}) {
  const funded = [...new Set(plan.allocations.map((x) => x.item.type))];
  const skipped = [...new Set(advice.flatMap((c) => c.types.filter((t) => !t.funded).map((t) => t.type)))].filter((t) => !funded.includes(t));
  const byCat = advice.filter((c) => c.spend > 0).sort((x, y) => y.spend - x.spend);
  const offers = [...new Map(plan.allocations.map((x) => [`${x.item.type}|${x.cell.promo.key}`, x])).values()];
  const rows: [ReactNode, string, ReactNode][] = plan.allocations.length ? [
    [<Users key="i" className="h-3.5 w-3.5" />, 'Who to target', <>{list(funded.map((t) => TYPE_BY_ID[t].name))} · {int(reached)} of {int(customers)} customers{skipped.length ? <span className="text-[var(--ink-3)]"> · no offer for {list(skipped.map((t) => TYPE_BY_ID[t].name))}</span> : ''}</>],
    [<Package key="i" className="h-3.5 w-3.5" />, 'What to promote', <>{byCat.map((c) => c.category).join(', ')}</>],
    [<Percent key="i" className="h-3.5 w-3.5" />, 'Suggested discount', <>{offers.slice(0, 3).map((x) => `${x.cell.promo.label} for ${TYPE_BY_ID[x.item.type].name}`).join('; ')}{offers.length > 3 ? ` and ${offers.length - 3} more` : ''}</>],
    [<Wallet key="i" className="h-3.5 w-3.5" />, 'How to spend the budget', <>{byCat.map((c) => `${money(c.spend)} on ${c.category}`).join(', ')} · {money(plan.spend)} of {money(budget)}{left.amount > budget * 0.01 ? <span className="text-[var(--ink-3)]"> ({money(left.amount)} kept back: more would cost more than it earns)</span> : ''}</>],
  ] : [];
  return (
    <section className="card flex flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-bold tracking-tight">Your plan</h2>
        <span title="Built by stated rules from each customer's past response to offers, how sales moved with past discounts, product costs and your budget. Not a trained AI model; results are estimates."><SourceChip kind="simulated" /></span>
      </div>
      {plan.allocations.length ? (
        <dl className="mt-3 space-y-2.5">
          {rows.map(([icon, k, v]) => (
            <div key={k} className="grid grid-cols-[22px_150px_minmax(0,1fr)] items-start gap-2 text-[12.5px]">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-[#eef3fa] text-[var(--navy)]">{icon}</span>
              <dt className="pt-0.5 font-semibold text-[var(--ink-2)]">{k}</dt>
              <dd className="pt-0.5 leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-[12.5px] leading-snug text-[var(--ink-2)]">No offer pays back for these customers and products. {advice[0]?.headline ?? ''} Try other customer groups or products, or lower the minimum profit per ₹1 under Advanced settings.</p>
      )}
      <div className="mt-auto pt-3">
        <div className="rounded-lg bg-[var(--page)] px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">What the recommendation changes</p>
          {!hasRec ? <p className="mt-1 text-[12px] text-[var(--ink-3)]">No customer group in this audience responds to offers, so there is nothing to recommend.</p>
            : changes.length ? <ul className="mt-1 space-y-0.5 text-[12px] leading-snug text-[var(--ink)]">{changes.slice(0, 4).map((c) => <li key={c}>• {c}</li>)}</ul>
            : <p className="mt-1 text-[12px] text-[var(--ink)]">Nothing: your plan already matches the recommendation.</p>}
          <p className="mt-1.5 text-[11px] text-[var(--ink-3)]">Your settings are not changed. The usual way at your budget would earn {money(bau)} extra profit.</p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------ chart 1: where the budget goes and what it earns
function AllocationChart({ plan, advice, focusId, onFocus, why, view }: {
  plan: Plan; advice: CategoryAdvice[]; focusId: string | null; onFocus: (id: string) => void; why: (a: Alloc) => string; view?: ReactNode;
}) {
  const rows = plan.allocations;
  const max = Math.max(1, ...rows.map((a) => Math.max(a.spend, a.incMargin)));
  const unfunded = advice.filter((a) => a.spend <= 0);
  const top = rows[0];
  const issues = plan.limitIssues.filter((x) => x.kind !== 'max-binding');
  return (
    <section className="card flex h-full flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-bold tracking-tight">Budget by customer group</h2>
          <p className="mt-0.5 flex gap-4 text-[11.5px] text-[var(--ink-3)]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[var(--navy)]" />Budget</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[var(--green)]" />Expected extra profit</span>
            <span>Click a row to compare its discounts</span>
          </p>
        </div>
        <div className="flex items-center gap-2">{view}</div>
      </div>
      {top && <p className="mt-2.5 text-[12.5px] leading-snug text-[var(--ink)]"><b>{pct(plan.spend ? top.spend / plan.spend : 0)}</b> of the money goes to <b>{top.item.category} · {segName(top.item)}</b> with <b>{top.cell.promo.label}</b>: each ₹1 earns {per1(top.roi)} back on top.</p>}
      {issues.length > 0 && <p className="mt-2 rounded-md bg-[#fef3c7] px-2.5 py-1.5 text-[11.5px] text-[#92400e]">{issues.map((x) => (x.kind === 'mins-over-budget' ? `Category minimums (${money(x.limit)}) exceed the budget, so they were set aside.` : `${x.category}: minimum ${money(x.limit)} not reachable, only ${money(x.possible)} pays off.`)).join(' ')}</p>}
      {rows.length ? (
        <ul className="mt-3 space-y-1">
          {rows.map((a) => {
            const on = a.item.id === focusId;
            return (
              <li key={a.item.id}>
                <button onClick={() => onFocus(a.item.id)} aria-pressed={on} title={why(a)}
                  className={`grid w-full grid-cols-[minmax(0,190px)_minmax(0,1fr)_96px] items-center gap-3 rounded-md px-2 py-1.5 text-left ${on ? 'bg-[#eef3fa]' : 'hover:bg-[var(--page)]'}`}>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_BY_ID[a.item.type].color }} />{a.item.category} · {segName(a.item)}</span>
                    <span className="block truncate text-[11px] text-[var(--ink-3)]">{a.cell.promo.label} · {int(a.treated)} customers{a.coverage < 1 ? ` (${pct(a.coverage)} of group)` : ''}{a.cell.history ? '' : ' · untested'}</span>
                  </span>
                  <span className="space-y-1">
                    <span className="block h-2 rounded-full bg-[var(--navy)]" style={{ width: `${Math.max(1, (a.spend / max) * 100)}%` }} />
                    <span className="block h-2 rounded-full bg-[var(--green)]" style={{ width: `${Math.max(1, (Math.max(0, a.incMargin) / max) * 100)}%` }} />
                  </span>
                  <span className="num text-right text-[11.5px] leading-tight"><span className="block font-semibold">{money(a.spend)}</span><span className="block text-[var(--green-dark)]">+{money(a.incMargin)}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-6 text-center text-[12.5px] text-[var(--ink-3)]">No offer pays back with these settings. Lower the minimum profit per ₹1 under Advanced settings, allow more discount types, or pick other products or customers.</p>}
      {unfunded.length > 0 && (
        <p className="mt-auto pt-3 text-[11.5px] text-[var(--ink-3)]">
          No budget: {unfunded.map((u, i) => <span key={u.category} title={u.headline} className="cursor-help underline decoration-dotted underline-offset-2">{u.category}{i < unfunded.length - 1 ? ', ' : ''}</span>)}{' '}
          <span>(hover for why)</span>
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------ chart 2: the discount options for one customer group
function DiscountChart({ item, plan, settings, items, onFocus }: { item: OptItem | undefined; plan: Plan; settings: OptSettings; items: OptItem[]; onFocus: (id: string) => void }) {
  const live = items.filter((i) => i.members.length && (i.type !== 'dog' || settings.includeExcluded));
  if (!item) return <section className="card h-full p-4"><h2 className="text-[14px] font-bold tracking-tight">Compare discounts</h2><p className="mt-6 text-center text-[12.5px] text-[var(--ink-3)]">No customer group to compare yet.</p></section>;
  const chosen = plan.allocations.find((a) => a.item.id === item.id)?.cell.promo.key;
  const opts = item.cells.filter((c) => c.eligible.ok && settings.allowed(c.promo) && c.investment > 0)
    .sort((a, b) => (a.promo.family === 'price' && b.promo.family === 'price' ? a.promo.depth - b.promo.depth : b.incMargin - a.incMargin));
  const price = opts.filter((c) => c.promo.family === 'price');
  const rest = opts.filter((c) => c.promo.family !== 'price').slice(0, Math.max(0, 8 - price.length));
  const shown = [...price, ...rest];
  const maxAbs = Math.max(1, ...shown.map((c) => Math.abs(c.incMargin)));
  const neg = shown.some((c) => c.incMargin < 0);
  const zero = neg ? 35 : 0, span = neg ? 65 : 100;
  return (
    <section className="card h-full p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold tracking-tight">Compare discounts</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">Expected extra profit if the whole group got each offer</p>
        </div>
        <select value={item.id} onChange={(ev) => onFocus(ev.target.value)} aria-label="Customer group"
          className="h-8 max-w-[220px] rounded-lg border border-[var(--line)] bg-white px-2 text-[12px] font-medium text-[var(--ink-2)] outline-none focus:border-[var(--navy)]">
          {live.map((i) => <option key={i.id} value={i.id}>{i.category} · {segName(i)}</option>)}
        </select>
      </div>
      {!opts.length ? <p className="mt-6 text-center text-[12.5px] text-[var(--ink-3)]">No discount type allowed here. Check Advanced settings.</p> : (
        <>
          <div className="mt-3 grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_52px_56px] gap-x-3 border-b border-[var(--line)] pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
            <span>Offer</span><span>Extra profit</span><span className="text-right" title="Extra profit for every ₹1 the offer costs">ROI</span><span className="text-right" title="Extra buyers in every 100 customers of the group">Buyers</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {shown.map((c) => {
              const ok = qualifies(c, settings);
              const w = (Math.abs(c.incMargin) / maxAbs) * span;
              const isChosen = c.promo.key === chosen;
              return (
                <li key={c.promo.key} title={`${c.promo.how} ${ok ? '' : c.incMargin <= 0 ? 'Loses margin.' : `Returns less than your minimum of ${per1(settings.hurdle)} per ₹1.`}${c.depthSource === 'behaviour' && c.promo.family === 'price' ? ' Deeper than any discount tried in this category: assumption.' : ''}`}
                  className={`grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_52px_56px] items-center gap-x-3 rounded-md px-1 py-1 ${isChosen ? 'bg-[#eef3fa]' : ''}`}>
                  <span className={`truncate text-[12px] ${isChosen ? 'font-bold text-[var(--navy)]' : ok ? 'font-medium' : 'text-[var(--ink-3)]'}`}>{c.promo.label}{isChosen ? ' ✓' : ''}</span>
                  <span className="relative h-2.5">
                    {neg && <span className="absolute inset-y-[-2px] w-px bg-[var(--line)]" style={{ left: `${zero}%` }} />}
                    <span className="absolute inset-y-0 rounded" style={{ left: c.incMargin >= 0 ? `${zero}%` : `${zero - w}%`, width: `${Math.max(0.8, w)}%`, background: c.incMargin < 0 ? 'var(--red)' : isChosen ? 'var(--navy)' : ok ? '#8fa3bd' : '#e1e6ee' }} />
                  </span>
                  <span className="num text-right text-[12px] font-semibold" style={{ color: roiColor(c.roi) }}>{per1(c.roi)}</span>
                  <span className="num text-right text-[12px] text-[var(--ink-2)]">+{Math.max(0, Math.round(c.uplift * 100))}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2.5 text-[11px] leading-snug text-[var(--ink-3)]">Deeper cuts usually win more buyers but return less per ₹1. ✓ is the recommendation; pale offers fall below your minimum return. Hover an offer for details.</p>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------ more details, closed by default
function Details({ plan, bau, advice, range, rows }: { plan: Plan; bau: PastPlan; advice: CategoryAdvice[]; range: Sku[]; rows: SkuAllocation[] }) {
  const funded = advice.filter((a) => a.spend > 0).map((a) => a.category);
  return (
    <div className="grid items-stretch gap-4 xl:grid-cols-2">
      <section className="card flex min-w-0 flex-col p-4">
        <h2 className="text-[14px] font-bold tracking-tight">Products</h2>
        <p className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">Budget and extra profit for each product in your plan</p>
        <div className="mt-3 flex-1">
          {funded.length ? <SkuTable categories={funded.map((c) => ({ category: c, skus: range.filter((s) => s.category === c) }))} rows={rows} /> : <p className="py-8 text-center text-[12.5px] text-[var(--ink-3)]">No products funded.</p>}
        </div>
      </section>
      <section className="card flex min-w-0 flex-col p-4">
        <CompareByCategory plan={plan} bau={bau} advice={advice} />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------ why an offer (row tooltips and the export)
/**
 * Why this offer, for one funded customer group: how it compares with the other offers that pay back, what a deeper price
 * cut would do, and where the response to the discount depth comes from (demand curve or behaviour rules).
 */
function whyOffer(a: Alloc, item: OptItem | undefined, s: OptSettings, model: ElasticityModel): string {
  if (!item) return '';
  const val = (c: SegPromo) => objectiveValue(c, s.objective);
  const usable = item.cells.filter((c) => c.eligible.ok && s.allowed(c.promo) && c.investment > 0);
  const others = usable.filter((c) => c.promo.key !== a.cell.promo.key && qualifies(c, s)).sort((x, y) => val(y) - val(x));
  const out: string[] = [];
  const goal = s.objective === 'margin' ? 'extra profit' : s.objective === 'revenue' ? 'extra sales' : 'extra buyers';
  out.push(others.length
    ? `Best of ${others.length + 1} offers that pay back for this group on ${goal}; next best is ${others[0].promo.label} (${per1(others[0].roi)} per ₹1).`
    : 'The only offer that pays back for this group.');
  // price cuts and ₹-off offers are what the demand curve was fitted on; other mechanics move volume by other means
  const discount = a.cell.promo.family === 'price' || a.cell.promo.family === 'threshold';
  if (discount) {
    const deeper = a.cell.promo.family === 'price' ? usable.filter((c) => c.promo.family === 'price' && c.promo.depth > a.cell.promo.depth).sort((x, y) => x.promo.depth - y.promo.depth)[0] : undefined;
    if (deeper) {
      const more = Math.round((deeper.uplift - a.cell.uplift) * 100);
      out.push(`A deeper cut (${deeper.promo.label}) would ${more > 0 ? `win about ${more} more buyers in every 100` : 'win no more buyers'} but return ${per1(deeper.roi)} per ₹1${deeper.roi < s.hurdle ? ', below your minimum' : ''}.`);
    }
    const ce = model.byCategory.get(item.category);
    out.push(a.cell.depthSource === 'elasticity'
      ? `How buying changes with the discount is estimated from ${ce?.reliable ? `past price offers in ${item.category}` : 'past price offers in all categories (too few in this one)'}.`
      : 'This depth is beyond any discount run before here, so its effect is an assumption from the behaviour rules: test it on a small group first.');
  } else out.push('Not a discount on the price, so its effect comes from how these customers responded to past offers of this kind.');
  return out.join(' ');
}

function DownloadMenu({ onExport, onAudience }: { onExport: (k: 'xlsx' | 'csv') => void; onAudience: () => void }) {
  const [open, setOpen] = useState(false);
  const item = (label: string, sub: string, run: () => void) => (
    <button onClick={() => { run(); setOpen(false); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--page)]">
      <span className="block text-[12.5px] font-semibold">{label}</span><span className="block text-[11.5px] text-[var(--ink-3)]">{sub}</span>
    </button>
  );
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(!open)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--navy)] px-3 text-[12.5px] font-semibold text-white hover:opacity-95">
        <Download className="h-3.5 w-3.5" />Download the plan<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute inset-x-0 bottom-full z-20 pb-1">
          <div className="rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-lg">
            {item('Plan (Excel)', 'Budget per brand, category and product, with reasons', () => onExport('xlsx'))}
            {item('Plan (CSV)', 'The same plan as a CSV file', () => onExport('csv'))}
            {item('Customer list (CSV)', 'Who gets which offer, and who is held back', onAudience)}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------ details: products and the usual way
/** per product: units sold in all past promotion windows, and how many of them were extra (engine/returns.ts), once per file */
const pastLift = new WeakMap<object, Map<string, { units: number; uplift: number }>>();

function usePastLift() {
  const e = useEngine();
  return useMemo(() => {
    let m = pastLift.get(e);
    if (!m) {
      m = new Map();
      for (const r of returnRows(e.ds, e.perCustomer, e.ds.campaigns, () => true)) {
        const a = m.get(r.productId) ?? { units: 0, uplift: 0 };
        a.units += r.units; a.uplift += r.units - r.base;
        m.set(r.productId, a);
      }
      pastLift.set(e, m);
    }
    return m;
  }, [e]);
}

/** the products of the funded categories in one table, sharing each category's money by their share of regular sales, with how each responded to past promotions */
function SkuTable({ categories, rows }: { categories: { category: string; skus: Sku[] }[]; rows: SkuAllocation[] }) {
  const past = usePastLift();
  const sum = (id: string, f: (r: SkuAllocation) => number) => rows.filter((r) => r.sku.productId === id).reduce((t, r) => t + f(r), 0);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-[var(--line)]">
      <div className="max-h-[360px] flex-1 overflow-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-[var(--page)]"><tr className="text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
            <th className="px-3 py-2 text-left">Product</th>
            <th className="px-2 py-2" title="Share of the category's normal sales; each product gets this share of the category's money">Sales share</th>
            <th className="px-2 py-2" title="Of this product's sales during past promotions, the share that was extra (above what customers would have bought anyway). Estimate.">Past uplift</th>
            <th className="px-2 py-2">Budget</th><th className="px-3 py-2">Extra profit</th>
          </tr></thead>
          <tbody>
            {categories.map(({ category, skus }) => {
              const tot = skus.reduce((t, s) => t + s.share, 0);
              return [
                <tr key={category} className="border-t border-[var(--line)] bg-[#fafbfd]">
                  <td colSpan={3} className="px-3 py-1.5 text-[11.5px] font-bold">{category}</td>
                  <td className="num px-2 py-1.5 text-right text-[11.5px] font-bold">{money(skus.reduce((t, s) => t + sum(s.productId, (r) => r.spend), 0))}</td>
                  <td className="num px-3 py-1.5 text-right text-[11.5px] font-bold">{money(skus.reduce((t, s) => t + sum(s.productId, (r) => r.incMargin), 0))}</td>
                </tr>,
                ...[...skus].sort((a, b) => b.share - a.share).map((s) => {
                  const p = past.get(s.productId);
                  return (
                    <tr key={s.productId} className="border-t border-[var(--line-2)] text-right">
                      <td className="px-3 py-1.5 pl-5 text-left font-medium">{s.product}</td>
                      <td className="num px-2 py-1.5 text-[var(--ink-3)]">{pct(tot ? s.share / tot : 0)}</td>
                      <td className="num px-2 py-1.5 text-[var(--ink-3)]">{p && p.units > 0 ? pct(Math.max(0, p.uplift) / p.units) : '–'}</td>
                      <td className="num px-2 py-1.5 font-semibold">{money(sum(s.productId, (r) => r.spend))}</td>
                      <td className="num px-3 py-1.5">{money(sum(s.productId, (r) => r.incMargin))}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--line-2)] bg-[var(--page)] px-3 py-1.5 text-[11px] leading-snug text-[var(--ink-3)]">Past promotions ran on whole categories, so response is measured per category and its money is split by normal sales. Past uplift shows how strongly each product responded.</p>
    </div>
  );
}

function CompareByCategory({ plan, bau, advice }: { plan: Plan; bau: PastPlan; advice: CategoryAdvice[] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rec = new Map(advice.map((a) => [a.category, a.spend]));
  const recOffers = (c: string) => [...new Set(plan.allocations.filter((a) => a.item.category === c).map((a) => a.cell.promo.label))].join(', ') || '–';
  const rows = bau.rows.map((r) => ({ ...r, rec: rec.get(r.category) ?? 0 })).sort((a, b) => b.rec - a.rec);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-bold tracking-tight">Usual way vs plan</h2>
          <p className="mt-0.5 flex flex-wrap gap-x-4 text-[11.5px] text-[var(--ink-3)]"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#94a3b8]" />Usual way (split like past spend)</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[var(--navy)]" />Your plan</span></p>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5">
          {(['chart', 'table'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold capitalize ${view === v ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)]'}`}>{v}</button>)}
        </div>
      </div>
      <div className="mt-3 flex-1">
      {view === 'chart'
        ? <GroupedBars height={300} format={(v) => inr(v)} series={[{ label: 'Usual way', color: '#94a3b8' }, { label: 'Your plan', color: 'var(--navy)' }]} groups={rows.map((r) => ({ label: r.category, values: [r.spend, r.rec] }))} />
        : (
          <div className="max-h-[360px] overflow-auto rounded-lg border border-[var(--line)]">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-[var(--page)]"><tr className="text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
                {['Category', 'Usual', 'Your plan', 'Change'].map((h, i) => <th key={h} className={`px-3 py-2 ${i === 0 ? 'text-left' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.rec - r.spend;
                  return (
                    <tr key={r.category} className="border-t border-[var(--line-2)] text-right">
                      <td className="px-3 py-1.5 text-left"><span className="block font-semibold">{r.category}</span><span className="block text-[10.5px] text-[var(--ink-3)]" title={`Usual offer: ${r.offer}. Past campaigns here returned ${per1(r.pastRoi)} per ₹1. Your plan: ${recOffers(r.category)}`}>{r.offer} → {recOffers(r.category)}</span></td>
                      <td className="num px-3">{money(r.spend)}</td>
                      <td className="num px-3 font-semibold">{money(r.rec)}</td>
                      <td className="num px-3 font-semibold" style={{ color: d >= 0 ? 'var(--green-dark)' : 'var(--red)' }}>{d >= 0 ? '+' : '−'}{money(Math.abs(d))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
