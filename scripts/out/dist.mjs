import fs from 'node:fs';
import { buildEngine } from '../../src/engine/index.ts';
import { activeAt, buildCtxs } from '../../src/engine/planner.ts';
import { compareOptions, promoOptions } from '../../src/engine/options.ts';
const e = buildEngine(fs.readFileSync(new URL('../../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
for (const cat of e.ds.categories) {
  const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), cat, e.asOf);
  const options = promoOptions(e.ds, cat); const promos = options.filter(o => o.family !== 'none');
  const cmp = compareOptions(e.ds, e.model, ctxs, cat, options);
  const out = {};
  for (const c of ctxs) {
    let top = null;
    for (const o of promos) { const v = cmp.exps.get(o.key).get(c.cid); if (v.net > 0 && v.uplift >= 0.03 && (!top || v.net > top.net)) top = { o, net: v.net }; }
    const t = e.recById.get(c.cid).type; const k = top ? top.o.label : 'none';
    out[t] ??= {}; out[t][k] = (out[t][k] ?? 0) + 1;
  }
  console.log(cat, JSON.stringify(out));
}
