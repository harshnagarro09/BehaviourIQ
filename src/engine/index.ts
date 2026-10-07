import { backtest, evaluateCampaigns, validationByCampaign, type CampaignResult, type CustomerCampaign, type StrategyResult, type ValidationRow } from './campaigns.ts';
import { buildDataset, parseCsv, isoOf, type Dataset } from './data.ts';
import {
  basketPairs, brandBehaviour, campaignTypeMatrix, monthlyTrend, priceLadder, responseCurves, switchingFunnel,
  timingBehaviour, typeStats, TYPE_IDS, type CustomerRecord, type TypeStat,
} from './insights.ts';
import { cachedProfile, trainModel, type TrainedModel } from './model.ts';
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

export interface AgentRun {
  id: 'analyst' | 'predictor' | 'planner' | 'watchdog';
  name: string;
  role: string;
  ms: number;
  steps: string[];
  output: string;
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
  model: TrainedModel;
  results: CampaignResult[];
  perCustomer: Map<string, CustomerCampaign[]>;
  strategies: StrategyResult[];
  validation: ValidationRow[];
  curves: ReturnType<typeof responseCurves>;
  ladder: ReturnType<typeof priceLadder>;
  matrix: ReturnType<typeof campaignTypeMatrix>;
  brand: ReturnType<typeof brandBehaviour>;
  funnel: ReturnType<typeof switchingFunnel>;
  basket: ReturnType<typeof basketPairs>;
  timing: ReturnType<typeof timingBehaviour>;
  trend: ReturnType<typeof monthlyTrend>;
  recommendations: Recommendation[];
  alerts: Alert[];
  agents: AgentRun[];
  totals: {
    customers: number;
    orders: number;
    revenue: number;
    lines: number;
    ourShare: number;
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

export function buildEngine(csvText: string): Engine {
  const ds = buildDataset(parseCsv(csvText));
  const asOf = ds.maxDay + 1;
  const t1 = performance.now();

  const profiles = ds.customers.map((cid) => cachedProfile(ds, cid, asOf));
  const segOf = assignSegments(profiles, ds.maxDay);
  const records: CustomerRecord[] = profiles.map((b) => {
    const c = classify(b);
    return { cid: b.cid, b, type: c.type, confidence: c.confidence, reasons: c.reasons, seg: segOf.get(b.cid)! };
  });
  const typeOf = new Map(records.map((r) => [r.cid, r.type]));
  const t2 = performance.now();

  const model = trainModel(ds);
  const t3 = performance.now();

  const { results, perCustomer } = evaluateCampaigns(ds, typeOf);
  const strategies = backtest(ds, model, perCustomer, typeOf);
  const validation = validationByCampaign(ds, model, perCustomer);
  const stats = typeStats(records, results);
  const funnel = switchingFunnel(ds, records);
  const recommendations = recommend(ds, model, records, asOf, validation);
  const t4 = performance.now();
  const alerts = watchdog(ds, results, records, funnel, asOf);
  const t5 = performance.now();

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
  let revenue = 0, ourUnits = 0, units = 0;
  for (const l of ds.lines) {
    orders.add(l.orderId);
    revenue += l.unit * l.qty;
    units += l.qty;
    if (l.ours) ourUnits += l.qty;
  }
  const sum = (f: (r: CampaignResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const promoUnits = sum((r) => r.units);
  const incUnits = sum((r) => r.incUnits);
  const discountCost = sum((r) => r.discountCost);
  const leakage = sum((r) => r.leakage);
  const netProfit = sum((r) => r.netProfit);

  const nCamps = ds.campaigns.length;
  const nScen = recommendations.reduce((s, r) => s + r.scenarios.length, 0);
  const nRec = recommendations.filter((r) => r.best).length;
  const agents: AgentRun[] = [
    {
      id: 'analyst', name: 'Behaviour Analyst', role: 'Reads every order and builds one behaviour profile per customer',
      ms: t2 - t1,
      steps: [
        `Loaded ${ds.lines.length.toLocaleString()} order lines from ${ds.customers.length} customers`,
        'Measured frequency, recency, quantity, price paid, brand mix, basket mix and timing',
        'Compared each customer\'s promo-window buying with their own baseline',
        `Applied the five consumer-type rules: ${TYPE_IDS.map((t) => `${records.filter((r) => r.type === t).length} ${t}`).join(', ')}`,
      ],
      output: `${records.length} customers typed`,
    },
    {
      id: 'predictor', name: 'Response Predictor', role: 'Learns who responds to which discount depth',
      ms: t3 - t2,
      steps: [
        `Built ${(model.nTrain + model.nTest).toLocaleString()} customer x 14-day window examples (campaign and non-campaign)`,
        'Used only information available before each window started',
        `Trained on ${model.nTrain.toLocaleString()} examples, validated on the last ${model.testCampaigns.length} campaigns`,
        `Held-out AUC ${model.aucTest.toFixed(2)} (train ${model.aucTrain.toFixed(2)})`,
      ],
      output: `AUC ${model.aucTest.toFixed(2)} on unseen campaigns`,
    },
    {
      id: 'planner', name: 'Campaign Planner', role: 'Chooses audience and discount depth for upcoming campaigns',
      ms: t4 - t3,
      steps: [
        `Scored ${recommendations.length} planned slots x ${nScen / recommendations.length} offer types = ${nScen} scenarios`,
        'For each customer, compared expected profit with and without the offer',
        'Kept only customers where the offer earns more than it costs',
        `Picked the best offer per slot: ${nRec} of ${recommendations.length} slots have a profitable option`,
      ],
      output: `${nRec} campaigns recommended`,
    },
    {
      id: 'watchdog', name: 'Watchdog', role: 'Looks for money leaking out of past and running promotions',
      ms: t5 - t4,
      steps: [
        `Re-measured ${nCamps} past campaigns against each customer's baseline`,
        'Checked leakage, losses, fatigue, pull-forward, competitor stickiness and lapsed customers',
        `Raised ${alerts.length} alerts`,
      ],
      output: `${alerts.length} alerts`,
    },
  ];

  return {
    ds, asOf, asOfIso: isoOf(asOf - 1), segStats, records, recById: new Map(records.map((r) => [r.cid, r])), typeOf, stats, model,
    results, perCustomer, strategies, validation,
    curves: responseCurves(ds, records),
    ladder: priceLadder(ds, records),
    matrix: campaignTypeMatrix(ds, results),
    brand: brandBehaviour(ds, records),
    funnel,
    basket: basketPairs(ds),
    timing: timingBehaviour(ds, records),
    trend: monthlyTrend(ds),
    recommendations, alerts, agents,
    totals: {
      customers: ds.customers.length, orders: orders.size, revenue, lines: ds.lines.length,
      ourShare: ourUnits / units, promoUnits, incUnits, incShare: promoUnits ? incUnits / promoUnits : 0,
      discountCost, leakage, leakagePct: discountCost ? leakage / discountCost : 0, netProfit,
      roi: discountCost ? netProfit / discountCost : 0,
    },
  };
}
