// Descriptive analytics for the six behaviour dimensions in the research brief.
import { dowOf, type Behaviour, type TypeId } from './behaviour.ts';
import type { CampaignResult } from './campaigns.ts';
import type { Dataset, Line } from './data.ts';
import { isoOf } from './data.ts';
import type { SegId } from './groups.ts';

export const TYPE_IDS: TypeId[] = ['anyways', 'deal', 'stockup', 'switcher', 'ignores'];

export interface CustomerRecord {
  cid: string;
  b: Behaviour;
  type: TypeId;
  confidence: number;
  reasons: string[];
  seg: SegId;
}

export interface TypeStat {
  type: TypeId;
  n: number;
  share: number;
  avgOrdersPerMonth: number;
  avgOrderValue: number;
  avgSpend: number;
  spendShare: number;
  promoReliance: number;
  ourShareFull: number;
  respRate: number;
  qtyRatio: number;
  compPerMonth: number;
  recency: number;
  weekendShare: number;
  avgInterval: number;
  avgDisc: number;
  fullPriceShare: number;
  discountCost: number;
  incUnits: number;
  leakage: number;
  netProfit: number;
  roi: number;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export function typeStats(recs: CustomerRecord[], results: CampaignResult[]): TypeStat[] {
  const totalSpend = recs.reduce((s, r) => s + r.b.totalSpend, 0);
  return TYPE_IDS.map((t) => {
    const rs = recs.filter((r) => r.type === t);
    const bs = rs.map((r) => r.b);
    let cost = 0, inc = 0, leak = 0, net = 0;
    for (const r of results) {
      const s = r.byType[t];
      cost += s.discountCost;
      inc += s.incUnits;
      leak += s.leakage;
      net += s.netProfit;
    }
    return {
      type: t,
      n: rs.length,
      share: rs.length / recs.length,
      avgOrdersPerMonth: mean(bs.map((b) => b.ordersPerMonth)),
      avgOrderValue: mean(bs.map((b) => b.avgOrderValue)),
      avgSpend: mean(bs.map((b) => b.totalSpend)),
      spendShare: bs.reduce((s, b) => s + b.totalSpend, 0) / totalSpend,
      promoReliance: mean(bs.map((b) => b.promoReliance)),
      ourShareFull: mean(bs.map((b) => b.ourShareFull)),
      respRate: mean(bs.map((b) => b.respRate)),
      qtyRatio: mean(bs.map((b) => b.qtyRatio)),
      compPerMonth: mean(bs.map((b) => b.compPerMonth)),
      recency: mean(bs.map((b) => b.recencyDays)),
      weekendShare: mean(bs.map((b) => b.weekendShare)),
      avgInterval: mean(bs.filter((b) => b.avgInterval > 0).map((b) => b.avgInterval)),
      avgDisc: mean(bs.filter((b) => b.avgDiscAccepted > 0).map((b) => b.avgDiscAccepted)),
      fullPriceShare: mean(bs.map((b) => b.fullPriceShare)),
      discountCost: cost,
      incUnits: inc,
      leakage: leak,
      netProfit: net,
      roi: cost ? net / cost : 0,
    };
  });
}

// ---------------------------------------------------------------- price behaviour
export interface CurvePoint { depth: number; rate: number; n: number }
/** share of active customers of each type who bought on promo, by discount depth */
export function responseCurves(ds: Dataset, recs: CustomerRecord[]): Record<TypeId, CurvePoint[]> {
  const typeOf = new Map(recs.map((r) => [r.cid, r.type]));
  const acc: Record<string, Record<number, { hit: number; n: number }>> = {};
  for (const t of TYPE_IDS) acc[t] = {};
  for (const c of ds.campaigns) {
    for (const cid of ds.customers) {
      const lines = ds.byCustomer.get(cid)!;
      if (lines[0].day > c.end) continue;
      const recent = lines.some((l) => l.day < c.start && l.day >= c.start - 90) || lines[0].day >= c.start - 90;
      if (!recent) continue;
      const t = typeOf.get(cid)!;
      const cell = (acc[t][c.depth] ||= { hit: 0, n: 0 });
      cell.n++;
      if (lines.some((l) => l.promoId === c.id)) cell.hit++;
    }
  }
  const out = {} as Record<TypeId, CurvePoint[]>;
  for (const t of TYPE_IDS)
    out[t] = Object.entries(acc[t])
      .map(([d, v]) => ({ depth: +d, rate: v.hit / v.n, n: v.n }))
      .sort((a, b) => a.depth - b.depth);
  return out;
}

/** per type, share of promo-line units bought at each discount band */
export function priceLadder(ds: Dataset, recs: CustomerRecord[]) {
  const typeOf = new Map(recs.map((r) => [r.cid, r.type]));
  const bands = ['Full price', '10-15% off', '20-25% off', '30%+ / multi-buy'];
  const rows = TYPE_IDS.map((t) => ({ type: t, share: [0, 0, 0, 0], units: 0 }));
  const ix = Object.fromEntries(TYPE_IDS.map((t, i) => [t, i]));
  for (const l of ds.lines) {
    if (!l.ours) continue;
    const r = rows[ix[typeOf.get(l.cid)!]];
    const k = l.disc === 0 ? 0 : l.disc <= 15 ? 1 : l.disc <= 25 ? 2 : 3;
    r.share[k] += l.qty;
    r.units += l.qty;
  }
  rows.forEach((r) => (r.share = r.share.map((v) => (r.units ? v / r.units : 0))));
  return { bands, rows };
}

// ---------------------------------------------------------------- promotion behaviour
export function campaignTypeMatrix(ds: Dataset, results: CampaignResult[]) {
  return results.map((r) => ({
    campaign: r.campaign,
    rates: Object.fromEntries(TYPE_IDS.map((t) => [t, r.byType[t].customers ? r.byType[t].buyers / r.byType[t].customers : 0])) as Record<TypeId, number>,
  }));
}

// ---------------------------------------------------------------- brand behaviour
export function brandBehaviour(ds: Dataset, recs: CustomerRecord[]) {
  const typeOf = new Map(recs.map((r) => [r.cid, r.type]));
  const camp = ds.campaigns;
  const inWin = (l: Line) => camp.some((c) => c.category === l.category && l.day >= c.start && l.day <= c.end);
  const acc = Object.fromEntries(TYPE_IDS.map((t) => [t, { baseOur: 0, baseAll: 0, winOur: 0, winAll: 0 }])) as Record<TypeId, { baseOur: number; baseAll: number; winOur: number; winAll: number }>;
  for (const l of ds.lines) {
    if (!camp.some((c) => c.category === l.category)) continue;
    const a = acc[typeOf.get(l.cid)!];
    if (inWin(l)) {
      a.winAll += l.qty;
      if (l.ours) a.winOur += l.qty;
    } else {
      a.baseAll += l.qty;
      if (l.ours) a.baseOur += l.qty;
    }
  }
  return TYPE_IDS.map((t) => ({
    type: t,
    baselineShare: acc[t].baseAll ? acc[t].baseOur / acc[t].baseAll : 0,
    promoShare: acc[t].winAll ? acc[t].winOur / acc[t].winAll : 0,
  }));
}

/** among customers who normally buy competitors, how many tried us on promo and how many stayed? */
export function switchingFunnel(ds: Dataset, recs: CustomerRecord[]) {
  let rivals = 0, tried = 0, stayed = 0;
  for (const r of recs) {
    if (r.b.ourShareFull >= 0.3) continue;
    rivals++;
    const lines = ds.byCustomer.get(r.cid)!;
    let didTry = false;
    let didStay = false;
    for (const c of ds.campaigns) {
      const t0 = lines.some((l) => l.promoId === c.id);
      if (!t0) continue;
      didTry = true;
      if (lines.some((l) => l.ours && l.disc === 0 && l.category === c.category && l.day > c.end && l.day <= c.end + 30)) didStay = true;
    }
    if (didTry) tried++;
    if (didStay) stayed++;
  }
  return { rivals, tried, stayed };
}

// ---------------------------------------------------------------- basket behaviour
export interface PairStat { a: string; b: string; support: number; lift: number; n: number }
export function basketPairs(ds: Dataset) {
  const orders = new Map<string, Set<string>>();
  const prodOrders = new Map<string, Set<string>>();
  for (const l of ds.lines) {
    let s = orders.get(l.orderId);
    if (!s) orders.set(l.orderId, (s = new Set()));
    s.add(l.category);
    let p = prodOrders.get(l.category);
    if (!p) prodOrders.set(l.category, (p = new Set()));
    p.add(l.orderId);
  }
  const N = orders.size;
  const cats = ds.categories;
  const pairs: PairStat[] = [];
  const matrix: number[][] = cats.map(() => cats.map(() => 1));
  for (let i = 0; i < cats.length; i++)
    for (let j = i + 1; j < cats.length; j++) {
      let both = 0;
      const A = prodOrders.get(cats[i])!;
      const B = prodOrders.get(cats[j])!;
      for (const o of A) if (B.has(o)) both++;
      const lift = (both / N) / ((A.size / N) * (B.size / N));
      matrix[i][j] = matrix[j][i] = lift;
      pairs.push({ a: cats[i], b: cats[j], support: both / N, lift, n: both });
    }
  pairs.sort((x, y) => y.lift - x.lift);
  // promo halo: items per order when the order includes a promoted unit vs other orders in the same windows
  const halo = ds.campaigns.map((c) => {
    let withP = 0, withN = 0, without = 0, withoutN = 0;
    const seen = new Set<string>();
    const lines = ds.lines.filter((l) => l.day >= c.start && l.day <= c.end);
    const per = new Map<string, { n: number; promo: boolean }>();
    for (const l of lines) {
      const o = per.get(l.orderId) ?? { n: 0, promo: false };
      o.n++;
      if (l.promoId === c.id) o.promo = true;
      per.set(l.orderId, o);
      seen.add(l.orderId);
    }
    for (const o of per.values()) {
      if (o.promo) { withP += o.n - 1; withN++; } else { without += o.n; withoutN++; }
    }
    return { campaign: c, withPromo: withN ? withP / withN : 0, without: withoutN ? without / withoutN : 0 };
  });
  return { cats, matrix, pairs, halo, orders: N };
}

// ---------------------------------------------------------------- timing behaviour
export function timingBehaviour(ds: Dataset, recs: CustomerRecord[]) {
  const dow = new Array(7).fill(0);
  const seen = new Set<string>();
  const months: { key: string; label: string }[] = [];
  const monthIx = new Map<string, number>();
  const catMonth: Record<string, number[]> = {};
  for (let d = ds.minDay; d <= ds.maxDay; d++) {
    const k = isoOf(d).slice(0, 7);
    if (!monthIx.has(k)) {
      monthIx.set(k, months.length);
      months.push({ key: k, label: new Date(d * 864e5).toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
    }
  }
  for (const c of ds.categories) catMonth[c] = new Array(months.length).fill(0);
  const intervals: number[] = [];
  for (const l of ds.lines) {
    const key = l.orderId;
    if (!seen.has(key)) { seen.add(key); dow[dowOf(l.day)]++; }
    if (!l.promoId) catMonth[l.category][monthIx.get(isoOf(l.day).slice(0, 7))!] += l.qty;
  }
  for (const r of recs) if (r.b.avgInterval > 0) intervals.push(r.b.avgInterval);
  // seasonality index: month volume / category mean (non-promo units only)
  const seasonality = ds.categories.map((c) => {
    const row = catMonth[c];
    const m = mean(row.slice(1, -1)) || 1; // partial first/last months
    return { category: c, index: row.map((v) => v / m) };
  });
  const edges = [0, 7, 10, 14, 21, 30, 45, 60, 1e9];
  const hist = edges.slice(0, -1).map((lo, i) => ({
    label: i === edges.length - 2 ? `${lo}+ d` : `${lo}-${edges[i + 1]} d`,
    n: intervals.filter((v) => v >= lo && v < edges[i + 1]).length,
  }));
  // within a promo window: on which day do responders buy?
  const dayInWindow = new Array(14).fill(0);
  for (const l of ds.lines) {
    if (!l.promoId) continue;
    const c = ds.campaigns.find((x) => x.id === l.promoId)!;
    const k = l.day - c.start;
    if (k >= 0 && k < 14) dayInWindow[k]++;
  }
  return { dow, months, seasonality, hist, dayInWindow };
}

// ---------------------------------------------------------------- purchasing behaviour
export function monthlyTrend(ds: Dataset) {
  const map = new Map<string, { revenue: number; promoRevenue: number; orders: Set<string> }>();
  for (const l of ds.lines) {
    const k = isoOf(l.day).slice(0, 7);
    const m = map.get(k) ?? { revenue: 0, promoRevenue: 0, orders: new Set<string>() };
    const v = l.unit * l.qty;
    m.revenue += v;
    if (l.promoId) m.promoRevenue += v;
    m.orders.add(l.orderId);
    map.set(k, m);
  }
  return [...map.entries()].map(([k, v]) => ({
    key: k,
    label: new Date(k + '-15T00:00:00Z').toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    revenue: v.revenue,
    promoRevenue: v.promoRevenue,
    orders: v.orders.size,
  }));
}
