import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { promoOptions, compareOptions, recommendOption } from '../src/engine/options.ts';
import { activeAt, buildCtxs } from '../src/engine/planner.ts';
const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
console.table(e.segStats.map((s) => ({ seg: s.seg, n: s.n, spend: (s.spendShare*100).toFixed(0)+'%', resp: (s.respRate*100).toFixed(0)+'%', promo: (s.promoReliance*100).toFixed(0)+'%', roi: s.roi.toFixed(2) })));
for (const cat of ['Beverages', 'Personal Care']) {
  const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), cat, e.asOf);
  const opts = promoOptions(e.ds, cat);
  const c = compareOptions(e.ds, e.model, ctxs, cat, opts);
  console.log(cat);
  console.table(c.summaries.map((s) => ({ o: s.option.label, resp: (s.response*100).toFixed(0)+'%', orders: Math.round(s.orders), rev: Math.round(s.revenue), inc: Math.round(s.incRevenue), margin: Math.round(s.margin), cost: Math.round(s.cost), net: Math.round(s.net), roi: s.roi.toFixed(2) })));
  console.log(recommendOption(c.summaries)?.text);
}
