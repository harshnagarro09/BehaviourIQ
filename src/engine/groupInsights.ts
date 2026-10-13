// Customer groups and what they buy: per-customer facts from actual order lines in a period, simple data-driven group
// rules, purchase breakdowns by brand / category / SKU, and behaviour alerts that only fire on large, statistically clear
// differences. Everything is computed from the order lines; nothing about a customer is invented.
//
// Facts per customer (lines dated inside the period only):
//   spend a month   = money paid / months in the period
//   orders a month  = distinct orders / months in the period
//   on deals        = money paid on promoted lines / money paid
//   last visit      = days from the last order to the end of the period
//   main channel    = channel of most orders;  favourite category = category with most money paid
//   promotions      = the promotions they bought something on in the period
// Group rule thresholds (spending and frequency thirds) are cut from the customers active in the period, so the labels
// always describe this data ("top third by spend"), not a fixed assumption.
import type { Campaign, Dataset, Line } from './data.ts';
import type { TypeId } from './behaviour.ts';

export interface Period { from: number; to: number } // day numbers, inclusive

export interface CustomerFacts {
  cid: string;
  type: TypeId;
  orders: number;
  spend: number;
  units: number;
  promoSpend: number;
  spendPerMonth: number;
  ordersPerMonth: number;
  dealShare: number; // share of money paid on promoted lines
  lastVisit: number; // days since the last order, at the end of the period
  channel: string;
  favCategory: string;
  catSpend: Record<string, number>; // money paid per category
  promos: string[]; // ids of the promotions they bought on in the period
  promoProducts: Record<string, string[]>; // per promotion: the products (SKUs) they bought under it
}

export const monthsIn = (p: Period) => Math.max(1, (p.to - p.from + 1) / 30.44);

export function periodLines(ds: Dataset, p: Period): Line[] {
  return ds.lines.filter((l) => l.day >= p.from && l.day <= p.to);
}

/** one row per customer who bought in the period */
export function customerFacts(ds: Dataset, typeOf: Map<string, TypeId>, p: Period): CustomerFacts[] {
  const months = monthsIn(p);
  const acc = new Map<string, { orders: Set<string>; spend: number; units: number; promo: number; last: number; ch: Map<string, Set<string>>; cat: Map<string, number>; promos: Map<string, Set<string>> }>();
  for (const l of periodLines(ds, p)) {
    let a = acc.get(l.cid);
    if (!a) acc.set(l.cid, (a = { orders: new Set(), spend: 0, units: 0, promo: 0, last: -Infinity, ch: new Map(), cat: new Map(), promos: new Map() }));
    const v = l.unit * l.qty;
    a.orders.add(l.orderId);
    a.spend += v;
    a.units += l.qty;
    if (l.promoId) {
      a.promo += v;
      let ps = a.promos.get(l.promoId);
      if (!ps) a.promos.set(l.promoId, (ps = new Set()));
      ps.add(l.productId);
    }
    if (l.day > a.last) a.last = l.day;
    if (!a.ch.has(l.channel)) a.ch.set(l.channel, new Set());
    a.ch.get(l.channel)!.add(l.orderId);
    a.cat.set(l.category, (a.cat.get(l.category) ?? 0) + v);
  }
  const top = <K,>(m: Map<K, number>) => [...m].sort((x, y) => y[1] - x[1])[0]?.[0];
  const out: CustomerFacts[] = [];
  for (const [cid, a] of acc) {
    const type = typeOf.get(cid);
    if (!type) continue;
    out.push({
      cid, type, orders: a.orders.size, spend: a.spend, units: a.units, promoSpend: a.promo,
      spendPerMonth: a.spend / months, ordersPerMonth: a.orders.size / months, dealShare: a.spend > 0 ? a.promo / a.spend : 0,
      lastVisit: p.to - a.last, channel: top(new Map([...a.ch].map(([k, s]) => [k, s.size]))) ?? 'Unknown', favCategory: top(a.cat) ?? '', catSpend: Object.fromEntries(a.cat), promos: [...a.promos.keys()], promoProducts: Object.fromEntries([...a.promos].map(([k, s]) => [k, [...s]])),
    });
  }
  return out.sort((x, y) => x.cid.localeCompare(y.cid));
}

// ------------------------------------------------------------------------ group rules
export type RuleKey = 'spend' | 'frequency' | 'visit' | 'deals' | 'channel' | 'promo';
export type Rules = Partial<Record<RuleKey, string>>;
export interface RuleOption { value: string; label: string; hint: string; group?: string; test: (f: CustomerFacts) => boolean }
export interface RuleDef { key: RuleKey; label: string; any: string; options: RuleOption[] } // `any` = the "no filter" wording

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const rupees = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

/**
 * The rules a group can be built from, with thresholds cut from this data. "Bought on promotion" lists every promotion
 * that at least one of these customers bought on in the period (grouped by category, newest first), so none is left out.
 * With a product filter (`inScope`, by product id) only purchases of those products count: a promotion is listed only if
 * someone bought one of the chosen products under it, and picking it keeps only the customers who did.
 */
export function ruleDefs(facts: CustomerFacts[], campaigns: Campaign[] = [], inScope?: (productId: string) => boolean): RuleDef[] {
  const boughtOn = (f: CustomerFacts, id: string) => !!f.promoProducts[id] && (!inScope || f.promoProducts[id].some(inScope));
  const s1 = quantile(facts.map((f) => f.spendPerMonth), 1 / 3), s2 = quantile(facts.map((f) => f.spendPerMonth), 2 / 3);
  const o1 = quantile(facts.map((f) => f.ordersPerMonth), 1 / 3), o2 = quantile(facts.map((f) => f.ordersPerMonth), 2 / 3);
  const channels = [...new Set(facts.map((f) => f.channel))].sort();
  const buyers = new Map<string, number>();
  for (const f of facts) for (const id of f.promos) if (boughtOn(f, id)) buyers.set(id, (buyers.get(id) ?? 0) + 1);
  const promos = campaigns.filter((c) => buyers.has(c.id)).sort((a, b) => a.category.localeCompare(b.category) || b.start - a.start);
  return [
    { key: 'spend', label: 'Spending', any: 'All spending levels', options: [
      { value: 'high', label: 'Top spenders', hint: `${rupees(s2)}+ a month`, test: (f) => f.spendPerMonth >= s2 },
      { value: 'mid', label: 'Middle spenders', hint: `${rupees(s1)}–${rupees(s2)} a month`, test: (f) => f.spendPerMonth >= s1 && f.spendPerMonth < s2 },
      { value: 'low', label: 'Lower spenders', hint: `under ${rupees(s1)} a month`, test: (f) => f.spendPerMonth < s1 },
    ] },
    { key: 'frequency', label: 'How often they shop', any: 'All shopping habits', options: [
      { value: 'frequent', label: 'Frequent shoppers', hint: `${o2.toFixed(1)}+ orders a month`, test: (f) => f.ordersPerMonth >= o2 },
      { value: 'regular', label: 'Regular shoppers', hint: `${o1.toFixed(1)}–${o2.toFixed(1)} a month`, test: (f) => f.ordersPerMonth >= o1 && f.ordersPerMonth < o2 },
      { value: 'occasional', label: 'Occasional shoppers', hint: `under ${o1.toFixed(1)} a month`, test: (f) => f.ordersPerMonth < o1 },
    ] },
    { key: 'visit', label: 'Last visit', any: 'Any time', options: [
      { value: 'active', label: 'Shopped recently', hint: 'last 30 days', test: (f) => f.lastVisit <= 30 },
      { value: 'slowing', label: 'Slowing down', hint: '31–90 days ago', test: (f) => f.lastVisit > 30 && f.lastVisit <= 90 },
      { value: 'lapsed', label: 'Not seen lately', hint: 'over 90 days ago', test: (f) => f.lastVisit > 90 },
    ] },
    { key: 'deals', label: 'Deal habit', any: 'Any deal habit', options: [
      { value: 'full', label: 'Mostly full price', hint: 'under 20% on deals', test: (f) => f.dealShare < 0.2 },
      { value: 'mixed', label: 'Mix of both', hint: '20–50% on deals', test: (f) => f.dealShare >= 0.2 && f.dealShare <= 0.5 },
      { value: 'deals', label: 'Mostly on deals', hint: 'over 50% on deals', test: (f) => f.dealShare > 0.5 },
    ] },
    { key: 'channel', label: 'Main channel', any: 'All channels', options: channels.map((c) => ({ value: c, label: c, hint: 'most orders here', test: (f: CustomerFacts) => f.channel === c })) },
    { key: 'promo', label: 'Bought on promotion', any: `Any promotion (${promos.length} ran)`, options: promos.map((c) => ({
      value: c.id, label: c.name, group: c.category, hint: `${buyers.get(c.id)} buyers`, test: (f: CustomerFacts) => boughtOn(f, c.id),
    })) },
  ];
}

export function applyRules(facts: CustomerFacts[], defs: RuleDef[], rules: Rules): CustomerFacts[] {
  const tests = defs.flatMap((d) => { const v = rules[d.key]; const o = v ? d.options.find((x) => x.value === v) : undefined; return o ? [o.test] : []; });
  return tests.length ? facts.filter((f) => tests.every((t) => t(f))) : facts;
}

// ------------------------------------------------------------------------ what a group buys
export interface Slice { key: string; label: string; sub?: string; spend: number; units: number; buyers: number }
export interface Purchases {
  customers: number; // customers in the group (bought anything in the period)
  buyers: number; // of them, bought in the product scope
  spend: number; units: number; orders: number; promoSpend: number;
  brands: Slice[]; categories: Slice[]; skus: Slice[];
}

export function purchases(ds: Dataset, group: Set<string>, p: Period, scope: (l: Line) => boolean = () => true): Purchases {
  const orders = new Set<string>(), buyers = new Set<string>();
  let spend = 0, units = 0, promo = 0;
  const maps = { brands: new Map<string, Slice & { who: Set<string> }>(), categories: new Map<string, Slice & { who: Set<string> }>(), skus: new Map<string, Slice & { who: Set<string> }>() };
  const add = (m: Map<string, Slice & { who: Set<string> }>, key: string, label: string, sub: string | undefined, l: Line, v: number) => {
    let s = m.get(key);
    if (!s) m.set(key, (s = { key, label, sub, spend: 0, units: 0, buyers: 0, who: new Set() }));
    s.spend += v; s.units += l.qty; s.who.add(l.cid);
  };
  for (const l of ds.lines) {
    if (l.day < p.from || l.day > p.to || !group.has(l.cid) || !scope(l)) continue;
    const v = l.unit * l.qty;
    spend += v; units += l.qty; orders.add(l.orderId); buyers.add(l.cid);
    if (l.promoId) promo += v;
    add(maps.brands, l.brand, l.brand, undefined, l, v);
    add(maps.categories, l.category, l.category, undefined, l, v);
    add(maps.skus, l.productId, l.product, `${l.category} · ${l.brand}`, l, v);
  }
  const done = (m: Map<string, Slice & { who: Set<string> }>) => [...m.values()].map(({ who, ...s }) => ({ ...s, buyers: who.size })).sort((a, b) => b.spend - a.spend);
  return { customers: group.size, buyers: buyers.size, spend, units, orders: orders.size, promoSpend: promo, brands: done(maps.brands), categories: done(maps.categories), skus: done(maps.skus) };
}

/**
 * How much more (or less) a group leans to an item than everyone does: its share of the group's spend divided by its
 * share of all customers' spend. Only read when enough group customers bought it.
 */
export function leaning(item: Slice, group: Purchases, all: Slice | undefined, allSpend: number): number | null {
  if (!all || item.buyers < 8 || group.spend <= 0 || allSpend <= 0 || all.spend <= 0) return null;
  return (item.spend / group.spend) / (all.spend / allSpend);
}

// ------------------------------------------------------------------------ behaviour alerts
export type Metric = 'dealShare' | 'spendPerMonth' | 'ordersPerMonth' | 'catShare';
export const METRIC_TEXT: Record<Metric, { name: string; fmt: (v: number) => string }> = {
  dealShare: { name: 'share of spending on deals', fmt: (v) => `${Math.round(v * 100)}%` },
  spendPerMonth: { name: 'spend a month', fmt: (v) => rupees(v) },
  ordersPerMonth: { name: 'orders a month', fmt: (v) => v.toFixed(1) },
  catShare: { name: 'share of spending', fmt: (v) => `${Math.round(v * 100)}%` },
};
/**
 * Which comparisons can be a finding. Spending, frequency and last visit all measure how much someone shops, so comparing
 * them with spend or orders only restates the rule (frequent shoppers spend more). Real findings are about behaviour mix:
 * reliance on deals, product preference, or volume differences across channels. "Bought on promotion X" is not tested:
 * it only restates that those customers bought on a deal.
 */
const ALLOWED: Record<Exclude<Metric, 'catShare'>, RuleKey[]> = {
  dealShare: ['spend', 'frequency', 'visit', 'channel'],
  spendPerMonth: ['channel'],
  ordersPerMonth: ['channel'],
};
const CAT_RULES: RuleKey[] = ['spend', 'frequency', 'visit', 'deals', 'channel'];

export interface Alert {
  type: TypeId;
  rule: { key: RuleKey; value: string; label: string };
  metric: Metric;
  category?: string; // for catShare: the category whose share differs
  n: number; // customers in the sub-group
  of: number; // customers in the customer type
  inside: number; // metric inside the sub-group
  rest: number; // metric for the rest of the type
  t: number; // Welch t statistic
}

const meanVar = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { m, v: xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) };
};

/** Minimum sizes and strength for an alert; strict, because many splits are tested and small groups vary a lot. */
export const ALERT_RULES = { minType: 40, minSub: 20, minRest: 20, maxSubShare: 0.6, minT: 3.5, minRelative: 0.3, minShare: 0.05 };

/**
 * Sub-groups inside each customer type that behave clearly differently from the rest of that type. A sub-group is one
 * rule option (for example "main channel: App") covering at most 60% of the type; it needs 20+ customers on both sides, a difference of 30%+ and a
 * Welch t of 3.5+ (chance below about 1 in 2,000 per test), so random variation does not raise alerts.
 */
export function behaviourAlerts(facts: CustomerFacts[], defs: RuleDef[], max = 4): Alert[] {
  const out: Alert[] = [];
  const cats = [...new Set(facts.flatMap((f) => Object.keys(f.catSpend)))].sort();
  const catTotal = (f: CustomerFacts) => Object.values(f.catSpend).reduce((t, v) => t + v, 0);
  const value = (f: CustomerFacts, m: Metric, c?: string) => (m === 'catShare' ? (catTotal(f) > 0 ? (f.catSpend[c!] ?? 0) / catTotal(f) : 0) : f[m]);
  const test = (type: TypeId, d: RuleDef, o: RuleOption, sub: CustomerFacts[], rest: CustomerFacts[], of: number, metric: Metric, c?: string) => {
    const a = meanVar(sub.map((f) => value(f, metric, c))), b = meanVar(rest.map((f) => value(f, metric, c)));
    const se = Math.sqrt(a.v / sub.length + b.v / rest.length);
    if (se <= 0 || b.m <= 0) return;
    if (metric === 'catShare' && Math.max(a.m, b.m) < ALERT_RULES.minShare) return; // a category they hardly buy is not a finding
    const t = (a.m - b.m) / se;
    if (Math.abs(t) < ALERT_RULES.minT || Math.abs(a.m - b.m) / b.m < ALERT_RULES.minRelative) return;
    out.push({ type, rule: { key: d.key, value: o.value, label: o.label }, metric, category: c, n: sub.length, of, inside: a.m, rest: b.m, t });
  };
  for (const type of [...new Set(facts.map((f) => f.type))]) {
    const inType = facts.filter((f) => f.type === type);
    if (inType.length < ALERT_RULES.minType) continue;
    for (const d of defs) for (const o of d.options) {
      if (d.key === 'promo') continue;
      const sub = inType.filter(o.test), rest = inType.filter((f) => !o.test(f));
      // a separate segment must be a real minority of the type, with enough customers on both sides
      if (sub.length < ALERT_RULES.minSub || rest.length < ALERT_RULES.minRest || sub.length > ALERT_RULES.maxSubShare * inType.length) continue;
      for (const metric of ['dealShare', 'spendPerMonth', 'ordersPerMonth'] as const) if (ALLOWED[metric].includes(d.key)) test(type, d, o, sub, rest, inType.length, metric);
      if (CAT_RULES.includes(d.key)) for (const c of cats) test(type, d, o, sub, rest, inType.length, 'catShare', c);
    }
  }
  // strongest first, one alert per customer type and kind of finding, so the list stays short and varied
  const seen = new Set<string>();
  return out.sort((x, y) => Math.abs(y.t) - Math.abs(x.t)).filter((a) => { const k = `${a.type}|${a.metric}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
}
