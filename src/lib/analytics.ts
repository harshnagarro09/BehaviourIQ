// Filter-aware aggregation over the per-customer, per-campaign results, and the KPI formulas shown on Behaviour Analytics.
// Every KPI is defined once here; the plain-English versions are the "?" tooltips in src/lib/glossary.ts.
import type { Engine } from '@/engine';
import type { Campaign } from '@/engine/data';
import type { CustomerCampaign } from '@/engine/campaigns';
import { mechKey, type MechKey } from '@/engine/mechanics';

export interface Filters {
  category: string;
  type: string; // customer type id (persuadable | sure | lost | dog)
  channel: string; // customer's main shopping channel (App | Store | Online), from the channel column
  promo: string; // all | MechKey
  period: '3m' | '6m' | 'all';
}
export const DEFAULT_FILTERS: Filters = { category: 'all', type: 'all', channel: 'all', promo: 'all', period: '6m' };

export interface Agg {
  campaigns: number;
  reached: number; // customer-campaign exposures
  buyers: number; // exposures that bought under the promotion
  units: number; // category units bought in the windows
  promoUnits: number;
  revenue: number; // revenue received in the windows (after discount)
  promoRevenue: number; // revenue on promoted lines
  baseRevenue: number;
  base: number; // baseline units
  inc: number; // incremental units
  dip: number; // post-promotion dip in units (diagnostic)
  cost: number; // promo investment
  leak: number; // investment on baseline units (subsidy)
  incMargin: number;
  incRevenue: number;
}
export const emptyAgg = (): Agg => ({ campaigns: 0, reached: 0, buyers: 0, units: 0, promoUnits: 0, revenue: 0, promoRevenue: 0, baseRevenue: 0, base: 0, inc: 0, dip: 0, cost: 0, leak: 0, incMargin: 0, incRevenue: 0 });

// ----------------------------------------------------------------------------- KPI formulas
/** ROI = incremental margin / promo investment (0 = break-even) */
export const roiOf = (a: Agg) => (a.cost > 0 ? a.incMargin / a.cost : 0);
/** Redemption rate = reached customers who bought under the promotion / reached customers */
export const respOf = (a: Agg) => (a.reached ? a.buyers / a.reached : 0);
/** Uplift share = incremental units / units sold in the windows */
export const incShareOf = (a: Agg) => (a.units > 0 ? a.inc / a.units : 0);
/** Margin from the extra units at full price (the part of incremental margin before the investment is paid) */

export type PromoKind = MechKey;
export const mechOf = (c: Campaign): PromoKind => mechKey(c);

export function selectCampaigns(e: Engine, f: Filters): { cur: Campaign[]; prior: Campaign[] } {
  const base = e.ds.campaigns.filter((c) => (f.category === 'all' || c.category === f.category) && (f.promo === 'all' || mechOf(c) === f.promo));
  if (f.period === 'all') return { cur: base, prior: [] };
  const max = e.ds.maxDay;
  const span = f.period === '3m' ? 92 : 183;
  return {
    cur: base.filter((c) => c.start >= max - span),
    prior: base.filter((c) => c.start >= max - 2 * span - 1 && c.start < max - span),
  };
}

export function customerFilter(e: Engine, f: Filters): (cid: string) => boolean {
  return (cid) => {
    return (f.type === 'all' || e.typeOf.get(cid) === f.type) && (f.channel === 'all' || e.recById.get(cid)?.b.topChannel === f.channel);
  };
}

function addRow(a: Agg, r: CustomerCampaign) {
  a.reached++;
  if (r.bought) a.buyers++;
  a.units += r.units;
  a.promoUnits += r.promoUnits;
  a.revenue += r.revenue;
  a.promoRevenue += r.promoRevenue;
  a.baseRevenue += r.baseRevenue;
  a.dip += r.pullForwardUnits;
  a.base += r.baselineUnits;
  a.inc += r.incUnits;
  a.cost += r.discountCost;
  a.leak += r.leakage;
  a.incMargin += r.incMargin;
  a.incRevenue += r.revenue - r.baseRevenue;
}

export function aggregate(e: Engine, camps: Campaign[], ok: (cid: string) => boolean): Agg {
  const a = emptyAgg();
  a.campaigns = camps.length;
  const ids = new Set(camps.map((c) => c.id));
  for (const [cid, rows] of e.perCustomer) {
    if (!ok(cid)) continue;
    for (const r of rows) if (ids.has(r.campaignId)) addRow(a, r);
  }
  return a;
}

/** aggregate() for every campaign separately, in one pass over the customers; sumAggs() of any subset equals aggregate() of it */
export function aggregateByCampaign(e: Engine, camps: Campaign[], ok: (cid: string) => boolean): Map<string, Agg> {
  const out = new Map(camps.map((c) => [c.id, { ...emptyAgg(), campaigns: 1 }]));
  for (const [cid, rows] of e.perCustomer) {
    if (!ok(cid)) continue;
    for (const r of rows) { const a = out.get(r.campaignId); if (a) addRow(a, r); }
  }
  return out;
}

export function sumAggs(as: Agg[]): Agg {
  const t = emptyAgg();
  for (const a of as) for (const k of Object.keys(t) as (keyof Agg)[]) t[k] += a[k];
  return t;
}

export function perCampaign(e: Engine, camps: Campaign[], ok: (cid: string) => boolean) {
  return camps.map((c) => ({ campaign: c, agg: aggregate(e, [c], ok) }));
}

/** How a finished campaign performed (historical label, not an instruction): by its promo ROI */
export function verdictOf(roi: number): 'High performer' | 'Needs improvement' | 'Low performer' {
  return roi >= 0.5 ? 'High performer' : roi >= 0 ? 'Needs improvement' : 'Low performer';
}

/** "+12%" style strings for the KPI delta chips */
export function pctChange(cur: number, prior: number): string | null {
  if (!prior) return null;
  const d = (cur - prior) / Math.abs(prior);
  return `${d >= 0 ? '+' : '-'}${Math.abs(d * 100).toFixed(0)}%`;
}
