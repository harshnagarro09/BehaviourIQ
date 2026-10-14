// Customer activity: whether a customer is still shopping at their usual pace. Planning and Simulation use it to choose
// which customers a plan starts from (active, all, or slowing down / inactive).
import type { Behaviour } from './behaviour.ts';

export type Activity = 'active' | 'slowing' | 'inactive';

export function activityOf(b: Behaviour): Activity {
  const gap = b.avgInterval > 0 ? b.avgInterval : 30;
  if (b.recencyDays <= Math.max(30, 1.5 * gap)) return 'active';
  if (b.recencyDays <= Math.max(60, 3 * gap)) return 'slowing';
  return 'inactive';
}
