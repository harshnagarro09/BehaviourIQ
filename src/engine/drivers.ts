// Which behaviours predict promotion response? Measured on every past campaign exposure (a customer reached by a campaign),
// with each behaviour computed ONLY from orders before that campaign started (point-in-time, no leakage), and the response
// being whether the customer then bought under the promotion. Customers are split into five equal groups (quintiles) on each
// behaviour; a behaviour predicts response when the response rate differs strongly between its top and bottom group.
// This is descriptive evidence for the customer types and the response rules, not a fitted model.
import { cutIndex } from './behaviour.ts';
import type { CustomerCampaign } from './campaigns.ts';
import type { Dataset } from './data.ts';
import { mechKey, type MechKey } from './mechanics.ts';

export interface Exposure {
  cid: string;
  campaignId: string;
  mech: MechKey;
  bought: boolean;
  f: Record<DriverKey, number>;
}

export type DriverKey = 'priorResp' | 'promoShare' | 'freq90' | 'recency' | 'affinity' | 'basket' | 'aov' | 'tenure' | 'qtyJump';

export const DRIVERS: { key: DriverKey; label: string; unit: (v: number) => string; meaning: string }[] = [
  { key: 'priorResp', label: 'Past promotion response', unit: (v) => `${Math.round(v * 100)}%`, meaning: 'Share of earlier offers the customer bought on' },
  { key: 'promoShare', label: 'Share bought on promotion', unit: (v) => `${Math.round(v * 100)}%`, meaning: 'Promoted lines over all lines before the campaign' },
  { key: 'qtyJump', label: 'Quantity jump on deal', unit: (v) => `${v.toFixed(1)}x`, meaning: 'Units per promoted line over units per normal line' },
  { key: 'affinity', label: 'Category affinity', unit: (v) => `${Math.round(v * 100)}%`, meaning: 'Share of the basket in the promoted category' },
  { key: 'freq90', label: 'Purchase frequency', unit: (v) => `${v.toFixed(0)} orders`, meaning: 'Orders in the 90 days before the campaign' },
  { key: 'recency', label: 'Recency', unit: (v) => `${Math.round(v)} days`, meaning: 'Days since the last order' },
  { key: 'basket', label: 'Basket breadth', unit: (v) => `${v.toFixed(1)} items`, meaning: 'Items per order' },
  { key: 'aov', label: 'Order value', unit: (v) => `₹${Math.round(v)}`, meaning: 'Average order value' },
  { key: 'tenure', label: 'Tenure', unit: (v) => `${Math.round(v)} days`, meaning: 'Days since the first order' },
];

/** one row per (customer, campaign) exposure, with behaviour measured before the campaign */
export function exposures(ds: Dataset, perCustomer: Map<string, CustomerCampaign[]>): Exposure[] {
  const byId = new Map(ds.campaigns.map((c) => [c.id, c]));
  const out: Exposure[] = [];
  for (const [cid, rows] of perCustomer) {
    const lines = ds.byCustomer.get(cid)!;
    let shown = 0, bought = 0;
    for (const r of rows) {
      const c = byId.get(r.campaignId)!;
      const hi = cutIndex(lines, c.start);
      if (hi > 0) {
        const lo90 = cutIndex(lines, c.start - 90);
        const orders = new Map<string, number>();
        const orders90 = new Set<string>();
        let promo = 0, cat = 0, pq = 0, pn = 0, nq = 0, nn = 0, spend = 0;
        for (let i = 0; i < hi; i++) {
          const l = lines[i];
          orders.set(l.orderId, (orders.get(l.orderId) ?? 0) + l.unit * l.qty);
          spend += l.unit * l.qty;
          if (i >= lo90) orders90.add(l.orderId);
          if (l.promoId) { promo++; pq += l.qty; pn++; } else { nq += l.qty; nn++; }
          if (l.category === c.category) cat++;
        }
        out.push({
          cid, campaignId: c.id, mech: mechKey(c), bought: r.bought,
          f: {
            priorResp: shown ? bought / shown : 0, promoShare: promo / hi, freq90: orders90.size, recency: c.start - 1 - lines[hi - 1].day,
            affinity: cat / hi, basket: hi / Math.max(1, orders.size), aov: spend / Math.max(1, orders.size), tenure: c.start - lines[0].day,
            qtyJump: pn >= 2 && nn >= 3 ? pq / pn / (nq / nn) : 1,
          },
        });
      }
      shown++;
      if (r.bought) bought++;
    }
  }
  return out;
}

export interface DriverResult {
  key: DriverKey;
  label: string;
  meaning: string;
  bands: { lo: number; hi: number; rate: number; n: number }[]; // quintiles, lowest behaviour first
  spread: number; // highest band rate - lowest band rate (points)
  ratio: number; // top band rate / bottom band rate
  direction: 'higher' | 'lower' | 'mixed'; // response rises with the behaviour, falls, or neither
  unit: (v: number) => string;
}

export function driverAnalysis(ex: Exposure[]): DriverResult[] {
  return DRIVERS.map((d): DriverResult => {
    const sorted = [...ex].sort((a, b) => a.f[d.key] - b.f[d.key]);
    const n = sorted.length;
    const bands = [0, 1, 2, 3, 4].map((q) => {
      const part = sorted.slice(Math.floor((q * n) / 5), Math.floor(((q + 1) * n) / 5));
      return { lo: part[0]?.f[d.key] ?? 0, hi: part[part.length - 1]?.f[d.key] ?? 0, rate: part.length ? part.filter((x) => x.bought).length / part.length : 0, n: part.length };
    });
    const rates = bands.map((b) => b.rate);
    const first = rates[0], last = rates[4];
    const up = rates.every((r, i) => i === 0 || r >= rates[i - 1] - 0.02);
    const down = rates.every((r, i) => i === 0 || r <= rates[i - 1] + 0.02);
    return {
      key: d.key, label: d.label, meaning: d.meaning, bands, unit: d.unit,
      spread: Math.max(...rates) - Math.min(...rates),
      ratio: first > 0 ? last / first : last > 0 ? Infinity : 1,
      direction: up && last > first ? 'higher' : down && last < first ? 'lower' : 'mixed',
    };
  }).sort((a, b) => b.spread - a.spread);
}
