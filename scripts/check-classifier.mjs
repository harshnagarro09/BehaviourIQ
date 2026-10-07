// dev-only: how well do behaviour-derived types match the latent simulation types?
import fs from 'node:fs';
import { parseCsv, buildDataset } from '../src/engine/data.ts';
import { profile } from '../src/engine/behaviour.ts';
import { classify } from '../src/engine/segments.ts';

const text = fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8');
const ds = buildDataset(parseCsv(text));
const truth = JSON.parse(fs.readFileSync(new URL('./out/ground_truth.json', import.meta.url), 'utf8'));
const asOf = ds.maxDay + 1;
const conf = {};
let ok = 0;
for (const cid of ds.customers) {
  const c = classify(profile(ds, cid, asOf));
  const t = truth[cid];
  conf[t] ||= {};
  conf[t][c.type] = (conf[t][c.type] || 0) + 1;
  if (c.type === t) ok++;
}
console.table(conf);
console.log('accuracy', (ok / ds.customers.length).toFixed(3));
