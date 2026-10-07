// Promotion response model.
//
// Question answered: "if customer X is offered discount d on category C, what is the chance they buy our brand
// in the next 14 days?"  One logistic regression is trained on past 14-day windows (campaign windows with
// depth > 0 and non-campaign windows with depth = 0). Because depth is an input, the same model gives the
// counterfactual:   uplift = P(buy | discount d) - P(buy | no discount).
// Every feature is computed from data BEFORE the window starts, and validation uses a time split.
import { baselineRate, cutIndex, profile, type Behaviour } from './behaviour.ts';
import type { Campaign, Dataset, Line } from './data.ts';

/** the model predicts the chance of buying within this many days of the offer starting (profit uses the same window) */
export const PREDICTION_WINDOW_DAYS = 14;

export type FeatureGroup = 'Purchasing' | 'Price' | 'Promotion' | 'Brand' | 'Basket' | 'Timing';

export const FEATURES: { key: string; label: string; group: FeatureGroup }[] = [
  { key: 'recency', label: 'Days since last order', group: 'Purchasing' },
  { key: 'freq', label: 'Orders per month', group: 'Purchasing' },
  { key: 'baseline', label: 'Own baseline buying of our brand in category', group: 'Purchasing' },
  { key: 'qty', label: 'Promo quantity vs normal quantity', group: 'Purchasing' },
  { key: 'avgDisc', label: 'Average discount accepted so far', group: 'Price' },
  { key: 'depth', label: 'Discount depth offered', group: 'Price' },
  { key: 'promoRel', label: 'Share of purchases made on promo', group: 'Promotion' },
  { key: 'pastResp', label: 'Response to previous promotions', group: 'Promotion' },
  { key: 'lift', label: 'Past volume lift during promos', group: 'Promotion' },
  { key: 'dxPromoRel', label: 'Discount x promo reliance', group: 'Price' },
  { key: 'dxResp', label: 'Discount x past response', group: 'Promotion' },
  { key: 'ourShareCat', label: 'Our-brand share in this category', group: 'Brand' },
  { key: 'compShare', label: 'Competitor share of purchases', group: 'Brand' },
  { key: 'dxComp', label: 'Discount x competitor share', group: 'Brand' },
  { key: 'dxOur', label: 'Discount x our-brand share', group: 'Brand' },
  { key: 'catShare', label: 'Share of basket in this category', group: 'Basket' },
  { key: 'basket', label: 'Items per order', group: 'Basket' },
  { key: 'dxQty', label: 'Multi-buy offer x stock-up tendency', group: 'Basket' },
  { key: 'due', label: 'Days since last order vs usual interval', group: 'Timing' },
];
const NF = FEATURES.length;

export interface Ctx {
  cid: string;
  cat: string;
  base: number[]; // features independent of the offer
  b: Behaviour;
  /** typical units per our-brand purchase at full price / on promo */
  qFull: number;
  qPromo: number;
  baselineUnits14: number;
}

const profCache = new WeakMap<Dataset, Map<string, Behaviour>>();
export function cachedProfile(ds: Dataset, cid: string, asOf: number): Behaviour {
  let m = profCache.get(ds);
  if (!m) profCache.set(ds, (m = new Map()));
  const k = cid + '|' + asOf;
  let p = m.get(k);
  if (!p) m.set(k, (p = profile(ds, cid, asOf)));
  return p;
}

export function makeCtx(ds: Dataset, cid: string, cat: string, asOf: number): Ctx {
  const b = cachedProfile(ds, cid, asOf);
  const all = ds.byCustomer.get(cid) ?? [];
  const lines = all.slice(0, cutIndex(all, asOf));
  let ourFull = 0, comp = 0, ourFullQty = 0, promoQty = 0, promoN = 0;
  for (const l of lines) {
    if (l.category !== cat) continue;
    if (l.ours) {
      if (l.disc === 0) {
        ourFull++;
        ourFullQty += l.qty;
      } else {
        promoN++;
        promoQty += l.qty;
      }
    } else comp++;
  }
  const ourShareCat = (ourFull + 0.3) / (ourFull + comp + 1);
  const base14 = baselineRate(ds, lines, cat, asOf) * PREDICTION_WINDOW_DAYS;
  const qFull = ourFull ? ourFullQty / ourFull : b.avgQty || 1.3;
  const qPromo = promoN ? promoQty / promoN : qFull * Math.max(1, b.qtyRatio);
  const due = b.avgInterval > 0 ? Math.min(4, Math.max(0, b.recencyDays) / b.avgInterval) : 1;
  const base = [
    Math.log1p(Math.max(0, b.recencyDays)),
    b.ordersPerMonth,
    Math.log1p(base14 * 10),
    Math.log(Math.max(0.5, b.qtyRatio)),
    b.avgDiscAccepted / 100,
    0, // depth (filled in per offer)
    (b.promoOurLines + 0.3) / (b.ourLines + 1),
    (b.respondedCampaigns + 0.3) / (b.activeCampaigns + 1),
    Math.log(Math.max(0.2, b.lift)),
    0, 0,
    ourShareCat,
    b.nLines ? b.compLines / b.nLines : 0,
    0, 0,
    b.catShare[cat] ?? 0,
    b.linesPerOrder,
    0,
    due,
  ];
  return { cid, cat, base, b, qFull, qPromo, baselineUnits14: base14 };
}

const IX = Object.fromEntries(FEATURES.map((f, i) => [f.key, i]));

/** full feature vector for an offer (depth in % off, 0 = no promotion) */
export function vector(ctx: Ctx, depth: number, mechanic: string): number[] {
  const x = ctx.base.slice();
  const d = depth / 100;
  x[IX.depth] = d;
  x[IX.dxPromoRel] = d * x[IX.promoRel];
  x[IX.dxResp] = d * x[IX.pastResp];
  x[IX.dxComp] = d * x[IX.compShare];
  x[IX.dxOur] = d * x[IX.ourShareCat];
  x[IX.dxQty] = mechanic === 'BOGO' || mechanic === 'MULTIBUY_3FOR2' ? d * x[IX.qty] : 0;
  return x;
}

export interface Calibration { lo: number; hi: number; predicted: number; actual: number; n: number }
export interface GainPoint { pctCustomers: number; pctResponders: number }

export interface TrainedModel {
  w: number[];
  b0: number;
  mu: number[];
  sd: number[];
  aucTrain: number;
  aucTest: number;
  nTrain: number;
  nTest: number;
  baseRateTest: number;
  calibration: Calibration[];
  gains: GainPoint[];
  importance: { key: string; label: string; group: FeatureGroup; weight: number; share: number }[];
  groupImportance: { group: FeatureGroup; share: number }[];
  holdout: Pick<TrainedModel, 'w' | 'b0' | 'mu' | 'sd'>; // fitted on pre-test data only (for backtests)
  splitDay: number;
  testCampaigns: string[];
}

interface Row { x: number[]; y: number; promo: boolean; day: number }

const sig = (z: number) => 1 / (1 + Math.exp(-z));

export function predictWith(m: Pick<TrainedModel, 'w' | 'b0' | 'mu' | 'sd'>, x: number[]): number {
  let z = m.b0;
  for (let j = 0; j < x.length; j++) z += m.w[j] * ((x[j] - m.mu[j]) / m.sd[j]);
  return sig(z);
}

export function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rankSum = 0;
  let pos = 0;
  for (let r = 0; r < idx.length; ) {
    let e = r;
    while (e + 1 < idx.length && scores[idx[e + 1]] === scores[idx[r]]) e++;
    const avg = (r + e) / 2 + 1;
    for (let k = r; k <= e; k++) if (labels[idx[k]] === 1) { rankSum += avg; pos++; }
    r = e + 1;
  }
  const neg = idx.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5;
}

function fit(rows: Row[], iters = 450) {
  const n = rows.length;
  const mu = new Array(NF).fill(0);
  const sd = new Array(NF).fill(0);
  for (const r of rows) for (let j = 0; j < NF; j++) mu[j] += r.x[j] / n;
  for (const r of rows) for (let j = 0; j < NF; j++) sd[j] += (r.x[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < NF; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = rows.map((r) => r.x.map((v, j) => (v - mu[j]) / sd[j]));
  const w = new Array(NF).fill(0);
  let b0 = 0;
  const m = new Array(NF + 1).fill(0);
  const v = new Array(NF + 1).fill(0);
  const lr = 0.05, l2 = 2e-3;
  for (let t = 1; t <= iters; t++) {
    const g = new Array(NF + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let z = b0;
      const zi = Z[i];
      for (let j = 0; j < NF; j++) z += w[j] * zi[j];
      const e = sig(z) - rows[i].y;
      g[NF] += e / n;
      for (let j = 0; j < NF; j++) g[j] += (e * zi[j]) / n;
    }
    for (let j = 0; j < NF; j++) g[j] += l2 * w[j];
    for (let j = 0; j <= NF; j++) {
      m[j] = 0.9 * m[j] + 0.1 * g[j];
      v[j] = 0.999 * v[j] + 0.001 * g[j] * g[j];
      const step = (lr * (m[j] / (1 - 0.9 ** t))) / (Math.sqrt(v[j] / (1 - 0.999 ** t)) + 1e-8);
      if (j < NF) w[j] -= step;
      else b0 -= step;
    }
  }
  return { w, b0, mu, sd };
}

function buildRows(ds: Dataset): Row[] {
  const rows: Row[] = [];
  const cats = ds.categories;
  const hasOrderedRecently = (lines: Line[], day: number) => {
    const i = cutIndex(lines, day);
    return i > 0 && lines[i - 1].day >= day - 90;
  };
  const bought = (lines: Line[], cat: string, s: number, e: number) => {
    for (let i = cutIndex(lines, s); i < lines.length && lines[i].day <= e; i++)
      if (lines[i].ours && lines[i].category === cat) return 1;
    return 0;
  };
  // campaign windows
  for (const c of ds.campaigns) {
    for (const cid of ds.customers) {
      const lines = ds.byCustomer.get(cid)!;
      if (!hasOrderedRecently(lines, c.start)) continue;
      const ctx = makeCtx(ds, cid, c.category, c.start);
      rows.push({ x: vector(ctx, c.depth, c.mechanic), y: bought(lines, c.category, c.start, c.end), promo: true, day: c.start });
    }
  }
  // non-campaign windows (depth = 0): rotate categories so each is represented
  const firstSlot = ds.minDay + 60;
  let slot = 0;
  for (let s = firstSlot; s + PREDICTION_WINDOW_DAYS - 1 <= ds.maxDay; s += PREDICTION_WINDOW_DAYS, slot++) {
    ds.customers.forEach((cid, ci) => {
      const cat = cats[(slot + ci) % cats.length];
      if (ds.campaigns.some((c) => c.category === cat && c.start <= s + 13 && c.end >= s - 21)) return;
      const lines = ds.byCustomer.get(cid)!;
      if (!hasOrderedRecently(lines, s)) return;
      const ctx = makeCtx(ds, cid, cat, s);
      rows.push({ x: vector(ctx, 0, 'PCT_OFF'), y: bought(lines, cat, s, s + 13), promo: false, day: s });
    });
  }
  return rows;
}

export function trainModel(ds: Dataset): TrainedModel {
  const rows = buildRows(ds);
  const testFrom = ds.campaigns[Math.max(0, ds.campaigns.length - 8)].start;
  const train = rows.filter((r) => r.day < testFrom - PREDICTION_WINDOW_DAYS);
  const test = rows.filter((r) => r.day >= testFrom);
  const f1 = fit(train);
  const sc = test.map((r) => predictWith(f1, r.x));
  const aucTest = auc(sc, test.map((r) => r.y));
  const aucTrain = auc(train.map((r) => predictWith(f1, r.x)), train.map((r) => r.y));

  // calibration + gains on the held-out period
  const order = test.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
  const bins = 5;
  const calibration: Calibration[] = [];
  const total = test.reduce((s, r) => s + r.y, 0);
  for (let k = 0; k < bins; k++) {
    const seg = order.slice(Math.floor((k * order.length) / bins), Math.floor(((k + 1) * order.length) / bins));
    if (!seg.length) continue;
    calibration.push({
      lo: Math.min(...seg.map((i) => sc[i])),
      hi: Math.max(...seg.map((i) => sc[i])),
      predicted: seg.reduce((s, i) => s + sc[i], 0) / seg.length,
      actual: seg.reduce((s, i) => s + test[i].y, 0) / seg.length,
      n: seg.length,
    });
  }
  const gains: GainPoint[] = [{ pctCustomers: 0, pctResponders: 0 }];
  let cum = 0;
  for (let i = 0; i < order.length; i++) {
    cum += test[order[i]].y;
    if ((i + 1) % Math.ceil(order.length / 20) === 0 || i === order.length - 1)
      gains.push({ pctCustomers: (i + 1) / order.length, pctResponders: total ? cum / total : 0 });
  }

  // final model: refit on everything
  const final = fit(rows);
  const absContrib = final.w.map((w) => Math.abs(w));
  const tot = absContrib.reduce((s, v) => s + v, 0) || 1;
  const importance = FEATURES.map((f, j) => ({ ...f, weight: final.w[j], share: absContrib[j] / tot }))
    .sort((a, b) => b.share - a.share);
  const groups = new Map<FeatureGroup, number>();
  for (const f of importance) groups.set(f.group, (groups.get(f.group) ?? 0) + f.share);
  const groupImportance = [...groups.entries()].map(([group, share]) => ({ group, share })).sort((a, b) => b.share - a.share);

  return {
    ...final,
    aucTrain,
    aucTest,
    nTrain: train.length,
    nTest: test.length,
    baseRateTest: total / Math.max(1, test.length),
    calibration,
    gains,
    importance,
    groupImportance,
    holdout: f1,
    splitDay: testFrom,
    testCampaigns: ds.campaigns.filter((c) => c.start >= testFrom).map((c) => c.id),
  };
}

export interface Scored {
  cid: string;
  p1: number; // P(buy | offer)
  p0: number; // P(buy | no offer)
  uplift: number;
}
export function score(model: TrainedModel, ctx: Ctx, depth: number, mechanic: string): Scored {
  const p1 = predictWith(model, vector(ctx, depth, mechanic));
  const p0 = predictWith(model, vector(ctx, 0, mechanic));
  return { cid: ctx.cid, p1, p0, uplift: p1 - p0 };
}

export type { Campaign };
