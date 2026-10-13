// Price elasticity and the combined behaviour + elasticity budget mode.  Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { estimateElasticity, fitBeta, combinedResponse, inRange, depthOptions, demandLift, PRICE_MECHANICS, SANE } from '../src/engine/elasticity.ts';
import { predictCategory } from '../src/engine/targeting.ts';
import { optimise } from '../src/engine/optimizer.ts';
import { skuCatalog } from '../src/engine/products.ts';
import { rangeItems, rescore } from '../src/engine/budgetScope.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const m = estimateElasticity(e.results, e.perCustomer, e.typeOf);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test('fit recovers a known elasticity exactly from noise-free points', () => {
  const pts = [0.1, 0.15, 0.2, 0.25].map((d) => ({ depth: d, lift: (1 - d) ** -3.2, baseline: 100 }));
  const f = fitBeta(pts);
  assert.ok(near(f.beta, -3.2, 1e-9) && f.se < 1e-9);
  assert.equal(fitBeta(pts.slice(0, 1)), null, 'one point is not enough');
});

test('estimates use only plain price offers from actual campaigns, are negative and plausible', () => {
  const price = e.results.filter((r) => PRICE_MECHANICS.includes(r.campaign.mechanic));
  assert.equal(m.pooled.n, price.length);
  assert.equal(m.excluded, e.results.length - price.length);
  assert.ok(m.pooled.beta < 0 && m.pooled.beta >= SANE.min && m.pooled.beta <= SANE.max);
  for (const c of m.byCategory.values()) {
    assert.ok(c.beta < 0, c.category);
    assert.ok(c.points.every((p) => PRICE_MECHANICS.includes(p.mechanic)));
    const r = e.results.find((x) => x.campaign.id === c.points[0].campaignId);
    assert.ok(near(c.points[0].lift, r.units / r.baselineUnits), 'lift is actual units / baseline units');
    assert.ok(c.looError === null || (c.looError >= 0 && c.looError < 1));
    // the value used lies between the category's own estimate and the pooled one (shrinkage), or equals the pooled one
    if (c.raw) assert.ok(c.beta >= Math.min(c.raw.beta, m.pooled.beta) - 1e-9 && c.beta <= Math.max(c.raw.beta, m.pooled.beta) + 1e-9);
  }
});

test('combined response: equals the customer’s own reads at 10% and 20%, rises with depth, is capped', () => {
  const f = combinedResponse(m.pooled.beta);
  const r = { lo: 0.18, hi: 0.41, nLo: 3, nHi: 3 };
  assert.ok(near(f(r, 10), 0.18) && near(f(r, 20), 0.41));
  let prev = 0;
  for (let d = 1; d <= 40; d++) { const v = f(r, d); assert.ok(v >= prev - 1e-12 && v <= 0.95); prev = v; }
  assert.equal(f(r, 0), 0);
  assert.ok(demandLift(m.pooled.beta, 20) > demandLift(m.pooled.beta, 10) && demandLift(m.pooled.beta, 0) === 1);
});

test('the curve is never used beyond the deepest discount actually run', () => {
  for (const c of m.byCategory.values()) {
    assert.ok(inRange(c, c.maxDepth) && !inRange(c, c.maxDepth + 1));
    const o = depthOptions(c);
    assert.ok(o.extra.every((p) => p.depth <= c.maxDepth && p.mechanic === 'PCT_OFF'));
  }
});

test('combined predictions match behaviour-only where they should, and only change shaped offers', () => {
  const cat = 'Snacks';
  const b = predictCategory(e.ds, e.typeOf, cat, e.asOf, e.resp, e.assumptions);
  const c = predictCategory(e.ds, e.typeOf, cat, e.asOf, e.resp, e.assumptions, undefined, depthOptions(m.byCategory.get(cat)));
  for (const t of ['persuadable', 'sure']) {
    for (const key of ['pct10', 'pct20']) {
      const x = b.cells.get(t).find((y) => y.promo.key === key), y = c.cells.get(t).find((z) => z.promo.key === key);
      assert.ok(near(x.incMargin, y.incMargin, 1e-9) && near(x.investment, y.investment, 1e-9), `${t} ${key} identical at observed depths`);
    }
    for (const y of c.cells.get(t)) {
      if (y.depthSource !== 'behaviour') continue;
      const x = b.cells.get(t).find((z) => z.promo.key === y.promo.key);
      assert.ok(near(x.incMargin, y.incMargin, 1e-9), `${y.promo.key} beyond the tested range keeps the behaviour rule`);
    }
  }
  assert.ok(c.promos.length >= b.promos.length);
});

test('combined optimiser: within budget, self-consistent, and at least as good as behaviour-only on one yardstick', () => {
  const cat = skuCatalog(e.ds);
  const cache = { b: new Map(), c: new Map() };
  const pf = (mode) => (k) => cache[mode].get(k) ?? (cache[mode].set(k, predictCategory(e.ds, e.typeOf, k, e.asOf, e.resp, e.assumptions, undefined, mode === 'c' ? depthOptions(m.byCategory.get(k)) : undefined)), cache[mode].get(k));
  const itemsB = rangeItems(cat, pf('b')), itemsC = rangeItems(cat, pf('c'));
  for (const budget of [10000, 30000, 80000]) {
    const S = { budget, objective: 'margin', hurdle: 0.25, holdout: 0.1, includeExcluded: false, allowed: (p) => p.family !== 'partner' };
    const pb = optimise(itemsB, S), pc = optimise(itemsC, S);
    assert.ok(pc.spend <= budget + 1e-6);
    const self = rescore(pc, itemsC);
    assert.ok(near(self.spend, pc.spend, 1e-9) && near(self.incMargin, pc.incMargin, 1e-9), 'rescoring a plan with its own items reproduces it');
    const bOnC = rescore(pb, itemsC);
    assert.ok(pc.incMargin >= bOnC.incMargin * 0.99 || bOnC.spend > budget, `combined ${pc.incMargin} vs behaviour on the same yardstick ${bOnC.incMargin}`);
    assert.ok(pc.allocations.every((a) => a.item.type !== 'dog'), 'Sleeping Dogs are still never offered');
  }
});
