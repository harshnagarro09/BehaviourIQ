// What did each past promotion REALLY deliver?  Incrementality = actual sales minus what each customer
// was already buying at full price (their own baseline), including the dip after the promotion ends.
import { baselineRate, cutIndex } from './behaviour.ts';
import type { TypeId } from './behaviour.ts';
import type { Campaign, Dataset } from './data.ts';
import { expect } from './economics.ts';
import { makeCtx, type TrainedModel } from './model.ts';

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
  const types: TypeId[] = ['anyways', 'deal', 'stockup', 'switcher', 'ignores'];
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
      const slice = [tot, byType[typeOf.get(cid) ?? 'ignores']];
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
      rows.push({ cid, campaignId: c.id, active, bought, units: A, baselineUnits: B, incUnits: inc, discountCost: disc, leakage: disc * leakShare, net });
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
 * Backtest on the held-out campaigns: the model is fitted on data BEFORE them and then decides who
 * to target. Realised profit comes from what those customers actually did.
 * Assumption: customers who are not targeted behave exactly at their baseline (no discount, no uplift).
 */
export function backtest(
  ds: Dataset, model: TrainedModel, perCustomer: Map<string, CustomerCampaign[]>, typeOf: Map<string, TypeId>,
): StrategyResult[] {
  const testCamps = ds.campaigns.filter((c) => c.start >= model.splitDay);
  const strategies = [
    { name: 'Discount everyone', description: 'Broad offer to every active customer', pick: () => true },
    { name: 'Skip Buys-anyways & Ignores', description: 'Rule based on consumer type: no offer for customers who need no push or will not respond', pick: 'type' as const },
    { name: 'Target likely buyers', description: 'Top half by predicted purchase probability', pick: 'propensity' as const },
    { name: 'Target persuadable customers', description: 'Only where the model predicts the discount earns more profit than it costs', pick: 'net' as const },
  ];
  const acc = strategies.map(() => ({ targeted: 0, cost: 0, net: 0 }));
  for (const c of testCamps) {
    const rows: { r: CustomerCampaign; p1: number; net: number; uplift: number }[] = [];
    for (const cid of ds.customers) {
      const r = perCustomer.get(cid)?.find((x) => x.campaignId === c.id);
      if (!r) continue;
      const ctx = makeCtx(ds, cid, c.category, c.start);
      const e = expect(ds, model.holdout, ctx, { category: c.category, depth: c.depth, mechanic: c.mechanic, minSpend: c.minSpend });
      rows.push({ r, p1: e.p1, net: e.net, uplift: e.uplift });
    }
    const sorted = [...rows].sort((a, b) => b.p1 - a.p1);
    const topHalf = new Set(sorted.slice(0, Math.ceil(rows.length / 2)).map((x) => x.r.cid));
    strategies.forEach((s, k) => {
      for (const x of rows) {
        const t = typeOf.get(x.r.cid);
        const take = s.pick === 'propensity' ? topHalf.has(x.r.cid) : s.pick === 'net' ? (x.net > 0 && x.uplift >= 0.03) : s.pick === 'type' ? t !== 'anyways' && t !== 'ignores' : true;
        if (!take) continue;
        acc[k].targeted++;
        acc[k].cost += x.r.discountCost;
        acc[k].net += x.r.net;
      }
    });
  }
  return strategies.map((s, k) => ({
    name: s.name,
    description: s.description,
    targeted: acc[k].targeted,
    discountCost: acc[k].cost,
    netProfit: acc[k].net,
    roi: acc[k].cost ? acc[k].net / acc[k].cost : 0,
  }));
}

export interface ValidationRow {
  campaign: Campaign;
  reached: number;
  targeted: number;
  predNet: number; // what the model expected the targeted customers to earn
  realNet: number; // what they actually earned
  predBuyers: number;
  realBuyers: number;
  cost: number;
  roi: number;
  skippedNet: number; // what the customers the model skipped would have earned if they had been offered
  broadNet: number; // offering everyone
  broadCost: number;
}

/**
 * Per held-out campaign: the model (fitted only on earlier data) picks who to target; we compare what it
 * predicted with what happened, and compare against offering everyone.
 */
export function validationByCampaign(ds: Dataset, model: TrainedModel, perCustomer: Map<string, CustomerCampaign[]>): ValidationRow[] {
  const out: ValidationRow[] = [];
  for (const c of ds.campaigns.filter((x) => x.start >= model.splitDay)) {
    const row: ValidationRow = { campaign: c, reached: 0, targeted: 0, predNet: 0, realNet: 0, predBuyers: 0, realBuyers: 0, cost: 0, roi: 0, skippedNet: 0, broadNet: 0, broadCost: 0 };
    for (const cid of ds.customers) {
      const r = perCustomer.get(cid)?.find((x) => x.campaignId === c.id);
      if (!r) continue;
      const e = expect(ds, model.holdout, makeCtx(ds, cid, c.category, c.start), { category: c.category, depth: c.depth, mechanic: c.mechanic, minSpend: c.minSpend });
      row.reached++;
      row.broadNet += r.net;
      row.broadCost += r.discountCost;
      if (e.net > 0 && e.uplift >= 0.03) {
        row.targeted++;
        row.predNet += e.net;
        row.realNet += r.net;
        row.predBuyers += e.p1;
        if (r.bought) row.realBuyers++;
        row.cost += r.discountCost;
      } else row.skippedNet += r.net;
    }
    row.roi = row.cost ? row.realNet / row.cost : 0;
    out.push(row);
  }
  return out;
}
