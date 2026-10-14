// The promotion plan shared by Planning and Simulation. A plan is a small set of choices (customer groups, products, discount,
// budget, goal, rules); everything else is calculated from them with the existing models, so Planning, every Simulation
// scenario and the recommendation are built by exactly the same code:
//   customer behaviour (customer types, each customer's past response)  -> who responds
//   category demand curve (price elasticity from past price offers)     -> how deep the discount should be
//   optimiser (engine/optimizer.ts, exact knapsack)                       -> where the money goes
import type { Engine } from '../engine/index.ts';
import type { TypeId } from '../engine/behaviour.ts';
import { activityOf } from '../engine/audience.ts';
import { rangeItems } from '../engine/budgetScope.ts';
import { activation, optimise, qualifies, type OptItem, type OptSettings, type Plan, type SpendLimit } from '../engine/optimizer.ts';
import type { Sku } from '../engine/products.ts';
import type { Family } from '../engine/promotions.ts';
import { MAX_SUBSIDY, type Objective, type SegPromo } from '../engine/targeting.ts';
import { audienceKey, predictionFor } from './targeting.ts';
import { TYPE_BY_ID } from '../engine/segments.ts';
import { applyRules, behaviourAlerts, customerFacts, ruleDefs, type Alert } from '../engine/groupInsights.ts';
import { eligibility, expectPromo, hasHistory, UNTESTED_CONFIDENCE } from '../engine/promotions.ts';
import { makeCtx } from '../engine/simulation.ts';
import { wakingUp, type Shift, type ShiftFrom } from '../engine/shifts.ts';
import { NO_HISTORY } from '../engine/response.ts';
import { depthOptions } from '../engine/elasticity.ts';

export type ActivityPick = 'all' | 'active' | 'lapsing';
export interface ProductPick { brand: string; category: string; sku: string }

export interface PlanConfig {
  /** customer groups that get offers; null = the recommended groups */
  groups: TypeId[] | null;
  /** which customers to start from: everyone, recently active, or slowing down / inactive */
  activity: ActivityPick;
  products: ProductPick;
  /** 'best' = the best discount for each customer group and category; otherwise one offer key for everyone */
  discount: string;
  /** null = the recommended budget */
  budget: number | null;
  objective: Objective;
  /** minimum extra profit per ₹1 an offer must return */
  hurdle: number;
  limits: Record<string, SpendLimit>;
  /** deepest discount allowed, as effective % off (null = no limit) */
  maxDepth: number | null;
  /** only offers that have already run in the category (no untested mechanics) */
  testedOnly: boolean;
  /** most of each customer group that may get the offer (1 = all of it) */
  maxCoverage: number;
  /** most of an offer's cost that may go on purchases the customers would make anyway (null = no limit) */
  maxSubsidy: number | null;
  /** behaviour alerts whose customers are left out of the plan (alert keys, see planAlerts) */
  leaveOut: string[];
  /** Lost Causes / Sleeping Dogs who have started buying on promotion in the last 3 months, added to the plan as Persuadables (see engine/shifts.ts) */
  wakeUp: ShiftFrom[];
  /** the period the behaviour alerts are read over (same choices as Behaviour Analytics) */
  alertPeriod: AlertPeriod;
}

export type AlertPeriod = '3m' | '6m' | '12m' | 'all';
export const ALERT_PERIODS: { id: AlertPeriod; label: string; days: number }[] = [
  { id: '3m', label: '3 months', days: 92 }, { id: '6m', label: '6 months', days: 183 }, { id: '12m', label: '12 months', days: 365 }, { id: 'all', label: 'All time', days: 1e6 },
];

export const DEFAULT_PLAN: PlanConfig = {
  groups: null, activity: 'all', products: { brand: 'all', category: 'all', sku: 'all' }, discount: 'best', budget: null, objective: 'margin', hurdle: 0.25, limits: {}, maxDepth: null, testedOnly: false, maxCoverage: 1, maxSubsidy: MAX_SUBSIDY, leaveOut: [], wakeUp: [], alertPeriod: '6m',
};

export const GROUP_IDS: TypeId[] = ['persuadable', 'sure', 'lost', 'dog'];
const FAMILIES = new Set<Family>(['price', 'threshold', 'volume', 'bundle', 'loyalty']);
export const HOLDOUT = 0.1;

/** the same brand -> category -> SKU narrowing as the product pickers */
export function pickProducts(catalog: Sku[], p: ProductPick): Sku[] {
  const inBrand = catalog.filter((s) => p.brand === 'all' || s.brand === p.brand);
  const inCat = inBrand.filter((s) => p.category === 'all' || s.category === p.category);
  return p.sku === 'all' ? inCat : inCat.filter((s) => s.productId === p.sku);
}

export function productLabel(catalog: Sku[], p: ProductPick): string {
  if (p.sku !== 'all') return catalog.find((s) => s.productId === p.sku)?.product ?? 'one product';
  if (p.brand === 'all' && p.category === 'all') return 'All products';
  if (p.brand === 'all') return `${p.category}, all brands`;
  if (p.category === 'all') return `${p.brand}, all categories`;
  return `${p.brand} ${p.category}`;
}

export function baseCustomers(e: Engine, activity: ActivityPick): string[] {
  const all = e.records.map((r) => r.cid);
  if (activity === 'all') return all;
  return all.filter((cid) => {
    const a = activityOf(e.recById.get(cid)!.b);
    return activity === 'active' ? a === 'active' : a !== 'active';
  });
}

/** offers the plan may use: every discount type, or the single offer the user chose */
export const allowedFor = (discount: string) => (discount === 'best' ? (p: { family: Family }) => FAMILIES.has(p.family) : (p: { key: string }) => p.key === discount);

export interface RecPlan { plan: Plan; settings: OptSettings; items: OptItem[]; reached: number }

/** one customer type, split into active and slowing / inactive customers: each judged on its own numbers */
export interface SegmentInsight {
  segment: 'active' | 'lapsing';
  customers: number;
  recommended: boolean;
  p0: number; p1: number; roi: number | null; subsidy: number | null; incMargin: number; cost: number; offer: string | null;
}

export interface GroupInsight {
  type: TypeId;
  customers: number;
  recommended: boolean;
  segments: SegmentInsight[];
  subsidy: number | null; // share of the best offers' cost that goes on purchases that would happen anyway
  p0: number; // average buying chance without an offer (model, next offer window)
  p1: number; // ... with the best offer that pays back (or the best offer at all, when none pays back)
  roi: number | null; // extra profit per ₹1 of that offer
  incMargin: number; // extra profit if the whole group got that offer in every category picked
  cost: number;
  offer: string | null; // the offer behind those numbers
}

export interface PlanResult {
  cfg: PlanConfig;
  base: string[]; // customers to start from (activity filter)
  ids: string[]; // the customers in the chosen groups
  range: Sku[];
  categories: string[];
  itemsAll: OptItem[]; // every customer group x category, for insights and the recommendation
  items: OptItem[]; // the chosen groups only
  settings: OptSettings;
  plan: Plan;
  reached: number;
  rec: RecPlan | null;
  recGroups: TypeId[];
  groups: Set<TypeId>;
  insights: GroupInsight[];
  offers: { key: string; label: string }[]; // discounts available for the products picked
  alerts: PlanAlertView[]; // behaviour alerts, with how the plan sees those customers
  shifts: PlanShiftView[]; // customers whose recent behaviour has changed (Lost Causes / Sleeping Dogs who now react to offers)
}

// ------------------------------------------------------------------------ customers who behave differently
/** A behaviour alert from Behaviour Analytics (last 6 months, all products), with the customers it is about */
export interface PlanAlert { key: string; alert: Alert; ids: string[] }

const alertCache = new WeakMap<Engine, Map<AlertPeriod, PlanAlert[]>>();
/** the same alerts Behaviour Analytics shows for that period (all products), so both pages talk about the same customers */
export function planAlerts(e: Engine, period: AlertPeriod = '6m'): PlanAlert[] {
  let byPeriod = alertCache.get(e);
  if (!byPeriod) alertCache.set(e, (byPeriod = new Map()));
  let out = byPeriod.get(period);
  if (out) return out;
  const days = ALERT_PERIODS.find((x) => x.id === period)!.days;
  const p = { from: Math.max(e.ds.minDay, e.ds.maxDay - days + 1), to: e.ds.maxDay };
  const facts = customerFacts(e.ds, e.typeOf, p);
  const defs = ruleDefs(facts);
  out = behaviourAlerts(facts, defs).map((a) => ({
    key: `${period}|${a.type}|${a.rule.key}|${a.rule.value}|${a.metric}|${a.category ?? ''}`, alert: a,
    ids: applyRules(facts.filter((f) => f.type === a.type), defs, { [a.rule.key]: a.rule.value }).map((f) => f.cid),
  }));
  byPeriod.set(period, out);
  return out;
}

const shiftCache = new WeakMap<Engine, Shift[]>();
/** the same customers Behaviour Analytics lists as "behaving differently lately" */
export function planShifts(e: Engine): Shift[] {
  let out = shiftCache.get(e);
  if (!out) shiftCache.set(e, (out = wakingUp(e.ds, e.typeOf, e.asOf)));
  return out;
}

/** How the plan's model sees a set of customers: their average buying chance without / with their own best offer, and the
 * share for whom an offer passes the plan's rules (moves them, pays back, mostly buys new sales) */
export interface Response { p0: number; p1: number; passing: number; n: number }

export interface PlanAlertView extends PlanAlert {
  inPlan: boolean; // their customer type is in the plan
  leftOut: boolean;
  them?: Response; rest?: Response; // only for alerts on groups in the plan
  scope: string; // the categories the comparison is read on
  suggest: 'keep' | 'leave';
}

export interface PlanShiftView {
  shift: Shift;
  added: boolean; // these customers are in the plan (as Persuadables)
  inPlan: boolean; // Persuadables are in the plan, so adding them can change anything
  them?: Response; rest?: Response; // how an offer works for them, and for the rest of their old type
  scope: string;
  suggest: 'add' | 'skip';
}

function responseOf(e: Engine, cids: string[], cats: string[], s: OptSettings): Response {
  let p0 = 0, p1 = 0, pass = 0, n = 0;
  for (const c of cats) {
    const depth = depthOptions(e.elasticity.byCategory.get(c));
    const promos = predictionFor(e, c).promos.filter((p) => eligibility(e.ds, c, p).ok && s.allowed(p));
    for (const cid of cids) {
      const ctx = makeCtx(e.ds, cid, c, e.asOf);
      let best: { p0: number; p1: number; inc: number } | null = null, ok = false;
      for (const p of promos) {
        const x = expectPromo(e.ds, ctx, p, e.resp.get(cid) ?? NO_HISTORY, hasHistory(e.ds, c, p) ? 1 : UNTESTED_CONFIDENCE, e.assumptions, depth?.covers(p) ? depth.fn : undefined);
        if (x.investment <= 0) continue;
        const cell = { eligible: { ok: true }, promo: p, investment: x.investment, uplift: x.uplift, roi: x.incMargin / x.investment, incMargin: x.incMargin, incRevenue: x.incRevenue, incBuyers: x.uplift, subsidy: x.subsidy } as unknown as SegPromo;
        if (qualifies(cell, s)) ok = true;
        if (!best || x.incMargin > best.inc) best = { p0: x.p0, p1: x.p1, inc: x.incMargin };
      }
      if (!best) continue;
      p0 += best.p0; p1 += best.p1; pass += ok ? 1 : 0; n++;
    }
  }
  return { p0: n ? p0 / n : 0, p1: n ? p1 / n : 0, passing: n ? pass / n : 0, n: cids.length };
}

const reachedBy = (p: Plan) => new Set(activation(p).filter((r) => r.group === 'treatment').map((r) => r.cid)).size;

export function computePlan(e: Engine, catalog: Sku[], cfg: PlanConfig): PlanResult {
  const alertsAll = planAlerts(e, cfg.alertPeriod);
  const leftOut = new Set(alertsAll.filter((a) => cfg.leaveOut.includes(a.key)).flatMap((a) => a.ids));
  const shiftsAll = planShifts(e);
  // customers who have started reacting to offers are planned as Persuadables when the plan says so
  const added = new Set(shiftsAll.filter((x) => cfg.wakeUp.includes(x.from)).flatMap((x) => x.ids));
  const typeOf = added.size ? new Map([...e.typeOf].map(([cid, t]) => [cid, added.has(cid) ? 'persuadable' as const : t])) : e.typeOf;
  const base = baseCustomers(e, cfg.activity).filter((cid) => !leftOut.has(cid));
  const range = pickProducts(catalog, cfg.products).filter((s) => s.share > 0);
  const categories = [...new Set(range.map((s) => s.category))].sort();
  // active and slowing / inactive customers are planned separately: lapsing customers respond less (measured in the
  // campaign history), so mixing them in would water down an active group's numbers and hide a win-back that pays on its own
  const segIds = { active: base.filter((cid) => activityOf(e.recById.get(cid)!.b) === 'active'), lapsing: base.filter((cid) => activityOf(e.recById.get(cid)!.b) !== 'active') };
  const raw: OptItem[] = [];
  if (range.length) for (const seg of ['active', 'lapsing'] as const) {
    const ids = segIds[seg];
    if (!ids.length) continue;
    const sc = { key: added.size ? `${audienceKey(ids)}|w${audienceKey(added)}` : audienceKey(ids), ids: new Set(ids), typeOf };
    for (const it of rangeItems(range, (c) => predictionFor(e, c, 'combined', sc))) raw.push({ ...it, id: `${it.type}|${seg}|${it.category}`, segment: seg });
  }
  // "only offers already run here": an untested mechanic is treated as not allowed in that category
  const itemsAll = cfg.testedOnly ? raw.map((i) => ({ ...i, cells: i.cells.map((c) => (c.history ? c : { ...c, eligible: { ok: false, reason: 'Not run in this category before' } })) })) : raw;
  const discountOk = allowedFor(cfg.discount) as OptSettings['allowed'];
  const s0: OptSettings = {
    budget: 0, objective: cfg.objective, hurdle: cfg.hurdle, holdout: HOLDOUT, includeExcluded: false,
    allowed: (p) => discountOk(p) && (cfg.maxDepth == null || p.depth <= cfg.maxDepth + 1e-9),
    limits: Object.keys(cfg.limits).length ? cfg.limits : undefined,
    maxCoverage: cfg.maxCoverage < 1 ? cfg.maxCoverage : undefined,
    maxSubsidy: cfg.maxSubsidy ?? undefined,
  };

  // per customer group and segment: what the best offer that pays back would do (or the best offer at all, to explain why
  // none does). A group is recommended when at least one of its segments is.
  const segInsight = (t: TypeId, seg: 'active' | 'lapsing'): SegmentInsight => {
    const its = itemsAll.filter((i) => i.type === t && i.segment === seg && i.members.length);
    const customers = segIds[seg].filter((cid) => typeOf.get(cid) === t).length;
    let n = 0, p0 = 0, p1 = 0, inc = 0, cost = 0, sub = 0, anyOk = false;
    const offers = new Map<string, number>();
    for (const it of its) {
      const usable = it.cells.filter((c) => c.eligible.ok && s0.allowed(c.promo) && c.investment > 0);
      const ok = usable.filter((c) => qualifies(c, s0));
      const pick = (ok.length ? ok : usable).reduce<SegPromo | null>((a, c) => (!a || c.incMargin > a.incMargin ? c : a), null);
      if (!pick) continue;
      if (ok.length) anyOk = true;
      const m = it.members.length;
      n += m; p0 += pick.p0 * m; p1 += pick.p1 * m; inc += pick.incMargin; cost += pick.investment; sub += pick.subsidy;
      offers.set(pick.promo.label, (offers.get(pick.promo.label) ?? 0) + pick.investment);
    }
    const top = [...offers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      segment: seg, customers, recommended: t !== 'dog' && anyOk, p0: n ? p0 / n : 0, p1: n ? p1 / n : 0, roi: cost > 0 ? inc / cost : null,
      subsidy: cost > 0 ? sub / cost : null, incMargin: inc, cost, offer: offers.size > 1 ? `${top} and others` : top,
    };
  };
  const insights: GroupInsight[] = GROUP_IDS.map((t) => {
    const segments = (['active', 'lapsing'] as const).map((s) => segInsight(t, s)).filter((s) => s.customers > 0);
    const n = segments.reduce((a, s) => a + s.customers, 0);
    const cost = segments.reduce((a, s) => a + s.cost, 0);
    const w = (f: (s: SegmentInsight) => number) => (n ? segments.reduce((a, s) => a + f(s) * s.customers, 0) / n : 0);
    const inc = segments.reduce((a, s) => a + s.incMargin, 0);
    const sub = segments.reduce((a, s) => a + (s.subsidy ?? 0) * s.cost, 0);
    const offerList = [...new Set(segments.map((s) => s.offer).filter(Boolean))] as string[];
    return {
      type: t, customers: n, recommended: segments.some((s) => s.recommended), segments,
      p0: w((s) => s.p0), p1: w((s) => s.p1), roi: cost > 0 ? inc / cost : null, subsidy: cost > 0 ? sub / cost : null, incMargin: inc, cost,
      offer: offerList.length > 1 ? `${offerList[0]} and others` : offerList[0] ?? null,
    };
  });
  const recGroups = insights.filter((g) => g.recommended).map((g) => g.type);

  // the recommendation: every customer group that responds (never Sleeping Dogs), with the budget everything worthwhile
  // needs (what the optimiser spends when money is not the limit; it never funds an offer below the minimum return)
  const itemsRec = itemsAll.filter((i) => i.type !== 'dog');
  let rec: RecPlan | null = null;
  if (itemsRec.some((i) => i.members.length)) {
    const level = optimise(itemsRec, { ...s0, budget: 100000 }).recommendedBudget;
    const needed = optimise(itemsRec, { ...s0, budget: Math.max(cfg.budget ?? 0, level * 2, 1000) }).spend;
    const settings = { ...s0, budget: Math.max(500, Math.ceil(needed / 500) * 500) };
    const plan = optimise(itemsRec, settings);
    rec = { plan, settings, items: itemsRec, reached: reachedBy(plan) };
  }

  const groups = new Set(cfg.groups ?? recGroups);
  const items = itemsAll.filter((i) => groups.has(i.type));
  const settings: OptSettings = { ...s0, budget: cfg.budget ?? rec?.settings.budget ?? 30000, includeExcluded: groups.has('dog') };
  const plan = optimise(items, settings);

  const labels = new Map<string, Set<string>>();
  for (const it of itemsAll) for (const c of it.cells) if (c.eligible.ok && FAMILIES.has(c.promo.family)) { if (!labels.has(c.promo.key)) labels.set(c.promo.key, new Set()); labels.get(c.promo.key)!.add(c.promo.label); }
  const offers = [...labels.entries()].map(([key, ls]) => ({ key, label: ls.size === 1 ? [...ls][0] : key === 'flat' ? '₹ off above a minimum spend' : [...ls][0] }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));

  // behaviour alerts: for groups in the plan, compare those customers with the rest of their group on the plan's own terms
  // (the alert's category when it is one of the products planned, otherwise every category planned)
  const alerts: PlanAlertView[] = alertsAll.map((a) => {
    const inPlan = groups.has(a.alert.type);
    const cats = a.alert.category && categories.includes(a.alert.category) ? [a.alert.category] : categories;
    const scope = cats.length === 1 ? cats[0] : 'the products planned';
    if (!cats.length) return { ...a, inPlan, leftOut: cfg.leaveOut.includes(a.key), scope, suggest: 'keep' as const };
    const them = responseOf(e, a.ids, cats, s0);
    const mine = new Set(a.ids);
    const rest = responseOf(e, [...baseCustomers(e, cfg.activity)].filter((cid) => typeOf.get(cid) === a.alert.type && !mine.has(cid)), cats, s0);
    // leave them out when the offer works for clearly fewer of them than for the rest of their group
    const suggest = them.passing < 0.5 && them.passing < rest.passing - 0.2 ? 'leave' as const : 'keep' as const;
    return { ...a, inPlan, leftOut: cfg.leaveOut.includes(a.key), them, rest, scope, suggest };
  });

  const shifts: PlanShiftView[] = shiftsAll.map((x) => {
    const mine = new Set(x.ids);
    const them = categories.length ? responseOf(e, x.ids, categories, s0) : undefined;
    const rest = categories.length ? responseOf(e, [...baseCustomers(e, cfg.activity)].filter((cid) => e.typeOf.get(cid) === x.from && !mine.has(cid)), categories, s0) : undefined;
    return { shift: x, added: cfg.wakeUp.includes(x.from), inPlan: groups.has('persuadable'), them, rest, scope: categories.length === 1 ? categories[0] : 'the products planned', suggest: them && them.passing >= 0.5 && x.from === 'lost' ? 'add' as const : 'skip' as const };
  });

  return {
    cfg, base, ids: base.filter((cid) => groups.has(typeOf.get(cid)!)), alerts, shifts, range, categories, itemsAll, items, settings, plan, reached: reachedBy(plan),
    rec, recGroups, groups, insights, offers,
  };
}

/** the plan's choices in a few words, for summaries and scenario columns */
export function describeOffer(r: PlanResult): string {
  if (r.cfg.discount !== 'best') return r.offers.find((o) => o.key === r.cfg.discount)?.label ?? r.cfg.discount;
  const ls = [...new Set(r.plan.allocations.map((a) => a.cell.promo.label))];
  return ls.length ? (ls.length <= 2 ? ls.join(', ') : `${ls.slice(0, 2).join(', ')} +${ls.length - 2} more`) : 'Best per group';
}

export const sameConfig = (a: PlanConfig, b: PlanConfig) => JSON.stringify(a) === JSON.stringify(b);

const names = (ts: TypeId[]) => ts.map((t) => TYPE_BY_ID[t].name);
const join = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export const groupText = (r: PlanResult) => join(names(GROUP_IDS.filter((g) => r.groups.has(g)))) || 'No group';

/** a customer group in a plan line, with its segment when lapsing customers are planned on their own (win-back) */
export const segName = (x: { type: TypeId; segment?: 'active' | 'lapsing' }) => `${TYPE_BY_ID[x.type].name}${x.segment === 'lapsing' ? ' (win-back)' : ''}`;
