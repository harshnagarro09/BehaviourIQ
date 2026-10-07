// Step 4 of the story: group customers by similar behaviour (before looking at promotion response).
import type { Behaviour } from './behaviour.ts';

export type SegId = 'loyal' | 'value' | 'new' | 'risk' | 'occasional';

export interface SegMeta {
  id: SegId;
  name: string;
  rule: string;
  blurb: string;
}

export const SEGMENTS: SegMeta[] = [
  { id: 'loyal', name: 'Loyal Customers', rule: 'Orders at least 2.5 times a month', blurb: 'Shop often and steadily. Their habit is the asset to protect.' },
  { id: 'value', name: 'High-Value Customers', rule: 'Top 20% by total spend', blurb: 'A small group that carries a large share of revenue.' },
  { id: 'new', name: 'New Customers', rule: 'First order in the last 200 days', blurb: 'Little history yet, so the model leans on similar customers.' },
  { id: 'risk', name: 'At-Risk Customers', rule: 'No order for 45+ days', blurb: 'Used to buy, now quiet. Need a reason to return.' },
  { id: 'occasional', name: 'Occasional Buyers', rule: 'Everyone else: lower frequency, mild promo use', blurb: 'Buy now and then, mostly at full price.' },
];
export const SEG_BY_ID = Object.fromEntries(SEGMENTS.map((s) => [s.id, s])) as Record<SegId, SegMeta>;

export function assignSegments(bs: Behaviour[], maxDay: number): Map<string, SegId> {
  const spends = bs.map((b) => b.totalSpend).sort((a, b) => a - b);
  const p80 = spends[Math.floor(spends.length * 0.8)] ?? Infinity;
  const out = new Map<string, SegId>();
  for (const b of bs) {
    let id: SegId;
    if (b.firstDay > maxDay - 200) id = 'new';
    else if (b.recencyDays > 45) id = 'risk';
    else if (b.totalSpend >= p80) id = 'value';
    else if (b.ordersPerMonth >= 2.5) id = 'loyal';
    else id = 'occasional';
    out.set(b.cid, id);
  }
  return out;
}
