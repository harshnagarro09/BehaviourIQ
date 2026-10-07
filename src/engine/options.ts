// Promotion options for comparison, plus plain-language explanation of any single prediction.
import type { Dataset } from './data.ts';
import { expect, type Expectation } from './economics.ts';
import { FEATURES, vector, type Ctx, type TrainedModel } from './model.ts';

export interface PromoOption {
  key: string;
  label: string;
  family: string; // none | percentage | fixed | bogo | bundle
  depth: number;
  mechanic: string;
  minSpend?: number;
  note?: string;
}

/** Display name of a promotion type */
export function offerName(mechanic: string, depth: number, flat = 0, minSpend = 0): string {
  if (mechanic === 'BOGO') return 'BOGO';
  if (mechanic === 'MULTIBUY_3FOR2') return 'Bundle / Combo Offer';
  if (mechanic === 'FLAT_OFF') return `₹${Math.round(flat)} Off on ₹${Math.round(minSpend)}+`;
  return `${depth}% Discount`;
}

/** Short label for chart axes */
export const shortOffer = (label: string) =>
  label.replace(' Discount', '').replace('Bundle / Combo Offer', 'Bundle').replace(/₹(\d+) Off on ₹(\d+)\+/, '₹$1 off');

export const offerOf = (o: PromoOption, category: string) => ({ category, depth: o.depth, mechanic: o.mechanic, minSpend: o.minSpend });

/** The six promotion types. The flat offer uses the Rs-off and minimum spend seen in that category's history. */
export function promoOptions(ds: Dataset, category: string): PromoOption[] {
  const list = ds.ourEcon[category].list;
  const hist = ds.campaigns.find((c) => c.category === category && c.mechanic === 'FLAT_OFF');
  const flat = hist ? Math.round(hist.flat) : Math.max(5, Math.round((list * 0.15) / 5) * 5);
  const minSpend = hist && hist.minSpend ? hist.minSpend : Math.round((list * 2) / 10) * 10;
  return [
    { key: 'none', label: 'No Promotion', family: 'none', depth: 0, mechanic: 'PCT_OFF' },
    { key: 'pct10', label: '10% Discount', family: 'percentage', depth: 10, mechanic: 'PCT_OFF' },
    { key: 'pct20', label: '20% Discount', family: 'percentage', depth: 20, mechanic: 'PCT_OFF' },
    { key: 'fixed', label: offerName('FLAT_OFF', 0, flat, minSpend), family: 'fixed', depth: Math.round((flat / list) * 100), mechanic: 'FLAT_OFF', minSpend },
    { key: 'bogo', label: 'BOGO', family: 'bogo', depth: 50, mechanic: 'BOGO' },
    { key: 'bundle', label: 'Bundle / Combo Offer', family: 'bundle', depth: 33, mechanic: 'MULTIBUY_3FOR2' },
  ];
}

export interface Summary {
  option: PromoOption;
  customers: number;
  response: number; // average chance of buying among the audience
  orders: number; // expected purchase occasions
  units: number;
  revenue: number;
  incRevenue: number;
  margin: number; // gross margin on the promoted sales
  cost: number; // discount given
  leakage: number;
  net: number; // incremental profit after pull-forward
  roi: number;
}

const money = (v: number) => `${v < 0 ? '-' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`;

export function summarise(ds: Dataset, category: string, option: PromoOption, exps: Expectation[]): Summary {
  const L = ds.ourEcon[category].list;
  const s: Summary = { option, customers: exps.length, response: 0, orders: 0, units: 0, revenue: 0, incRevenue: 0, margin: 0, cost: 0, leakage: 0, net: 0, roi: 0 };
  if (option.family === 'none') {
    // the do-nothing reference: what the same customers buy at full price
    for (const e of exps) {
      s.response += e.p0;
      s.orders += e.p0;
      s.units += e.baseUnits;
      s.revenue += e.baseUnits * L;
      s.margin += e.profitBase;
    }
    s.response = exps.length ? s.response / exps.length : 0;
    return s;
  }
  let base = 0;
  for (const e of exps) {
    s.response += e.p1;
    s.orders += e.p1;
    s.units += e.units;
    s.revenue += e.revenue;
    base += e.baseUnits * L;
    s.margin += e.profitOffer;
    s.cost += e.discountCost;
    s.leakage += e.leakage;
    s.net += e.net;
  }
  s.response = exps.length ? s.response / exps.length : 0;
  s.incRevenue = s.revenue - base;
  s.roi = s.cost > 0 ? s.net / s.cost : 0;
  return s;
}

export interface Comparison {
  summaries: Summary[];
  exps: Map<string, Map<string, Expectation>>; // option key -> cid -> expectation
}

export function compareOptions(
  ds: Dataset, model: Pick<TrainedModel, 'w' | 'b0' | 'mu' | 'sd'>, ctxs: Ctx[], category: string, options: PromoOption[],
  pick: (cid: string, optionKey: string, perOption: Map<string, Expectation>) => boolean = () => true,
): Comparison {
  const exps = new Map<string, Map<string, Expectation>>();
  for (const o of options) {
    const m = new Map<string, Expectation>();
    for (const c of ctxs) m.set(c.cid, expect(ds, model, c, offerOf(o, category)));
    exps.set(o.key, m);
  }
  const summaries = options.map((o) => {
    const list: Expectation[] = [];
    for (const c of ctxs) {
      const per = new Map(options.map((x) => [x.key, exps.get(x.key)!.get(c.cid)!]));
      if (pick(c.cid, o.key, per)) list.push(exps.get(o.key)!.get(c.cid)!);
    }
    return summarise(ds, category, o, list);
  });
  return { summaries, exps };
}

export interface Recommended {
  best: Summary;
  highestResponse: Summary;
  text: string;
  scores: { key: string; score: number }[];
}

/** Response alone never decides: profit, ROI and spend are all weighed. */
export function recommendOption(summaries: Summary[]): Recommended | null {
  // ignore options that only work for a handful of customers
  const minAud = Math.max(10, 0.05 * (summaries[0]?.customers ?? 0));
  const promos = summaries.filter((s) => s.option.family !== 'none' && s.customers >= minAud);
  if (!promos.length) return null;
  const maxNet = Math.max(...promos.map((s) => s.net), 1);
  const maxResp = Math.max(...promos.map((s) => s.response), 0.0001);
  const maxRoi = Math.max(...promos.map((s) => s.roi), 0.0001);
  const maxInc = Math.max(...promos.map((s) => s.incRevenue), 1);
  const scores = promos.map((s) => ({
    key: s.option.key,
    // profit 40%, ROI 25%, incremental revenue 20%, response 15%; unprofitable options are excluded
    score: s.net <= 0 ? -1 : 0.4 * (s.net / maxNet) + 0.25 * (Math.max(0, s.roi) / maxRoi) + 0.2 * (Math.max(0, s.incRevenue) / maxInc) + 0.15 * (s.response / maxResp),
  }));
  const top = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const hr = promos.reduce((a, b) => (b.response > a.response ? b : a));
  if (top.score < 0) return null;
  const best = promos.find((s) => s.option.key === top.key)!;
  let text: string;
  if (hr.option.key === best.option.key)
    text = `${best.option.label} has both the highest predicted response (${(best.response * 100).toFixed(0)}%) and the best overall balance, with net profit of ${money(best.net)} and ROI ${best.roi.toFixed(2)}.`;
  else
    text = `${hr.option.label} has the highest predicted response (${(hr.response * 100).toFixed(0)}%), but ${best.option.label} gives the better balance: ROI ${best.roi.toFixed(2)} vs ${hr.roi.toFixed(2)}, net profit ${money(best.net)} vs ${money(hr.net)}. Response is only one of the things that matters.`;
  return { best, highestResponse: hr, text, scores };
}

// ------------------------------------------------------------------ why this prediction?
const FACTOR: Record<string, string> = {
  pastResp: 'Previous promotion response', lift: 'Previous promotion response', dxResp: 'Previous promotion response',
  dxPromoRel: 'Price sensitivity', promoRel: 'Price sensitivity', avgDisc: 'Price sensitivity', depth: 'Price sensitivity',
  freq: 'Purchase frequency',
  catShare: 'Product affinity', ourShareCat: 'Product affinity', dxOur: 'Product affinity',
  basket: 'Basket behaviour', dxQty: 'Basket behaviour', qty: 'Basket behaviour',
  recency: 'Recency',
  due: 'Timing preference',
  compShare: 'Brand habit (competitor use)', dxComp: 'Brand habit (competitor use)',
  baseline: 'Existing buying of our brand',
};
export const FACTOR_ORDER = [
  'Previous promotion response', 'Price sensitivity', 'Purchase frequency', 'Product affinity', 'Basket behaviour', 'Recency',
  'Timing preference', 'Brand habit (competitor use)', 'Existing buying of our brand',
];

export interface FactorEffect {
  factor: string;
  effect: number; // contribution to the log-odds, vs the average customer
  reading: string; // the customer's own value, in words
}

export function explain(model: Pick<TrainedModel, 'w' | 'mu' | 'sd'>, ctx: Ctx, depth: number, mechanic: string, category: string): FactorEffect[] {
  const x = vector(ctx, depth, mechanic);
  const sum = new Map<string, number>();
  FEATURES.forEach((f, j) => {
    const z = (x[j] - model.mu[j]) / model.sd[j];
    sum.set(FACTOR[f.key], (sum.get(FACTOR[f.key]) ?? 0) + model.w[j] * z);
  });
  const b = ctx.b;
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  const reading: Record<string, string> = {
    'Previous promotion response': `responded to ${b.respondedCampaigns} of ${b.activeCampaigns} past promotions (${pc(b.respRate)})`,
    'Price sensitivity': `${pc(b.promoReliance)} of our-brand purchases were on promotion, average discount taken ${b.avgDiscAccepted.toFixed(0)}%`,
    'Purchase frequency': `${b.ordersPerMonth.toFixed(1)} orders a month`,
    'Product affinity': `${pc(b.catShare[category] ?? 0)} of their basket is ${category}`,
    'Basket behaviour': `${b.linesPerOrder.toFixed(1)} items per order, ${b.qtyRatio.toFixed(1)}x normal quantity on promo`,
    'Recency': `last ordered ${b.recencyDays} days ago`,
    'Timing preference': `buys about every ${b.avgInterval.toFixed(0)} days, ${pc(b.weekendShare)} of orders at weekends`,
    'Brand habit (competitor use)': `${b.compPerMonth.toFixed(1)} competitor items a month`,
    'Existing buying of our brand': `${pc(b.ourShareFull)} of full-price purchases are our brand`,
  };
  return FACTOR_ORDER.map((factor) => ({ factor, effect: sum.get(factor) ?? 0, reading: reading[factor] }));
}
