// What did each past promotion actually deliver?  Baseline = what each customer was already buying at full price;
// uplift = promoted sales above that baseline, after the dip once the promotion ends. Measured from actual orders.
import { baselineRate, cutIndex } from './behaviour.ts';
import type { TypeId } from './behaviour.ts';
import type { Campaign, Dataset } from './data.ts';

export interface Slice {
  customers: number; // customers reached (active)
  buyers: number; // bought on promo
  units: number;
  revenue: number;
  discountCost: number;
  baselineUnits: number;
  incUnits: number;
  leakage: number;
  pullForwardUnits: number; // units missing in 21 days after the window
  windowMargin: number; // gross margin earned on promoted units
  baseMargin: number; // margin those customers would have earned at full price anyway
  dipMargin: number; // margin lost in the 21 days after (negative = lost)
  netProfit: number;
}
const emptySlice = (): Slice => ({
  customers: 0, buyers: 0, units: 0, revenue: 0, discountCost: 0, baselineUnits: 0, incUnits: 0, leakage: 0,
  pullForwardUnits: 0, windowMargin: 0, baseMargin: 0, dipMargin: 0, netProfit: 0,
});

export interface CampaignResult extends Slice {
  campaign: Campaign;
  respRate: number;
  leakagePct: number; // share of discount spend given to units that would sell anyway
  roi: number; // net profit / discount cost
  byType: Record<TypeId, Slice>;
  verdict: 'Scale' | 'Optimise' | 'Stop';
}

export interface CustomerCampaign {
  cid: string;
  campaignId: string;
  revenue: number; // cash received on promoted units
  grossProfit: number; // price paid minus unit cost on promoted units
  pullForwardUnits: number; // units missing in the weeks after (the dip)
  active: boolean;
  bought: boolean;
  units: number;
  baselineUnits: number;
  incUnits: number;
  discountCost: number;
  leakage: number;
  net: number;
}

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
    const rows: CustomerCampaign[] = [];
    for (const cid of ds.customers) {
      const lines = ds.byCustomer.get(cid)!;
      const i0 = cutIndex(lines, c.start - 90);
      const i1 = cutIndex(lines, c.start);
      const active = i1 > i0 || lines[0].day >= c.start - 90;
      if (!active || lines[0].day > c.end) continue;
      let A = 0, rev = 0, marg = 0, disc = 0, P = 0;
      let bought = false;
      for (let i = cutIndex(lines, c.start); i < lines.length && lines[i].day <= c.end + 21; i++) {
        const l = lines[i];
        if (l.category !== c.category || !l.ours) continue;
        if (l.day <= c.end) {
          A += l.qty;
          rev += l.unit * l.qty;
          marg += (l.unit - l.cost) * l.qty;
          disc += (l.list - l.unit) * l.qty;
          if (l.promoId === c.id) bought = true;
        } else P += l.qty;
      }
      const b = baselineRate(ds, lines, c.category, c.start);
      const B = b * len;
      const postKnown = c.end + 21 <= ds.maxDay;
      const dip = postKnown ? b * 21 - P : 0;
      const inc = A - B;
      const leakShare = A > 0 ? Math.min(A, B) / A : 0;
      const net = marg - B * mFull - dip * mFull;
      const slice = [tot, byType[typeOf.get(cid) ?? 'lost']];
      for (const s of slice) {
        s.customers++;
        if (bought) s.buyers++;
        s.units += A;
        s.revenue += rev;
        s.discountCost += disc;
        s.baselineUnits += B;
        s.incUnits += inc;
        s.leakage += disc * leakShare;
        s.pullForwardUnits += dip;
        s.windowMargin += marg;
        s.baseMargin += B * mFull;
        s.dipMargin -= dip * mFull;
        s.netProfit += net;
      }
      rows.push({ cid, campaignId: c.id, revenue: rev, grossProfit: marg, pullForwardUnits: dip, active, bought, units: A, baselineUnits: B, incUnits: inc, discountCost: disc, leakage: disc * leakShare, net });
      let arr = perCustomer.get(cid);
      if (!arr) perCustomer.set(cid, (arr = []));
      arr.push(rows[rows.length - 1]);
    }
    const roi = tot.discountCost > 0 ? tot.netProfit / tot.discountCost : 0;
    results.push({
      ...tot,
      campaign: c,
      respRate: tot.customers ? tot.buyers / tot.customers : 0,
      leakagePct: tot.discountCost ? tot.leakage / tot.discountCost : 0,
      roi,
      byType,
      verdict: roi >= 0.5 ? 'Scale' : roi >= 0 ? 'Optimise' : 'Stop',
    });
  }
  return { results, perCustomer };
}

export interface StrategyResult {
  name: string;
  description: string;
  targeted: number;
  discountCost: number;
  netProfit: number;
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
      for (const r of rows) { acc[k].targeted++; acc[k].cost += r.discountCost; acc[k].net += r.net; }
    });
  }
  return strategies.map((s, k) => ({ name: s.name, description: s.description, targeted: acc[k].targeted, discountCost: acc[k].cost, netProfit: acc[k].net, roi: acc[k].cost ? acc[k].net / acc[k].cost : 0 }));
}
