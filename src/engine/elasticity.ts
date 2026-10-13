// Price elasticity of promotional demand, estimated from ACTUAL past campaign results: how much a category's units rise as
// the discount deepens. It answers "how deep should the discount be?"; customer behaviour (customer types and each
// customer's own past response) still answers "who should get it?".
//
// Data used (per past campaign, from engine/campaigns.ts):
//   lift  = units the reached customers bought in the campaign window / their baseline units (normal buying rate, no offer)
//   depth = the campaign's discount at the till (% off; ₹-off offers converted to their equivalent %)
// Model (constant elasticity, the standard promotional demand curve):
//   lift = (1 - depth) ^ beta        =>   ln(lift) = beta x ln(1 - depth)
// fitted per category by baseline-weighted least squares through the origin (no offer = no lift), then shrunk toward the
// all-category estimate in proportion to how uncertain each category is (random-effects / DerSimonian-Laird weights).
// Only plain price offers are used (% off, ₹ off, buy-2-save): multi-buys, BOGO, combos and points move volume through
// their mechanics, so they would distort a price curve. Beta must be negative (a deeper cut never lowers demand).
//
// Limits (shown in the UI): observational data with no control group, few distinct depths per category (mostly 10% and
// 20%), timing and seasonality are not separated out, and the curve is only trusted from 5 points below the shallowest
// discount run up to the deepest one run. Outside that range the existing behaviour rule is used and the offer is flagged.
import type { CampaignResult, CustomerCampaign } from './campaigns.ts';
import type { TypeId } from './behaviour.ts';
import type { RespProfile } from './response.ts';
import { priceOffer, type PromoDef } from './promotions.ts';
import type { DepthOptions } from './targeting.ts';

export const PRICE_MECHANICS = ['PCT_OFF', 'FLAT_OFF', 'TIERED'];
/**
 * Depths the curve is trusted for: from this many points below the shallowest discount actually run, up to the deepest
 * one actually run. Never deeper: in the one category with a 25% offer the constant-elasticity curve over-predicts the
 * step from 20% to 25%, so deeper offers keep the behaviour rule and are flagged as beyond the tested depths.
 */
export const RANGE_BELOW = 5;
/** plausible range for a promotional own-price elasticity; outside it the estimate is not used */
export const SANE = { min: -8, max: -0.2 };

export interface ElasticityPoint { campaignId: string; name: string; mechanic: string; depth: number; lift: number; baseline: number; start: number }
export interface Fit { beta: number; se: number; n: number }

export interface CategoryElasticity {
  category: string;
  beta: number; // the value used: shrunk toward the all-category estimate
  raw: Fit | null; // this category's own fit (null if too few points)
  points: ElasticityPoint[]; // actual campaigns behind it
  minDepth: number; maxDepth: number; // % off actually run
  reliable: boolean; // own data is enough and passes the sanity checks
  note: string; // plain-language reliability note
  looError: number | null; // leave-one-campaign-out mean absolute % error of the lift
}

export interface ElasticityModel {
  pooled: Fit; // all categories together
  tau2: number; // between-category variance of beta
  byCategory: Map<string, CategoryElasticity>;
  byType: Map<TypeId, Fit | null>; // pooled over categories, per customer type (diagnostic: who is price-sensitive)
  excluded: number; // campaigns left out because their mechanic is not a plain price offer
}

const ln = Math.log;

/** weighted least squares through the origin: ln(lift) = beta x ln(1 - depth) */
export function fitBeta(points: { depth: number; lift: number; baseline: number }[]): Fit | null {
  const ps = points.filter((p) => p.depth > 0 && p.depth < 1 && p.lift > 0 && p.baseline > 0);
  if (ps.length < 2) return null;
  let sxy = 0, sxx = 0;
  for (const p of ps) { const x = ln(1 - p.depth), y = ln(p.lift); sxy += p.baseline * x * y; sxx += p.baseline * x * x; }
  if (sxx <= 0) return null;
  const beta = sxy / sxx;
  let ss = 0;
  for (const p of ps) { const x = ln(1 - p.depth), y = ln(p.lift); ss += p.baseline * (y - beta * x) ** 2; }
  // the usual weighted-least-squares standard error: residual variance / sum of w x^2
  return { beta, se: Math.sqrt(ss / Math.max(1, ps.length - 1) / sxx), n: ps.length };
}

export const demandLift = (beta: number, depthPct: number) => (1 - depthPct / 100) ** beta;

export function estimateElasticity(results: CampaignResult[], perCustomer?: Map<string, CustomerCampaign[]>, typeOf?: Map<string, TypeId>): ElasticityModel {
  const price = results.filter((r) => PRICE_MECHANICS.includes(r.campaign.mechanic) && r.baselineUnits > 0 && r.units > 0);
  const toPoint = (r: CampaignResult): ElasticityPoint => ({ campaignId: r.campaign.id, name: r.campaign.name, mechanic: r.campaign.mechanic, depth: r.campaign.depth / 100, lift: r.units / r.baselineUnits, baseline: r.baselineUnits, start: r.campaign.start });
  const all = price.map(toPoint);
  const pooled = fitBeta(all) ?? { beta: -2, se: Infinity, n: 0 };

  const cats = [...new Set(results.map((r) => r.campaign.category))].sort();
  const raw = new Map(cats.map((c) => [c, fitBeta(all.filter((p) => results.find((r) => r.campaign.id === p.campaignId)!.campaign.category === c))]));
  const pointsOf = (c: string) => all.filter((p) => results.find((r) => r.campaign.id === p.campaignId)!.campaign.category === c);

  // DerSimonian-Laird between-category variance
  const ok = [...raw.values()].filter((f): f is Fit => !!f && Number.isFinite(f.se) && f.se > 0);
  let tau2 = 0;
  if (ok.length >= 2) {
    const w = ok.map((f) => 1 / f.se ** 2);
    const sw = w.reduce((a, b) => a + b, 0);
    const mean = ok.reduce((a, f, i) => a + w[i] * f.beta, 0) / sw;
    const Q = ok.reduce((a, f, i) => a + w[i] * (f.beta - mean) ** 2, 0);
    tau2 = Math.max(0, (Q - (ok.length - 1)) / (sw - w.reduce((a, b) => a + b * b, 0) / sw));
  }
  const shrink = (f: Fit | null) => {
    if (!f || !Number.isFinite(f.se)) return pooled.beta;
    if (tau2 <= 0) return pooled.beta; // categories are indistinguishable from the average
    const a = 1 / f.se ** 2, b = 1 / tau2;
    return (a * f.beta + b * pooled.beta) / (a + b);
  };

  const byCategory = new Map<string, CategoryElasticity>();
  for (const c of cats) {
    const pts = pointsOf(c);
    const f = raw.get(c) ?? null;
    const depths = [...new Set(pts.map((p) => Math.round(p.depth * 100)))];
    const spread = depths.length ? Math.max(...depths) - Math.min(...depths) : 0;
    const sane = !!f && f.beta >= SANE.min && f.beta <= SANE.max;
    const reliable = !!f && f.n >= 3 && spread >= 5 && sane && f.se < Math.abs(f.beta) / 2;
    const beta = reliable ? shrink(f) : pooled.beta;
    // leave one campaign out: refit without it (falls back to the pooled estimate) and predict its lift
    let errs = 0, k = 0;
    for (const p of pts) {
      const rest = fitBeta(pts.filter((x) => x !== p));
      const b = rest && rest.beta >= SANE.min && rest.beta <= SANE.max ? rest.beta : pooled.beta;
      errs += Math.abs((1 - p.depth) ** b - p.lift) / p.lift; k++;
    }
    const note = !f ? 'Too few plain price offers here, so the average of all categories is used.'
      : !sane ? 'This category’s own estimate is implausible, so the average of all categories is used.'
      : spread < 5 ? 'Only one discount depth has been run here, so the curve cannot be read from this category alone; the average of all categories is used.'
      : !reliable ? 'This category’s own estimate is uncertain, so the average of all categories is used.'
      : `Based on ${f.n} past price offers at ${depths.sort((a, b) => a - b).join('%, ')}% off, combined with the other categories.`;
    byCategory.set(c, {
      category: c, beta, raw: f, points: pts, minDepth: depths.length ? Math.min(...depths) : 0, maxDepth: depths.length ? Math.max(...depths) : 0,
      reliable, note, looError: k ? errs / k : null,
    });
  }

  // per customer type: lift of each type's reached customers in each price campaign, pooled over categories
  const byType = new Map<TypeId, Fit | null>();
  if (perCustomer && typeOf) {
    const acc = new Map<string, { units: number; base: number }>();
    const ids = new Set(price.map((r) => r.campaign.id));
    for (const [cid, rows] of perCustomer) {
      const t = typeOf.get(cid);
      if (!t) continue;
      for (const r of rows) {
        if (!ids.has(r.campaignId)) continue;
        const k = `${t}|${r.campaignId}`;
        const a = acc.get(k) ?? { units: 0, base: 0 };
        a.units += r.units; a.base += r.baselineUnits;
        acc.set(k, a);
      }
    }
    for (const t of ['persuadable', 'sure', 'lost', 'dog'] as TypeId[]) {
      const pts = price.flatMap((r) => { const a = acc.get(`${t}|${r.campaign.id}`); return a && a.base > 0 && a.units > 0 ? [{ depth: r.campaign.depth / 100, lift: a.units / a.base, baseline: a.base }] : []; });
      byType.set(t, fitBeta(pts));
    }
  }
  return { pooled, tau2, byCategory, byType, excluded: results.length - price.length };
}

/** is this offer depth inside the depths the category's curve is trusted for (see RANGE_BELOW)? */
export function inRange(ce: CategoryElasticity | undefined, depthPct: number): boolean {
  if (!ce || !ce.points.length) return false;
  return depthPct >= Math.max(1, ce.minDepth - RANGE_BELOW) && depthPct <= ce.maxDepth + 1e-9;
}

/**
 * Combined response: each customer's OWN past response sets the level (behaviour: who responds, and how strongly, at the
 * shallow ~10% and deep ~20% offers they actually saw); the category's demand curve sets how that response changes with
 * depth (elasticity: between and around those depths). Inside the supported range only.
 *   g(d) = (1 - d)^beta - 1        (extra demand at depth d, relative to no offer)
 *   up to 10%:   lo x g(d) / g(10%)
 *   10% to 20%:  lo + (hi - lo) x (g(d) - g(10%)) / (g(20%) - g(10%))
 *   20% and up:  hi x g(d) / g(20%)
 * At exactly 10% and 20% it returns the customer's own reads, so the two approaches agree where the data is.
 */
export function combinedResponse(beta: number) {
  const g = (d: number) => (1 - d) ** beta - 1;
  const g1 = g(0.1), g2 = g(0.2);
  return (r: RespProfile, depthPct: number): number => {
    const d = depthPct / 100;
    if (d <= 0) return 0;
    const v = d <= 0.1 ? r.lo * (g(d) / g1) : d < 0.2 ? r.lo + (r.hi - r.lo) * ((g(d) - g1) / (g2 - g1)) : r.hi * (g(d) / g2);
    return Math.max(0, Math.min(0.95, v));
  };
}

/** Price-off depths the combined mode considers, kept inside the supported range */
export const LADDER = [5, 10, 15, 20, 25, 30];

/**
 * The combined-mode hook for one category: the demand curve shapes the response of every offer whose (felt) depth lies
 * inside the depths the category has actually run; other offers keep the behaviour rule. Extra price-off depths from
 * LADDER are added only where they are inside that range.
 */
export function depthOptions(ce: CategoryElasticity | undefined): DepthOptions | undefined {
  if (!ce || !ce.points.length) return undefined;
  const curve = combinedResponse(ce.beta);
  const felt = (p: PromoDef) => p.depth * p.perceived;
  const covers = (p: PromoDef) => inRange(ce, felt(p));
  return {
    covers,
    fn: (r, p) => (covers(p) ? curve(r, felt(p)) : null),
    extra: LADDER.filter((d) => inRange(ce, d) && ![10, 15, 20, 25].includes(d)).map(priceOffer),
  };
}
