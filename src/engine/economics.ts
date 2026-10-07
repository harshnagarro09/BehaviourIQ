// Expected profit of offering customer X a discount, from the model's counterfactual.
import type { Dataset } from './data.ts';
import { predictWith, vector, type Ctx, type TrainedModel } from './model.ts';

/** Extra stock-up units can only borrow from purchases the customer would have made in the next ~3 weeks. */
export const PULL_FORWARD_HORIZON_DAYS = 21;

export interface Offer {
  category: string;
  depth: number; // % off
  mechanic: string; // PCT_OFF | FLAT_OFF | BOGO | MULTIBUY_3FOR2
  minSpend?: number;
}

export interface Expectation {
  cid: string;
  p1: number;
  p0: number;
  uplift: number;
  units: number; // expected units sold on offer
  baseUnits: number; // expected units without offer
  revenue: number;
  discountCost: number;
  leakage: number; // discount handed to units that would have sold anyway
  profitOffer: number;
  profitBase: number;
  pullForward: number; // future margin borrowed
  net: number; // incremental profit after pull-forward
}

const minQty = (mech: string, minSpend = 0, list = 1) => (mech === 'BOGO' ? 2 : mech === 'MULTIBUY_3FOR2' ? 3 : mech === 'FLAT_OFF' ? Math.max(1, Math.ceil(minSpend / list)) : 1);

export function expect(
  ds: Dataset,
  model: Pick<TrainedModel, 'w' | 'b0' | 'mu' | 'sd'>,
  ctx: Ctx,
  offer: Offer,
): Expectation {
  const e = ds.ourEcon[offer.category];
  const L = e.list;
  const K = e.cost;
  const m = L - K;
  const d = offer.depth / 100;
  const p1 = predictWith(model, vector(ctx, offer.depth, offer.mechanic));
  const p0 = predictWith(model, vector(ctx, 0, offer.mechanic));
  const qOffer = Math.max(ctx.qPromo, minQty(offer.mechanic, offer.minSpend, L));
  const units = p1 * qOffer;
  const baseUnits = p0 * ctx.qFull;
  const revenue = units * L * (1 - d);
  const discountCost = units * L * d;
  const leakage = Math.min(units, baseUnits) * L * d;
  const profitOffer = units * (L * (1 - d) - K);
  const profitBase = baseUnits * m;
  const borrowable = (ctx.baselineUnits14 / 14) * PULL_FORWARD_HORIZON_DAYS;
  const pullForward = Math.min(Math.max(0, qOffer - ctx.qFull), borrowable) * p1 * m;
  return {
    cid: ctx.cid, p1, p0, uplift: p1 - p0, units, baseUnits, revenue, discountCost, leakage,
    profitOffer, profitBase, pullForward, net: profitOffer - profitBase - pullForward,
  };
}
