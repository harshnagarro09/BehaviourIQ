// Audience builder for Customer Prediction: every customer scored for one product category, described in business terms,
// filtered by type and behaviour, and summarised. The KPIs, charts, table and downloads all read the SAME rows, so the
// numbers always agree.
//
// Prediction for one customer (same engine as the rest of the app, see promotions.ts and response.ts):
//   chance without offer  p0  = their own full-price buying rate in the category over the next 14 days
//   chance with offer     p1  = p0 + the share of "would not have bought" that past offers converted for them
//   uplift                    = p1 - p0  (how many points more likely to buy because of the offer)
//   response score (0-100)    = where their uplift ranks among all customers (100 = most likely to be moved by the offer)
// The offer each customer gets is decided for their customer type (the best offer that pays back for the whole type);
// Sleeping Dogs never get one. A customer is a "Target" when their type gets an offer AND their own uplift is meaningful.
import type { Behaviour, TypeId } from './behaviour.ts';
import type { Engine } from './index.ts';
import { TYPE_IDS } from './insights.ts';
import { expectPromo, hasHistory, UNTESTED_CONFIDENCE, type PromoDef } from './promotions.ts';
import { NO_HISTORY } from './response.ts';
import { TYPE_BY_ID } from './segments.ts';
import { makeCtx } from './simulation.ts';
import { bestFor, MIN_SEG_UPLIFT, TARGET_HURDLE, TARGET_UPLIFT, type CategoryPrediction } from './targeting.ts';

export type Activity = 'active' | 'slowing' | 'inactive';
export type Level = 'high' | 'medium' | 'low';
export type Frequency = 'frequent' | 'regular' | 'occasional';
export type Status = 'target' | 'optional' | 'hold' | 'avoid';

export const ACTIVITY_LABEL: Record<Activity, string> = { active: 'Active', slowing: 'Slowing down', inactive: 'Inactive' };
export const FREQ_LABEL: Record<Frequency, string> = { frequent: 'Frequent', regular: 'Regular', occasional: 'Occasional' };
export const LEVEL_LABEL: Record<Level, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const STATUS_LABEL: Record<Status, string> = { target: 'Target', optional: 'Optional', hold: 'Hold discount', avoid: 'Do not disturb' };

export interface AudienceRow {
  cid: string;
  type: TypeId;
  activity: Activity;
  recency: number; // days since last order
  gap: number; // usual days between orders
  ordersPerMonth: number;
  frequency: Frequency;
  spend: number; // total spend in the history
  spendLevel: Level;
  avgOrderValue: number;
  favCategory: string;
  catShare: number; // share of their basket in the promoted category
  responsiveness: Level; // how often they bought on past offers
  respRate: number;
  responded: number;
  offered: number;
  offer: PromoDef | null; // the offer this customer would get (decided for their customer type)
  p0: number;
  p1: number; // chance with the scoring offer (shown only when an offer is given)
  uplift: number;
  score: number; // 0-100 response score
  potential: Level; // response potential from the score
  investment: number; // expected promo cost of giving them the offer (0 when no offer)
  incMargin: number;
  incRevenue: number;
  status: Status;
  reason: string; // one-line explanation
  reasons: string[]; // fuller explanation for the expanded row and the export
}

const pc = (v: number) => `${Math.round(v * 100)}%`;

export function activityOf(b: Behaviour): Activity {
  const gap = b.avgInterval > 0 ? b.avgInterval : 30;
  if (b.recencyDays <= Math.max(30, 1.5 * gap)) return 'active';
  if (b.recencyDays <= Math.max(60, 3 * gap)) return 'slowing';
  return 'inactive';
}
export const frequencyOf = (b: Behaviour): Frequency => (b.ordersPerMonth >= 3 ? 'frequent' : b.ordersPerMonth >= 1.5 ? 'regular' : 'occasional');
export const responsivenessOf = (b: Behaviour): Level => (b.respRate >= 0.4 ? 'high' : b.respRate >= 0.15 ? 'medium' : 'low');

/** The offer each customer type gets: the recommended one (best that pays back), or the offer the user chose. Sleeping Dogs: none. */
export function offersByType(P: CategoryPrediction, offerKey: string): { offer: Record<TypeId, PromoDef | null>; blocked?: string } {
  const offer = {} as Record<TypeId, PromoDef | null>;
  if (offerKey === 'recommended') {
    for (const t of TYPE_IDS) {
      const best = t === 'dog' ? null : bestFor(P.cells.get(t)!, 'margin', TARGET_HURDLE);
      offer[t] = best && best.uplift >= TARGET_UPLIFT ? best.promo : null; // same bar as Planning: the offer must really move the group
    }
    return { offer };
  }
  const i = P.promos.findIndex((p) => p.key === offerKey);
  const cell = i >= 0 ? P.cells.get('persuadable')![i] : null;
  if (!cell || !cell.eligible.ok) {
    for (const t of TYPE_IDS) offer[t] = null;
    return { offer, blocked: cell?.eligible.reason ?? 'Unknown offer.' };
  }
  for (const t of TYPE_IDS) offer[t] = t === 'dog' ? null : P.promos[i];
  return { offer };
}

export function buildAudience(e: Engine, P: CategoryPrediction, offerKey: string): { rows: AudienceRow[]; offerByType: Record<TypeId, PromoDef | null>; blocked?: string } {
  const { ds, asOf } = e;
  const category = P.category;
  const { offer: offerByType, blocked } = offersByType(P, offerKey);
  // everyone is scored on the same yardstick: their type's offer, or (types with none) the offer Persuadables get
  const fallback = offerByType.persuadable ?? P.promos.find((p) => p.key === 'pct10') ?? P.promos[0];
  const spends = e.records.map((r) => r.b.totalSpend).sort((a, b) => a - b);
  const t1 = spends[Math.floor(spends.length / 3)] ?? 0;
  const t2 = spends[Math.floor((2 * spends.length) / 3)] ?? 0;

  const rows: AudienceRow[] = e.records.map((r) => {
    const b = r.b;
    const offer = offerByType[r.type];
    const def = offer ?? fallback;
    const x = expectPromo(ds, makeCtx(ds, r.cid, category, asOf), def, e.resp.get(r.cid) ?? NO_HISTORY, hasHistory(ds, category, def) ? 1 : UNTESTED_CONFIDENCE, e.assumptions);
    const gap = b.avgInterval > 0 ? b.avgInterval : 30;
    return {
      cid: r.cid, type: r.type, activity: activityOf(b), recency: b.recencyDays, gap, ordersPerMonth: b.ordersPerMonth, frequency: frequencyOf(b),
      spend: b.totalSpend, spendLevel: b.totalSpend >= t2 ? 'high' : b.totalSpend >= t1 ? 'medium' : 'low', avgOrderValue: b.avgOrderValue,
      favCategory: b.topCategory, catShare: b.catShare[category] ?? 0, responsiveness: responsivenessOf(b), respRate: b.respRate,
      responded: b.respondedCampaigns, offered: b.activeCampaigns, offer, p0: x.p0, p1: x.p1, uplift: x.uplift, score: 0, potential: 'low',
      investment: offer ? x.investment : 0, incMargin: offer ? x.incMargin : 0, incRevenue: offer ? x.incRevenue : 0,
      status: r.type === 'dog' ? 'avoid' : !offer ? 'hold' : x.uplift >= MIN_SEG_UPLIFT ? 'target' : 'optional', reason: '', reasons: [],
    };
  });

  // response score: percentile of uplift across all customers
  const sorted = rows.map((x) => x.uplift).sort((a, b) => a - b);
  const rankOf = (v: number) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; } return lo; };
  for (const x of rows) {
    x.score = sorted.length > 1 ? Math.round((100 * rankOf(x.uplift)) / (sorted.length - 1)) : 50;
    x.potential = x.score >= 70 ? 'high' : x.score >= 40 ? 'medium' : 'low';
    explain(x, e.recById.get(x.cid)!.reasons, category, fallback);
  }
  return { rows, offerByType, blocked };
}

function explain(x: AudienceRow, typeReasons: string[], category: string, fallback: PromoDef) {
  const name = TYPE_BY_ID[x.type].name;
  const pts = `${x.uplift >= 0 ? '+' : ''}${Math.round(x.uplift * 100)} pts`;
  const offerLabel = (x.offer ?? fallback).label;
  const out: string[] = [`${name}: ${TYPE_BY_ID[x.type].tagline.toLowerCase()}.`, ...typeReasons.map((s) => `${s}.`)];
  if (x.catShare >= 0.15) out.push(`${pc(x.catShare)} of their basket is ${category}.`);
  else out.push(`${category} is only ${pc(x.catShare)} of their basket (favourite: ${x.favCategory}).`);
  if (x.activity !== 'active') out.push(`Last order ${x.recency} days ago; they usually order every ${Math.round(x.gap)} days.`);
  out.push(`${pc(x.p0)} likely to buy ${category} in the next 14 days without an offer, ${pc(x.p1)} with ${offerLabel} (${pts}).`);
  x.reasons = out;
  x.reason =
    x.status === 'target' ? `${offerLabel} makes them ${pts} more likely to buy. ${typeReasons[0] ?? 'Responds to offers'}.`
      : x.status === 'optional' ? `Their group gets ${offerLabel}, but this customer moves little (${pts}). Include only if budget allows.`
        : x.status === 'hold' ? `No discount: ${x.type === 'sure' ? 'they buy anyway, so an offer only gives margin away' : `offers barely move this group in ${category}`}.`
          : 'Buys less when offers run: leave out of promotions.';
}

// ------------------------------------------------------------------------ filters, goals, KPIs
export interface AudienceFilters {
  type: 'all' | 'notDog' | TypeId;
  activity: 'all' | Activity | 'lapsing';
  frequency: 'all' | Frequency;
  spend: 'all' | Level;
  responsiveness: 'all' | Level;
  categoryBuyers: boolean; // only customers who buy the promoted category regularly (15%+ of basket)
  recommendedOnly: boolean; // only customers marked Target
  search: string;
}
export const DEFAULT_AUDIENCE: AudienceFilters = { type: 'all', activity: 'all', frequency: 'all', spend: 'all', responsiveness: 'all', categoryBuyers: false, recommendedOnly: false, search: '' };

export type Goal = 'repeat' | 'winback' | 'category' | 'custom';
export const GOALS: { id: Goal; title: string; text: string; filters: AudienceFilters }[] = [
  { id: 'repeat', title: 'Grow repeat purchases', text: 'Active customers an offer will bring back more often.', filters: { ...DEFAULT_AUDIENCE, type: 'notDog', activity: 'active', recommendedOnly: true } },
  { id: 'winback', title: 'Win back inactive customers', text: 'Customers who have slowed down or stopped ordering.', filters: { ...DEFAULT_AUDIENCE, type: 'notDog', activity: 'lapsing' } },
  { id: 'category', title: 'Promote a product category', text: 'Regular buyers of the category who respond to offers.', filters: { ...DEFAULT_AUDIENCE, type: 'notDog', categoryBuyers: true, recommendedOnly: true } },
  { id: 'custom', title: 'Build my own audience', text: 'Start from every customer and set the filters yourself.', filters: { ...DEFAULT_AUDIENCE } },
];

export function applyFilters(rows: AudienceRow[], f: AudienceFilters): AudienceRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((x) =>
    (f.type === 'all' || (f.type === 'notDog' ? x.type !== 'dog' : x.type === f.type)) &&
    (f.activity === 'all' || (f.activity === 'lapsing' ? x.activity !== 'active' : x.activity === f.activity)) &&
    (f.frequency === 'all' || x.frequency === f.frequency) &&
    (f.spend === 'all' || x.spendLevel === f.spend) &&
    (f.responsiveness === 'all' || x.responsiveness === f.responsiveness) &&
    (!f.categoryBuyers || x.catShare >= 0.15) &&
    (!f.recommendedOnly || x.status === 'target') &&
    (!q || x.cid.toLowerCase().includes(q)));
}

export interface AudienceKpis {
  customers: number;
  offered: number; // customers who would receive an offer
  targets: number;
  buyersWithout: number; // expected buyers with no offer at all
  buyersWith: number; // expected buyers when the offered customers get their offer
  extraBuyers: number;
  investment: number;
  incMargin: number;
  incRevenue: number;
  roi: number;
}

export function audienceKpis(rows: AudienceRow[]): AudienceKpis {
  let offered = 0, targets = 0, without = 0, withOffer = 0, extra = 0, inv = 0, inc = 0, rev = 0;
  for (const x of rows) {
    without += x.p0;
    if (x.status === 'target') targets++;
    if (x.offer) { offered++; withOffer += x.p1; extra += x.uplift; inv += x.investment; inc += x.incMargin; rev += x.incRevenue; } else withOffer += x.p0;
  }
  return { customers: rows.length, offered, targets, buyersWithout: without, buyersWith: withOffer, extraBuyers: extra, investment: inv, incMargin: inc, incRevenue: rev, roi: inv > 0 ? inc / inv : 0 };
}

export type SortKey = 'score' | 'uplift' | 'p1' | 'recency' | 'spend' | 'cid';
export function sortRows(rows: AudienceRow[], k: SortKey): AudienceRow[] {
  const by: Record<SortKey, (a: AudienceRow, b: AudienceRow) => number> = {
    score: (a, b) => b.score - a.score || b.uplift - a.uplift, uplift: (a, b) => b.uplift - a.uplift, p1: (a, b) => b.p1 - a.p1,
    recency: (a, b) => b.recency - a.recency, spend: (a, b) => b.spend - a.spend, cid: (a, b) => a.cid.localeCompare(b.cid),
  };
  return [...rows].sort(by[k]);
}

/** The table that is downloaded: one row per customer in the filtered audience, exactly as shown */
export function exportTable(rows: AudienceRow[], category: string): { head: string[]; data: (string | number)[][] } {
  const head = ['customer_id', 'customer_type', 'recommendation', 'response_score', 'response_potential', 'promoted_category', 'recommended_offer',
    'chance_to_buy_without_offer', 'chance_to_buy_with_offer', 'uplift_pts', 'expected_promo_cost', 'activity', 'days_since_last_order',
    'orders_per_month', 'total_spend', 'spend_level', 'favourite_category', 'share_of_basket_in_category', 'promotion_responsiveness', 'targeting_reason'];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const data = rows.map((x) => [
    x.cid, TYPE_BY_ID[x.type].name, STATUS_LABEL[x.status], x.score, LEVEL_LABEL[x.potential], category, x.offer?.label ?? 'No offer',
    r2(x.p0), x.offer ? r2(x.p1) : r2(x.p0), x.offer ? Math.round(x.uplift * 1000) / 10 : 0, Math.round(x.investment), ACTIVITY_LABEL[x.activity], x.recency,
    Math.round(x.ordersPerMonth * 10) / 10, Math.round(x.spend), LEVEL_LABEL[x.spendLevel], x.favCategory, r2(x.catShare), LEVEL_LABEL[x.responsiveness], x.reason,
  ]);
  return { head, data };
}
