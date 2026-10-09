// One plain-English "so what" sentence per view. Pure functions: every number is passed in from engine output,
// nothing is hardcoded. Wording says "estimated" for uplift and incrementality (no control group in the data).
import { inr, pct } from './fmt.ts';

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export const NOT_ENOUGH = 'Not enough data in this view to summarise. Widen the filters or the period.';

export function pastResultsTakeaway(o: { campaigns: number; lost: number; incShare: number; units: number }): string {
  if (o.campaigns < 2 || o.units < 30) return NOT_ENOUGH;
  return `Across ${o.campaigns} campaigns, ${o.lost} lost money; an estimated ${pct(1 - o.incShare)} of promoted sales were baseline (would have happened anyway).`;
}

export function behaviourTakeaway(groups: { name: string; n: number; net: number }[]): string {
  const g = groups.filter((x) => x.n >= 5);
  if (g.length < 2) return NOT_ENOUGH;
  const earn = g.filter((x) => x.net > 0).map((x) => x.name);
  const lose = g.filter((x) => x.net <= 0).map((x) => x.name);
  if (!earn.length) return `In this view, every customer type loses money on promotions: ${list(lose)}.`;
  if (!lose.length) return `In this view, every customer type earns money from promotions: ${list(earn)}.`;
  return `${list(earn)} customers earn money from promotions; ${list(lose)} cost money.`;
}

export function customerTakeaway(o: { cid: string; p0: number; best: { label: string; p1: number; net: number } | null }): string {
  if (!o.best) return `${o.cid}: ${pct(o.p0)} chance of buying with no promotion; no promotion earns more than it costs for this customer.`;
  const pts = Math.round((o.best.p1 - o.p0) * 100);
  return `${o.cid}: ${pct(o.p0)} chance of buying with no promotion, ${pct(o.best.p1)} with ${o.best.label}, ${pts >= 0 ? '+' : ''}${pts} pts uplift (simulated), expected profit about ${inr(o.best.net, 0)}.`;
}

export function planningTakeaway(o: { campaigns: number; net: number; flagged: number }): string {
  if (!o.campaigns) return NOT_ENOUGH;
  return `${o.campaigns} campaigns planned: ${inr(o.net)} simulated net profit if the recommended promotions are run; ${o.flagged} flagged for review.`;
}

export function simulationTakeaway(o: { targeted: number; total: number; net: number; roi: number }): string {
  if (!o.targeted) return 'No customer meets the chosen objective and audience. Loosen the objective or add customer types.';
  return `This scenario contacts ${o.targeted} of ${o.total} customers for an expected net profit of ${inr(o.net)} (ROI ${o.roi.toFixed(2)}).`;
}
