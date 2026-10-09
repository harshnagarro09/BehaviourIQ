// Expected economics of offering customer X a promotion, from the rule-based simulation (no fitted model).
// Profit is always measured against the baseline: what the same customer would have bought with NO offer.
import type { Dataset } from './data.ts';
import { DEFAULT_ASSUMPTIONS, chanceWithOffer, type Assumptions, type Ctx } from './simulation.ts';

export const PULL_FORWARD_HORIZON_DAYS = DEFAULT_ASSUMPTIONS.pullForwardDays;

export interface Offer {
  category: string;
  depth: number; // effective % off the shelf price (BOGO = 50, 3-for-2 = 33)
  mechanic: string; // PCT_OFF | FLAT_OFF | BOGO | MULTIBUY_3FOR2
  minSpend?: number;
}

export interface Expectation {
  cid: string;
  p1: number; // chance of buying with the offer
  p0: number; // baseline chance of buying with no offer
  uplift: number; // p1 - p0
  units: number; // expected units sold on offer (free units included)
  baseUnits: number; // baseline units
  revenue: number;
  discountCost: number; // shelf value of the discount given
  funding: number; // supplier funding (assumption, default 0)
  leakage: number; // discount given on baseline sales
  contactCost: number;
  profitOffer: number; // gross profit on offer sales
  profitBase: number; // gross profit at baseline
  pullForward: number; // future profit borrowed
  net: number; // incremental profit = profitOffer - profitBase - pullForward - contactCost
}

/** whole offers only: BOGO in pairs, multi-buy in threes, flat-off enough units to reach the minimum spend */
export function minQty(mech: string, minSpend = 0, list = 1) {
  return mech === 'BOGO' ? 2 : mech === 'MULTIBUY_3FOR2' ? 3 : mech === 'FLAT_OFF' ? Math.max(1, Math.ceil(minSpend / list)) : 1;
}
const roundToPack = (q: number, mech: string) => (mech === 'BOGO' ? Math.ceil(q / 2) * 2 : mech === 'MULTIBUY_3FOR2' ? Math.ceil(q / 3) * 3 : q);

export function expect(ds: Dataset, ctx: Ctx, offer: Offer, A: Assumptions = DEFAULT_ASSUMPTIONS): Expectation {
  const e = ds.ourEcon[offer.category];
  const L = e.list, K = e.cost, m = L - K, d = offer.depth / 100;
  const p0 = ctx.p0;
  const p1 = chanceWithOffer(ctx, offer.depth, offer.mechanic, L, offer.minSpend ?? 0, A);
  const qOffer = offer.depth <= 0 ? ctx.qFull : roundToPack(Math.max(ctx.qPromo, minQty(offer.mechanic, offer.minSpend, L)), offer.mechanic);
  const units = p1 * qOffer;
  const baseUnits = p0 * ctx.qFull;
  const revenue = units * L * (1 - d);
  const discountCost = units * L * d;
  const funding = discountCost * A.supplierFunding;
  const leakage = Math.min(units, baseUnits) * L * d;
  const profitOffer = revenue - units * K + funding;
  const profitBase = baseUnits * m;
  const borrowable = (ctx.baselineUnits14 / 14) * A.pullForwardDays;
  const pullForward = Math.min(Math.max(0, qOffer - ctx.qFull), borrowable) * p1 * m;
  const contactCost = offer.depth > 0 ? A.contactCost : 0;
  return {
    cid: ctx.cid, p1, p0, uplift: p1 - p0, units, baseUnits, revenue, discountCost, funding, leakage, contactCost,
    profitOffer, profitBase, pullForward, net: profitOffer - profitBase - pullForward - contactCost,
  };
}
