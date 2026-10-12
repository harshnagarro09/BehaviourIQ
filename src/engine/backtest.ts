// Backtest of the customer-type prediction on past campaigns. For each of the most recent campaigns, the clock is set back to
// the campaign start: behaviour profiles, customer types and the response rules use only orders before that day. The predicted
// response of each type is then compared with what the type actually did in the campaign window.
import type { CustomerCampaign } from './campaigns.ts';
import type { Campaign, Dataset } from './data.ts';
import { catalogue, expectPromo, UNTESTED_CONFIDENCE, type PromoDef } from './promotions.ts';
import { NO_HISTORY, responseProfiles } from './response.ts';
import type { TypeId } from './behaviour.ts';
import { TYPE_IDS } from './insights.ts';
import { classify } from './segments.ts';
import { cachedProfile, DEFAULT_ASSUMPTIONS, makeCtx, type Assumptions } from './simulation.ts';

/** The catalogue definition that matches a past campaign (same mechanic, the depth and threshold it actually ran with) */
export function defForCampaign(ds: Dataset, c: Campaign): PromoDef {
  const cat = catalogue(ds, c.category);
  const same = cat.find((p) => p.mechanic === c.mechanic && (c.mechanic !== 'PCT_OFF' || p.depth === c.depth)) ?? cat.find((p) => p.mechanic === c.mechanic) ?? cat[0];
  return { ...same, depth: c.depth, minSpend: c.minSpend || same.minSpend, flat: c.flat || same.flat };
}

export interface BacktestRow { seg: TypeId; n: number; predicted: number; actual: number }
export interface Backtest {
  campaigns: Campaign[];
  rows: BacktestRow[];
  overall: { n: number; predicted: number; actual: number; mae: number; weightedMae: number };
  gains: { share: number; captured: number; seg?: TypeId }[]; // segments ranked by predicted response
  perCampaign: { campaign: Campaign; predicted: number; actual: number; n: number }[];
}

export function backtest(ds: Dataset, perCustomer: Map<string, CustomerCampaign[]>, last = 8, A: Assumptions = DEFAULT_ASSUMPTIONS): Backtest {
  const camps = ds.campaigns.slice(-last);
  const acc = new Map<TypeId, { n: number; p: number; a: number }>(TYPE_IDS.map((t) => [t, { n: 0, p: 0, a: 0 }]));
  const perCampaign: Backtest['perCampaign'] = [];
  for (const c of camps) {
    const profiles = ds.customers.filter((cid) => ds.byCustomer.get(cid)![0].day < c.start).map((cid) => cachedProfile(ds, cid, c.start));
    const typeAt = new Map(profiles.map((b) => [b.cid, classify(b).type]));
    const def = defForCampaign(ds, c);
    const resp = responseProfiles(ds, perCustomer, c.start, (cid) => cachedProfile(ds, cid, c.start).avgQty);
    const tested = ds.campaigns.some((x) => x.end < c.start && x.category === c.category && x.mechanic === c.mechanic);
    let n = 0, p = 0, a = 0;
    for (const [cid, rows] of perCustomer) {
      const r = rows.find((x) => x.campaignId === c.id);
      const t = typeAt.get(cid);
      if (!r || !t) continue;
      const x = expectPromo(ds, makeCtx(ds, cid, c.category, c.start), def, resp.get(cid) ?? NO_HISTORY, tested ? 1 : UNTESTED_CONFIDENCE, A);
      const cell = acc.get(t)!;
      cell.n++; cell.p += x.p1; cell.a += r.bought ? 1 : 0;
      n++; p += x.p1; a += r.bought ? 1 : 0;
    }
    perCampaign.push({ campaign: c, predicted: n ? p / n : 0, actual: n ? a / n : 0, n });
  }
  const rows: BacktestRow[] = TYPE_IDS.map((t) => {
    const v = acc.get(t)!;
    return { seg: t, n: v.n, predicted: v.n ? v.p / v.n : 0, actual: v.n ? v.a / v.n : 0 };
  }).filter((r) => r.n > 0);
  const N = rows.reduce((t, r) => t + r.n, 0);
  const P = rows.reduce((t, r) => t + r.predicted * r.n, 0);
  const Aa = rows.reduce((t, r) => t + r.actual * r.n, 0);
  const mae = rows.reduce((t, r) => t + Math.abs(r.predicted - r.actual), 0) / Math.max(1, rows.length);
  const weightedMae = rows.reduce((t, r) => t + Math.abs(r.predicted - r.actual) * r.n, 0) / Math.max(1, N);
  // gains: contact segments in order of predicted response; how many of the actual buyers are reached
  const ranked = [...rows].sort((x, y) => y.predicted - x.predicted);
  const gains: Backtest['gains'] = [{ share: 0, captured: 0 }];
  let cn = 0, ca = 0;
  for (const r of ranked) { cn += r.n; ca += r.actual * r.n; gains.push({ share: cn / N, captured: Aa ? ca / Aa : 0, seg: r.seg }); }
  return { campaigns: camps, rows, overall: { n: N, predicted: N ? P / N : 0, actual: N ? Aa / N : 0, mae, weightedMae }, gains, perCampaign };
}
