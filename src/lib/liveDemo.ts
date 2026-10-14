// Demo only: when the loaded data does not reach a campaign's dates there is no real result to show, so a running or ended
// campaign shows what its own plan expected for the days gone, with a steady daily pattern and a little variation. It is always
// labelled "Simulated", and it is replaced by the real figures (engine/measure.ts salesSoFar) as soon as the data covers the dates.
import { hash01, type Plan } from '../engine/optimizer.ts';
import { addDays, lengthFactor, type LiveCampaign } from './live.ts';

export interface DemoPurchase { cid: string; category: string; day: string; amount: number }
export interface DemoSales {
  days: number; to: string;
  customers: number; buyers: number; orders: number; units: number;
  sales: number; onOffer: number; discountGiven: number;
  latest: DemoPurchase[]; // the most recent purchases by customers who got the offer
}

/** the plan's expected result for the first `days` days of the campaign, spread over the days with front-loaded buying */
export function demoSales(plan: Plan, c: LiveCampaign, days: number): DemoSales | null {
  if (days <= 0 || !plan.allocations.length) return null;
  const lf = lengthFactor(c.days);
  const r = Math.pow(Math.min(1, days / c.days), 0.85);
  const vary = 0.94 + 0.12 * hash01(`${c.id}|${days}`);
  let customers = 0, buyers = 0, units = 0, sales = 0, disc = 0;
  const events: DemoPurchase[] = [];
  for (const a of plan.allocations) {
    const f = a.treated / Math.max(1, a.cell.members);
    const aBuyers = Math.min(a.treated, a.cell.p1 * a.treated * Math.sqrt(lf)) * r * vary;
    const aSales = a.cell.revenue * f * lf * r * vary;
    customers += a.treated; buyers += aBuyers; sales += aSales;
    units += a.cell.units * f * lf * r * vary; disc += a.cell.investment * f * lf * r * vary;
    const n = Math.round(aBuyers);
    const ranked = [...a.item.members].sort((x, y) => hash01(x + c.id) - hash01(y + c.id)).slice(0, a.treated).slice(0, n);
    for (const cid of ranked) events.push({ cid, category: a.item.category, day: addDays(c.start, Math.min(days - 1, Math.floor(hash01(cid + c.id + 'd') * days))), amount: n ? (aSales / n) * (0.7 + 0.6 * hash01(cid + c.id + 'a')) : 0 });
  }
  const bn = Math.round(buyers);
  return {
    days, to: addDays(c.start, days - 1), customers, buyers: bn, orders: Math.round(bn * 1.12), units: Math.round(units), sales, onOffer: sales, discountGiven: disc,
    latest: events.sort((x, y) => y.day.localeCompare(x.day) || x.cid.localeCompare(y.cid)).slice(0, 6),
  };
}
