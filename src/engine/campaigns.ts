// What did each past promotion actually deliver?  Measured from actual orders over the customers the campaign reached.
//
// Measurement design (intent-to-treat): every customer who ordered in the 90 days before a campaign counts as reached,
// whether or not they bought. Their own full-price buying rate before the campaign is the baseline (no control group exists).
//   Promo investment    = till discount (list - paid) x units  +  loyalty points issued x POINTS_REDEMPTION      (actual)
//   Promo revenue       = paid price x units on lines bought under the promotion                               (actual)
//   Incremental units   = category units bought in the window  -  baseline units                               (estimate)
//   Incremental revenue = revenue received in the window  -  baseline units x list price                       (estimate)
//   Incremental margin  = margin in the window after discount and points  -  baseline units x full unit margin (estimate)
//   ROI                 = incremental margin / promo investment
//                       = (incremental units x unit margin - promo investment) / promo investment
// The post-promotion dip (pull-forward) is reported as a separate diagnostic and is NOT deducted from ROI: reading it
// reliably needs a longer window and a control group.
import { baselineRate, cutIndex } from './behaviour.ts';
import type { TypeId } from './behaviour.ts';
import { POINTS_REDEMPTION, type Campaign, type Dataset } from './data.ts';

export interface Slice {
  customers: number; // customers reached (active)
  buyers: number; // bought on promo
  units: number; // category units bought in the window
  promoUnits: number; // units bought under the promotion
  revenue: number; // revenue received in the window (category, after discount)
  promoRevenue: number; // revenue on promoted lines only
  baseRevenue: number; // baseline units x list price
  incRevenue: number; // revenue - baseRevenue
  discountCost: number; // promo investment: till discount + redeemed points
  rewardCost: number; // the points part of the investment
  baselineUnits: number;
  incUnits: number;
  leakage: number; // investment spent on baseline units (subsidy)
  pullForwardUnits: number; // units missing in the 21 days after the window (diagnostic)
  windowMargin: number; // gross margin on window units after discount and points
  baseMargin: number; // margin those customers would have earned at full price anyway
  incMargin: number; // windowMargin - baseMargin
  dipMargin: number; // margin lost in the 21 days after (negative = lost), diagnostic only
}
const emptySlice = (): Slice => ({
  customers: 0, buyers: 0, units: 0, promoUnits: 0, revenue: 0, promoRevenue: 0, baseRevenue: 0, incRevenue: 0, discountCost: 0, rewardCost: 0,
  baselineUnits: 0, incUnits: 0, leakage: 0, pullForwardUnits: 0, windowMargin: 0, baseMargin: 0, incMargin: 0, dipMargin: 0,
});

export interface CampaignResult extends Slice {
  campaign: Campaign;
  respRate: number;
  leakagePct: number; // share of the investment given to units that would sell anyway
  roi: number; // incremental margin / promo investment
  byType: Record<TypeId, Slice>;
  verdict: 'High performer' | 'Needs improvement' | 'Low performer'; // how the finished campaign performed
}

export interface CustomerCampaign {
  cid: string;
  campaignId: string;
  revenue: number; // cash received on category units in the window
  promoRevenue: number; // cash received on promoted lines
  baseRevenue: number;
  grossProfit: number; // margin in the window after discount and points
  baseMargin: number;
  incMargin: number;
  pullForwardUnits: number; // units missing in the weeks after (the dip)
  active: boolean;
  bought: boolean;
  units: number;
  promoUnits: number;
  baselineUnits: number;
  incUnits: number;
  discountCost: number; // promo investment
  rewardCost: number;
  leakage: number;
}

export const verdictOf = (roi: number): CampaignResult['verdict'] => (roi >= 0.5 ? 'High performer' : roi >= 0 ? 'Needs improvement' : 'Low performer');

export function evaluateCampaigns(ds: Dataset, typeOf: Map<string, TypeId>) {
  const results: CampaignResult[] = [];
  const perCustomer = new Map<string, CustomerCampaign[]>();
  const types: TypeId[] = ['persuadable', 'sure', 'lost', 'dog'];
  for (const c of ds.campaigns) {
    const len = c.end - c.start + 1;
    const econ = ds.ourEcon[c.category];
    const mFull = econ.list - econ.cost;
    const tot = emptySlice();
    const byType = Object.fromEntries(types.map((t) => [t, emptySlice()])) as Record<TypeId, Slice>;
    for (const cid of ds.customers) {
      const lines = ds.byCustomer.get(cid)!;
      const i0 = cutIndex(lines, c.start - 90);
      const i1 = cutIndex(lines, c.start);
      const active = i1 > i0 || lines[0].day >= c.start - 90;
      if (!active || lines[0].day > c.end) continue;
      let A = 0, pU = 0, rev = 0, pRev = 0, marg = 0, disc = 0, pts = 0, P = 0;
      let bought = false;
      for (let i = cutIndex(lines, c.start); i < lines.length && lines[i].day <= c.end + 21; i++) {
        const l = lines[i];
        if (l.category !== c.category || !l.ours) continue;
        if (l.day <= c.end) {
          A += l.qty;
          rev += l.unit * l.qty;
          marg += (l.unit - l.cost) * l.qty;
          disc += (l.list - l.unit) * l.qty;
          pts += l.reward * POINTS_REDEMPTION;
          if (l.promoId === c.id) { bought = true; pU += l.qty; pRev += l.unit * l.qty; }
        } else P += l.qty;
      }
      const b = baselineRate(ds, lines, c.category, c.start);
      const B = b * len;
      const postKnown = c.end + 21 <= ds.maxDay;
      const dip = postKnown ? b * 21 - P : 0;
      const invest = disc + pts;
      const wMargin = marg - pts;
      const inc = wMargin - B * mFull;
      const leakShare = A > 0 ? Math.min(A, B) / A : 0;
      const row: CustomerCampaign = {
        cid, campaignId: c.id, revenue: rev, promoRevenue: pRev, baseRevenue: B * econ.list, grossProfit: wMargin, baseMargin: B * mFull, incMargin: inc,
        pullForwardUnits: dip, active, bought, units: A, promoUnits: pU, baselineUnits: B, incUnits: A - B,
        discountCost: invest, rewardCost: pts, leakage: invest * leakShare,
      };
      for (const s of [tot, byType[typeOf.get(cid) ?? 'lost']]) {
        s.customers++;
        if (bought) s.buyers++;
        s.units += A;
        s.promoUnits += pU;
        s.revenue += rev;
        s.promoRevenue += pRev;
        s.baseRevenue += row.baseRevenue;
        s.incRevenue += rev - row.baseRevenue;
        s.discountCost += invest;
        s.rewardCost += pts;
        s.baselineUnits += B;
        s.incUnits += A - B;
        s.leakage += row.leakage;
        s.pullForwardUnits += dip;
        s.windowMargin += wMargin;
        s.baseMargin += row.baseMargin;
        s.incMargin += inc;
        s.dipMargin -= dip * mFull;
      }
      let arr = perCustomer.get(cid);
      if (!arr) perCustomer.set(cid, (arr = []));
      arr.push(row);
    }
    const roi = tot.discountCost > 0 ? tot.incMargin / tot.discountCost : 0;
    results.push({
      ...tot,
      campaign: c,
      respRate: tot.customers ? tot.buyers / tot.customers : 0,
      leakagePct: tot.discountCost ? tot.leakage / tot.discountCost : 0,
      roi,
      byType,
      verdict: verdictOf(roi),
    });
  }
  return { results, perCustomer };
}

export interface StrategyResult {
  name: string;
  description: string;
  targeted: number;
  discountCost: number;
  incMargin: number;
  roi: number;
}

/**
 * Replay of past campaigns under simple audience rules, using what customers ACTUALLY did (no prediction).
 * Customers who are not contacted are assumed to buy at their baseline. Indicative: the types are built from the same history.
 */
export function replayStrategies(perCustomer: Map<string, CustomerCampaign[]>, typeOf: Map<string, TypeId>): StrategyResult[] {
  const strategies: { name: string; description: string; keep: (t: TypeId) => boolean }[] = [
    { name: 'Offer everyone', description: 'Every active customer receives the offer (what was done)', keep: () => true },
    { name: 'Skip Sure Things & Sleeping Dogs', description: 'No offer for customers who buy anyway or are put off by offers', keep: (t) => t !== 'sure' && t !== 'dog' },
    { name: 'Target Persuadables only', description: 'Only customers who buy because of the offer', keep: (t) => t === 'persuadable' },
  ];
  const acc = strategies.map(() => ({ targeted: 0, cost: 0, net: 0 }));
  for (const [cid, rows] of perCustomer) {
    const t = typeOf.get(cid);
    if (!t) continue;
    strategies.forEach((s, k) => {
      if (!s.keep(t)) return;
      for (const r of rows) { acc[k].targeted++; acc[k].cost += r.discountCost; acc[k].net += r.incMargin; }
    });
  }
  return strategies.map((s, k) => ({ name: s.name, description: s.description, targeted: acc[k].targeted, discountCost: acc[k].cost, incMargin: acc[k].net, roi: acc[k].cost ? acc[k].net / acc[k].cost : 0 }));
}
