// Rule-based planning: scores every upcoming campaign x promotion scenario with the same customer-type prediction used on
// Customer Prediction, and recommends which promotion to run and which customer types to give it to.
// Rule: an offer goes to a customer type only if it lifts purchase probability by at least MIN_SEG_UPLIFT and its predicted
// ROI (incremental margin / promo investment) clears TARGET_HURDLE. Run the promotion with the highest incremental margin.
// No promotion clears the bar -> do not discount. Sleeping Dogs are never targeted.
import type { TypeId } from './behaviour.ts';
import type { CampaignResult } from './campaigns.ts';
import { dayOf, isoOf, type Dataset } from './data.ts';
import { TYPE_IDS, type CustomerRecord } from './insights.ts';
import { offerName } from './options.ts';
import type { PromoDef } from './promotions.ts';
import type { RespProfile } from './response.ts';
import { DEFAULT_ASSUMPTIONS, makeCtx, type Assumptions, type Ctx } from './simulation.ts';
import { predictCategory, worthTargeting, type SegPromo } from './targeting.ts';

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

export interface Audience {
  total: number;
  targeted: number;
  byType: Record<TypeId, { total: number; targeted: number }>;
}

/** One promotion offered to the customer types it pays off for */
export interface Scenario {
  option: PromoDef;
  audience: Audience;
  tested: boolean; // has this mechanic run in the category before
  buyers: number; // expected buyers among the targeted types
  incrementalBuyers: number; // uplift in buyers because of the offer
  units: number;
  revenue: number;
  incRevenue: number;
  discountCost: number; // promo investment
  leakage: number; // subsidy: investment on units that would sell anyway
  incMargin: number; // incremental margin: margin after the offer minus the baseline margin
  roi: number; // incremental margin / promo investment
  /** the same promotion sent to every active customer, with no targeting */
  blanket: { customers: number; buyers: number; incBuyers: number; revenue: number; incRevenue: number; discountCost: number; incMargin: number; roi: number; leakage: number };
}

export interface Recommendation {
  candidate: Candidate;
  scenarios: Scenario[];
  best: Scenario | null;
  confidence: number; // 0-100: how much past campaign history in this category the rules can draw on
  flag: 'ready' | 'attention';
  flagReason?: string;
  rationale: string[];
}

/** customers who ordered in the 90 days before `asOf` */
export function activeAt(ds: Dataset, asOf: number): string[] {
  return ds.customers.filter((cid) => {
    const l = ds.byCustomer.get(cid)!;
    let last = -Infinity;
    for (let i = l.length - 1; i >= 0; i--) if (l[i].day < asOf) { last = l[i].day; break; }
    return last >= asOf - 90;
  });
}

export function buildCtxs(ds: Dataset, cids: string[], cat: string, asOf: number): Ctx[] {
  return cids.map((cid) => makeCtx(ds, cid, cat, asOf));
}

const TYPE_LABEL: Record<TypeId, string> = {
  persuadable: 'Persuadables', sure: 'Sure Things', lost: 'Lost Causes', dog: 'Sleeping Dogs',
};
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Combine the per-type predictions of one promotion into a scenario. Only the types in `include` receive the offer. */
export function buildScenario(cells: SegPromo[], include: (c: SegPromo) => boolean = worthTargeting): Scenario {
  const sum = (cs: SegPromo[], f: (c: SegPromo) => number) => cs.reduce((t, c) => t + f(c), 0);
  const chosen = cells.filter(include);
  const byType = Object.fromEntries(cells.map((c) => [c.seg, { total: c.members, targeted: include(c) ? c.members : 0 }])) as Audience['byType'];
  const buyers = (c: SegPromo) => c.p1 * c.members;
  const inv = sum(chosen, (c) => c.investment);
  const incM = sum(chosen, (c) => c.incMargin);
  const bInv = sum(cells, (c) => c.investment);
  const bM = sum(cells, (c) => c.incMargin);
  return {
    option: cells[0].promo,
    audience: { total: sum(cells, (c) => c.members), targeted: sum(chosen, (c) => c.members), byType },
    tested: cells[0].history,
    buyers: sum(chosen, buyers),
    incrementalBuyers: sum(chosen, (c) => c.incBuyers),
    units: sum(chosen, (c) => c.units),
    revenue: sum(chosen, (c) => c.revenue),
    incRevenue: sum(chosen, (c) => c.incRevenue),
    discountCost: inv,
    leakage: sum(chosen, (c) => c.subsidy),
    incMargin: incM,
    roi: inv ? incM / inv : 0,
    blanket: {
      customers: sum(cells, (c) => c.members), buyers: sum(cells, buyers), incBuyers: sum(cells, (c) => c.incBuyers), revenue: sum(cells, (c) => c.revenue),
      incRevenue: sum(cells, (c) => c.incRevenue), discountCost: bInv, incMargin: bM, roi: bInv ? bM / bInv : 0, leakage: sum(cells, (c) => c.subsidy),
    },
  };
}

export function recommend(
  ds: Dataset, recs: CustomerRecord[], asOf: number, resp: Map<string, RespProfile>, A: Assumptions = DEFAULT_ASSUMPTIONS,
): Recommendation[] {
  const typeOf = new Map(recs.map((r) => [r.cid, r.type]));
  const active = new Set(activeAt(ds, asOf));
  const out: Recommendation[] = [];
  for (const cand of CANDIDATES) {
    const P = predictCategory(ds, typeOf, cand.category, asOf, resp, A, active);
    const scenarios: Scenario[] = [];
    P.promos.forEach((p, i) => {
      const cells = TYPE_IDS.map((t) => P.cells.get(t)![i]);
      if (cells[0].eligible.ok) scenarios.push(buildScenario(cells));
      void p;
    });
    const positive = scenarios.filter((s) => s.incMargin > 0 && s.audience.targeted >= 20);
    const best = positive.length ? positive.reduce((a, b) => (b.incMargin > a.incMargin ? b : a)) : null;
    const hist = ds.campaigns.filter((c) => c.category === cand.category).length;
    // Confidence reflects how much earlier campaign history exists in this category (rules, not a fitted model)
    const confidence = Math.min(92, 45 + 12 * hist);
    const rationale: string[] = [];
    let flag: Recommendation['flag'] = 'ready';
    let flagReason: string | undefined;
    if (best) {
      const bt = best.audience.byType;
      const targetedTypes = TYPE_IDS.filter((t) => bt[t].targeted > 0).map((t) => TYPE_LABEL[t]);
      const heldBack = TYPE_IDS.filter((t) => bt[t].total > 0 && bt[t].targeted === 0).map((t) => TYPE_LABEL[t]);
      rationale.push(`${Math.round((best.audience.targeted / best.audience.total) * 100)}% of ${best.audience.total} active customers (${list(targetedTypes)}) show a positive uplift: about ${Math.round(best.incrementalBuyers)} incremental buyers are expected because of the offer.`);
      if (heldBack.length) rationale.push(`Hold back ${list(heldBack)}: sending this offer to everyone would put about ${fmtMoney(best.blanket.leakage - best.leakage)} more promo investment into baseline sales that happen anyway.`);
      const alt = [...scenarios].sort((a, b) => b.incMargin - a.incMargin).find((s) => s.option.key !== best.option.key && s.incMargin > 0);
      if (alt) rationale.push(`${alt.option.label} was the next best option (${fmtMoney(alt.incMargin)} incremental margin vs ${fmtMoney(best.incMargin)}).`);
      if (!best.tested) { flag = 'attention'; flagReason = `${best.option.label} has not run in ${cand.category} before: the uplift is discounted by a quarter. Launch as a test with a holdout.`; }
      else if (best.roi < 0.65 || best.incMargin < 2500) { flag = 'attention'; flagReason = `Expected return is thin (ROI ${best.roi.toFixed(2)}, incremental margin ${fmtMoney(best.incMargin)}); validate with a small test first.`; }
      else if (hist < 2) { flag = 'attention'; flagReason = `Only ${hist} earlier ${cand.category} campaign${hist === 1 ? '' : 's'} to learn from.`; }
    } else {
      flag = 'attention';
      flagReason = 'No promotion pays back for this category and audience.';
      rationale.push('Across all promotion types the incremental margin is negative or the uplift is too small. Consider a non-price trigger (sampling, loyalty points) for this slot.');
    }
    out.push({ candidate: cand, scenarios, best, confidence, flag, flagReason, rationale });
  }
  return out;
}

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
  const losing = results.filter((r) => r.roi < 0).sort((a, b) => a.incMargin - b.incMargin);
  if (losing.length) {
    const worst = losing[0];
    alerts.push({
      id: 'loss', severity: 'high',
      title: `${losing.length} of ${results.length} past promotions did not pay back`,
      detail: `Worst: ${worst.campaign.name} (${offerName(worst.campaign.mechanic, worst.campaign.depth, worst.campaign.flat, worst.campaign.minSpend)}): the margin from incremental sales covered only ${Math.round(Math.max(0, 1 + worst.roi) * 100)}% of the ${fmtMoney(worst.discountCost)} promo investment (ROI ${worst.roi.toFixed(2)}).`,
      action: 'Avoid deep cuts and buy-one-get-one for broad audiences unless the margin supports the depth; reserve them for Persuadables who buy larger quantities.',
    });
  }
  const leaky = results.filter((r) => r.leakagePct > 0.15);
  if (leaky.length) {
    const l = leaky.sort((a, b) => b.leakage - a.leakage)[0];
    alerts.push({
      id: 'leak', severity: 'medium',
      title: 'Subsidy: investment on baseline sales',
      detail: `${leaky.length} campaign${leaky.length > 1 ? 's' : ''} put over 15% of the promo investment into units that would have sold anyway. Highest: ${l.campaign.name} at ${Math.round(l.leakagePct * 100)}%.`,
      action: 'Exclude Sure Things from the offer list.',
    });
  }
  const sure = recs.filter((r) => r.type === 'sure').length;
  alerts.push({
    id: 'sure', severity: 'info',
    title: `${sure} Sure Things buy regardless of promotions`,
    detail: `They make up ${Math.round((sure / recs.length) * 100)}% of the base, and each broad offer subsidises their normal basket.`,
    action: 'Switch them to loyalty rewards.',
  });
  const dogs = recs.filter((r) => r.type === 'dog').length;
  if (dogs)
    alerts.push({
      id: 'dog', severity: 'medium',
      title: `${dogs} Sleeping Dogs (Do Not Disturb) buy less when an offer runs`,
      detail: 'They buy our brand regularly, but their volume drops during promotion windows: the uplift is negative.',
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
        title: 'Persuadable redemption is fading',
        detail: `Average redemption fell from ${Math.round(first * 100)}% (first 3 campaigns) to ${Math.round(last * 100)}% (last 3).`,
        action: 'Rotate mechanics and avoid back-to-back offers in the same category.',
      });
  }
  const dip = results.reduce((s, r) => s + Math.max(0, r.byType.persuadable.pullForwardUnits), 0);
  if (dip > 20)
    alerts.push({
      id: 'pull', severity: 'info',
      title: 'Volume offers borrow from future sales',
      detail: `About ${Math.round(dip)} units were missing from Persuadables in the three weeks after their promotions (pull-forward).`,
      action: 'Judge multi-buy offers on units after the window, not only inside it.',
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

export { dayOf, isoOf };
