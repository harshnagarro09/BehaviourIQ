// The promotion catalogue used by Planning, Simulation and the budget optimiser: twelve mechanics a grocery retailer
// actually runs, each with explicit economics, eligibility guardrails and a rule-based response read from behaviour.
// Nothing is trained or fitted: every number is a stated rule on the customer's own history.
//
// Response rule for one customer and one offer (all multipliers are stated, see fitOf and response.ts):
//   p0 = chance of buying with no offer (simulation.ts: full-price buying rate, timing)
//   p1 = p0 + (1 - p0) x incremental response at the felt depth x category affinity x mechanic fit x activity x confidence
// where incremental response is what past offers converted ABOVE what the customer would have bought anyway, and
// confidence is 0.75 for a mechanic that has never run in the category (an untested offer is not trusted at face value).
// Customers whose volume falls while offers run (promo-averse) get p1 below p0.
//
// Economics of one offer for one customer over the offer window (all in rupees):
//   units          = expected units bought (respecting the pack size the mechanic needs)
//   investment     = retailer-funded till discount on those units, or points issued x redemption rate
//   revenue        = cash the retailer keeps on those units (list price minus the retailer-funded discount)
//   incRevenue     = revenue - baseline units x list price
//   incMargin      = (units x unit margin - investment) - baseline units x unit margin
//   ROI            = incMargin / investment
// The baseline is the same customer with no offer. Pull-forward is reported as a risk, not deducted (as on Behaviour Analytics).
import { POINTS_REDEMPTION, type Dataset } from './data.ts';
import { activityFactor, incrementalAt, NO_HISTORY, type RespProfile } from './response.ts';
import { DEFAULT_ASSUMPTIONS, isPutOff, type Assumptions, type Ctx } from './simulation.ts';

export type Family = 'price' | 'threshold' | 'volume' | 'bundle' | 'loyalty' | 'partner';

export interface PromoDef {
  key: string;
  label: string;
  short: string; // chart axis label
  family: Family;
  mechanic: string; // data code, as in the CSV
  depth: number; // effective % off the shelf price on the units bought under the offer
  perceived: number; // how strongly shoppers react compared with the same money off at the till (points < 1)
  minQty: number; // units needed to qualify
  minSpend: number; // category spend needed to qualify (threshold offers)
  flat: number; // rupees off (threshold offers)
  retailerShare: number; // share of the discount the retailer pays (partner-funded offers < 1)
  digitalOnly: boolean; // only redeemable in the App / Online channels
  how: string;
  bestFor: string;
  watch: string;
}

/** Uplift kept for a mechanic with no history in the category (assumption: an untested offer is discounted by a quarter). */
export const UNTESTED_CONFIDENCE = 0.75;
/** A promoted unit must keep at least this share of its shelf price as margin (guardrail, assumption). */
export const MARGIN_FLOOR = 0.05;
/** Share of the discount a bank / UPI partner funds on co-funded offers (assumption; agreed per partner contract). */
export const PARTNER_SHARE = 0.5;

/** The twelve mechanics for one category. Thresholds use the category's own shelf price and history. */
export function catalogue(ds: Dataset, category: string): PromoDef[] {
  const list = ds.ourEcon[category]?.list ?? 100;
  const hist = ds.campaigns.find((c) => c.category === category && c.mechanic === 'FLAT_OFF');
  const flat = hist ? Math.round(hist.flat) : Math.max(5, Math.round((list * 0.15) / 5) * 5);
  const minSpend = hist && hist.minSpend ? hist.minSpend : Math.round((list * 2) / 10) * 10;
  const flatDepth = Math.round((flat / list) * 100);
  const base = { perceived: 1, minQty: 1, minSpend: 0, flat: 0, retailerShare: 1, digitalOnly: false };
  return [
    { ...base, key: 'pct10', label: '10% Off', short: '10%', family: 'price', mechanic: 'PCT_OFF', depth: 10, how: 'Price cut at the till on every unit.', bestFor: 'Price-aware shoppers who respond to small cuts.', watch: 'Pure subsidy for customers who buy anyway.' },
    { ...base, key: 'pct15', label: '15% Off', short: '15%', family: 'price', mechanic: 'PCT_OFF', depth: 15, how: 'Price cut at the till on every unit.', bestFor: 'The middle step when 10% is too weak to move a segment.', watch: 'Check the extra 5 points buys enough extra units.' },
    { ...base, key: 'pct20', label: '20% Off', short: '20%', family: 'price', mechanic: 'PCT_OFF', depth: 20, how: 'Price cut at the till on every unit.', bestFor: 'Deal seekers with a high price threshold.', watch: 'Trains customers to wait for deals.' },
    { ...base, key: 'pct25', label: '25% Off', short: '25%', family: 'price', mechanic: 'PCT_OFF', depth: 25, how: 'Deep price cut on every unit.', bestFor: 'Win-back and trial where a strong signal is needed.', watch: 'Only for high-margin categories; subsidy is large.' },
    { ...base, key: 'flat', label: `₹${flat} Off on ₹${minSpend}+`, short: `₹${flat} off`, family: 'threshold', mechanic: 'FLAT_OFF', depth: flatDepth, minSpend, flat, minQty: Math.max(1, Math.ceil(minSpend / list)), how: `₹${flat} off once the category basket reaches ₹${minSpend}.`, bestFor: 'Raising basket size for shoppers just below the threshold.', watch: 'Shoppers already above the threshold get it for free.' },
    { ...base, key: 'b1g1_50', label: 'Buy 1 Get 1 at 50%', short: '2nd 50%', family: 'volume', mechanic: 'B1G1_50', depth: 25, minQty: 2, how: 'Second unit at half price (25% off the pair).', bestFor: 'Households that use more than one unit per trip.', watch: 'Stock-up: later purchases may fall.' },
    { ...base, key: 'bogo', label: 'Buy 1 Get 1 Free', short: 'BOGO', family: 'volume', mechanic: 'BOGO', depth: 50, minQty: 2, how: 'Second unit free (50% off the pair).', bestFor: 'High-margin categories and stock-up shoppers.', watch: 'Below cost where margin is under 55%.' },
    { ...base, key: 'multibuy', label: 'Buy 3 Pay for 2', short: '3 for 2', family: 'volume', mechanic: 'MULTIBUY_3FOR2', depth: 33, minQty: 3, how: 'Three for the price of two (33% off the pack).', bestFor: 'Stock-up shoppers with storage and steady use.', watch: 'Heavy pull-forward; judge on units after the window.' },
    { ...base, key: 'tiered', label: 'Buy 2+ Save 15%', short: 'Tier 15%', family: 'volume', mechanic: 'TIERED', depth: 15, minQty: 2, how: '15% off once two or more units are bought.', bestFor: 'Nudging single-unit buyers to a second unit.', watch: 'Shoppers who already buy two get it free.' },
    { ...base, key: 'combo', label: 'Combo Pack 20% Off', short: 'Combo', family: 'bundle', mechanic: 'COMBO', depth: 20, minQty: 2, how: 'Two different products of the category together, 20% off both.', bestFor: 'Cross-selling a second product to broad-basket shoppers.', watch: 'Needs two products in range and shelf execution.' },
    { ...base, key: 'cashback', label: '10% Cashback (Points)', short: 'Points', family: 'loyalty', mechanic: 'CASHBACK', depth: 10, perceived: 0.7, how: `Shelf price unchanged; 10% back as points. Cost is the ${Math.round(POINTS_REDEMPTION * 100)}% of points that get redeemed.`, bestFor: 'Frequent shoppers who will come back to spend the points.', watch: 'Rewards people who buy anyway; weak pull on occasional shoppers.' },
    { ...base, key: 'partner', label: 'Bank / UPI 15% Off', short: 'Bank 15%', family: 'partner', mechanic: 'PARTNER_PCT', depth: 15, retailerShare: PARTNER_SHARE, digitalOnly: true, how: `15% off paid with the partner card or UPI app; the partner funds ${Math.round(PARTNER_SHARE * 100)}% of it.`, bestFor: 'App and online shoppers; halves the retailer cost.', watch: 'Only reaches digital-channel customers. No history: test first.' },
  ];
}

/** Extra price-off depths (e.g. 5% or 30%) beyond the standard 10 / 15 / 20 / 25%, built like the catalogue's price cuts */
export function priceOffer(depth: number): PromoDef {
  return {
    key: `pct${depth}`, label: `${depth}% Off`, short: `${depth}%`, family: 'price', mechanic: 'PCT_OFF', depth,
    perceived: 1, minQty: 1, minSpend: 0, flat: 0, retailerShare: 1, digitalOnly: false,
    how: 'Price cut at the till on every unit.', bestFor: 'A depth chosen from the category demand curve.', watch: 'Check the extra depth buys enough extra units.',
  };
}

/** Effective share of the shelf price the retailer gives away on a promoted unit */
export const retailerDepth = (p: PromoDef) => (p.depth / 100) * (p.family === 'loyalty' ? POINTS_REDEMPTION : p.retailerShare);

export interface Eligibility { ok: boolean; reason?: string }

/** Business guardrails: an offer that sells below the margin floor, or cannot be executed in the category, is not allowed */
export function eligibility(ds: Dataset, category: string, p: PromoDef): Eligibility {
  const e = ds.ourEcon[category];
  if (!e) return { ok: false, reason: 'No sales in this category.' };
  const marginPct = (e.list - e.cost) / e.list;
  const d = retailerDepth(p);
  if (marginPct - d < MARGIN_FLOOR)
    return { ok: false, reason: `Sells below the ${Math.round(MARGIN_FLOOR * 100)}% margin floor: ${Math.round(d * 100)}% off on a ${Math.round(marginPct * 100)}% margin.` };
  if (p.family === 'bundle' && new Set(ds.lines.filter((l) => l.category === category).map((l) => l.productId)).size < 2)
    return { ok: false, reason: 'Needs two products in the category range.' };
  return { ok: true };
}

/** Has this mechanic run in this category before? (history makes the response read more reliable) */
export function hasHistory(ds: Dataset, category: string, p: PromoDef): boolean {
  const runs = ds.campaigns.filter((c) => c.category === category && c.mechanic === p.mechanic);
  // a price cut is read off the category's depth-response; it counts as tested up to 5 points beyond the deepest cut run
  return p.mechanic === 'PCT_OFF' ? runs.some((c) => p.depth <= c.depth + 5) : runs.length > 0;
}

export interface PromoExp {
  cid: string;
  reach: number; // share of the customer's buying the offer can apply to (digital-only offers)
  p0: number; // chance of buying with no offer
  p1: number; // chance of buying with the offer
  uplift: number;
  units: number;
  baseUnits: number;
  incUnits: number;
  revenue: number;
  baseRevenue: number;
  incRevenue: number;
  investment: number;
  subsidy: number; // investment on units that would have been bought anyway
  margin: number; // margin after the investment
  baseMargin: number;
  incMargin: number;
  stockRisk: number; // expected units borrowed from later weeks (shown as a risk, not deducted)
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pack = (q: number, n: number) => (n > 1 ? Math.ceil(q / n) * n : q);

/** How well the mechanic suits this customer's habits (rule-based, multipliers on the response) */
export function fitOf(ctx: Ctx, p: PromoDef, list: number, A: Assumptions = DEFAULT_ASSUMPTIONS): number {
  const b = ctx.b;
  switch (p.family) {
    case 'volume':
      if (b.qtyRatio >= 1.7) return A.multiBuyFitStockup;
      if (ctx.qFull <= 1.3 && b.qtyRatio < 1.3) return p.minQty >= 3 ? A.multiBuyFitSingle * 0.9 : A.multiBuyFitSingle;
      return 1;
    case 'threshold':
      return ctx.qPromo * list >= p.minSpend ? 1 : A.minSpendFit;
    case 'bundle':
      return b.linesPerOrder >= 2 ? 1.05 : 0.9;
    case 'loyalty': // points pay back only for shoppers who return; deal-prone shoppers prefer instant savings
      return (b.ordersPerMonth >= 2.5 ? 1.1 : b.ordersPerMonth < 1.2 ? 0.8 : 1) * (b.promoReliance >= 0.5 ? 0.75 : 1);
    default:
      return 1;
  }
}

export function digitalShare(ctx: Ctx): number {
  return (ctx.b.channelShare.App ?? 0) + (ctx.b.channelShare.Online ?? 0);
}

/**
 * Optional replacement for the depth part of the response (how incremental response changes with discount depth).
 * Returns null to keep the behaviour rule (incrementalAt). Used by the combined behaviour + price elasticity mode.
 */
export type DepthFn = (resp: RespProfile, p: PromoDef) => number | null;

export function expectPromo(
  ds: Dataset, ctx: Ctx, p: PromoDef, resp: RespProfile = NO_HISTORY, confidence = 1, A: Assumptions = DEFAULT_ASSUMPTIONS, depth?: DepthFn,
): PromoExp {
  const e = ds.ourEcon[ctx.cat];
  const L = e.list, m = e.list - e.cost;
  const p0 = ctx.p0;
  const reach = p.digitalOnly ? clamp(digitalShare(ctx)) : 1;
  let pOn: number;
  if (isPutOff(ctx)) pOn = p0 * clamp(ctx.b.lift, 0.3, 0.9);
  else {
    const conv = (depth?.(resp, p) ?? incrementalAt(resp, p.depth * p.perceived)) * ctx.affinity * fitOf(ctx, p, L, A) * activityFactor(ctx.b) * confidence;
    pOn = Math.min(0.97, p0 + (1 - p0) * clamp(conv));
  }
  const p1 = p0 + reach * (pOn - p0);
  const qOn = p.family === 'loyalty' ? ctx.qFull : pack(Math.max(ctx.qPromo, p.minQty), p.minQty);
  const unitsOn = reach * pOn * qOn; // bought under the offer
  const unitsOff = (1 - reach) * p0 * ctx.qFull; // bought where the offer does not apply
  const units = unitsOn + unitsOff;
  const baseUnits = p0 * ctx.qFull;
  const investment = unitsOn * L * retailerDepth(p);
  const tillGiven = p.family === 'loyalty' ? 0 : investment; // points are not taken off the price
  const revenue = units * L - tillGiven;
  const margin = units * m - investment;
  const baseMargin = baseUnits * m;
  const borrowable = (ctx.baselineUnits14 / 14) * A.pullForwardDays;
  const stockRisk = Math.min(Math.max(0, qOn - ctx.qFull), borrowable) * reach * pOn;
  return {
    cid: ctx.cid, reach, p0, p1, uplift: p1 - p0, units, baseUnits, incUnits: units - baseUnits,
    revenue, baseRevenue: baseUnits * L, incRevenue: revenue - baseUnits * L,
    investment, subsidy: units > 0 ? investment * Math.min(1, baseUnits / units) : 0,
    margin, baseMargin, incMargin: margin - baseMargin, stockRisk,
  };
}
