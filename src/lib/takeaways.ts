// One plain-English "so what" sentence per view. Pure functions: every number is passed in from engine output,
// nothing is hardcoded. Wording says "estimated" for uplift and incrementality (no holdout group in the data).
import { inr, pct } from './fmt.ts';

export const NOT_ENOUGH = 'Not enough data in this view to summarise. Widen the filters or the period.';

export function pastResultsTakeaway(o: { campaigns: number; lost: number; cost: number; incRevenue: number; roi: number; incShare: number; units: number }): string {
  if (o.campaigns < 2 || o.units < 30) return NOT_ENOUGH;
  return `${o.campaigns} campaigns invested ${inr(o.cost, 0)} and returned an ROI of ${o.roi.toFixed(2)} and about ${inr(o.incRevenue, 0)} of incremental revenue. ${o.lost === 0 ? 'Every campaign paid for itself' : `${o.lost} did not pay for ${o.lost === 1 ? 'itself' : 'themselves'}`}; ${pct(1 - o.incShare)} of promoted sales would have happened anyway (baseline).`;
}

/**
 * The one thing the KPI tiles cannot show: which promotions lost money, where they cluster, and which returned the most.
 * `rows` are the campaigns in view with their ROI; `units` guards against reading a too-small selection.
 */
export function resultsInsight(rows: { name: string; category: string; roi: number; cost: number }[], units: number): string {
  const paid = rows.filter((r) => r.cost > 0);
  if (paid.length < 2 || units < 30) return NOT_ENOUGH;
  const byRoi = [...paid].sort((a, b) => b.roi - a.roi);
  const best = byRoi[0], worst = byRoi[byRoi.length - 1];
  const losers = paid.filter((r) => r.roi < 0);
  if (!losers.length) return `All ${paid.length} promotions paid back. ${best.name} (${best.category}) returned the most, ROI ${best.roi.toFixed(2)}; ${worst.name} the least, ROI ${worst.roi.toFixed(2)}.`;
  const cats = new Map<string, number>();
  for (const r of losers) cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
  const [topCat, n] = [...cats].sort((a, b) => b[1] - a[1])[0];
  const where = losers.length >= 2 && n >= Math.ceil(losers.length / 2) ? `, ${n === losers.length ? 'all' : `${n} of them`} in ${topCat}` : '';
  return `${losers.length} of ${paid.length} promotions lost money${where}; the biggest loss was ${worst.name} (ROI ${worst.roi.toFixed(2)}). ${best.name} (${best.category}) returned the most, ROI ${best.roi.toFixed(2)}.`;
}

export function behaviourTakeaway(groups: { name: string; n: number; roi: number; resp: number }[]): string {
  const g = groups.filter((x) => x.n >= 5);
  if (g.length < 2) return NOT_ENOUGH;
  const s = [...g].sort((a, b) => b.roi - a.roi);
  const hi = s[0], lo = s[s.length - 1];
  return `${hi.name} return the most on promotions (ROI ${hi.roi.toFixed(2)}, ${pct(hi.resp)} response); ${lo.name} the least (ROI ${lo.roi.toFixed(2)}). Spend should follow the customer type, not the calendar.`;
}

export function audienceTakeaway(o: { customers: number; total: number; category: string; offer: string; offered: number; targets: number; buyersWith: number; buyersWithout: number; roi: number }): string {
  if (!o.customers) return 'No customers match these filters yet. Loosen a filter to build an audience.';
  const extra = Math.round(o.buyersWith - o.buyersWithout);
  if (!o.offered || extra <= 0) return `${o.customers} of ${o.total} customers match. None of them is moved enough by ${o.offer} in ${o.category} to pay back, so a discount would only subsidise buying that happens anyway.`;
  const held = o.customers - o.offered;
  return `${o.customers} of ${o.total} customers match: ${o.offered} would get an offer (${o.targets} strongly recommended)${held ? ` and ${held} are held back because an offer would not pay back for their type` : ''}. About ${Math.round(o.buyersWith)} are expected to buy ${o.category} in the next 14 days instead of ${Math.round(o.buyersWithout)}: ${extra} extra buyers at an expected ROI of ${o.roi.toFixed(2)}.`;
}

export function planningTakeaway(o: { campaigns: number; margin: number; flagged: number }): string {
  if (!o.campaigns) return NOT_ENOUGH;
  return `${o.campaigns} campaigns planned: ${inr(o.margin)} of predicted incremental margin if the recommended promotions run, each aimed at the customer types with a positive uplift; ${o.flagged} flagged for review.`;
}

export function simulationTakeaway(o: { targeted: number; total: number; margin: number; roi: number }): string {
  if (!o.targeted) return 'No customer type meets the chosen objective and audience. Loosen the objective or add customer types.';
  return `This scenario reaches ${o.targeted} of ${o.total} customers (the types with a positive uplift) for an expected incremental margin of ${inr(o.margin)} (ROI ${o.roi.toFixed(2)}).`;
}
