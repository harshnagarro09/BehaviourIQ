import { evaluateCampaigns, replayStrategies, type CampaignResult, type CustomerCampaign, type StrategyResult } from './campaigns.ts';
import { buildDataset, parseCsv, isoOf, type Dataset } from './data.ts';
import { basketPairs, monthlyTrend, timingBehaviour, typeStats, TYPE_IDS, type CustomerRecord, type TypeStat } from './insights.ts';
import { cachedProfile, DEFAULT_ASSUMPTIONS, type Assumptions } from './simulation.ts';
import { recommend, watchdog, type Alert, type Recommendation } from './planner.ts';
import { classify } from './segments.ts';
import { responseProfiles, type RespProfile } from './response.ts';
import type { TypeId } from './behaviour.ts';
import { depthOptions, estimateElasticity, type ElasticityModel } from './elasticity.ts';

export interface Engine {
  ds: Dataset;
  asOf: number;
  asOfIso: string;
  records: CustomerRecord[];
  recById: Map<string, CustomerRecord>;
  typeOf: Map<string, TypeId>;
  stats: TypeStat[];
  resp: Map<string, RespProfile>; // incremental responsiveness per customer (shared by prediction and planning)
  assumptions: Assumptions; // business assumptions behind the simulated numbers
  results: CampaignResult[];
  perCustomer: Map<string, CustomerCampaign[]>;
  strategies: StrategyResult[]; // past campaigns replayed under audience rules (actual behaviour)
  basket: ReturnType<typeof basketPairs>;
  timing: ReturnType<typeof timingBehaviour>;
  trend: ReturnType<typeof monthlyTrend>;
  /** price elasticity from the actual past campaigns: how deep a discount should be (used by every prediction) */
  elasticity: ElasticityModel;
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
    incMargin: number;
    roi: number;
  };
}

export function buildEngine(csvText: string, assumptions: Assumptions = DEFAULT_ASSUMPTIONS): Engine {
  const ds = buildDataset(parseCsv(csvText));
  const asOf = ds.maxDay + 1;

  const profiles = ds.customers.map((cid) => cachedProfile(ds, cid, asOf));
  const records: CustomerRecord[] = profiles.map((b) => {
    const c = classify(b);
    return { cid: b.cid, b, type: c.type, confidence: c.confidence, reasons: c.reasons };
  });
  const typeOf = new Map(records.map((r) => [r.cid, r.type]));

  const { results, perCustomer } = evaluateCampaigns(ds, typeOf);
  const strategies = replayStrategies(perCustomer, typeOf);
  const stats = typeStats(records, results);
  const resp = responseProfiles(ds, perCustomer, asOf, (cid) => cachedProfile(ds, cid, asOf).avgQty);
  // one prediction model everywhere: customer behaviour for who responds, the category demand curve for how deep
  const elasticity = estimateElasticity(results, perCustomer, typeOf);
  const recommendations = recommend(ds, records, asOf, resp, assumptions, (cat) => depthOptions(elasticity.byCategory.get(cat)));
  const alerts = watchdog(ds, results, records, asOf);

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
  const incMargin = sum((r) => r.incMargin);

  return {
    ds, asOf, asOfIso: isoOf(asOf - 1), assumptions, records, recById: new Map(records.map((r) => [r.cid, r])), typeOf, stats, resp,
    results, perCustomer, strategies,
    basket: basketPairs(ds),
    timing: timingBehaviour(ds, records),
    trend: monthlyTrend(ds),
    elasticity, recommendations, alerts,
    totals: {
      customers: ds.customers.length, orders: orders.size, revenue, lines: ds.lines.length,
      promoUnits, incUnits, incShare: promoUnits ? incUnits / promoUnits : 0,
      discountCost, leakage, leakagePct: discountCost ? leakage / discountCost : 0, incMargin,
      roi: discountCost ? incMargin / discountCost : 0,
    },
  };
}

export { TYPE_IDS };
