// Budget planning for a chosen product range (overall, a brand, a brand's category, or one SKU).
//
// Every promotion in the data ran category-wide, so customer response is measured at customer type x category, not per SKU.
// Following the "estimate low, pool up, decide in between" pattern (docs/Behaviour driven budget optimization.md):
//   1. Decide at customer type x category: the optimiser chooses who gets which offer, as before.
//   2. Scope: when the offer runs on only part of a category (one brand's SKUs, or one SKU), the category's expected money
//      (investment, incremental revenue, incremental margin, extra buyers, units) is scaled by that range's share of the
//      category's regular sales. Buying chances, uplift and ROI are the category's, so eligibility rules are unchanged.
//   3. Roll down: each funded category allocation is split across the SKUs in range by the same shares, so SKU, category
//      and brand totals add up exactly to the plan.
// Limitation (stated in the UI): switching between our own SKUs during a single-SKU offer is not modelled, because no
// single-SKU promotion exists in the data to measure it.
import { MIN_SEG_UPLIFT, objectiveValue, type CategoryPrediction, type SegPromo } from './targeting.ts';
import { qualifies, type Allocation, type OptItem, type Plan } from './optimizer.ts';
import type { Sku } from './products.ts';
import type { TypeId } from './behaviour.ts';
import type { Campaign } from './data.ts';
import type { CampaignResult } from './campaigns.ts';
import { TYPE_IDS } from './insights.ts';
import { inr, int, pct } from '../lib/fmt.ts';

/** The category's expected money for an offer, scaled to the part of the category the offer runs on */
export function scaleCell(c: SegPromo, share: number): SegPromo {
  if (share === 1) return c;
  return {
    ...c,
    incBuyers: c.incBuyers * share, units: c.units * share, incUnits: c.incUnits * share, revenue: c.revenue * share,
    incRevenue: c.incRevenue * share, investment: c.investment * share, subsidy: c.subsidy * share, incMargin: c.incMargin * share,
    margin: c.margin * share, stockRisk: c.stockRisk * share,
  };
}

/** in-range share of each category's regular sales */
export function rangeShares(range: Sku[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of range) m.set(s.category, (m.get(s.category) ?? 0) + s.share);
  return m;
}

/** One optimiser item per customer type x category in range, with the category's economics scaled to the range */
export function rangeItems(range: Sku[], predictionFor: (category: string) => CategoryPrediction): OptItem[] {
  const out: OptItem[] = [];
  for (const [category, share] of rangeShares(range)) {
    if (share <= 0) continue;
    const P = predictionFor(category);
    for (const t of TYPE_IDS) out.push({ id: `${t}|${category}`, type: t, category, members: P.members.get(t)!, cells: P.cells.get(t)!.map((c) => scaleCell(c, share)) });
  }
  return out;
}

export interface SkuAllocation {
  sku: Sku;
  type: TypeId;
  offer: string;
  spend: number;
  incRevenue: number;
  incMargin: number;
  incBuyers: number;
}

/** Split every funded allocation across the SKUs in range by their share of the in-range category sales. Sums to the plan. */
export function rollDown(plan: Plan, range: Sku[]): SkuAllocation[] {
  const shares = rangeShares(range);
  const out: SkuAllocation[] = [];
  for (const a of plan.allocations) {
    const tot = shares.get(a.item.category) ?? 0;
    if (tot <= 0) continue;
    for (const sku of range) {
      if (sku.category !== a.item.category || sku.share <= 0) continue;
      const w = sku.share / tot;
      out.push({ sku, type: a.item.type, offer: a.cell.promo.label, spend: a.spend * w, incRevenue: a.incRevenue * w, incMargin: a.incMargin * w, incBuyers: a.incBuyers * w });
    }
  }
  return out;
}

// ------------------------------------------------------------------------ business as usual (what past practice would do)
/** The catalogue offer closest to a past campaign's mechanic (price cuts snap to the nearest 10 / 15 / 20 / 25%) */
export function pastOfferKey(c: Campaign): string {
  switch (c.mechanic) {
    case 'PCT_OFF': return `pct${[10, 15, 20, 25].reduce((a, b) => (Math.abs(b - c.depth) < Math.abs(a - c.depth) ? b : a))}`;
    case 'FLAT_OFF': return 'flat';
    case 'BOGO': return 'bogo';
    case 'B1G1_50': return 'b1g1_50';
    case 'MULTIBUY_3FOR2': return 'multibuy';
    case 'TIERED': return 'tiered';
    case 'COMBO': return 'combo';
    case 'CASHBACK': return 'cashback';
    default: return '';
  }
}

export interface PastCategory {
  category: string;
  pastSpend: number; // ACTUAL promo investment of past campaigns, scaled to the products in range
  pastRoi: number; // ACTUAL ROI of past campaigns in the category (whole category)
  offer: string; // the offer past campaigns put the most money into
  allotted: number; // this budget, split like past spend
  spend: number; // what that offer sent to everyone can absorb (<= allotted)
  incRevenue: number;
  incMargin: number;
  incBuyers: number;
}
export interface PastPlan { rows: PastCategory[]; spend: number; incRevenue: number; incMargin: number; incBuyers: number; roi: number; unspent: number }

/**
 * Business as usual: split the budget across categories the way past promotions were funded (actual promo investment), and in
 * each category send the offer that got the most past money to EVERY customer, as past campaigns did (no targeting, no
 * holdout). Its expected results come from the same prediction rules as the recommended plan, so the two compare like for like.
 */
export function pastPractice(results: CampaignResult[], items: OptItem[], range: Sku[], budget: number): PastPlan {
  const shares = rangeShares(range);
  const cats = [...new Set(items.map((i) => i.category))];
  const rows0 = cats.map((category) => {
    const past = results.filter((r) => r.campaign.category === category);
    const byOffer = new Map<string, number>();
    for (const r of past) { const k = pastOfferKey(r.campaign); byOffer.set(k, (byOffer.get(k) ?? 0) + r.discountCost); }
    const offerKey = [...byOffer].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const cost = past.reduce((t, r) => t + r.discountCost, 0);
    return { category, offerKey, pastSpend: cost * (shares.get(category) ?? 0), pastRoi: cost > 0 ? past.reduce((t, r) => t + r.incMargin, 0) / cost : 0 };
  });
  const totalPast = rows0.reduce((t, r) => t + r.pastSpend, 0);
  const rows: PastCategory[] = rows0.map((r) => {
    const cells = items.filter((i) => i.category === r.category).map((i) => i.cells.find((c) => c.promo.key === r.offerKey)).filter((c): c is SegPromo => !!c);
    const full = cells.reduce((t, c) => t + c.investment, 0);
    const allotted = totalPast > 0 ? (budget * r.pastSpend) / totalPast : 0;
    const cov = full > 0 ? Math.min(1, allotted / full) : 0;
    const add = (f: (c: SegPromo) => number) => cells.reduce((t, c) => t + f(c), 0) * cov;
    return {
      category: r.category, pastSpend: r.pastSpend, pastRoi: r.pastRoi, offer: cells[0]?.promo.label ?? 'No past promotion', allotted,
      spend: add((c) => c.investment), incRevenue: add((c) => c.incRevenue), incMargin: add((c) => c.incMargin), incBuyers: add((c) => c.incBuyers),
    };
  });
  const sum = (f: (r: PastCategory) => number) => rows.reduce((t, r) => t + f(r), 0);
  const spend = sum((r) => r.spend);
  return { rows, spend, incRevenue: sum((r) => r.incRevenue), incMargin: sum((r) => r.incMargin), incBuyers: sum((r) => r.incBuyers), roi: spend > 0 ? sum((r) => r.incMargin) / spend : 0, unspent: budget - spend };
}

// ------------------------------------------------------------------------ why each category gets what it gets
export type CategoryStatus = 'funded' | 'capped' | 'raised' | 'outranked' | 'no-payback' | 'min-unmet';
export interface TypeReason { type: TypeId; funded: boolean; text: string }
export interface CategoryAdvice {
  category: string;
  status: CategoryStatus;
  spend: number; incRevenue: number; incMargin: number; incBuyers: number; roi: number;
  headline: string;
  points: string[];
  types: TypeReason[];
}

/** customer types in everyday words (the type names stay in the details) */
export const PLAIN_TYPE: Record<TypeId, string> = { persuadable: 'shoppers who buy only with an offer', sure: 'regular buyers', lost: 'rare buyers', dog: 'shoppers put off by offers' };
const per1 = (roi: number) => `₹${roi.toFixed(2)}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Plain-language reasons built from exactly the rules the optimiser applies (qualifies): which customer types get which offer,
 * why the others get nothing, and whether a spending limit changed the answer. `free` is the same plan without limits.
 */
export function explainPlan(plan: Plan, free: Plan | null, items: OptItem[]): CategoryAdvice[] {
  const s = plan.settings;
  const keep = 1 - s.holdout;
  const cats = [...new Set(items.map((i) => i.category))];
  return cats.map((category): CategoryAdvice => {
    const its = items.filter((i) => i.category === category && i.members.length);
    const allocs = plan.allocations.filter((a) => a.item.category === category);
    const sum = (f: (a: Allocation) => number) => allocs.reduce((t, a) => t + f(a), 0);
    const spend = sum((a) => a.spend), incMargin = sum((a) => a.incMargin);
    const issue = plan.limitIssues.find((x) => x.category === category);
    const lim = s.limits?.[category];
    const freeSpend = free ? free.allocations.filter((a) => a.item.category === category).reduce((t, a) => t + a.spend, 0) : spend;
    const contactable = (i: OptItem) => i.type !== 'dog' || s.includeExcluded;
    const qual = its.filter(contactable).flatMap((i) => i.cells.filter((c) => qualifies(c, s)));

    const types: TypeReason[] = its.map((i) => {
      const a = allocs.find((x) => x.item.id === i.id);
      if (a) {
        const tested = a.cell.history ? '' : ' It has never run in this category, so its expected effect is cut by a quarter: try it on a small group first.';
        const part = a.coverage < 1 ? ` for ${pct(a.coverage)} of them (the budget${lim?.max != null ? ' or your limit' : ''} runs out before the rest)` : ' for all of them';
        return { type: i.type, funded: true, text: `${a.cell.promo.label}${part}. About ${Math.round(a.cell.uplift * 100)} more in every 100 are expected to buy, and each ₹1 comes back plus ${per1(a.roi)} of extra margin.${tested}` };
      }
      if (!contactable(i)) return { type: i.type, funded: false, text: 'No offer: promotions put them off, so they buy less while one runs.' };
      const usable = i.cells.filter((c) => c.eligible.ok && s.allowed(c.promo) && c.investment > 0);
      const ok = usable.filter((c) => qualifies(c, s));
      if (ok.length) {
        const b = ok.reduce((x, y) => (y.roi > x.roi ? y : x));
        const capped = issue?.kind === 'max-binding' && freeSpend > spend + 2 * plan.unit;
        return { type: i.type, funded: false, text: capped ? `No offer: their best option (${b.promo.label}) would take the category past your limit.` : `No offer: their best option (${b.promo.label}, ${per1(b.roi)} per ₹1) earns less than where the money went.` };
      }
      const moves = usable.filter((c) => c.uplift >= MIN_SEG_UPLIFT);
      if (!moves.length) {
        const top = usable.reduce<SegPromo | null>((x, y) => (!x || y.uplift > x.uplift ? y : x), null);
        return { type: i.type, funded: false, text: `No offer: no promotion changes whether they buy${top ? ` (at best ${Math.max(0, Math.round(top.uplift * 100))} more in every 100)` : ''}, so a discount would mostly go on sales that ${i.type === 'sure' ? 'happen anyway' : 'would not happen either way'}.` };
      }
      const b = moves.reduce((x, y) => (y.roi > x.roi ? y : x));
      return { type: i.type, funded: false, text: b.incMargin <= 0 ? `No offer: promotions would win some buyers but lose money (best: ${b.promo.label}).` : `No offer: the best option (${b.promo.label}) earns ${per1(b.roi)} per ₹1, below your minimum of ${per1(s.hurdle)}.` };
    });

    // response is not profit: the offer that wins the most buyers is often not the one that pays
    const points: string[] = [];
    const chosen = new Set(allocs.map((a) => a.cell.promo.key));
    const byKey = new Map<string, { label: string; buyers: number; margin: number; inv: number }>();
    for (const i of its.filter(contactable)) for (const c of i.cells) {
      if (!c.eligible.ok || !s.allowed(c.promo) || c.investment <= 0) continue;
      const r = byKey.get(c.promo.key) ?? { label: c.promo.label, buyers: 0, margin: 0, inv: 0 };
      r.buyers += c.incBuyers; r.margin += c.incMargin; r.inv += c.investment;
      byKey.set(c.promo.key, r);
    }
    const most = [...byKey.entries()].sort((a, b) => b[1].buyers - a[1].buyers)[0];
    if (most && !chosen.has(most[0]) && most[1].buyers >= 1) {
      const r = most[1].inv > 0 ? most[1].margin / most[1].inv : 0;
      if (r < s.hurdle || most[1].margin <= 0) points.push(`${most[1].label} would attract the most extra buyers (${int(most[1].buyers)}) but ${most[1].margin <= 0 ? 'loses money' : `earns only ${per1(r)} per ₹1`}, so it is not recommended.`);
    }

    let status: CategoryStatus;
    let headline: string;
    const roi = spend > 0 ? incMargin / spend : 0;
    if (issue?.kind === 'min-unreachable') {
      status = 'min-unmet';
      headline = `Your minimum of ${inr(issue.limit)} can't be reached: only ${inr(issue.possible)} of offers here earn back their cost plus your minimum return.`;
    } else if (issue?.kind === 'max-binding' && freeSpend > spend + 2 * plan.unit) {
      status = 'capped';
      headline = `Held to your ${inr(issue.limit)} limit. Without it, this category would get ${inr(freeSpend)}, because more money here would still pay off.`;
    } else if (lim?.min && spend > freeSpend + 2 * plan.unit) {
      status = 'raised';
      headline = `Raised to your ${inr(lim.min)} minimum. On returns alone it would get ${inr(freeSpend)}; the extra earns less than it would elsewhere.`;
    } else if (allocs.length) {
      status = 'funded';
      const byOffer = new Map<string, string[]>();
      for (const a of allocs) byOffer.set(a.cell.promo.label, [...(byOffer.get(a.cell.promo.label) ?? []), PLAIN_TYPE[a.item.type]]);
      headline = `${[...byOffer].map(([o, who]) => `${o} for ${list(who)}`).join('; ')}. Each ₹1 spent comes back plus ${per1(roi)} of extra margin.`;
    } else if (qual.length) {
      status = 'outranked';
      const best = qual.reduce((x, y) => (y.roi > x.roi ? y : x));
      const cheapest = Math.min(...qual.map((c) => c.investment * 0.25 * keep));
      headline = s.budget - plan.spend < cheapest
        ? `Not funded: its best offer (${best.promo.label}) earns ${per1(best.roi)} per ₹1, less than the categories that got the money first, and the budget ran out.`
        : `Not funded: its best offer (${best.promo.label}) earns ${per1(best.roi)} per ₹1, less than the categories that got the money.`;
    } else {
      status = 'no-payback';
      headline = `Not funded: no offer here earns back its cost plus your minimum of ${per1(s.hurdle)} per ₹1.`;
    }
    return { category, status, spend, incRevenue: sum((a) => a.incRevenue), incMargin, incBuyers: sum((a) => a.incBuyers), roi, headline, points, types };
  });
}

/** Why part of the budget is left unallocated, in one sentence */
export function unallocated(plan: Plan, free: Plan | null): { amount: number; text: string } {
  const budget = plan.settings.budget;
  const left = Math.max(0, budget - plan.spend);
  if (left <= Math.max(2 * plan.unit, budget * 0.01)) return { amount: left, text: 'The whole budget is used.' };
  if (free && free.spend > plan.spend + 2 * plan.unit) return { amount: left, text: `Your category limits hold it back. Without them the plan would spend ${inr(free.spend)}.` };
  const value = plan.allocations.reduce((t, a) => t + objectiveValue(a, plan.settings.objective), 0);
  if (value >= 0.98 * plan.maxUsefulValue - 1e-6) return { amount: left, text: `Every offer that earns at least ${per1(plan.settings.hurdle)} per ₹1 is already funded. Spending more would earn less than it costs.` };
  return { amount: left, text: `It is too small for the next worthwhile roll-out (offers go to a quarter of a customer group at a time).` };
}
