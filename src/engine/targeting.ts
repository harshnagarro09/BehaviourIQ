// Customer-type promotion prediction: for each of the four customer types (Persuadables, Sure Things, Lost Causes,
// Sleeping Dogs) and every promotion in the catalogue, the expected response, incremental sales and return if the WHOLE
// group receives the offer. Decisions are made per customer type, never per individual; customer-level numbers are only
// summed into their group.
import type { Behaviour, TypeId } from './behaviour.ts';
import type { Dataset } from './data.ts';
import { catalogue, eligibility, expectPromo, hasHistory, digitalShare, UNTESTED_CONFIDENCE, type DepthFn, type Eligibility, type PromoDef } from './promotions.ts';
import { NO_HISTORY, type RespProfile } from './response.ts';
import { TYPE_IDS } from './insights.ts';
import { DEFAULT_ASSUMPTIONS, makeCtx, type Assumptions, type Ctx } from './simulation.ts';

export interface SegPromo {
  seg: TypeId;
  category: string;
  promo: PromoDef;
  eligible: Eligibility;
  history: boolean; // has this mechanic run in this category before
  members: number;
  p0: number; // average chance of buying with no offer
  p1: number; // ... with the offer
  uplift: number; // p1 - p0 (points)
  incBuyers: number; // extra buyers expected because of the offer
  units: number;
  incUnits: number;
  revenue: number;
  incRevenue: number;
  investment: number;
  subsidy: number;
  incMargin: number;
  margin: number; // margin after the investment (before removing the baseline)
  roi: number; // incMargin / investment
  revPerRupee: number; // incremental revenue per rupee invested
  stockRisk: number; // units borrowed from later weeks (risk, not deducted)
  reach: number; // average share the offer can reach (digital-only offers)
  depthSource?: 'elasticity' | 'behaviour'; // combined mode: was the depth response read from the category demand curve?
}

/** Combined mode: the depth-response hook, which offers it covers, and extra discount depths to consider */
export interface DepthOptions { fn: DepthFn; covers: (p: PromoDef) => boolean; extra: PromoDef[] }

export interface CategoryPrediction {
  category: string;
  promos: PromoDef[];
  members: Map<TypeId, string[]>;
  cells: Map<TypeId, SegPromo[]>; // per customer type, one entry per catalogue promotion (same order as promos)
  baseline: Map<TypeId, { p0: number; baseUnits: number; baseRevenue: number }>;
}

export type Objective = 'margin' | 'revenue' | 'buyers';
export const OBJECTIVE_LABEL: Record<Objective, string> = {
  margin: 'Best return (incremental margin)', revenue: 'Sales growth (incremental revenue)', buyers: 'Reach (incremental buyers)',
};
export const objectiveValue = (c: Pick<SegPromo, 'incMargin' | 'incRevenue' | 'incBuyers'>, o: Objective) => (o === 'margin' ? c.incMargin : o === 'revenue' ? c.incRevenue : c.incBuyers);

/** Customers assigned to each segment (the targeting population: every customer with history) */
export function membersByType(typeOf: Map<string, TypeId>, only?: Set<string>): Map<TypeId, string[]> {
  const m = new Map<TypeId, string[]>(TYPE_IDS.map((t) => [t, []]));
  for (const [cid, t] of typeOf) if (!only || only.has(cid)) m.get(t)!.push(cid);
  return m;
}

export function predictCategory(
  ds: Dataset, typeOf: Map<string, TypeId>, category: string, asOf: number, resp: Map<string, RespProfile>, A: Assumptions = DEFAULT_ASSUMPTIONS, only?: Set<string>,
  depth?: DepthOptions,
): CategoryPrediction {
  const base = catalogue(ds, category);
  const promos = depth ? [...base, ...depth.extra.filter((x) => !base.some((b) => b.key === x.key))] : base;
  const members = membersByType(typeOf, only);
  const cells = new Map<TypeId, SegPromo[]>();
  const baseline = new Map<TypeId, { p0: number; baseUnits: number; baseRevenue: number }>();
  for (const t of TYPE_IDS) {
    const ids = members.get(t)!;
    const ctxs = ids.map((cid) => makeCtx(ds, cid, category, asOf));
    const L = ds.ourEcon[category]?.list ?? 0;
    baseline.set(t, {
      p0: ctxs.length ? ctxs.reduce((a, c) => a + c.p0, 0) / ctxs.length : 0,
      baseUnits: ctxs.reduce((a, c) => a + c.p0 * c.qFull, 0),
      baseRevenue: ctxs.reduce((a, c) => a + c.p0 * c.qFull * L, 0),
    });
    cells.set(t, promos.map((p) => aggregateGroup(ds, ctxs, t, category, p, resp, A, depth)));
  }
  return { category, promos, members, cells, baseline };
}

export function aggregateGroup(ds: Dataset, ctxs: Ctx[], seg: TypeId, category: string, p: PromoDef, resp: Map<string, RespProfile>, A: Assumptions, depth?: DepthOptions): SegPromo {
  const history = hasHistory(ds, category, p);
  const useCurve = !!depth && depth.covers(p);
  const c: SegPromo = {
    seg, category, promo: p, eligible: eligibility(ds, category, p), history, members: ctxs.length,
    p0: 0, p1: 0, uplift: 0, incBuyers: 0, units: 0, incUnits: 0, revenue: 0, incRevenue: 0, investment: 0, subsidy: 0, incMargin: 0, margin: 0, roi: 0, revPerRupee: 0, stockRisk: 0, reach: 0,
  };
  for (const ctx of ctxs) {
    const x = expectPromo(ds, ctx, p, resp.get(ctx.cid) ?? NO_HISTORY, history ? 1 : UNTESTED_CONFIDENCE, A, useCurve ? depth!.fn : undefined);
    c.p0 += x.p0; c.p1 += x.p1; c.incBuyers += x.uplift; c.units += x.units; c.incUnits += x.incUnits;
    c.revenue += x.revenue; c.incRevenue += x.incRevenue; c.investment += x.investment; c.subsidy += x.subsidy;
    c.incMargin += x.incMargin; c.margin += x.margin; c.stockRisk += x.stockRisk; c.reach += x.reach;
  }
  const n = Math.max(1, ctxs.length);
  c.p0 /= n; c.p1 /= n; c.reach /= n; c.uplift = c.p1 - c.p0;
  c.roi = c.investment > 0 ? c.incMargin / c.investment : 0;
  c.revPerRupee = c.investment > 0 ? c.incRevenue / c.investment : 0;
  if (depth) c.depthSource = useCurve ? 'elasticity' : 'behaviour';
  return c;
}

/** Minimum average uplift (5 points of purchase probability) for an offer to count as moving the group at all */
export const MIN_SEG_UPLIFT = 0.05;
/** ROI an offer must reach to be recommended for a customer type */
export const TARGET_HURDLE = 0.25;

/** Uplift (points of purchase probability) at which a customer type is a real target: the offer changes whether they buy */
export const TARGET_UPLIFT = 0.15;

/** Does this offer pay off for the whole customer type? Only types with a strong uplift are targeted; Sleeping Dogs never. */
export const worthTargeting = (c: SegPromo) => c.seg !== 'dog' && c.eligible.ok && c.uplift >= TARGET_UPLIFT && c.investment > 0 && c.incMargin > 0 && c.roi >= TARGET_HURDLE;

/** The recommended offer for one segment: highest objective among allowed offers that clear the ROI hurdle */
export function bestFor(cells: SegPromo[], objective: Objective, hurdle: number, allowed?: (p: PromoDef) => boolean): SegPromo | null {
  let best: SegPromo | null = null;
  for (const c of cells) {
    if (!c.eligible.ok || (allowed && !allowed(c.promo))) continue;
    if (c.uplift < MIN_SEG_UPLIFT || c.investment <= 0 || c.roi < hurdle || c.incMargin <= 0 && objective === 'margin') continue;
    if (!best || objectiveValue(c, objective) > objectiveValue(best, objective)) best = c;
  }
  return best;
}

// ------------------------------------------------------------------------ explainability
export interface Reason { text: string; tone: 'up' | 'down' }

const avg = (bs: Behaviour[], f: (b: Behaviour) => number) => (bs.length ? bs.reduce((s, b) => s + f(b), 0) / bs.length : 0);
const pc = (v: number) => `${Math.round(v * 100)}%`;

/** Plain-language reason codes: how the segment's behaviour differs from the whole base, and what that means for the offer */
export function reasonsFor(seg: Behaviour[], all: Behaviour[], category: string, pick: SegPromo | null): Reason[] {
  const out: (Reason & { w: number })[] = [];
  const cmp = (label: string, f: (b: Behaviour) => number, fmt: (v: number) => string, up: string, down: string) => {
    const a = avg(seg, f), b = avg(all, f);
    if (b <= 0) return;
    const r = a / b;
    if (r >= 1.25) out.push({ text: `${label} ${fmt(a)} vs ${fmt(b)} for all customers: ${up}`, tone: 'up', w: r });
    else if (r <= 0.75) out.push({ text: `${label} ${fmt(a)} vs ${fmt(b)} for all customers: ${down}`, tone: 'down', w: 1 / Math.max(0.05, r) });
  };
  cmp('Respond to', (b) => b.respRate, pc, 'offers change their buying.', 'offers rarely change their buying.');
  cmp('Buy on promotion', (b) => b.promoReliance, pc, 'price-sensitive, so a cut moves them.', 'they mostly pay full price, so a cut is subsidy.');
  cmp('Quantity on deal', (b) => b.qtyRatio, (v) => `${v.toFixed(1)}x`, 'volume mechanics fit (watch pull-forward).', 'volume mechanics fit poorly.');
  cmp('Share of basket in ' + category, (b) => b.catShare[category] ?? 0, pc, 'strong category affinity.', 'weak category affinity.');
  cmp('Full-price buys of our brand', (b) => b.fullPriceBuysPerMonth, (v) => `${v.toFixed(1)}/mo`, 'much of the offer goes to buying that happens anyway.', 'little existing buying to subsidise.');
  cmp('Days since last order', (b) => b.recencyDays, (v) => `${Math.round(v)}`, 'they need a reason to return.', 'they are already active.');
  cmp('Digital-channel share', (b) => (b.channelShare.App ?? 0) + (b.channelShare.Online ?? 0), pc, 'reachable by app and partner offers.', 'partner and app offers reach few of them.');
  out.sort((a, b) => b.w - a.w);
  const res: Reason[] = out.slice(0, 3).map(({ text, tone }) => ({ text, tone }));
  if (pick) {
    const p = pick.promo;
    if (p.family === 'volume' && pick.stockRisk > 0.25 * Math.max(1, pick.incUnits)) res.push({ text: `About ${Math.round(pick.stockRisk)} of the units are likely borrowed from later weeks: read the result on units after the window.`, tone: 'down' });
    if (!pick.history) res.push({ text: `${p.label} has not run in ${category} before: the predicted uplift is cut by a quarter and it should launch as a test.`, tone: 'down' });
    if (p.digitalOnly) res.push({ text: `Reaches ${pc(pick.reach)} of the segment's buying (app and online orders only).`, tone: 'down' });
  }
  return res;
}

export { digitalShare };
