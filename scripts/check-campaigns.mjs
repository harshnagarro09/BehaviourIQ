import fs from 'node:fs';
import { parseCsv, buildDataset } from '../src/engine/data.ts';
import { cachedProfile, trainModel } from '../src/engine/model.ts';
import { classify } from '../src/engine/segments.ts';
import { evaluateCampaigns, backtest } from '../src/engine/campaigns.ts';

const text = fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8');
const ds = buildDataset(parseCsv(text));
const typeOf = new Map(ds.customers.map((c) => [c, classify(cachedProfile(ds, c, ds.maxDay + 1)).type]));
const model = trainModel(ds);
const { results, perCustomer } = evaluateCampaigns(ds, typeOf);
console.table(results.map((r) => ({
  id: r.campaign.id, name: r.campaign.name, depth: r.campaign.depth, reach: r.customers, buyers: r.buyers,
  units: Math.round(r.units), base: Math.round(r.baselineUnits), inc: Math.round(r.incUnits), cost: Math.round(r.discountCost),
  leak: (r.leakagePct * 100).toFixed(0) + '%', net: Math.round(r.netProfit), roi: r.roi.toFixed(2), v: r.verdict,
})));
const types = ['anyways', 'deal', 'stockup', 'switcher', 'ignores'];
console.table(types.map((t) => {
  const s = results.reduce((a, r) => { const x = r.byType[t]; a.cost += x.discountCost; a.net += x.netProfit; a.inc += x.incUnits; a.units += x.units; a.leak += x.leakage; a.dip += x.pullForwardUnits; return a; }, { cost: 0, net: 0, inc: 0, units: 0, leak: 0, dip: 0 });
  return { t, cost: Math.round(s.cost), net: Math.round(s.net), roi: (s.net / s.cost).toFixed(2), inc: Math.round(s.inc), units: Math.round(s.units), leak: Math.round(s.leak), dip: Math.round(s.dip) };
}));
console.table(backtest(ds, model, perCustomer, typeOf).map((r) => ({ ...r, discountCost: Math.round(r.discountCost), netProfit: Math.round(r.netProfit), roi: r.roi.toFixed(2) })));
