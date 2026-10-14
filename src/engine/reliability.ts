// How far to trust the numbers. Three honest checks, all from the data:
//   accuracy     the model's buying rate against what really happened on the last 8 campaigns (clock set back, see backtest.ts)
//   range        a plain "likely range" around an estimate, sized from that accuracy
//   sensitivity  how many customers would change customer type if the hand-set rules moved a little
import type { CustomerCampaign } from './campaigns.ts';
import type { Dataset } from './data.ts';
import { backtest, type Backtest } from './backtest.ts';
import type { CustomerRecord } from './insights.ts';
import type { Assumptions } from './simulation.ts';
import { classify, TYPE_RULES, type TypeRules } from './segments.ts';

export interface Reliability {
  backtest: Backtest;
  /** typical miss of the predicted buying rate against the actual one, per campaign (0.14 = 14%) */
  typicalMiss: number;
  /**
   * Relative half-width of the "likely range" shown around money estimates. Extra profit is the gap between two predicted buying
   * rates (with and without an offer), so it can be off by about twice the miss of one rate. Never below 15% or above 50%.
   */
  band: number;
  sensitivity: Sensitivity;
}

export interface Sensitivity {
  shift: number; // how far each rule is moved (0.15 = 15%)
  customers: number;
  changed: number; // customers whose type changes if any single rule moves by the shift, in either direction
  share: number;
  /** for every rule: customers who change type when only that rule moves */
  byRule: { rule: keyof TypeRules; label: string; changed: number }[];
}

const RULE_LABEL: Record<keyof TypeRules, string> = {
  dogLift: 'Volume during promotions (Sleeping Dogs)', dogFull: 'Full-price buying (Sleeping Dogs)', qty: 'Quantity bought on a deal (Persuadables)',
  resp: 'Share of offers responded to (Persuadables)', sureFull: 'Full-price buying (Sure Things)', sureDeal: 'Spending on deals (Sure Things)', lostResp: 'Share of offers responded to (Lost Causes)',
};

export function sensitivityOf(records: CustomerRecord[], shift = 0.15): Sensitivity {
  const keys = Object.keys(TYPE_RULES) as (keyof TypeRules)[];
  const moved = new Set<string>();
  const byRule = keys.map((rule) => {
    const hit = new Set<string>();
    for (const f of [1 - shift, 1 + shift]) {
      const rules = { ...TYPE_RULES, [rule]: TYPE_RULES[rule] * f };
      for (const r of records) if (classify(r.b, rules).type !== r.type) { hit.add(r.cid); moved.add(r.cid); }
    }
    return { rule, label: RULE_LABEL[rule], changed: hit.size };
  }).sort((a, b) => b.changed - a.changed);
  return { shift, customers: records.length, changed: moved.size, share: records.length ? moved.size / records.length : 0, byRule };
}

export function reliabilityOf(ds: Dataset, perCustomer: Map<string, CustomerCampaign[]>, records: CustomerRecord[], A: Assumptions): Reliability {
  const bt = backtest(ds, perCustomer, 8, A);
  const misses = bt.perCampaign.filter((p) => p.actual > 0).map((p) => Math.abs(p.predicted - p.actual) / p.actual);
  const typicalMiss = misses.length ? misses.reduce((s, v) => s + v, 0) / misses.length : 0.2;
  return { backtest: bt, typicalMiss, band: Math.min(0.5, Math.max(0.15, 2 * typicalMiss)), sensitivity: sensitivityOf(records) };
}

/** "₹58,000 – ₹1,06,000": a likely range around an estimate, rounded to the nearest ₹1,000 */
export function likelyRange(v: number, band: number): { low: number; high: number } {
  const r = (x: number) => Math.round(x / 1000) * 1000;
  return v >= 0 ? { low: r(v * (1 - band)), high: r(v * (1 + band)) } : { low: r(v * (1 + band)), high: r(v * (1 - band)) };
}
