// Customer behaviour profile: purchasing, price, promotion, brand, basket and timing signals,
// all computed strictly from order lines dated before `asOf` (so the same code can build
// training features for the model without leaking the future).
import type { Campaign, Dataset, Line } from './data.ts';

export type TypeId = 'anyways' | 'deal' | 'stockup' | 'switcher' | 'ignores';

export interface Behaviour {
  cid: string;
  // purchasing
  nOrders: number;
  nLines: number;
  firstDay: number;
  lastDay: number;
  recencyDays: number;
  ordersPerMonth: number;
  avgQty: number;
  linesPerOrder: number;
  avgOrderValue: number;
  totalSpend: number;
  // price
  avgDiscAccepted: number; // mean % off on promoted lines bought
  minDiscAccepted: number;
  fullPriceShare: number; // share of our-brand lines bought at list price
  // brand
  ourLines: number;
  compLines: number;
  fullOurLines: number;
  promoOurLines: number;
  ourShareFull: number; // our share of (full-price our + competitor) lines
  promoReliance: number; // share of our-brand lines bought on promo
  compPerMonth: number;
  // promotion
  activeCampaigns: number;
  respondedCampaigns: number;
  respRate: number;
  lift: number; // our units in promo windows / baseline expectation
  qtyRatio: number; // units per promo line / units per normal line (percent-off promos only)
  dipRatio: number; // category units in 21d after responding vs baseline (1 = no dip)
  // timing
  weekendShare: number;
  avgInterval: number;
  intervalCV: number;
  festiveShare: number; // share of orders in Oct-Nov
  // channel
  channelShare: Record<string, number>;
  topChannel: string;
  // basket
  catShare: Record<string, number>;
  topCategory: string;
  topCategoryShare: number;
}

export const dowOf = (day: number) => (day + 4) % 7; // 0 = Sunday

export function cutIndex(lines: Line[], day: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].day < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** campaigns visible to a customer as "active": they ordered in the 90 days before the window (or were new) */
export function activeCampaignsFor(lines: Line[], camps: Campaign[]): Campaign[] {
  if (!lines.length) return [];
  const first = lines[0].day;
  return camps.filter((c) => {
    if (first > c.end) return false;
    if (first >= c.start - 90) return true;
    const i = cutIndex(lines, c.start);
    return i > 0 && lines[i - 1].day >= c.start - 90;
  });
}

export function respondedTo(lines: Line[], c: Campaign): boolean {
  for (const l of lines) {
    if (l.day > c.end) break;
    if (l.day >= c.start && l.promoId === c.id) return true;
  }
  return false;
}

/** units/day of our brand (or all brands) in `cat` over the lookback, excluding promo windows (+21d tail) */
export function baselineRate(
  ds: Dataset, lines: Line[], cat: string, asOf: number, opts: { all?: boolean; lookback?: number; skip?: Campaign[] } = {},
): number {
  const lookback = opts.lookback ?? 120;
  const first = lines.length ? lines[0].day : asOf;
  const from = Math.max(asOf - lookback, ds.minDay, first);
  const wins = ds.campaigns.filter((c) => c.category === cat && c.start < asOf);
  const tail = (d: number) => wins.some((w) => d >= w.start && d <= w.end + 21);
  let eligible = 0;
  for (let d = from; d < asOf; d++) if (!tail(d)) eligible++;
  let units = 0;
  const hi = cutIndex(lines, asOf);
  for (let i = cutIndex(lines, from); i < hi; i++) {
    const l = lines[i];
    if (l.category !== cat) continue;
    if (!opts.all && !l.ours) continue;
    if (tail(l.day)) continue;
    units += l.qty;
  }
  if (opts.all) return eligible > 0 ? units / eligible : 0;
  const prior = 30;
  const mu = ds.priorRate[cat] ?? 0;
  return (units + prior * mu) / (eligible + prior);
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export function profile(ds: Dataset, cid: string, asOf: number): Behaviour {
  const all = ds.byCustomer.get(cid) ?? [];
  const lines = all.slice(0, cutIndex(all, asOf));
  const camps = ds.campaigns.filter((c) => c.end < asOf);
  const orders = new Map<string, { day: number; value: number; channel: string }>();
  let qtySum = 0;
  let spend = 0;
  let ourLines = 0, compLines = 0, fullOur = 0, promoOur = 0;
  const promoDiscs: number[] = [];
  const catCount: Record<string, number> = {};
  for (const l of lines) {
    const v = l.unit * l.qty;
    spend += v;
    qtySum += l.qty;
    const o = orders.get(l.orderId);
    if (o) o.value += v;
    else orders.set(l.orderId, { day: l.day, value: v, channel: l.channel });
    catCount[l.category] = (catCount[l.category] || 0) + 1;
    if (l.ours) {
      ourLines++;
      if (l.disc > 0) {
        promoOur++;
        promoDiscs.push(l.disc);
      } else fullOur++;
    } else compLines++;
  }
  const nOrders = orders.size;
  const firstDay = lines.length ? lines[0].day : asOf;
  const lastDay = lines.length ? lines[lines.length - 1].day : asOf;
  const spanMonths = Math.max(1, (asOf - Math.max(firstDay, ds.minDay)) / 30);

  const orderDays = [...new Set([...orders.values()].map((o) => o.day))].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < orderDays.length; i++) gaps.push(orderDays[i] - orderDays[i - 1]);
  const avgGap = mean(gaps);
  const sd = Math.sqrt(mean(gaps.map((g) => (g - avgGap) ** 2)));
  const weekend = orderDays.filter((d) => [0, 6].includes(dowOf(d))).length;

  // promotion response
  const active = activeCampaignsFor(lines, camps);
  let responded = 0;
  let aSum = 0;
  let bSum = 0;
  const dips: number[] = [];
  const promoQty: number[] = [];
  const normQty: number[] = [];
  for (const l of lines) {
    if (l.promoId) {
      if (l.mechanic === 'PCT_OFF' || l.mechanic === 'FLAT_OFF') promoQty.push(l.qty);
    } else normQty.push(l.qty);
  }
  for (const c of active) {
    const resp = respondedTo(lines, c);
    if (resp) responded++;
    const len = c.end - c.start + 1;
    let a = 0;
    for (const l of lines) {
      if (l.day > c.end) break;
      if (l.day >= c.start && l.category === c.category && l.ours) a += l.qty;
    }
    const b = baselineRate(ds, lines, c.category, c.start) * len;
    aSum += a;
    bSum += b;
    if (resp) {
      const post = c.end + 22 <= asOf;
      if (post) {
        let p = 0;
        for (const l of lines) {
          if (l.day <= c.end) continue;
          if (l.day > c.end + 21) break;
          if (l.category === c.category) p += l.qty;
        }
        const base = baselineRate(ds, lines, c.category, c.start, { all: true }) * 21;
        if (base > 0.5) dips.push(Math.min(2, p / base));
      }
    }
  }
  const catShare: Record<string, number> = {};
  for (const k of Object.keys(catCount)) catShare[k] = catCount[k] / Math.max(1, lines.length);
  const topCat = Object.entries(catShare).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const chCount: Record<string, number> = {};
  let festive = 0;
  for (const o of orders.values()) {
    chCount[o.channel] = (chCount[o.channel] || 0) + 1;
    const mo = new Date(o.day * 86_400_000).getUTCMonth();
    if (mo === 9 || mo === 10) festive++;
  }
  const channelShare: Record<string, number> = {};
  for (const k of Object.keys(chCount)) channelShare[k] = chCount[k] / Math.max(1, nOrders);
  const topChannel = Object.entries(channelShare).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';

  return {
    cid,
    nOrders,
    nLines: lines.length,
    firstDay,
    lastDay,
    recencyDays: asOf - 1 - lastDay,
    ordersPerMonth: nOrders / spanMonths,
    avgQty: lines.length ? qtySum / lines.length : 0,
    linesPerOrder: nOrders ? lines.length / nOrders : 0,
    avgOrderValue: nOrders ? spend / nOrders : 0,
    totalSpend: spend,
    avgDiscAccepted: mean(promoDiscs),
    minDiscAccepted: promoDiscs.length ? Math.min(...promoDiscs) : 0,
    fullPriceShare: ourLines ? fullOur / ourLines : 0,
    ourLines,
    compLines,
    fullOurLines: fullOur,
    promoOurLines: promoOur,
    ourShareFull: fullOur + compLines > 0 ? fullOur / (fullOur + compLines) : 0,
    promoReliance: ourLines ? promoOur / ourLines : 0,
    compPerMonth: compLines / spanMonths,
    activeCampaigns: active.length,
    respondedCampaigns: responded,
    respRate: active.length ? responded / active.length : 0,
    lift: (aSum + 0.5) / (bSum + 0.5),
    qtyRatio: promoQty.length >= 2 && normQty.length >= 3 ? mean(promoQty) / mean(normQty) : 1,
    dipRatio: dips.length ? mean(dips) : 1,
    weekendShare: orderDays.length ? weekend / orderDays.length : 0,
    avgInterval: avgGap,
    intervalCV: avgGap > 0 ? sd / avgGap : 0,
    festiveShare: nOrders ? festive / nOrders : 0,
    channelShare,
    topChannel,
    catShare,
    topCategory: topCat[0],
    topCategoryShare: topCat[1],
  };
}
