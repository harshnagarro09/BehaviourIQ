// Customers whose recent behaviour no longer matches the type they were given. A customer type is read from the whole
// history, so a Lost Cause who started reacting to offers a few weeks ago still looks like a Lost Cause. This looks only at
// the last 3 months against the customer's own earlier months and flags the ones who have started buying on promotion.
//
// A customer is "waking up" when, in the last 3 months, they:
//   - are a Lost Cause or a Sleeping Dog (so offers did nothing, or backfired, so far),
//   - have been shopping with us for at least 6 months before that (a new customer has no "earlier"),
//   - bought on promotion in 3+ separate orders, and
//   - did so at 2x or more their own earlier monthly rate.
// As a yardstick the same test is run on the 3 months before, so the list can be read against what chance alone produces.
import type { Dataset } from './data.ts';
import type { TypeId } from './behaviour.ts';

export const SHIFT_RULES = { days: 91, minPromoOrders: 3, minRise: 2, minKnown: 182, minGroup: 5 };
export type ShiftFrom = Extract<TypeId, 'lost' | 'dog'>;

export interface ShiftStats { promoOrdersPerMonth: number; ordersPerMonth: number; dealShare: number }
export interface Shift {
  from: ShiftFrom;
  ids: string[];
  of: number; // customers of that type
  recent: ShiftStats; // average over the customers flagged, last 3 months
  before: ShiftStats; // the same customers, all months before that
  chance: number; // customers of that type the same test flags for the 3 months before (a yardstick, not a forecast)
}

const MONTH = 30.44;

interface Acc { first: number; orders: Set<string>; promo: Set<string>; spend: number; promoSpend: number }

/** the test over one window: who passes, and their stats inside and before it */
function scan(ds: Dataset, byCid: Map<string, { day: number; orderId: string; promoId: string; v: number }[]>, ids: string[], from: number, to: number) {
  const months = (to - from + 1) / MONTH;
  const hits: { cid: string; recent: Acc; before: Acc; beforeMonths: number }[] = [];
  for (const cid of ids) {
    const ls = byCid.get(cid) ?? [];
    if (!ls.length) continue;
    const first = ls[0].day;
    if (first > from - SHIFT_RULES.minKnown) continue;
    const mk = (): Acc => ({ first, orders: new Set(), promo: new Set(), spend: 0, promoSpend: 0 });
    const recent = mk(), before = mk();
    for (const l of ls) {
      if (l.day > to) break;
      const a = l.day >= from ? recent : before;
      a.orders.add(l.orderId); a.spend += l.v;
      if (l.promoId) { a.promo.add(l.orderId); a.promoSpend += l.v; }
    }
    const beforeMonths = Math.max(1, (from - Math.max(first, ds.minDay)) / MONTH);
    if (recent.promo.size >= SHIFT_RULES.minPromoOrders && recent.promo.size / months >= SHIFT_RULES.minRise * (before.promo.size / beforeMonths)) hits.push({ cid, recent, before, beforeMonths });
  }
  return { hits, months };
}

/** Lost Causes and Sleeping Dogs who have started buying on promotion in the last 3 months; one entry per type with 5+ customers */
export function wakingUp(ds: Dataset, typeOf: Map<string, TypeId>, asOf: number): Shift[] {
  const byCid = new Map<string, { day: number; orderId: string; promoId: string; v: number }[]>();
  for (const l of ds.lines) {
    let a = byCid.get(l.cid);
    if (!a) byCid.set(l.cid, (a = []));
    a.push({ day: l.day, orderId: l.orderId, promoId: l.promoId, v: l.unit * l.qty });
  }
  for (const a of byCid.values()) a.sort((x, y) => x.day - y.day);
  const to = asOf - 1, from = asOf - SHIFT_RULES.days;
  const out: Shift[] = [];
  for (const type of ['lost', 'dog'] as const) {
    const ids = [...typeOf].filter(([, t]) => t === type).map(([c]) => c).sort();
    const now = scan(ds, byCid, ids, from, to);
    if (now.hits.length < SHIFT_RULES.minGroup) continue;
    const prev = scan(ds, byCid, ids, from - SHIFT_RULES.days, from - 1);
    const n = now.hits.length;
    const avg = (f: (h: (typeof now.hits)[number]) => number) => now.hits.reduce((s, h) => s + f(h), 0) / n;
    const dealShare = (a: Acc) => (a.spend > 0 ? a.promoSpend / a.spend : 0);
    out.push({
      from: type, ids: now.hits.map((h) => h.cid), of: ids.length, chance: prev.hits.length,
      recent: { promoOrdersPerMonth: avg((h) => h.recent.promo.size / now.months), ordersPerMonth: avg((h) => h.recent.orders.size / now.months), dealShare: avg((h) => dealShare(h.recent)) },
      before: { promoOrdersPerMonth: avg((h) => h.before.promo.size / h.beforeMonths), ordersPerMonth: avg((h) => h.before.orders.size / h.beforeMonths), dealShare: avg((h) => dealShare(h.before)) },
    });
  }
  return out;
}
