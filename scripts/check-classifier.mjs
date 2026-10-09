// Compares the rule-based customer types with the latent type used to generate the demo data (never shipped).
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const truth = JSON.parse(fs.readFileSync(new URL('./out/ground_truth.json', import.meta.url), 'utf8'));
const map = { anyways: 'sure', deal: 'persuadable', stockup: 'persuadable', switcher: 'persuadable', ignores: 'lost', dog: 'dog' };
const m = {}; let ok = 0;
for (const r of e.records) { const t = map[truth[r.cid]]; (m[t] ||= {})[r.type] = ((m[t] || {})[r.type] || 0) + 1; if (t === r.type) ok++; }
console.table(m); console.log('accuracy', (ok / e.records.length * 100).toFixed(1) + '%');
