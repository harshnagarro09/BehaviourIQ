// Measuring a live campaign with its own control group. A plan holds back a share of every group (see optimizer.ts, activation());
// once the data covers the campaign dates, the customers who got the offer are compared with those held back: the difference in
// how many bought in the category is the real extra buyers. The data file only has orders up to its last date, so a campaign
// that has not started in the data cannot be measured yet.
import { dayOf, type Dataset } from './data.ts';

export interface ActivationRow { cid: string; category: string; group: 'treatment' | 'holdout' }

export interface Measured {
  from: string; to: string; days: number; // the part of the campaign covered by the data
  treated: { n: number; bought: number };
  held: { n: number; bought: number };
  rateTreated: number; rateHeld: number;
  lift: number; // points: share who bought with the offer minus share who bought without
  extraBuyers: number; // lift x customers who got the offer
}

/** null when the data does not reach the campaign's first day, or there is no control group to compare with */
export function measureCampaign(ds: Dataset, rows: ActivationRow[], start: string, days: number): Measured | null {
  const from = dayOf(start);
  const last = Math.min(from + days - 1, ds.maxDay);
  if (ds.maxDay < from) return null;
  const bought = (cid: string, category: string) => (ds.byCustomer.get(cid) ?? []).some((l) => l.category === category && l.day >= from && l.day <= last);
  const acc = { treatment: { n: 0, bought: 0 }, holdout: { n: 0, bought: 0 } };
  for (const r of rows) { const a = acc[r.group]; a.n++; if (bought(r.cid, r.category)) a.bought++; }
  if (!acc.treatment.n || !acc.holdout.n) return null;
  const rt = acc.treatment.bought / acc.treatment.n, rh = acc.holdout.bought / acc.holdout.n;
  const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
  return { from: start, to: iso(last), days: last - from + 1, treated: acc.treatment, held: acc.holdout, rateTreated: rt, rateHeld: rh, lift: rt - rh, extraBuyers: (rt - rh) * acc.treatment.n };
}

export interface SalesSoFar {
  from: string; to: string; days: number; // the part of the campaign covered by the data
  customers: number; // customers who got the offer
  buyers: number; // of them, bought the planned categories in the period
  orders: number; units: number;
  sales: number; // money paid for those purchases
  onOffer: number; // of which on a promoted line
  discountGiven: number; // list price minus price paid on promoted lines
  perCustomer: number; // sales per customer who got the offer
  perHeldBack: number | null; // the same for the customers held back (null without a control group)
}

/** Actual sales of the campaign's customers in its categories, from the first day to the last day the data covers (null before it starts) */
export function salesSoFar(ds: Dataset, rows: ActivationRow[], start: string, days: number): SalesSoFar | null {
  const from = dayOf(start);
  if (ds.maxDay < from) return null;
  const last = Math.min(from + days - 1, ds.maxDay);
  const treated = rows.filter((r) => r.group === 'treatment'), held = rows.filter((r) => r.group === 'holdout');
  if (!treated.length) return null;
  const sum = (rs: ActivationRow[]) => {
    const orders = new Set<string>(), who = new Set<string>(), seen = new Set<string>();
    let units = 0, sales = 0, onOffer = 0, discountGiven = 0;
    for (const r of rs) {
      const key = `${r.cid}|${r.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const l of ds.byCustomer.get(r.cid) ?? []) {
        if (l.category !== r.category || l.day < from || l.day > last) continue;
        const v = l.unit * l.qty;
        orders.add(l.orderId); who.add(r.cid); units += l.qty; sales += v;
        if (l.promoId) { onOffer += v; discountGiven += Math.max(0, l.list - l.unit) * l.qty; }
      }
    }
    return { orders: orders.size, buyers: who.size, units, sales, onOffer, discountGiven, n: new Set(rs.map((r) => r.cid)).size };
  };
  const t = sum(treated), h = held.length ? sum(held) : null;
  const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
  return {
    from: start, to: iso(last), days: last - from + 1, customers: t.n, buyers: t.buyers, orders: t.orders, units: t.units, sales: t.sales, onOffer: t.onOffer, discountGiven: t.discountGiven,
    perCustomer: t.n ? t.sales / t.n : 0, perHeldBack: h && h.n ? h.sales / h.n : null,
  };
}
