// Rule-based planning: scores every upcoming campaign x offer scenario with the transparent simulation and recommends
// who to target and which promotion to run. Rule: run the promotion with the highest incremental profit, only for
// customers where the offer adds more profit than it costs (Persuadables). No promotion adds profit -> do not discount.
import type { TypeId } from './behaviour.ts';
import type { CampaignResult } from './campaigns.ts';
import { dayOf, isoOf, type Dataset } from './data.ts';
import { expect, type Expectation, type Offer } from './economics.ts';
import { TYPE_IDS, type CustomerRecord } from './insights.ts';
import { DEFAULT_ASSUMPTIONS, makeCtx, type Assumptions, type Ctx } from './simulation.ts';
import { offerOf, promoOptions, type PromoOption } from './options.ts';

export interface Candidate {
  id: string;
  name: string;
  category: string;
  start: string; // ISO
  days: number;
  theme: string;
}

// Planned slots for the next quarter (calendar input, not part of the CSV)
export const CANDIDATES: Candidate[] = [
  { id: 'UP01', name: 'Festive Clean-Up', category: 'Household', start: '2026-10-12', days: 14, theme: 'Pre-Diwali cleaning peak' },
  { id: 'UP02', name: 'Diwali Beverage Fest', category: 'Beverages', start: '2026-10-26', days: 14, theme: 'Diwali (8 Nov)' },
  { id: 'UP03', name: 'Diwali Snack Box', category: 'Snacks', start: '2026-10-30', days: 14, theme: 'Gifting and guests' },
  { id: 'UP04', name: 'Winter Warm-Up Breakfast', category: 'Breakfast', start: '2026-11-16', days: 14, theme: 'Cold-season breakfast' },
  { id: 'UP05', name: 'Dairy Winter Fest', category: 'Dairy', start: '2026-11-23', days: 14, theme: 'Winter dairy demand' },
  { id: 'UP06', name: 'Year-End Glow', category: 'Personal Care', start: '2026-12-14', days: 14, theme: 'Party season' },
];

/** A customer is only worth an offer if it lifts their purchase chance by at least this much (guards against noise) */
export const MIN_LIFT = 0.03;

export interface Audience {
  total: number;
  targeted: number;
  byType: Record<TypeId, { total: number; targeted: number }>;
}

export interface Scenario {
  option: PromoOption;
  audience: Audience;
  buyers: number; // expected buyers among targeted
  incrementalBuyers: number;
  units: number;
  revenue: number;
  discountCost: number;
  leakage: number;
  net: number;
  roi: number;
  /** the promotion that draws the highest response when offered to everyone */
  /** same offer pushed to every active customer */
  blanket: { customers: number; buyers: number; incBuyers: number; revenue: number; discountCost: number; net: number; roi: number; leakage: number };
}

export interface Recommendation {
  candidate: Candidate;
  scenarios: Scenario[];
  best: Scenario | null;
  confidence: number; // 0-100: how much past campaign history in this category the rules can draw on
  flag: 'ready' | 'attention';
  flagReason?: string;
  rationale: string[];
  /** per customer expectation under the best (or fallback) option */
  expectations: Map<string, Expectation>;
}

export function activeAt(ds: Dataset, asOf: number): string[] {
  return ds.customers.filter((cid) => {
    const l = ds.byCustomer.get(cid)!;
    let last = -Infinity;
    for (let i = l.length - 1; i >= 0; i--) if (l[i].day < asOf) { last = l[i].day; break; }
    return last >= asOf - 90;
  });
}

export function evaluateScenario(
  ds: Dataset, ctxs: Ctx[], typeOf: Map<string, TypeId>, offer: Offer, A: Assumptions = DEFAULT_ASSUMPTIONS,
  filter: (e: Expectation, t: TypeId) => boolean = (e) => e.net > 0 && e.uplift >= MIN_LIFT,
): { scenario: Omit<Scenario, 'option'>; expectations: Map<string, Expectation> } {
  const byType = Object.fromEntries(TYPE_IDS.map((t) => [t, { total: 0, targeted: 0 }])) as Audience['byType'];
  const expectations = new Map<string, Expectation>();
  let buyers = 0, inc = 0, units = 0, revenue = 0, cost = 0, leak = 0, net = 0, targeted = 0;
  let bCost = 0, bNet = 0, bLeak = 0, bRev = 0, bBuy = 0, bInc = 0;
  for (const ctx of ctxs) {
    const e = expect(ds, ctx, offer, A);
    expectations.set(ctx.cid, e);
    const t = typeOf.get(ctx.cid)!;
    byType[t].total++;
    bCost += e.discountCost;
    bNet += e.net;
    bLeak += e.leakage;
    bRev += e.revenue;
    bBuy += e.p1;
    bInc += e.uplift;
    if (filter(e, t)) {
      byType[t].targeted++;
      targeted++;
      buyers += e.p1;
      inc += e.uplift;
      units += e.units;
      revenue += e.revenue;
      cost += e.discountCost;
      leak += e.leakage;
      net += e.net;
    }
  }
  return {
    scenario: {
      audience: { total: ctxs.length, targeted, byType },
      buyers, incrementalBuyers: inc, units, revenue, discountCost: cost, leakage: leak, net,
      roi: cost ? net / cost : 0,
      blanket: { customers: ctxs.length, buyers: bBuy, incBuyers: bInc, revenue: bRev, discountCost: bCost, net: bNet, roi: bCost ? bNet / bCost : 0, leakage: bLeak },
    },
    expectations,
  };
}

export function buildCtxs(ds: Dataset, cids: string[], cat: string, asOf: number): Ctx[] {
  return cids.map((cid) => makeCtx(ds, cid, cat, asOf));
}

export function recommend(
  ds: Dataset, recs: CustomerRecord[], asOf: number, A: Assumptions = DEFAULT_ASSUMPTIONS,
): Recommendation[] {
  const typeOf = new Map(recs.map((r) => [r.cid, r.type]));
  const active = activeAt(ds, asOf);
  const out: Recommendation[] = [];
  for (const cand of CANDIDATES) {
    const ctxs = buildCtxs(ds, active, cand.category, asOf);
    const scenarios: Scenario[] = [];
    const allExp = new Map<string, Map<string, Expectation>>();
    for (const option of promoOptions(ds, cand.category).filter((o) => o.family !== 'none')) {
      const { scenario, expectations } = evaluateScenario(ds, ctxs, typeOf, offerOf(option, cand.category), A);
      scenarios.push({ option, ...scenario });
      allExp.set(option.key, expectations);
    }
    const positive = scenarios.filter((s) => s.net > 0 && s.audience.targeted >= 20);
    const best = positive.length ? positive.reduce((a, b) => (b.net > a.net ? b : a)) : null;
    const hist = ds.campaigns.filter((c) => c.category === cand.category).length;
    // Confidence reflects how much earlier campaign history exists in this category (rules, not a fitted model)
    const confidence = Math.min(92, 45 + 12 * hist);
    const rationale: string[] = [];
    let flag: Recommendation['flag'] = 'ready';
    let flagReason: string | undefined;
    if (best) {
      const bt = best.audience.byType;
      const excluded = TYPE_IDS.filter((t) => bt[t].total > 0 && bt[t].targeted / bt[t].total < 0.25);
      const core = TYPE_IDS.filter((t) => bt[t].targeted / Math.max(1, best.audience.targeted) >= 0.25);
      rationale.push(`${Math.round((best.audience.targeted / best.audience.total) * 100)}% of ${best.audience.total} active customers are worth an offer; about ${Math.round(best.incrementalBuyers)} extra buyers are expected because of the discount (uplift).`);
      if (excluded.length) rationale.push(`Hold back ${excluded.map((t) => TYPE_LABEL[t]).join(', ')}: a broad version of this offer would give away about ${fmtMoney(best.blanket.leakage - best.leakage)} more on purchases that happen anyway.`);
      if (core.length) rationale.push(`Core audience: ${core.map((t) => TYPE_LABEL[t]).join(' and ')}.`);
      const alt = [...scenarios].sort((a, b) => b.net - a.net).find((s) => s.option.key !== best.option.key && s.net > 0);
      if (alt) rationale.push(`${alt.option.label} was the next best option (${fmtMoney(alt.net)} net vs ${fmtMoney(best.net)}).`);
      if (best.roi < 0.65 || best.net < 2500) { flag = 'attention'; flagReason = `Expected return is thin (ROI ${best.roi.toFixed(2)}, net ${fmtMoney(best.net)}); validate with a small test first.`; }
      else if (hist < 2) { flag = 'attention'; flagReason = `Only ${hist} earlier ${cand.category} campaign${hist === 1 ? '' : 's'} to learn from.`; }
    } else {
      flag = 'attention';
      flagReason = 'No discount level beats the no-promotion baseline for this category.';
      rationale.push(`Across all offer types the incremental profit is negative for the audience as a whole. Consider a non-price trigger (sampling, loyalty points) for this slot.`);
    }
    out.push({
      candidate: cand, scenarios, best, confidence, flag, flagReason, rationale,
      expectations: allExp.get((best ?? scenarios.reduce((a, b) => (b.net > a.net ? b : a))).option.key)!,
    });
  }
  return out;
}

const TYPE_LABEL: Record<TypeId, string> = {
  persuadable: 'Persuadables', sure: 'Sure Things', lost: 'Lost Causes', dog: 'Sleeping Dogs',
};
export const fmtMoney = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(2)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(2)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${Math.round(a)}`;
  return `${v < 0 ? '-' : ''}₹${s}`;
};

// ------------------------------------------------------------------------ alerts
export interface Alert {
  id: string;
  severity: 'high' | 'medium' | 'info';
  title: string;
  detail: string;
  action: string;
}

export function watchdog(
  ds: Dataset, results: CampaignResult[], recs: CustomerRecord[], asOf: number,
): Alert[] {
  const alerts: Alert[] = [];
  const losing = results.filter((r) => r.roi < 0).sort((a, b) => a.netProfit - b.netProfit);
  if (losing.length) {
    const worst = losing[0];
    alerts.push({
      id: 'loss', severity: 'high',
      title: `${losing.length} of ${results.length} past promotions lost money`,
      detail: `Worst: ${worst.campaign.name} (${worst.campaign.depth}% ${mech(worst.campaign.mechanic)}) lost ${fmtMoney(-worst.netProfit)} after counting baseline sales and the post-promo dip.`,
      action: 'Avoid BOGO and multi-buy for broad audiences unless the margin supports the depth; reserve them for Persuadables who buy larger quantities.',
    });
  }
  const leaky = results.filter((r) => r.leakagePct > 0.15);
  if (leaky.length) {
    const l = leaky.sort((a, b) => b.leakage - a.leakage)[0];
    alerts.push({
      id: 'leak', severity: 'medium',
      title: 'Subsidy: discount on baseline sales',
      detail: `${leaky.length} campaign${leaky.length > 1 ? 's' : ''} gave over 15% of the discount to units that would have sold anyway. Highest: ${l.campaign.name} at ${Math.round(l.leakagePct * 100)}%.`,
      action: 'Exclude Sure Things from the offer list.',
    });
  }
  const sure = recs.filter((r) => r.type === 'sure').length;
  alerts.push({
    id: 'sure', severity: 'info',
    title: `${sure} Sure Things buy regardless of promotions`,
    detail: `They make up ${Math.round((sure / recs.length) * 100)}% of the base, and each broad offer gives away margin on their normal basket.`,
    action: 'Switch them to loyalty rewards.',
  });
  const dogs = recs.filter((r) => r.type === 'dog').length;
  if (dogs)
    alerts.push({
      id: 'dog', severity: 'medium',
      title: `${dogs} Sleeping Dogs (Do Not Disturb) buy less when an offer runs`,
      detail: 'They buy our brand regularly, but their volume drops during promotion windows.',
      action: 'Exclude them from every promotion list and contact them with non-price messages only.',
    });
  // fatigue: response of persuadables over time
  const deal = results.map((r) => (r.byType.persuadable.customers ? r.byType.persuadable.buyers / r.byType.persuadable.customers : 0));
  if (deal.length >= 6) {
    const first = deal.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
    const last = deal.slice(-3).reduce((s, v) => s + v, 0) / 3;
    if (last < first - 0.08)
      alerts.push({
        id: 'fatigue', severity: 'medium',
        title: 'Persuadable response is fading',
        detail: `Average response fell from ${Math.round(first * 100)}% (first 3 campaigns) to ${Math.round(last * 100)}% (last 3).`,
        action: 'Rotate mechanics and avoid back-to-back offers in the same category.',
      });
  }
  const dip = results.reduce((s, r) => s + Math.max(0, r.byType.persuadable.pullForwardUnits), 0);
  if (dip > 20)
    alerts.push({
      id: 'pull', severity: 'info',
      title: 'Multi-buy offers borrow from future sales',
      detail: `About ${Math.round(dip)} units were missing from Persuadables in the three weeks after their promotions.`,
      action: 'Judge multi-buy offers on net units, not window units.',
    });
  const lapsed = recs.filter((r) => r.b.recencyDays > 45 && r.b.nOrders >= 8).length;
  if (lapsed)
    alerts.push({
      id: 'lapsed', severity: 'medium',
      title: `${lapsed} regular customers have gone quiet`,
      detail: 'They ordered at least 8 times but nothing in the last 45 days.',
      action: 'A win-back offer is a better use of budget than a category discount.',
    });
  void asOf;
  return alerts;
}
const mech = (m: string) => (m === 'BOGO' ? 'BOGO' : m === 'MULTIBUY_3FOR2' ? 'bundle' : m === 'FLAT_OFF' ? 'flat off' : 'off');

export { dayOf, isoOf };
