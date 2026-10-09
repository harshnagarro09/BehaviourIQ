import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
console.log(e.totals);
console.table(e.stats.map((s) => ({ type: s.type, n: s.n, roi: s.roi.toFixed(2), net: Math.round(s.netProfit) })));
const by = {};
for (const r of e.results) { const k = r.campaign.mechanic + (r.campaign.mechanic === 'PCT_OFF' ? r.campaign.depth : ''); const a = (by[k] ||= { n: 0, cust: 0, buyers: 0, cost: 0, gross: 0, net: 0 }); a.n++; a.cust += r.customers; a.buyers += r.buyers; a.cost += r.discountCost; a.gross += r.windowMargin; a.net += r.netProfit; }
console.table(Object.entries(by).map(([k, a]) => ({ promo: k, campaigns: a.n, response: (a.buyers / a.cust * 100).toFixed(0) + '%', discount: Math.round(a.cost), grossProfit: Math.round(a.gross), incrementalProfit: Math.round(a.net), roi: (a.net / a.cost).toFixed(2) })));
for (const r of e.recommendations) console.log(r.candidate.name, r.best?.option.label ?? 'no discount', r.best ? Math.round(r.best.net) : '', r.scenarios.map((s) => `${s.option.key}:${Math.round(s.net)}`).join(' '));
console.table(e.strategies);
