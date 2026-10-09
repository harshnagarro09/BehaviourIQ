// Promotion options for comparison, plus plain-language explanation of any single prediction.
import type { Dataset } from './data.ts';
import { expect, type Expectation } from './economics.ts';
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Ctx } from './simulation.ts';

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
  ds: Dataset, ctxs: Ctx[], category: string, options: PromoOption[], A: Assumptions = DEFAULT_ASSUMPTIONS,
  pick: (cid: string, optionKey: string, perOption: Map<string, Expectation>) => boolean = () => true,
): Comparison {
  const exps = new Map<string, Map<string, Expectation>>();
  for (const o of options) {
    const m = new Map<string, Expectation>();
    for (const c of ctxs) m.set(c.cid, expect(ds, c, offerOf(o, category), A));
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

// ------------------------------------------------------------------ behaviour signals
export interface Signal {
  factor: string; // the customer behaviour
  reading: string; // the customer's own value, in words
  use: string; // how the simulation uses it
  tone: 'up' | 'down' | 'flat'; // effect on the simulated response to an offer
}

/** The nine behaviours the simulation reads, with the customer's own values */
export const SIGNAL_NAMES = [
  'Previous promotion response', 'Purchase frequency', 'Product affinity', 'Price sensitivity',
  'Recency', 'Existing buying of our brand', 'Timing preference', 'Basket behaviour',
] as const;

const pc = (v: number) => `${Math.round(v * 100)}%`;

export function behaviourSignals(ctx: Ctx, category: string): Signal[] {
  const b = ctx.b;
  const catShare = b.catShare[category] ?? 0;
  const putOff = b.lift < 0.6 && b.fullPriceBuysPerMonth >= 1.5;
  return [
    { factor: 'Previous promotion response', reading: `bought on ${b.respondedCampaigns} of ${b.activeCampaigns} past promotions (${pc(b.respRate)}); volume in promotion windows is ${b.lift.toFixed(1)}x normal`, use: 'Sets the response to shallow and deep offers', tone: putOff ? 'down' : b.respRate >= 0.3 ? 'up' : 'flat' },
    { factor: 'Purchase frequency', reading: `${b.ordersPerMonth.toFixed(1)} orders a month`, use: 'Sets the baseline chance of buying with no offer', tone: b.ordersPerMonth >= 3 ? 'down' : 'flat' },
    { factor: 'Product affinity', reading: `${pc(catShare)} of their basket is ${category}`, use: 'Scales the response up or down (x0.6 to x1.25)', tone: ctx.affinity >= 1 ? 'up' : 'down' },
    { factor: 'Price sensitivity', reading: `${pc(b.promoReliance)} of our-brand purchases on promotion; average discount taken ${b.avgDiscAccepted.toFixed(0)}%`, use: 'Reads response between shallow and deep discount levels', tone: b.promoReliance >= 0.5 ? 'up' : 'flat' },
    { factor: 'Recency', reading: `last ordered ${b.recencyDays} days ago`, use: 'Part of the timing check on the baseline', tone: b.recencyDays > 45 ? 'up' : 'flat' },
    { factor: 'Existing buying of our brand', reading: `${b.fullPriceBuysPerMonth.toFixed(1)} full-price purchases of our brand a month`, use: 'High full-price buying means they buy anyway: a Sure Thing, so the offer adds little', tone: b.fullPriceBuysPerMonth >= 2.5 ? 'down' : 'flat' },
    { factor: 'Timing preference', reading: `buys about every ${b.avgInterval.toFixed(0)} days, ${pc(b.weekendShare)} of orders at weekends`, use: `Due-to-reorder check (baseline x${ctx.due.toFixed(1)})`, tone: ctx.due > 1 ? 'down' : 'flat' },
    { factor: 'Basket behaviour', reading: `${b.linesPerOrder.toFixed(1)} items per order, ${b.qtyRatio.toFixed(1)}x normal quantity on promotion`, use: 'Fit for multi-buy and minimum-spend offers', tone: b.qtyRatio >= 1.7 ? 'up' : 'flat' },
  ];
}
