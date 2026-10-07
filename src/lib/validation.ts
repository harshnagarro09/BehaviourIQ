// One place that turns the held-out backtest into the headline numbers shown in the callouts.
import type { ValidationRow } from '@/engine/campaigns';

export interface ValidationSummary {
  campaigns: number;
  real: number; // profit actually earned by the behaviour-based targets
  roi: number; // behaviour-based targeting
  broad: number;
  broadRoi: number; // blanket promotion to everyone
  skipped: number;
  reached: number;
  targeted: number;
}

export function summariseValidation(V: ValidationRow[]): ValidationSummary {
  const s = (fn: (v: ValidationRow) => number) => V.reduce((a, v) => a + fn(v), 0);
  const real = s((v) => v.realNet), cost = s((v) => v.cost), broad = s((v) => v.broadNet), broadCost = s((v) => v.broadCost);
  return {
    campaigns: V.length, real, roi: cost ? real / cost : 0, broad, broadRoi: broadCost ? broad / broadCost : 0,
    skipped: s((v) => v.skippedNet), reached: s((v) => v.reached), targeted: s((v) => v.targeted),
  };
}
