import { evaluateCampaigns, replayStrategies, type CampaignResult, type CustomerCampaign, type StrategyResult } from './campaigns.ts';
import { buildDataset, parseCsv, isoOf, type Dataset } from './data.ts';
import { basketPairs, monthlyTrend, timingBehaviour, typeStats, TYPE_IDS, type CustomerRecord, type TypeStat } from './insights.ts';
import { cachedProfile, DEFAULT_ASSUMPTIONS, type Assumptions } from './simulation.ts';
import { recommend, watchdog, type Alert, type Recommendation } from './planner.ts';
import { classify } from './segments.ts';
import { assignSegments, SEGMENTS, type SegId } from './groups.ts';
import type { TypeId } from './behaviour.ts';

export interface SegStat {
  seg: SegId;
  n: number;
  share: number;
  spendShare: number;
  avgOrdersPerMonth: number;
  avgOrderValue: number;
  respRate: number;
  promoReliance: number;
  pastCost: number;
  pastNet: number;
  roi: number;
}

export interface Engine {
  ds: Dataset;
  asOf: number;
  asOfIso: string;
  records: CustomerRecord[];
  recById: Map<string, CustomerRecord>;
  typeOf: Map<string, TypeId>;
  stats: TypeStat[];
  segStats: SegStat[];
  assumptions: Assumptions; // business assumptions behind the simulated numbers
  results: CampaignResult[];
  perCustomer: Map<string, CustomerCampaign[]>;
  strategies: StrategyResult[]; // past campaigns replayed under audience rules (actual behaviour)
  basket: ReturnType<typeof basketPairs>;
  timing: ReturnType<typeof timingBehaviour>;
  trend: ReturnType<typeof monthlyTrend>;
  recommendations: Recommendation[];
  alerts: Alert[];
  totals: {
    customers: number;
    orders: number;
    revenue: number;
    lines: number;
    promoUnits: number;
    incUnits: number;
    incShare: number;
    discountCost: number;
    leakage: number;
    leakagePct: number;
    netProfit: number;
    roi: number;
  };
}

export function buildEngine(csvText: string, assumptions: Assumptions = DEFAULT_ASSUMPTIONS): Engine {
  const ds = buildDataset(parseCsv(csvText));
  const asOf = ds.maxDay + 1;

  const profiles = ds.customers.map((cid) => cachedProfile(ds, cid, asOf));
  const segOf = assignSegments(profiles, ds.maxDay);
  const records: CustomerRecord[] = profiles.map((b) => {
    const c = classify(b);
    return { cid: b.cid, b, type: c.type, confidence: c.confidence, reasons: c.reasons, seg: segOf.get(b.cid)! };
  });
  const typeOf = new Map(records.map((r) => [r.cid, r.type]));

  const { results, perCustomer } = evaluateCampaigns(ds, typeOf);
  const strategies = replayStrategies(perCustomer, typeOf);
  const stats = typeStats(records, results);
  const recommendations = recommend(ds, records, asOf, assumptions);
  const alerts = watchdog(ds, results, records, asOf);

  const totalSpend = records.reduce((s, r) => s + r.b.totalSpend, 0);
  const segStats: SegStat[] = SEGMENTS.map((sg) => {
    const rs = records.filter((r) => r.seg === sg.id);
    const avg = (f: (r: CustomerRecord) => number) => (rs.length ? rs.reduce((s, r) => s + f(r), 0) / rs.length : 0);
    let cost = 0, net = 0;
    for (const r of rs) for (const x of perCustomer.get(r.cid) ?? []) { cost += x.discountCost; net += x.net; }
    return {
      seg: sg.id, n: rs.length, share: rs.length / records.length, spendShare: rs.reduce((s, r) => s + r.b.totalSpend, 0) / totalSpend,
      avgOrdersPerMonth: avg((r) => r.b.ordersPerMonth), avgOrderValue: avg((r) => r.b.avgOrderValue), respRate: avg((r) => r.b.respRate),
      promoReliance: avg((r) => r.b.promoReliance), pastCost: cost, pastNet: net, roi: cost ? net / cost : 0,
    };
  });

  const orders = new Set<string>();
  let revenue = 0;
  for (const l of ds.lines) {
    orders.add(l.orderId);
    revenue += l.unit * l.qty;
  }
  const sum = (f: (r: CampaignResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const promoUnits = sum((r) => r.units);
  const incUnits = sum((r) => r.incUnits);
  const discountCost = sum((r) => r.discountCost);
  const leakage = sum((r) => r.leakage);
  const netProfit = sum((r) => r.netProfit);

  return {
    ds, asOf, asOfIso: isoOf(asOf - 1), assumptions, segStats, records, recById: new Map(records.map((r) => [r.cid, r])), typeOf, stats,
    results, perCustomer, strategies,
    basket: basketPairs(ds),
    timing: timingBehaviour(ds, records),
    trend: monthlyTrend(ds),
    recommendations, alerts,
    totals: {
      customers: ds.customers.length, orders: orders.size, revenue, lines: ds.lines.length,
      promoUnits, incUnits, incShare: promoUnits ? incUnits / promoUnits : 0,
      discountCost, leakage, leakagePct: discountCost ? leakage / discountCost : 0, netProfit,
      roi: discountCost ? netProfit / discountCost : 0,
    },
  };
}

export { TYPE_IDS };
