// Promotion budget optimisation across the four customer types: a multiple-choice knapsack.
//
// Each item is one (customer type, category) audience. It can receive at most one offer, at a coverage of 25 / 50 / 75 / 100% of
// the segment (a random share of members, which is how a partial roll-out is executed), or nothing. Every option has an
// expected cost (promo investment) and an expected value for the chosen objective. The optimiser picks the combination with
// the highest total value whose cost fits the budget. It is solved exactly by dynamic programming over the budget in small
// rupee steps, so the result is the true optimum for these inputs, not a greedy approximation.
//
// Business rules enforced as constraints:
//   - ROI hurdle: an option is only allowed if its own ROI (incremental margin / investment) clears the hurdle
//   - guardrails from the catalogue (margin floor, executability) and the allowed-mechanics list
//   - Sleeping Dogs (do not disturb) are excluded unless the user opts in
//   - a holdout share of every treated audience gets no offer, so the result can be measured; it costs nothing and earns nothing
// Spending limits per category (min / max) are honoured exactly: the knapsack is solved in two levels, first the best value at
// every exact spend inside each category (one offer per customer type), then across categories within each category's limits.
// The DP table gives the best value at EVERY budget, so the efficient frontier (value vs budget) and the marginal return of the
// next rupee come for free. This follows the industry pattern: Booking.com, Uber and Meituan allocate uplift-scored offers
// under a budget with knapsack formulations (see docs/research.md, Method 3).
import type { PromoDef } from './promotions.ts';
import type { TypeId } from './behaviour.ts';
import { MIN_SEG_UPLIFT, objectiveValue, type Objective, type SegPromo } from './targeting.ts';

export const COVERAGES = [0.25, 0.5, 0.75, 1];

export interface OptItem {
  id: string; // type|category
  type: TypeId;
  category: string;
  members: string[];
  cells: SegPromo[];
}

export interface OptSettings {
  budget: number;
  objective: Objective;
  hurdle: number; // minimum ROI an option must reach
  holdout: number; // share of each treated audience kept as a control group
  includeExcluded: boolean;
  allowed: (p: PromoDef) => boolean;
  /** optional spending limits per category, in rupees (a minimum is only met with offers that clear the ROI hurdle) */
  limits?: Record<string, SpendLimit>;
}

export interface SpendLimit { min?: number | null; max?: number | null }

/** A spending limit the plan could not honour exactly, or that holds the plan back */
export interface LimitIssue {
  category: string; // '' for a plan-wide issue
  kind: 'min-unreachable' | 'mins-over-budget' | 'max-binding';
  limit: number;
  possible: number; // what could be spent (min-unreachable), the budget (mins-over-budget) or what was spent (max-binding)
}

export interface Allocation {
  item: OptItem;
  cell: SegPromo; // the chosen offer (full-segment economics)
  coverage: number; // share of the segment offered the promotion (before holdout)
  treated: number; // customers who receive the offer
  holdout: number; // customers kept as control
  spend: number;
  incMargin: number;
  incRevenue: number;
  incBuyers: number;
  roi: number;
  marginalRoi: number; // ROI of the last step funded in this audience (from the next lower coverage or nothing)
}

export interface Plan {
  settings: OptSettings;
  allocations: Allocation[];
  spend: number;
  incMargin: number;
  incRevenue: number;
  incBuyers: number;
  treated: number;
  holdoutCustomers: number;
  roi: number;
  frontier: { budget: number; value: number; spend: number }[]; // best objective value at each budget
  recommendedBudget: number; // smallest budget reaching 98% of the best possible value
  maxUsefulValue: number;
  nextRupee: number; // objective value added by the next 10% of budget, per rupee
  unit: number; // DP budget step in rupees
  skipped: { item: OptItem; reason: string }[]; // audiences left out, with why
  limitIssues: LimitIssue[];
}

interface Choice { cell: SegPromo; coverage: number; cost: number; units: number; value: number }

/** Can this offer be funded at all? Allowed and executable, moves buying by 5+ points, clears the ROI hurdle, adds value. */
export function qualifies(c: SegPromo, s: OptSettings): boolean {
  if (!c.eligible.ok || !s.allowed(c.promo)) return false;
  if (c.investment <= 0 || c.uplift < MIN_SEG_UPLIFT || c.roi < s.hurdle) return false;
  return objectiveValue(c, s.objective) > 0 && !(c.incMargin <= 0 && s.objective === 'margin');
}

function optionsFor(item: OptItem, s: OptSettings): { choices: Choice[]; reason?: string } {
  if (item.type === 'dog' && !s.includeExcluded) return { choices: [], reason: 'Sleeping Dogs: do not disturb.' };
  if (!item.members.length) return { choices: [], reason: 'No customers in this group.' };
  const keep = 1 - s.holdout;
  const choices: Choice[] = [];
  for (const c of item.cells) {
    if (!qualifies(c, s)) continue;
    const v = objectiveValue(c, s.objective);
    for (const cov of COVERAGES) choices.push({ cell: c, coverage: cov, cost: c.investment * cov * keep, units: 0, value: v * cov * keep });
  }
  return { choices, reason: choices.length ? undefined : 'No offer clears the ROI hurdle.' };
}

export function optimise(items: OptItem[], s: OptSettings): Plan {
  const prepared = items.map((it) => ({ it, ...optionsFor(it, s) }));
  const skipped = prepared.filter((p) => !p.choices.length).map((p) => ({ item: p.it, reason: p.reason ?? '' }));
  const live = prepared.filter((p) => p.choices.length);
  const maxCost = live.reduce((a, p) => a + Math.max(...p.choices.map((c) => c.cost)), 0);
  const top = Math.max(s.budget, maxCost);
  const STATES = 2400;
  const unit = Math.max(1, Math.ceil(top / STATES));
  const B = Math.ceil(top / unit);
  for (const p of live) for (const c of p.choices) c.units = Math.ceil(c.cost / unit - 1e-9);
  const limitIssues: LimitIssue[] = [];

  // ---- level 1: within each category, the best value at every EXACT spend (one offer per customer type)
  const cats = [...new Set(live.map((p) => p.it.category))];
  const groups = cats.map((category) => {
    const members = live.filter((p) => p.it.category === category);
    let f = new Float64Array(B + 1).fill(-Infinity);
    f[0] = 0;
    const picks: Int16Array[] = [];
    for (const p of members) {
      const next = Float64Array.from(f);
      const pk = new Int16Array(B + 1).fill(-1);
      p.choices.forEach((c, ci) => {
        for (let b = B; b >= c.units; b--) {
          const prev = f[b - c.units];
          if (prev === -Infinity) continue;
          const v = prev + c.value;
          if (v > next[b] + 1e-9) { next[b] = v; pk[b] = ci; }
        }
      });
      f = next;
      picks.push(pk);
    }
    return { category, members, f, picks };
  });

  // Minimums are checked in rupees: the most a category can usefully take is every customer type fully funded with its
  // costliest qualifying offer (capped by its maximum). A minimum above that is reported and lowered to it.
  const minOf = new Map<string, number>(); // effective minimum spend, in budget units
  for (const [category, lim] of Object.entries(s.limits ?? {})) {
    if (!lim.min) continue;
    const g = groups.find((x) => x.category === category);
    const fullU = g ? g.members.reduce((t, p) => t + Math.max(...p.choices.map((c) => c.units)), 0) : 0;
    const fullRs = g ? g.members.reduce((t, p) => t + Math.max(...p.choices.map((c) => c.cost)), 0) : 0;
    const possible = Math.min(fullRs, lim.max ?? Infinity);
    if (possible < lim.min - 1e-6) limitIssues.push({ category, kind: 'min-unreachable', limit: lim.min, possible });
    if (!g) continue;
    const want = Math.min(lim.min, possible);
    // costs are rounded up to budget units, so ask for a few units more than the minimum when that is still affordable
    const exact = Math.ceil(want / unit - 1e-9);
    minOf.set(category, Math.min(fullU, exact + (want < lim.min ? 0 : g.members.length)));
  }

  // the spend levels a category may take: inside its limits, keeping only levels that buy more value than every cheaper one
  const levels = (g: (typeof groups)[number], useMin: boolean) => {
    const lim = s.limits?.[g.category];
    const minU = useMin ? minOf.get(g.category) ?? 0 : 0;
    const maxU = lim?.max != null ? Math.min(B, Math.floor(lim.max / unit + 1e-9)) : B;
    const out: { u: number; v: number }[] = [];
    let best = -Infinity;
    for (let u = minU; u <= maxU; u++) {
      if (g.f[u] === -Infinity) continue;
      if (g.f[u] > best + 1e-9) { out.push({ u, v: g.f[u] }); best = g.f[u]; }
    }
    return out;
  };

  // ---- level 2: across categories, the best value at every exact total spend
  const solve = (useMin: boolean) => {
    const lv = groups.map((g) => {
      const l = levels(g, useMin);
      return l.length ? l : levels(g, false); // no spend level inside the limits: fall back to returns alone
    });
    let F = new Float64Array(B + 1).fill(-Infinity);
    F[0] = 0;
    const choice: Int32Array[] = [];
    for (const l of lv) {
      const next = new Float64Array(B + 1).fill(-Infinity);
      const ch = new Int32Array(B + 1).fill(-1);
      for (let b = 0; b <= B; b++) {
        if (F[b] === -Infinity) continue;
        for (let k = 0; k < l.length; k++) {
          const t = b + l[k].u;
          if (t > B) break;
          const v = F[b] + l[k].v;
          if (v > next[t] + 1e-9) { next[t] = v; ch[t] = k; }
        }
      }
      F = next;
      choice.push(ch);
    }
    return { lv, F, choice };
  };

  const bu = Math.min(B, Math.floor(s.budget / unit + 1e-9));
  let sol = solve(true);
  const reachable = (F: Float64Array) => { for (let b = 0; b <= bu; b++) if (F[b] > -Infinity) return true; return false; };
  if (!reachable(sol.F)) { // the minimums together cost more than the budget: plan without them and say so
    limitIssues.splice(0, limitIssues.length, { category: '', kind: 'mins-over-budget', limit: Object.values(s.limits ?? {}).reduce((t, l) => t + (l.min ?? 0), 0), possible: s.budget });
    sol = solve(false);
  }

  // best[b] = best value with total spend <= b
  const best = new Float64Array(B + 1);
  const arg = new Int32Array(B + 1);
  let run = -Infinity, at = -1;
  for (let b = 0; b <= B; b++) {
    if (sol.F[b] > run + 1e-9) { run = sol.F[b]; at = b; }
    best[b] = run;
    arg[b] = at;
  }

  const reconstruct = (budgetUnits: number) => {
    const chosen: { p: (typeof live)[number]; c: Choice }[] = [];
    let b = arg[budgetUnits];
    if (b < 0) return chosen;
    for (let g = groups.length - 1; g >= 0; g--) {
      const k = sol.choice[g][b];
      let u = sol.lv[g][k].u;
      b -= u;
      const grp = groups[g];
      for (let i = grp.members.length - 1; i >= 0; i--) {
        const ci = grp.picks[i][u];
        if (ci >= 0) { const c = grp.members[i].choices[ci]; chosen.push({ p: grp.members[i], c }); u -= c.units; }
      }
    }
    return chosen;
  };

  const keep = 1 - s.holdout;
  const allocations: Allocation[] = reconstruct(bu).map(({ p, c }) => {
    const n = p.it.members.length;
    const offered = Math.round(n * c.coverage);
    const lower = p.choices.filter((x) => x.cell === c.cell && x.coverage < c.coverage).sort((a, b) => b.coverage - a.coverage)[0];
    const dCost = c.cost - (lower?.cost ?? 0);
    const dMargin = (c.cell.incMargin * (c.coverage - (lower?.coverage ?? 0))) * keep;
    return {
      item: p.it, cell: c.cell, coverage: c.coverage,
      treated: Math.round(offered * keep), holdout: offered - Math.round(offered * keep),
      spend: c.cost, incMargin: c.cell.incMargin * c.coverage * keep, incRevenue: c.cell.incRevenue * c.coverage * keep,
      incBuyers: c.cell.incBuyers * c.coverage * keep, roi: c.cell.roi, marginalRoi: dCost > 0 ? dMargin / dCost : c.cell.roi,
    };
  }).sort((a, b) => b.spend - a.spend);

  // a maximum that may hold the plan back: the category could usefully take more than its cap (explainPlan compares with the
  // plan without limits to say whether it actually did)
  for (const g of groups) {
    const max = s.limits?.[g.category]?.max;
    if (max == null) continue;
    const spent = allocations.filter((a) => a.item.category === g.category).reduce((t, a) => t + a.spend, 0);
    const couldUse = g.f.some((v, u) => v > -Infinity && u * unit > max + unit);
    if (couldUse) limitIssues.push({ category: g.category, kind: 'max-binding', limit: max, possible: spent });
  }

  const sum = (f: (a: Allocation) => number) => allocations.reduce((t, a) => t + f(a), 0);
  const spend = sum((a) => a.spend);
  const incMargin = sum((a) => a.incMargin);
  const top1 = best[B] > -Infinity ? best[B] : 0;
  let rec = B;
  for (let b = 0; b <= B; b++) if (best[b] > -Infinity && best[b] >= 0.98 * top1 - 1e-9) { rec = b; break; }
  const step = Math.max(1, Math.round(B / 60));
  const frontier: Plan['frontier'] = [];
  for (let b = 0; b <= B; b += step) if (best[b] > -Infinity) frontier.push({ budget: b * unit, value: best[b], spend: b * unit });
  if (best[B] > -Infinity && frontier[frontier.length - 1]?.budget !== B * unit) frontier.push({ budget: B * unit, value: best[B], spend: B * unit });
  const ahead = Math.min(B, bu + Math.max(1, Math.round(bu * 0.1)));
  const nextRupee = ahead > bu && best[bu] > -Infinity ? (best[ahead] - best[bu]) / ((ahead - bu) * unit) : 0;

  return {
    settings: s, allocations, spend, incMargin, incRevenue: sum((a) => a.incRevenue), incBuyers: sum((a) => a.incBuyers),
    treated: sum((a) => a.treated), holdoutCustomers: sum((a) => a.holdout), roi: spend > 0 ? incMargin / spend : 0,
    frontier, recommendedBudget: rec * unit, maxUsefulValue: top1, nextRupee, unit, skipped, limitIssues,
  };
}

/**
 * The traditional alternative at the same budget: one offer for every audience in scope (no segmentation),
 * rolled out to as large a random share of customers as the budget pays for.
 */
export function blanket(items: OptItem[], promoKey: string, budget: number) {
  let cost = 0, margin = 0, revenue = 0, buyers = 0, customers = 0;
  for (const it of items) {
    const c = it.cells.find((x) => x.promo.key === promoKey);
    if (!c || !c.eligible.ok) continue;
    cost += c.investment; margin += c.incMargin; revenue += c.incRevenue; buyers += c.incBuyers; customers += it.members.length;
  }
  const share = cost > budget ? budget / cost : 1;
  return { promoKey, share, spend: cost * share, incMargin: margin * share, incRevenue: revenue * share, incBuyers: buyers * share, customers: Math.round(customers * share), roi: cost ? margin / cost : 0 };
}

// ------------------------------------------------------------------------ measurement plan
/**
 * Smallest uplift (in points of buying chance) a treated-vs-holdout comparison can detect, two-sided 5% significance and
 * 80% power: 2.8 x sqrt(p(1-p) x (1/n_treated + 1/n_holdout)).
 */
export function minDetectableUplift(p: number, nT: number, nC: number): number {
  if (nT <= 0 || nC <= 0) return Infinity;
  const q = Math.min(0.99, Math.max(0.01, p));
  return 2.8 * Math.sqrt(q * (1 - q) * (1 / nT + 1 / nC));
}

/** stable 0..1 hash so the activation file assigns the same customers every time (no randomness at run time) */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/** Activation rows: which members of each funded segment get the offer and which are held out as control */
export function activation(plan: Plan): { cid: string; type: TypeId; category: string; offer: string; group: 'treatment' | 'holdout' }[] {
  const out: { cid: string; type: TypeId; category: string; offer: string; group: 'treatment' | 'holdout' }[] = [];
  for (const a of plan.allocations) {
    const ranked = [...a.item.members].sort((x, y) => hash01(x + a.item.category) - hash01(y + a.item.category));
    const offered = ranked.slice(0, a.treated + a.holdout);
    offered.forEach((cid, i) => out.push({ cid, type: a.item.type, category: a.item.category, offer: a.cell.promo.label, group: i < a.treated ? 'treatment' : 'holdout' }));
  }
  return out;
}
