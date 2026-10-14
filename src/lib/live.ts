// Live campaigns: a finalised plan becomes a dated campaign. Its status comes from today's date and its own dates; its numbers
// are the plan's estimates at the moment it was finalised, scaled to its length; real results are measured when the data covers it.
import type { PlanConfig } from './plan.ts';
import { SIM_WINDOW_DAYS } from '../engine/simulation.ts';

export interface LiveCampaign {
  id: string;
  name: string;
  cfg: PlanConfig;
  finalisedAt: string; // ISO date-time
  start: string; // ISO date (first day)
  days: number;
  stoppedOn?: string; // ISO date, when stopped early
  summary: string; // groups · products · discount, in words
  spend: number; budget: number; incMargin: number; incRevenue: number; roi: number; customers: number;
  incBuyers?: number; // expected extra buyers over the whole campaign (absent in campaigns saved by an older version)
}

/**
 * The model estimates one offer window (SIM_WINDOW_DAYS). A longer campaign keeps buying going for longer, so money figures are
 * scaled in proportion to its length (assumes buying continues at the same pace, with no fatigue). ROI and customers do not scale.
 */
export const lengthFactor = (days: number) => days / SIM_WINDOW_DAYS;

export type LiveStatus = 'scheduled' | 'running' | 'ended';

const DAY = 864e5;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
/** today's date (the browser's calendar day) as ISO */
export const todayIso = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
export const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * DAY).toISOString().slice(0, 10);
export const endOf = (c: LiveCampaign) => c.stoppedOn ?? addDays(c.start, c.days - 1);

export function statusOf(c: LiveCampaign, today = todayIso()): LiveStatus {
  if (c.stoppedOn && dayNum(c.stoppedOn) <= dayNum(today)) return 'ended';
  if (dayNum(today) < dayNum(c.start)) return 'scheduled';
  return dayNum(today) <= dayNum(addDays(c.start, c.days - 1)) ? 'running' : 'ended';
}

/** day N of the campaign (1-based, capped to its length), and the share of its days gone */
export function progressOf(c: LiveCampaign, today = todayIso()) {
  const d = Math.min(c.days, Math.max(0, dayNum(today) - dayNum(c.start) + 1));
  return { day: d, share: c.days ? d / c.days : 0, left: Math.max(0, c.days - d) };
}
