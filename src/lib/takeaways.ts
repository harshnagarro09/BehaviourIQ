// One plain-English "so what" sentence per view. Pure functions: every number is passed in from engine output,
// nothing is hardcoded. Wording says "estimated" for uplift and incrementality (no holdout group in the data).

export const NOT_ENOUGH = 'Not enough data in this view to summarise. Widen the filters or the period.';

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
