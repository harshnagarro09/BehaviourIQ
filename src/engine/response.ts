// Incremental (uplift-style) promotion responsiveness per customer, read from past campaigns.
//
// "Bought during a promotion" is not the same as "bought because of it": a frequent full-price buyer buys in most windows
// anyway. So for every past campaign that reached the customer we compare what they did with what they would have done:
//   expected-anyway chance  p0_i = 1 - exp(-baseline units in the window / usual units per purchase)
//   excess response         bought_i - p0_i
//   incremental response    r = (sum of excess + k x population rate) / (sum of (1 - p0_i) + k)       (shrunk, k = 2)
// r is the share of the customer's "would not have bought" chance that past offers converted. It is split by depth
// (up to 15% off vs deeper) like the price-sensitivity read in simulation.ts. Only campaigns that ENDED before `asOf` count.
// Responsiveness also decays when a customer is well past their usual purchase gap (lapsing customers respond less).
import type { Behaviour } from './behaviour.ts';
import type { CustomerCampaign } from './campaigns.ts';
import type { Dataset } from './data.ts';

export interface RespProfile {
  lo: number; // incremental response to shallow offers (<= 15% off)
  hi: number; // ... to deep offers (> 15% off), never below lo
  nLo: number; // campaigns behind each read
  nHi: number;
}

const SHRINK = 2;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

const cache = new WeakMap<Map<string, CustomerCampaign[]>, Map<number, Map<string, RespProfile>>>();

export function responseProfiles(ds: Dataset, perCustomer: Map<string, CustomerCampaign[]>, asOf: number, avgQty: (cid: string) => number): Map<string, RespProfile> {
  let byDay = cache.get(perCustomer);
  if (!byDay) cache.set(perCustomer, (byDay = new Map()));
  const hit = byDay.get(asOf);
  if (hit) return hit;
  const camp = new Map(ds.campaigns.map((c) => [c.id, c]));
  const raw = new Map<string, { eLo: number; dLo: number; nLo: number; eHi: number; dHi: number; nHi: number }>();
  const pop = { eLo: 0, dLo: 0, eHi: 0, dHi: 0 };
  for (const [cid, rows] of perCustomer) {
    const q = Math.max(1, avgQty(cid));
    const acc = { eLo: 0, dLo: 0, nLo: 0, eHi: 0, dHi: 0, nHi: 0 };
    for (const r of rows) {
      const c = camp.get(r.campaignId)!;
      if (c.end >= asOf) continue;
      const p0 = 1 - Math.exp(-Math.max(0, r.baselineUnits) / q);
      const ex = (r.bought ? 1 : 0) - p0;
      if (c.depth <= 15) { acc.eLo += ex; acc.dLo += 1 - p0; acc.nLo++; } else { acc.eHi += ex; acc.dHi += 1 - p0; acc.nHi++; }
    }
    raw.set(cid, acc);
    pop.eLo += acc.eLo; pop.dLo += acc.dLo; pop.eHi += acc.eHi; pop.dHi += acc.dHi;
  }
  const muLo = pop.dLo > 0 ? clamp(pop.eLo / pop.dLo) : 0.15;
  const muHi = pop.dHi > 0 ? clamp(pop.eHi / pop.dHi) : 0.3;
  const out = new Map<string, RespProfile>();
  for (const [cid, a] of raw) {
    const lo = clamp((a.eLo + SHRINK * muLo) / (a.dLo + SHRINK));
    const hi = Math.max(lo, clamp((a.eHi + SHRINK * muHi) / (a.dHi + SHRINK)));
    out.set(cid, { lo, hi, nLo: a.nLo, nHi: a.nHi });
  }
  byDay.set(asOf, out);
  return out;
}

/** Population fallback for customers with no campaign history yet */
export const NO_HISTORY: RespProfile = { lo: 0.15, hi: 0.3, nLo: 0, nHi: 0 };

/**
 * Incremental response at a given depth (% off): linear up to 10%, between the shallow and deep reads up to 20%, and beyond
 * 20% the customer's own deep response grows by up to half again at 50% off (diminishing returns; a customer who never
 * responds stays unresponsive however deep the offer).
 */
export function incrementalAt(r: RespProfile, depth: number): number {
  if (depth <= 0) return 0;
  if (depth <= 10) return r.lo * (depth / 10);
  if (depth < 20) return r.lo + (r.hi - r.lo) * ((depth - 10) / 10);
  return Math.min(0.95, r.hi * (1 + 0.5 * Math.min(1, (depth - 20) / 30)));
}

/** 1 while the customer is within twice their usual gap; falls towards 0.25 as they lapse */
export function activityFactor(b: Behaviour): number {
  const gap = b.avgInterval > 0 ? b.avgInterval : 30;
  return b.recencyDays <= 2 * gap ? 1 : clamp((2 * gap) / b.recencyDays, 0.25, 1);
}
