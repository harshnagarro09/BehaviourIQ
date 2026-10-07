import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
const text = fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8');
console.time('engine');
const e = buildEngine(text);
console.timeEnd('engine');
console.log(e.totals);
console.table(e.stats.map((s) => ({ t: s.type, n: s.n, spend: (s.spendShare*100).toFixed(0)+'%', roi: s.roi.toFixed(2), net: Math.round(s.netProfit) })));
for (const r of e.recommendations) {
  console.log(r.candidate.name, r.flag, r.best?.option.label, r.best && Math.round(r.best.net), r.best && r.best.roi.toFixed(2), r.best && `${r.best.audience.targeted}/${r.best.audience.total}`);
  console.log('  ', r.scenarios.map((s) => `${s.option.key}:${Math.round(s.net)}`).join(' '));
}
console.log(e.alerts.map((a) => a.title));
console.log(e.agents.map((a) => a.name + ' ' + Math.round(a.ms) + 'ms'));
console.log(e.funnel, e.basket.pairs.slice(0,4));
