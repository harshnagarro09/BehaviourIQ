// Rule-based promotion response simulation for a business demo. NO machine learning: nothing is trained or fitted.
//
// Question answered: "if customer X is offered promotion P on category C, how likely are they to buy our brand in the
// next 14 days, compared with no offer?"  Fixed rules read from the customer's own purchase history:
//   1. Baseline: chance of buying WITHOUT an offer, from their full-price buying rate (frequency, existing buying of
//      our brand), nudged by timing (are they due to reorder?).
//   2. Past promotion response: share of past campaigns they bought on, split into shallow (<=15% off) and deep
//      (20%+) offers: their price sensitivity. Short histories lean on the all-customer average.
//   3. Offer depth: read between those two observed rates.
//   4. Product affinity and basket fit: small, visible adjustments (assumptions below).
//   5. Uplift = chance with the offer minus baseline. Buying that would have happened anyway is not credited.
//      Customers whose volume FALLS in promotion windows (Sleeping Dogs) get a chance below baseline.
// The output is simulated, not a forecast.
import { baselineRate, cutIndex, profile, type Behaviour } from './behaviour.ts';
import type { Dataset } from './data.ts';

export const SIM_WINDOW_DAYS = 14;

/** Business assumptions behind the simulated numbers. Demonstration values, not measurements. */
export interface Assumptions {
  pullForwardDays: number; // extra quantity can only borrow from this many days of normal purchases
  multiBuyFitStockup: number; // response multiplier for BOGO / multi-buy for customers who buy larger quantities
  multiBuyFitSingle: number; // ... for customers who normally buy one unit
  minSpendFit: number; // multiplier for "Rs off on min spend" when the usual basket is below the threshold
  deepOfferExtra: number; // share of remaining customers won between 20% and 50% off
  contactCost: number; // Rs to reach one customer
  supplierFunding: number; // share of the discount repaid by the brand (0 = retailer pays all)
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  pullForwardDays: 21, multiBuyFitStockup: 1.15, multiBuyFitSingle: 0.85, minSpendFit: 0.9,
  deepOfferExtra: 0.25, contactCost: 2, supplierFunding: 0,
};

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export interface Ctx {
  cid: string;
  cat: string;
  b: Behaviour;
  qFull: number; // typical units per purchase of our brand at full price
  qPromo: number; // ... on promotion
  baselineUnits14: number; // expected units of our brand in the category over the window with no offer
  p0: number; // baseline chance of buying
  due: number; // timing factor applied to the baseline
  rLow: number; // observed response to shallow offers
  rHigh: number; // ... and to deep offers
  affinity: number; // product affinity multiplier
}

const profCache = new WeakMap<Dataset, Map<string, Behaviour>>();
export function cachedProfile(ds: Dataset, cid: string, asOf: number): Behaviour {
  let m = profCache.get(ds);
  if (!m) profCache.set(ds, (m = new Map()));
  const k = cid + '|' + asOf;
  let p = m.get(k);
  if (!p) m.set(k, (p = profile(ds, cid, asOf)));
  return p;
}

const PRIOR_WEIGHT = 2; // a short history counts as much as 2 average campaigns
const priorCache = new WeakMap<Dataset, { lo: number; hi: number }>();
function priors(ds: Dataset, asOf: number) {
  let p = priorCache.get(ds);
  if (!p) {
    let ls = 0, lb = 0, hs = 0, hb = 0;
    for (const cid of ds.customers) {
      const b = cachedProfile(ds, cid, asOf);
      ls += b.shallowShown; lb += b.shallowBought; hs += b.deepShown; hb += b.deepBought;
    }
    p = { lo: ls ? lb / ls : 0.2, hi: hs ? hb / hs : 0.3 };
    priorCache.set(ds, p);
  }
  return p;
}

export function makeCtx(ds: Dataset, cid: string, cat: string, asOf: number): Ctx {
  const b = cachedProfile(ds, cid, asOf);
  const all = ds.byCustomer.get(cid) ?? [];
  const lines = all.slice(0, cutIndex(all, asOf));
  let ourFull = 0, ourFullQty = 0, promoQty = 0, promoN = 0;
  for (const l of lines) {
    if (l.category !== cat || !l.ours) continue;
    if (l.disc === 0) { ourFull++; ourFullQty += l.qty; } else { promoN++; promoQty += l.qty; }
  }
  const baselineUnits14 = baselineRate(ds, lines, cat, asOf) * SIM_WINDOW_DAYS;
  const qFull = ourFull ? ourFullQty / ourFull : b.avgQty || 1.3;
  const qPromo = promoN ? promoQty / promoN : qFull * Math.max(1, b.qtyRatio);
  // timing: customers who are due to reorder are a little more likely to buy, those who just bought a little less
  const cycle = b.avgInterval > 0 ? b.recencyDays / b.avgInterval : 1;
  const due = cycle >= 1 ? 1.1 : cycle < 0.4 ? 0.9 : 1;
  const p0 = clamp((1 - Math.exp(-baselineUnits14 / Math.max(1, qFull))) * due, 0.01, 0.9);
  const pr = priors(ds, asOf);
  const rLow = (b.shallowBought + PRIOR_WEIGHT * pr.lo) / (b.shallowShown + PRIOR_WEIGHT);
  const rHigh = Math.max(rLow, (b.deepBought + PRIOR_WEIGHT * pr.hi) / (b.deepShown + PRIOR_WEIGHT));
  const evenShare = 1 / Math.max(1, ds.categories.length);
  const affinity = clamp(0.6 + 0.4 * ((b.catShare[cat] ?? 0) / evenShare), 0.6, 1.25);
  return { cid, cat, b, qFull, qPromo, baselineUnits14, p0, due, rLow, rHigh, affinity };
}

/** Rule 3: observed response at a given depth, read between the customer's shallow and deep response */
export function observedResponse(ctx: Pick<Ctx, 'rLow' | 'rHigh'>, depth: number, A: Assumptions = DEFAULT_ASSUMPTIONS): number {
  if (depth <= 0) return 0;
  if (depth <= 10) return ctx.rLow * (depth / 10);
  if (depth < 20) return ctx.rLow + (ctx.rHigh - ctx.rLow) * ((depth - 10) / 10);
  return ctx.rHigh + (1 - ctx.rHigh) * A.deepOfferExtra * ((depth - 20) / 30);
}

/** Rule 4b: how well the mechanic suits this customer's usual basket */
export function mechanicFit(ctx: Ctx, mechanic: string, listPrice: number, minSpend: number, A: Assumptions = DEFAULT_ASSUMPTIONS): number {
  if (mechanic === 'BOGO' || mechanic === 'MULTIBUY_3FOR2') {
    if (ctx.b.qtyRatio >= 1.7) return A.multiBuyFitStockup;
    if (ctx.qFull <= 1.3 && ctx.b.qtyRatio < 1.3) return A.multiBuyFitSingle;
    return 1;
  }
  if (mechanic === 'FLAT_OFF' && minSpend > 0) return ctx.qPromo * listPrice >= minSpend ? 1 : A.minSpendFit;
  return 1;
}

/** Customers whose volume falls in promotion windows are put off by offers (Sleeping Dogs) */
export const isPutOff = (ctx: Pick<Ctx, 'b'>) => ctx.b.lift < 0.6 && ctx.b.fullPriceBuysPerMonth >= 1.5;

/** Rule 5: simulated chance of buying with an offer */
export function chanceWithOffer(ctx: Ctx, depth: number, mechanic: string, listPrice: number, minSpend: number, A: Assumptions = DEFAULT_ASSUMPTIONS): number {
  if (depth <= 0) return ctx.p0;
  if (isPutOff(ctx)) return ctx.p0 * clamp(ctx.b.lift, 0.3, 0.9);
  const r = observedResponse(ctx, depth, A) * ctx.affinity * mechanicFit(ctx, mechanic, listPrice, minSpend, A);
  return Math.max(ctx.p0, Math.min(0.97, r));
}
