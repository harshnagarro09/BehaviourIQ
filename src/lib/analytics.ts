// Filter-aware aggregation over the per-customer, per-campaign results.
import type { Engine } from '@/engine';
import type { Campaign } from '@/engine/data';

export interface Filters {
  category: string;
  persona: string; // customer type id
  channel: string;
  promo: string; // all | pct10 | pct20 | flat | bogo | bundle
  period: '3m' | '6m' | 'all';
  segment: string; // internal activity grouping (not shown in the UI)
  loyalty: string; // all | ours | mixed | rival
  frequency: string; // all | high | mid | low
}
export const DEFAULT_FILTERS: Filters = { category: 'all', persona: 'all', channel: 'all', promo: 'all', period: '6m', segment: 'all', loyalty: 'all', frequency: 'all' };

export interface Agg {
  campaigns: number;
  reached: number;
  buyers: number;
  units: number;
  base: number;
  inc: number;
  cost: number;
  leak: number;
  net: number;
}
export const emptyAgg = (): Agg => ({ campaigns: 0, reached: 0, buyers: 0, units: 0, base: 0, inc: 0, cost: 0, leak: 0, net: 0 });

export const roiOf = (a: Agg) => (a.cost > 0 ? a.net / a.cost : 0);
export const respOf = (a: Agg) => (a.reached ? a.buyers / a.reached : 0);
export const incShareOf = (a: Agg) => (a.units > 0 ? a.inc / a.units : 0);
export const leakOf = (a: Agg) => (a.cost > 0 ? a.leak / a.cost : 0);

export type PromoKind = 'pct10' | 'pct20' | 'flat' | 'bogo' | 'bundle';
export function mechOf(c: Campaign): PromoKind {
  return c.mechanic === 'BOGO' ? 'bogo' : c.mechanic === 'MULTIBUY_3FOR2' ? 'bundle' : c.mechanic === 'FLAT_OFF' ? 'flat' : c.depth <= 15 ? 'pct10' : 'pct20';
}

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
    const r = e.recById.get(cid)!;
    const loyal = r.b.ourShareFull >= 0.5 ? 'ours' : r.b.ourShareFull >= 0.15 ? 'mixed' : 'rival';
    const freq = r.b.ordersPerMonth >= 3 ? 'high' : r.b.ordersPerMonth >= 1.5 ? 'mid' : 'low';
    return (
      (f.persona === 'all' || r.type === f.persona) && (f.channel === 'all' || r.b.topChannel === f.channel) && (f.segment === 'all' || r.seg === f.segment) &&
      (f.loyalty === 'all' || loyal === f.loyalty) && (f.frequency === 'all' || freq === f.frequency)
    );
  };
}

export function aggregate(e: Engine, camps: Campaign[], ok: (cid: string) => boolean): Agg {
  const a = emptyAgg();
  a.campaigns = camps.length;
  const ids = new Set(camps.map((c) => c.id));
  for (const [cid, rows] of e.perCustomer) {
    if (!ok(cid)) continue;
    for (const r of rows) {
      if (!ids.has(r.campaignId)) continue;
      a.reached++;
      if (r.bought) a.buyers++;
      a.units += r.units;
      a.base += r.baselineUnits;
      a.inc += r.incUnits;
      a.cost += r.discountCost;
      a.leak += r.leakage;
      a.net += r.net;
    }
  }
  return a;
}

export function perCampaign(e: Engine, camps: Campaign[], ok: (cid: string) => boolean) {
  return camps.map((c) => ({ campaign: c, agg: aggregate(e, [c], ok) }));
}

export function verdictOf(roi: number): 'Scale' | 'Optimise' | 'Stop' {
  return roi >= 0.5 ? 'Scale' : roi >= 0 ? 'Optimise' : 'Stop';
}

/** "+12%" style strings for the KPI delta chips */
export function pctChange(cur: number, prior: number): string | null {
  if (!prior) return null;
  const d = (cur - prior) / Math.abs(prior);
  return `${d >= 0 ? '+' : '-'}${Math.abs(d * 100).toFixed(0)}%`;
}
