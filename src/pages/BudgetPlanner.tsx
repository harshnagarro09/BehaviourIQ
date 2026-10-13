// Plan the budget: a compact planning workspace. Who (customers from Find customers, or a new plan with its own customer
// filters), what (brand -> category -> SKU, chosen freely: an audience is not tied to the category it was built for), how much
// (budget, aim, discount types and rules); then the recommended allocation and the discount options for one customer group.
// Customer behaviour decides who responds; the category demand curve (price elasticity from past price offers) shapes how deep
// the discount should be; the optimiser (engine/optimizer.ts, exact knapsack) decides where the money goes. Decisions are per
// customer type x category, scaled to the products picked and split to SKUs by regular-sales share (engine/budgetScope.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Download, Info, Package, Percent, SlidersHorizontal, Users, Wallet } from 'lucide-react';
import { useEngine } from '@/state';
import { Help } from '@/components/Help';
import { SourceChip } from '@/components/ui';
import { GroupedBars } from '@/components/charts';
import { useProductFilter } from '@/components/ProductScope';
import { TYPE_BY_ID } from '@/engine/segments';
import { FAMILY_LABEL, type Family } from '@/engine/promotions';
import { objectiveValue, type Objective, type SegPromo } from '@/engine/targeting';
import type { TypeId } from '@/engine/behaviour';
import type { ElasticityModel } from '@/engine/elasticity';
import { activityOf, ALL_CATEGORIES, type SharedAudience } from '@/engine/audience';
import { activation, optimise, qualifies, type Allocation as Alloc, type OptItem, type OptSettings, type Plan, type SpendLimit } from '@/engine/optimizer';
import {
  explainPlan, pastPractice, rangeItems, rollDown, unallocated,
  type CategoryAdvice, type PastPlan, type SkuAllocation,
} from '@/engine/budgetScope';
import { skuCatalog, type Sku } from '@/engine/products';
import { returnRows } from '@/engine/returns';
import { audienceKey, elasticityOf, predictionFor, type AudienceScope } from '@/lib/targeting';
import { roiColor } from '@/lib/colors';
import { saveFile, toCsv, toXlsx } from '@/lib/download';
import { inr, int, pct } from '@/lib/fmt';

const FAMILIES: Family[] = ['price', 'threshold', 'volume', 'bundle', 'loyalty', 'partner'];
const DEFAULT_FAMILIES: Family[] = ['price', 'threshold', 'volume', 'bundle', 'loyalty'];
const GOALS: { id: Objective; label: string; text: string }[] = [
  { id: 'margin', label: 'Most profit', text: 'Puts money where it adds the most profit after paying for the offer.' },
  { id: 'revenue', label: 'Most sales', text: 'Puts money where it adds the most sales. Extra sales can come with thinner profit.' },
  { id: 'buyers', label: 'Most buyers', text: 'Puts money where it wins the most extra buyers. More buyers is not always more profit.' },
];
const per1 = (roi: number) => `₹${roi.toFixed(2)}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
type LimitInput = Record<string, { min: string; max: string }>;
const num = (s: string) => (s.trim() === '' || !Number.isFinite(+s) || +s < 0 ? null : +s);
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]';

type Source = 'find' | 'new';
type ActivityPick = 'all' | 'active' | 'lapsing';
const GROUP_IDS: TypeId[] = ['persuadable', 'sure', 'lost', 'dog'];
const DEFAULT_GROUPS: TypeId[] = ['persuadable', 'sure', 'lost'];

export function BudgetView({ audience, onFind }: { audience: SharedAudience | null; onFind: () => void }) {
  const e = useEngine();
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const products = useProductFilter(catalog);
  const { picked, label: rangeLabel, pickers, setCategory } = products;
  const range = useMemo(() => picked.filter((s) => s.share > 0), [picked]);
  const rangeKey = range.map((s) => s.productId).join('|');
  const noRegular = picked.length > 0 && range.length === 0;

  // ---- 1. audience: imported from Find customers, or built here from customer groups (each source keeps its own groups)
  const findIds = audience?.ids;
  const [source, setSource] = useState<Source>('find');
  const [groupsFind, setGroupsFind] = useState<Set<TypeId>>(new Set(DEFAULT_GROUPS));
  const [groupsNew, setGroupsNew] = useState<Set<TypeId>>(new Set()); // starting from scratch: nobody until groups are picked
  const [activity, setActivity] = useState<ActivityPick>('all');
  const fromFind = source === 'find' && !!findIds?.length;
  const groups = fromFind ? groupsFind : groupsNew;
  const setGroups = fromFind ? setGroupsFind : setGroupsNew;
  // the plan starts on the category Find customers promotes, once; after that the products are the user's choice
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !audience?.category || audience.category === ALL_CATEGORIES) return; // "all categories": leave the products open
    seeded.current = true;
    setCategory(audience.category);
  }, [audience?.category, setCategory]);
  const base = useMemo(() => (fromFind ? findIds! : e.records.map((r) => r.cid)), [fromFind, findIds, e]);
  const baseAct = useMemo(() => (fromFind || activity === 'all' ? base : base.filter((cid) => {
    const a = activityOf(e.recById.get(cid)!.b);
    return activity === 'active' ? a === 'active' : a !== 'active';
  })), [base, fromFind, activity, e]);
  const ids = useMemo(() => baseAct.filter((cid) => groups.has(e.typeOf.get(cid)!)), [baseAct, groups, e]);
  const scope: AudienceScope = useMemo(() => ({ key: audienceKey(ids), ids: new Set(ids) }), [ids]);
  const counts = useMemo(() => {
    const m = new Map<TypeId, number>(GROUP_IDS.map((t) => [t, 0]));
    for (const cid of baseAct) m.set(e.typeOf.get(cid)!, (m.get(e.typeOf.get(cid)!) ?? 0) + 1);
    return m;
  }, [baseAct, e]);

  // ---- 3. budget, goal and advanced settings
  const [budget, setBudget] = useState(30000);
  const [objective, setObjective] = useState<Objective>('margin');
  const [hurdle, setHurdle] = useState(0.25);
  const [holdout, setHoldout] = useState(0.1);
  const [families, setFamilies] = useState<Set<Family>>(new Set(DEFAULT_FAMILIES));
  const [limitInput, setLimitInput] = useState<LimitInput>({});
  const [rulesOpen, setRulesOpen] = useState(false);
  const model = useMemo(() => elasticityOf(e), [e]);
  const cats = useMemo(() => [...new Set(range.map((s) => s.category))].sort(), [range]);
  const limits = useMemo(() => {
    const out: Record<string, SpendLimit> = {};
    for (const c of cats) { const l = limitInput[c]; if (!l) continue; const min = num(l.min), max = num(l.max); if (min || max != null) out[c] = { min, max }; }
    return out;
  }, [limitInput, cats]);
  const limitCount = Object.keys(limits).length;
  const includeDogs = groups.has('dog');
  const settings: OptSettings = useMemo(() => ({ budget, objective, hurdle, holdout, includeExcluded: includeDogs, allowed: (p) => families.has(p.family), limits: limitCount ? limits : undefined }),
    [budget, objective, hurdle, holdout, includeDogs, families, limits, limitCount]);
  const changedRules = [hurdle !== 0.25, holdout !== 0.1, families.size !== DEFAULT_FAMILIES.length || !DEFAULT_FAMILIES.every((f) => families.has(f))].filter(Boolean).length + limitCount;

  // ---- 4. generate plan: once generated, results follow every input (budget, groups, products, goal, settings) immediately,
  // so what is shown always matches the current selections
  const [generated, setGenerated] = useState(false);
  const canRun = ids.length > 0 && range.length > 0;
  const live = generated && canRun;
  // Your plan: exactly the selected customers, products, budget, goal and settings
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rangeKey is the identity of range
  const items = useMemo(() => (live ? rangeItems(range, (c) => predictionFor(e, c, 'combined', scope)) : null), [live, e, rangeKey, scope]);
  // Recommended plan: same source audience, products, goal and settings, but every customer group that responds (never
  // Sleeping Dogs) and the budget at which returns level off
  const recIds = useMemo(() => baseAct.filter((cid) => e.typeOf.get(cid) !== 'dog'), [baseAct, e]);
  const recScope: AudienceScope = useMemo(() => ({ key: audienceKey(recIds), ids: new Set(recIds) }), [recIds]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rangeKey is the identity of range
  const itemsRec = useMemo(() => (live && recIds.length ? rangeItems(range, (c) => predictionFor(e, c, 'combined', recScope)) : null), [live, e, rangeKey, recScope]);

  return (
    <div className="space-y-4">
      <Steps done={{ audience: ids.length > 0, products: range.length > 0, budget: budget > 0, generate: live }} />

      {/* ------------------------------------------------------------ set up: audience, products, budget */}
      <section className="card divide-y divide-[var(--line-2)]">
        <div className="space-y-3 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-bold">Audience</p>
            <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--page)] p-0.5" role="radiogroup" aria-label="Where the customers come from">
              {([['find', 'Use customers from Find customers'], ['new', 'Start from scratch']] as const).map(([v, l]) => (
                <button key={v} role="radio" aria-checked={source === v} onClick={() => setSource(v)} disabled={v === 'find' && !findIds?.length}
                  className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40 ${source === v ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink)]'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Customer groups">
              {GROUP_IDS.map((t) => {
                const on = groups.has(t);
                const n = counts.get(t) ?? 0;
                return (
                  <button key={t} onClick={() => { const s = new Set(groups); if (on) s.delete(t); else s.add(t); setGroups(s); }} aria-pressed={on} disabled={!n && !on}
                    title={`${TYPE_BY_ID[t].tagline}.${t === 'dog' ? ' They buy less when offers run; include them only to test that.' : ''}`}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40 ${on ? 'border-[var(--navy)] bg-[#eef3fa] text-[var(--navy)]' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[#c9d2de]'}`}>
                    <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${on ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[#c9d2de] bg-white'}`}>{on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
                    <span className="h-2 w-2 rounded-full" style={{ background: TYPE_BY_ID[t].color }} />{TYPE_BY_ID[t].name}<span className="num font-normal text-[var(--ink-3)]">{int(n)}</span>
                  </button>
                );
              })}
            </div>
            {!fromFind && (
              <div className="inline-flex rounded-lg border border-[var(--line)] bg-white p-0.5" role="radiogroup" aria-label="Last shopped">
                {([['all', 'Any activity'], ['active', 'Active'], ['lapsing', 'Slowing / inactive']] as const).map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={activity === v} onClick={() => setActivity(v)} className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${activity === v ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{l}</button>
                ))}
              </div>
            )}
          </div>
          <AudienceBar title={fromFind ? audience!.goal : 'Selected customers'} total={ids.length} counts={counts} groups={groups}
            note={fromFind ? <>From Find customers ({audience!.category === ALL_CATEGORIES ? 'all categories' : audience!.category}{audience!.criteria.length ? `, ${audience!.criteria.join(', ')}` : ''}) · <button onClick={onFind} className="font-semibold text-[var(--navy)] hover:underline">Change</button></> : undefined} />
          {!ids.length && <p className="text-[12px] text-[#92400e]">{fromFind ? 'None of the imported customers are in the selected groups. Tick at least one group.' : 'Tick one or more customer groups to build the audience.'}</p>}
          <Evidence ids={ids} cats={cats} fromCategory={fromFind && audience!.category !== ALL_CATEGORIES ? audience!.category : null} />
        </div>

        <div className="grid items-end gap-3 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_auto]">
          {pickers[0]}{pickers[1]}{pickers[2]}
          <BudgetField value={budget} onChange={setBudget} max={Math.max(60000, Math.ceil(budget * 1.2 / 5000) * 5000)} />
          <AimField value={objective} onChange={setObjective} />
          {noRegular && <p className="text-[12px] text-[var(--red)] sm:col-span-2 lg:col-span-3 xl:col-span-5">This product has no regular sales in the data, so its share of a promotion can't be estimated. Pick another product.</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <button onClick={() => setRulesOpen(!rulesOpen)} aria-expanded={rulesOpen}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold ${rulesOpen ? 'border-[var(--navy)] bg-[#eef3fa] text-[var(--navy)]' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />Advanced settings
            {changedRules > 0 && <span className="rounded-full bg-[var(--navy)] px-1.5 text-[10.5px] text-white">{changedRules}</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rulesOpen ? 'rotate-180' : ''}`} />
          </button>
          <span className="ml-auto text-[12px] text-[var(--ink-3)]">
            {!canRun ? 'Choose customers and products first' : live ? 'Results update as you change any setting' : `${int(ids.length)} customers · ${rangeLabel} · ${inr(budget)}`}
          </span>
          {!live && (
            <button onClick={() => setGenerated(true)} disabled={!canRun}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--navy)] px-4 text-[13px] font-semibold text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40">Generate plan</button>
          )}
        </div>
        {rulesOpen && <div className="px-4 pb-4"><Rules {...{ hurdle, setHurdle, holdout, setHoldout, families, setFamilies, limitInput, setLimitInput, cats }} /></div>}
      </section>

      {/* ------------------------------------------------------------ your plan next to the recommended plan */}
      {live && items
        ? <Results items={items} itemsRec={itemsRec} settings={settings} range={range} rangeLabel={rangeLabel} model={model}
            label={fromFind ? audience!.goal : 'Your selection'} customers={ids.length} groups={groups} />
        : <div className="card flex flex-col items-center gap-1 px-4 py-10 text-center">
            <p className="text-[13.5px] font-semibold">{generated && !canRun ? 'Choose customers and products to see the plan' : 'Choose the customers, products and budget, then generate the plan'}</p>
            <p className="max-w-[560px] text-[12.5px] text-[var(--ink-3)]">You will see the results of your choices next to a recommended plan built from the same data, so you can compare them before deciding.</p>
          </div>}
    </div>
  );
}

const STEPS = [['audience', 'Choose audience'], ['products', 'Select products'], ['budget', 'Set budget'], ['generate', 'Generate plan'], ['review', 'Compare with recommendation']] as const;
function Steps({ done }: { done: Record<'audience' | 'products' | 'budget' | 'generate', boolean> }) {
  const state = (k: string) => (k === 'review' ? done.generate : done[k as keyof typeof done]);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[12px]">
      {STEPS.map(([k, l], i) => (
        <li key={k} className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 font-semibold ${state(k) ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'}`}>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${state(k) ? 'border-[var(--green-dark)] bg-[var(--green-dark)] text-white' : 'border-[#c9d2de] bg-white'}`}>{state(k) && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>{l}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-[var(--line)]" />}
        </li>
      ))}
    </ol>
  );
}

function Results({ items, itemsRec, settings, range, rangeLabel, model, label, customers, groups }: {
  items: OptItem[]; itemsRec: OptItem[] | null; settings: OptSettings; range: Sku[]; rangeLabel: string; model: ElasticityModel; label: string; customers: number; groups: Set<TypeId>;
}) {
  const e = useEngine();
  // your plan
  const plan = useMemo(() => optimise(items, settings), [items, settings]);
  const free = useMemo(() => (settings.limits ? optimise(items, { ...settings, limits: undefined }) : null), [items, settings]);
  const advice = useMemo(() => explainPlan(plan, free, items), [plan, free, items]);
  const bau = useMemo(() => pastPractice(e.results, items, range, settings.budget), [e, items, range, settings.budget]);
  const skuRows = useMemo(() => rollDown(plan, range), [plan, range]);
  const left = unallocated(plan, free);
  const reached = useMemo(() => new Set(activation(plan).filter((r) => r.group === 'treatment').map((r) => r.cid)).size, [plan]);
  // recommended plan: every responsive group, at the budget where returns level off (found on the full budget curve)
  const rec = useMemo(() => {
    if (!itemsRec) return null;
    const s0: OptSettings = { ...settings, includeExcluded: false };
    const budget = Math.max(500, Math.round(optimise(itemsRec, s0).recommendedBudget / 500) * 500);
    const s: OptSettings = { ...s0, budget };
    const p = optimise(itemsRec, s);
    return { plan: p, settings: s, items: itemsRec, advice: explainPlan(p, null, itemsRec), reached: new Set(activation(p).filter((r) => r.group === 'treatment').map((r) => r.cid)).size };
  }, [itemsRec, settings]);
  const [view, setView] = useState<'yours' | 'rec'>('yours');
  const shown = view === 'rec' && rec ? rec : { plan, settings, items, advice };
  const why = useCallback((al: Alloc) => whyOffer(al, shown.items.find((i) => i.id === al.item.id), shown.settings, model), [shown.items, shown.settings, model]);
  const [focus, setFocus] = useState<string | null>(null);
  const focusId = shown.plan.allocations.some((x) => x.item.id === focus) || shown.items.some((i) => i.id === focus && i.members.length) ? focus : shown.plan.allocations[0]?.item.id ?? null;
  const cats = [...new Set(items.map((i) => i.category))].sort();

  const exportPlan = (kind: 'xlsx' | 'csv') => {
    const head = ['Planned for', 'Brand', 'Category', 'SKU id', 'SKU', 'Customer group', 'Offer', 'Discount depth set by', 'Share of group offered', 'Budget (Rs)', 'Expected extra units', 'Expected extra sales (Rs)', 'Expected extra profit (Rs)', 'Profit per Rs 1 (ROI)', 'Why'];
    const who = `${label} (${customers} customers)`;
    const rows = skuRows.map((r) => {
      const al = plan.allocations.find((x) => x.item.category === r.sku.category && x.item.type === r.type);
      const src = al?.cell.promo.family !== 'price' && al?.cell.promo.family !== 'threshold' ? 'Past response to this kind of offer' : al?.cell.depthSource === 'elasticity' ? 'How sales moved with past discounts' : 'Assumption (deeper than any past discount)';
      const units = al ? al.incUnits * (r.spend / Math.max(1e-9, al.spend)) : 0;
      return [who, r.sku.brand, r.sku.category, r.sku.productId, r.sku.product, TYPE_BY_ID[r.type].name, r.offer, src, al ? pct(al.coverage) : '', Math.round(r.spend), Math.round(units), Math.round(r.incRevenue), Math.round(r.incMargin), r.spend > 0 ? +(r.incMargin / r.spend).toFixed(2) : 0, al ? whyOffer(al, items.find((i) => i.id === al.item.id), settings, model) : ''];
    });
    if (kind === 'csv') saveFile('promotion_budget_plan.csv', toCsv(head, rows), 'text/csv;charset=utf-8');
    else saveFile('promotion_budget_plan.xlsx', toXlsx(head, rows, 'Budget plan'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const exportAudience = () => saveFile('campaign_customer_list.csv', toCsv(['customer_id', 'customer_group', 'category', 'products', 'offer', 'group'],
    activation(plan).map((r) => [r.cid, TYPE_BY_ID[r.type].name, r.category, rangeLabel, r.offer, r.group])), 'text/csv;charset=utf-8');

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Summary plan={plan} advice={advice} customers={customers} budget={settings.budget} left={left} reached={reached} />
        <Compare yours={{ plan, reached, budget: settings.budget, bau: bau.incMargin }} rec={rec} groups={groups} />
      </div>
      {plan.allocations.length > 0 || (rec?.plan.allocations.length ?? 0) > 0 ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <AllocationChart plan={shown.plan} advice={shown.advice} focusId={focusId} onFocus={setFocus} why={why} onExport={exportPlan} onAudience={exportAudience}
            view={rec ? <PlanSwitch value={view} onChange={setView} /> : undefined} />
          <DiscountChart item={shown.items.find((i) => i.id === focusId)} plan={shown.plan} settings={shown.settings} items={shown.items} onFocus={setFocus} />
        </div>
      ) : null}
      <Details plan={plan} bau={bau} advice={advice} range={range} rows={skuRows} />
    </div>
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

/** Your plan next to the recommended plan: the same measures, then what the recommendation changes and what it adds */
function Compare({ yours, rec, groups }: {
  yours: { plan: Plan; reached: number; budget: number; bau: number };
  rec: { plan: Plan; settings: OptSettings; reached: number } | null;
  groups: Set<TypeId>;
}) {
  const y = yours.plan, r = rec?.plan;
  const rows: { k: string; a: string; b: string; d?: number; help?: string }[] = [
    { k: 'Budget used', a: `${inr(y.spend)} of ${inr(yours.budget)}`, b: r ? `${inr(r.spend)} of ${inr(rec!.settings.budget)}` : '–' },
    { k: 'Customers with an offer', a: int(yours.reached), b: r ? int(rec!.reached) : '–' },
    { k: 'Extra units', a: int(y.incUnits), b: r ? int(r.incUnits) : '–', d: r ? r.incUnits - y.incUnits : undefined },
    { k: 'Extra sales', a: inr(y.incRevenue), b: r ? inr(r.incRevenue) : '–', d: r ? r.incRevenue - y.incRevenue : undefined },
    { k: 'Extra profit', a: inr(y.incMargin), b: r ? inr(r.incMargin) : '–', d: r ? r.incMargin - y.incMargin : undefined },
    { k: 'Profit per ₹1', a: y.spend > 0 ? per1(y.roi) : '–', b: r && r.spend > 0 ? per1(r.roi) : '–' },
  ];
  // what the recommendation does differently
  const changes: string[] = [];
  if (r) {
    const fundedRec = [...new Set(r.allocations.map((a) => a.item.type))];
    const added = fundedRec.filter((t) => !groups.has(t));
    for (const t of added) {
      const al = r.allocations.filter((a) => a.item.type === t);
      changes.push(`Add ${TYPE_BY_ID[t].name}: ${int(al.reduce((s, a) => s + a.treated, 0))} customers, about ${inr(al.reduce((s, a) => s + a.incMargin, 0))} extra profit.`);
    }
    const dropped = [...groups].filter((t) => t === 'dog' && y.allocations.some((a) => a.item.type === t));
    if (dropped.length) changes.push('Leave out Sleeping Dogs: offers make them buy less.');
    const yb = yours.budget, rb = rec!.settings.budget;
    if (rb < yb * 0.95) changes.push(`Budget ${inr(rb)} instead of ${inr(yb)}: beyond that, more money earns less than it costs here.`);
    else if (rb > yb * 1.05) changes.push(`Budget ${inr(rb)} instead of ${inr(yb)}: returns keep paying off up to that level.`);
    for (const a of r.allocations) {
      const mine = y.allocations.find((x) => x.item.id === a.item.id);
      if (mine && mine.cell.promo.key !== a.cell.promo.key) changes.push(`${a.item.category} · ${TYPE_BY_ID[a.item.type].name}: ${a.cell.promo.label} instead of ${mine.cell.promo.label}.`);
    }
  }
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-bold tracking-tight">Your plan vs recommended</h2>
        <span title="Both are estimates built by the same stated rules: customers' past response to offers, how sales moved with past discounts, product costs and the budget. The recommended plan only changes the customer groups (never Sleeping Dogs) and the budget level; your settings are not changed."><SourceChip kind="simulated" /></span>
      </div>
      <table className="mt-3 w-full text-[12.5px]">
        <thead><tr className="border-b border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
          <th className="py-1.5 text-left font-semibold" /><th className="px-2 py-1.5">Your plan</th><th className="py-1.5 pl-2">Recommended</th>
        </tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.k} className="border-b border-[var(--line-2)] text-right last:border-0">
              <td className="py-1.5 text-left text-[var(--ink-2)]">{x.k}</td>
              <td className="num px-2 py-1.5 font-semibold">{x.a}</td>
              <td className="num py-1.5 pl-2 font-semibold">{x.b}{x.d !== undefined && Math.abs(x.d) >= 1 && <span className="ml-1.5 text-[11px] font-semibold" style={{ color: x.d > 0 ? 'var(--green-dark)' : 'var(--red)' }}>{x.d > 0 ? '+' : '−'}{x.k === 'Extra units' ? int(Math.abs(x.d)) : inr(Math.abs(x.d))}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 rounded-lg bg-[var(--page)] px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">What the recommendation changes</p>
        {!r ? <p className="mt-1 text-[12px] text-[var(--ink-3)]">No customer group in this audience responds to offers, so there is nothing to recommend.</p>
          : changes.length ? <ul className="mt-1 space-y-0.5 text-[12px] leading-snug text-[var(--ink)]">{changes.slice(0, 5).map((c) => <li key={c}>• {c}</li>)}</ul>
          : <p className="mt-1 text-[12px] text-[var(--ink)]">Nothing: your plan already matches the recommendation.</p>}
        <p className="mt-1.5 text-[11px] text-[var(--ink-3)]">Your settings are not changed. Usual way at your budget: {inr(yours.bau)} extra profit.</p>
      </div>
    </section>
  );
}

/** who to target, what to promote, which discount, how to split the budget: one line each, straight from the plan */
function Summary({ plan, advice, customers, budget, left, reached }: { plan: Plan; advice: CategoryAdvice[]; customers: number; budget: number; left: { amount: number; text: string }; reached: number }) {
  const funded = [...new Set(plan.allocations.map((x) => x.item.type))];
  const skipped = [...new Set(advice.flatMap((c) => c.types.filter((t) => !t.funded).map((t) => t.type)))].filter((t) => !funded.includes(t));
  const byCat = advice.filter((c) => c.spend > 0).sort((x, y) => y.spend - x.spend);
  const offers = [...new Map(plan.allocations.map((x) => [`${x.item.type}|${x.cell.promo.key}`, x])).values()];
  const rows: [ReactNode, string, ReactNode][] = plan.allocations.length ? [
    [<Users key="i" className="h-3.5 w-3.5" />, 'Who to target', <>{list(funded.map((t) => TYPE_BY_ID[t].name))} · {int(reached)} of {int(customers)} customers{skipped.length ? <span className="text-[var(--ink-3)]"> · no offer for {list(skipped.map((t) => TYPE_BY_ID[t].name))}</span> : ''}</>],
    [<Package key="i" className="h-3.5 w-3.5" />, 'What to promote', <>{byCat.map((c) => c.category).join(', ')}</>],
    [<Percent key="i" className="h-3.5 w-3.5" />, 'Suggested discount', <>{offers.slice(0, 3).map((x) => `${x.cell.promo.label} for ${TYPE_BY_ID[x.item.type].name}`).join('; ')}{offers.length > 3 ? ` and ${offers.length - 3} more` : ''}</>],
    [<Wallet key="i" className="h-3.5 w-3.5" />, 'How to spend the budget', <>{byCat.map((c) => `${inr(c.spend)} on ${c.category}`).join(', ')} · {inr(plan.spend)} of {inr(budget)}{left.amount > budget * 0.01 ? <span className="text-[var(--ink-3)]"> ({inr(left.amount)} kept back: more would cost more than it earns)</span> : ''}</>],
  ] : [];
  return (
    <section className="card p-4">
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
    </section>
  );
}

// ------------------------------------------------------------------------ the audience in one line and one bar
function AudienceBar({ title, total, counts, groups, note }: { title: string; total: number; counts: Map<TypeId, number>; groups: Set<TypeId>; note?: ReactNode }) {
  const all = GROUP_IDS.reduce((t, g) => t + (counts.get(g) ?? 0), 0);
  return (
    <div className="min-w-[260px] flex-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className="text-[13.5px] font-bold tracking-tight">{title} · <span className="num">{int(total)}</span> customers</p>
        {note && <p className="text-[11.5px] text-[var(--ink-3)]">{note}</p>}
      </div>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-[var(--line-2)]">
        {GROUP_IDS.map((g) => {
          const n = counts.get(g) ?? 0;
          return n > 0 ? <div key={g} title={`${TYPE_BY_ID[g].name}: ${int(n)}${groups.has(g) ? '' : ' (not included)'}`} style={{ width: `${(n / Math.max(1, all)) * 100}%`, background: TYPE_BY_ID[g].color, opacity: groups.has(g) ? 1 : 0.2 }} /> : null;
        })}
      </div>
    </div>
  );
}

/**
 * Is the audience a fair basis for the products picked? The estimates read each customer's own buying in each category, so
 * an audience built for one category can be planned for another; what matters is how many of them buy it at all.
 */
function Evidence({ ids, cats, fromCategory }: { ids: string[]; cats: string[]; fromCategory: string | null }) {
  const e = useEngine();
  if (!ids.length || !cats.length) return null;
  const shown = cats.filter((c) => c !== fromCategory);
  if (!shown.length) return null;
  const rows = shown.map((c) => ({ c, n: ids.filter((cid) => (e.recById.get(cid)!.b.catShare[c] ?? 0) > 0).length }));
  const weak = rows.filter((r) => r.n / ids.length < 0.3);
  if (!fromCategory && !weak.length) return null;
  return (
    <p className="flex items-start gap-1.5 border-t border-[var(--line-2)] px-4 py-2 text-[11.5px] text-[var(--ink-3)]">
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      <span>
        {fromCategory && <>Audience built for {fromCategory}; estimates for {list(shown.slice(0, 3))}{shown.length > 3 ? ' and more' : ''} use each customer's own buying there. </>}
        {rows.length <= 3 && rows.map((r) => `${int(r.n)} of ${int(ids.length)} have bought ${r.c}`).join(' · ')}
        {weak.length > 0 && <span className="text-[#92400e]"> · Few of them buy {list(weak.map((r) => r.c))}, so expect little effect there.</span>}
      </span>
    </p>
  );
}

// ------------------------------------------------------------------------ chart 1: where the budget goes and what it earns
function AllocationChart({ plan, advice, focusId, onFocus, why, onExport, onAudience, view }: {
  plan: Plan; advice: CategoryAdvice[]; focusId: string | null; onFocus: (id: string) => void; why: (a: Alloc) => string; onExport: (k: 'xlsx' | 'csv') => void; onAudience: () => void; view?: ReactNode;
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
        <div className="flex items-center gap-2">{view}<DownloadMenu onExport={onExport} onAudience={onAudience} /></div>
      </div>
      {top && <p className="mt-2.5 text-[12.5px] leading-snug text-[var(--ink)]"><b>{pct(plan.spend ? top.spend / plan.spend : 0)}</b> of the money goes to <b>{top.item.category} · {TYPE_BY_ID[top.item.type].name}</b> with <b>{top.cell.promo.label}</b>: each ₹1 earns {per1(top.roi)} back on top.</p>}
      {issues.length > 0 && <p className="mt-2 rounded-md bg-[#fef3c7] px-2.5 py-1.5 text-[11.5px] text-[#92400e]">{issues.map((x) => (x.kind === 'mins-over-budget' ? `Category minimums (${inr(x.limit)}) exceed the budget, so they were set aside.` : `${x.category}: minimum ${inr(x.limit)} not reachable, only ${inr(x.possible)} pays off.`)).join(' ')}</p>}
      {rows.length ? (
        <ul className="mt-3 space-y-1">
          {rows.map((a) => {
            const on = a.item.id === focusId;
            return (
              <li key={a.item.id}>
                <button onClick={() => onFocus(a.item.id)} aria-pressed={on} title={why(a)}
                  className={`grid w-full grid-cols-[minmax(0,190px)_minmax(0,1fr)_96px] items-center gap-3 rounded-md px-2 py-1.5 text-left ${on ? 'bg-[#eef3fa]' : 'hover:bg-[var(--page)]'}`}>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_BY_ID[a.item.type].color }} />{a.item.category} · {TYPE_BY_ID[a.item.type].name}</span>
                    <span className="block truncate text-[11px] text-[var(--ink-3)]">{a.cell.promo.label} · {int(a.treated)} customers{a.coverage < 1 ? ` (${pct(a.coverage)} of group)` : ''}{a.cell.history ? '' : ' · untested'}</span>
                  </span>
                  <span className="space-y-1">
                    <span className="block h-2 rounded-full bg-[var(--navy)]" style={{ width: `${Math.max(1, (a.spend / max) * 100)}%` }} />
                    <span className="block h-2 rounded-full bg-[var(--green)]" style={{ width: `${Math.max(1, (Math.max(0, a.incMargin) / max) * 100)}%` }} />
                  </span>
                  <span className="num text-right text-[11.5px] leading-tight"><span className="block font-semibold">{inr(a.spend)}</span><span className="block text-[var(--green-dark)]">+{inr(a.incMargin)}</span></span>
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
  if (!item) return <section className="card p-4"><h2 className="text-[14px] font-bold tracking-tight">Compare discounts</h2><p className="mt-6 text-center text-[12.5px] text-[var(--ink-3)]">No customer group to compare yet.</p></section>;
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
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold tracking-tight">Compare discounts</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">Expected extra profit if the whole group got each offer</p>
        </div>
        <select value={item.id} onChange={(ev) => onFocus(ev.target.value)} aria-label="Customer group"
          className="h-8 max-w-[220px] rounded-lg border border-[var(--line)] bg-white px-2 text-[12px] font-medium text-[var(--ink-2)] outline-none focus:border-[var(--navy)]">
          {live.map((i) => <option key={i.id} value={i.id}>{i.category} · {TYPE_BY_ID[i.type].name}</option>)}
        </select>
      </div>
      {!opts.length ? <p className="mt-6 text-center text-[12.5px] text-[var(--ink-3)]">No discount type allowed here. Check Advanced settings.</p> : (
        <>
          <div className="mt-3 grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_52px_56px] gap-x-3 border-b border-[var(--line)] pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
            <span>Offer</span><span>Extra profit</span><span className="text-right" title="Extra profit for every ₹1 the offer costs">Profit/₹1</span><span className="text-right" title="Extra buyers in every 100 customers of the group">Buyers</span>
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

// ------------------------------------------------------------------------ setup fields
function BudgetField({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="min-w-0">
      <span className={LABEL}>Budget</span>
      <div className="flex h-10 items-center gap-3 rounded-lg border border-[var(--line)] bg-white pl-3 pr-3 focus-within:border-[var(--navy)]">
        <span className="text-[13px] font-semibold text-[var(--ink-3)]">₹</span>
        <input inputMode="numeric" aria-label="Budget in rupees" value={editing ?? value.toLocaleString('en-IN')}
          onFocus={() => setEditing(String(value))} onBlur={() => setEditing(null)}
          onChange={(ev) => { const d = ev.target.value.replace(/[^\d]/g, ''); setEditing(d); onChange(Math.min(1e8, +d || 0)); }}
          className="num w-[78px] shrink-0 bg-transparent text-[14px] font-bold outline-none" />
        <input type="range" min={0} max={max} step={500} value={Math.min(value, max)} onChange={(ev) => onChange(+ev.target.value)} className="min-w-0 flex-1 accent-[var(--navy)]" aria-label="Budget slider" />
      </div>
    </div>
  );
}

function AimField({ value, onChange }: { value: Objective; onChange: (v: Objective) => void }) {
  const goal = GOALS.find((g) => g.id === value)!;
  return (
    <div className="min-w-0">
      <span className={`${LABEL} flex items-center gap-1`}>Goal<span title={GOALS.map((g) => g.text).join('\n')}><Info className="h-3 w-3 cursor-help" /></span></span>
      <div className="flex h-10 rounded-lg border border-[var(--line)] bg-white p-1" role="radiogroup" aria-label="Goal">
        {GOALS.map((g) => (
          <button key={g.id} role="radio" aria-checked={value === g.id} title={g.text} onClick={() => onChange(g.id)}
            className={`flex-1 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-semibold transition-colors ${value === g.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{g.label}</button>
        ))}
      </div>
      <span className="sr-only">{goal.text}</span>
    </div>
  );
}

// ------------------------------------------------------------------------ discounts & rules (opened from the setup card)
function Rules(p: {
  hurdle: number; setHurdle: (v: number) => void; holdout: number; setHoldout: (v: number) => void; families: Set<Family>; setFamilies: (v: Set<Family>) => void;
  limitInput: LimitInput; setLimitInput: (v: LimitInput) => void; cats: string[];
}) {
  const toggleFamily = (f: Family) => { const n = new Set(p.families); if (n.has(f)) n.delete(f); else n.add(f); p.setFamilies(n); };
  const anyLimit = Object.values(p.limitInput).some((l) => l.min || l.max);
  const seg = <T extends string>(value: T, options: { id: T; label: string }[], onChange: (v: T) => void) => (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-white p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${value === o.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{o.label}</button>
      ))}
    </div>
  );
  return (
    <div className="mt-3 grid gap-x-8 gap-y-4 rounded-xl bg-[var(--page)] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <Field label={<>Minimum profit per ₹1<Help term="hurdle" /></>} text="Only fund offers that bring back their cost plus at least this much profit for every ₹1 spent.">
          {seg(String(p.hurdle), ['0', '0.25', '0.5', '1'].map((h) => ({ id: h, label: h === '0' ? 'Break even' : `₹${h}` })), (v) => p.setHurdle(+v))}
        </Field>
        <Field label={<>Keep a test group<Help term="holdout" /></>} text="A random few in each group get no offer, so the real effect can be measured afterwards.">
          {seg(String(p.holdout), [0, 0.05, 0.1, 0.2].map((h) => ({ id: String(h), label: h ? pct(h) : 'None' })), (v) => p.setHoldout(+v))}
        </Field>
        <Field label="Discount types allowed" text="Switch off any type you cannot run.">
          <div className="flex flex-wrap gap-1.5">
            {FAMILIES.map((f) => (
              <button key={f} onClick={() => toggleFamily(f)} aria-pressed={p.families.has(f)} className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${p.families.has(f) ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[var(--line)] bg-white text-[var(--ink-3)]'}`}>{FAMILY_LABEL[f]}</button>
            ))}
          </div>
        </Field>
      </div>
      <Field label="Category limits (optional)" text="A minimum (for example a supplier commitment) or a maximum, in ₹.">
        <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-white">
          <table className="w-full text-[12px]">
            <thead><tr className="whitespace-nowrap text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]"><th className="px-3 py-2">Category</th><th className="px-2 py-2">Min ₹</th><th className="px-2 py-2 pr-3">Max ₹</th></tr></thead>
            <tbody>
              {p.cats.map((c) => {
                const v = p.limitInput[c] ?? { min: '', max: '' };
                const set = (k: 'min' | 'max', x: string) => p.setLimitInput({ ...p.limitInput, [c]: { ...v, [k]: x } });
                return (
                  <tr key={c} className="border-t border-[var(--line-2)]">
                    <td className="whitespace-nowrap px-3 py-1 font-medium">{c}</td>
                    {(['min', 'max'] as const).map((k) => (
                      <td key={k} className={`py-1 ${k === 'min' ? 'px-2' : 'px-2 pr-3'}`}>
                        <input type="number" min={0} step={500} placeholder="–" value={v[k]} onChange={(ev) => set(k, ev.target.value)} aria-label={`${k === 'min' ? 'Minimum' : 'Maximum'} for ${c}`}
                          className="num h-7 w-full min-w-[72px] rounded-md border border-[var(--line)] bg-white px-2 text-[12px] outline-none focus:border-[var(--navy)]" />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {anyLimit && <button onClick={() => p.setLimitInput({})} className="mt-2 text-[12px] font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]">Clear limits</button>}
      </Field>
    </div>
  );
}

function Field({ label, text, children }: { label: ReactNode; text: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-semibold">{label}</p>
      <p className="mb-1.5 mt-0.5 text-[11.5px] leading-snug text-[var(--ink-3)]">{text}</p>
      {children}
    </div>
  );
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
                  <td className="num px-2 py-1.5 text-right text-[11.5px] font-bold">{inr(skus.reduce((t, s) => t + sum(s.productId, (r) => r.spend), 0))}</td>
                  <td className="num px-3 py-1.5 text-right text-[11.5px] font-bold">{inr(skus.reduce((t, s) => t + sum(s.productId, (r) => r.incMargin), 0))}</td>
                </tr>,
                ...[...skus].sort((a, b) => b.share - a.share).map((s) => {
                  const p = past.get(s.productId);
                  return (
                    <tr key={s.productId} className="border-t border-[var(--line-2)] text-right">
                      <td className="px-3 py-1.5 pl-5 text-left font-medium">{s.product}</td>
                      <td className="num px-2 py-1.5 text-[var(--ink-3)]">{pct(tot ? s.share / tot : 0)}</td>
                      <td className="num px-2 py-1.5 text-[var(--ink-3)]">{p && p.units > 0 ? pct(Math.max(0, p.uplift) / p.units) : '–'}</td>
                      <td className="num px-2 py-1.5 font-semibold">{inr(sum(s.productId, (r) => r.spend))}</td>
                      <td className="num px-3 py-1.5">{inr(sum(s.productId, (r) => r.incMargin))}</td>
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
        ? <GroupedBars height={300} format={(v) => inr(v, 0)} series={[{ label: 'Usual way', color: '#94a3b8' }, { label: 'Your plan', color: 'var(--navy)' }]} groups={rows.map((r) => ({ label: r.category, values: [r.spend, r.rec] }))} />
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
                      <td className="num px-3">{inr(r.spend)}</td>
                      <td className="num px-3 font-semibold">{inr(r.rec)}</td>
                      <td className="num px-3 font-semibold" style={{ color: d >= 0 ? 'var(--green-dark)' : 'var(--red)' }}>{d >= 0 ? '+' : '−'}{inr(Math.abs(d))}</td>
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
