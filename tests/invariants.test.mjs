// Run with: npm test  (node --test, no extra dependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildEngine } from '../src/engine/index.ts';
import { buildCtxs, activeAt } from '../src/engine/planner.ts';
import { promoOptions, compareOptions } from '../src/engine/options.ts';
import { summariseValidation } from '../src/lib/validation.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));

test('uplift equals P1 minus P0 and probabilities are valid', () => {
  const category = e.ds.campaigns[0].category;
  const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), category, e.asOf);
  const options = promoOptions(e.ds, category);
  const cmp = compareOptions(e.ds, e.model, ctxs, category, options);
  assert.ok(ctxs.length > 0);
  for (const m of cmp.exps.values()) for (const x of m.values()) {
    assert.ok(x.p0 >= 0 && x.p0 <= 1 && x.p1 >= 0 && x.p1 <= 1);
    assert.ok(Math.abs(x.uplift - (x.p1 - x.p0)) < 1e-9, 'uplift must be P1 - P0');
  }
});

test('the no-promotion option has zero uplift', () => {
  const category = e.ds.campaigns[0].category;
  const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), category, e.asOf);
  const options = promoOptions(e.ds, category);
  const none = options.find((o) => o.family === 'none');
  const cmp = compareOptions(e.ds, e.model, ctxs, category, options);
  for (const x of cmp.exps.get(none.key).values()) assert.ok(Math.abs(x.uplift) < 1e-9);
});

test('callout numbers come from the held-out backtest', () => {
  const v = summariseValidation(e.validation);
  assert.equal(v.campaigns, e.validation.length);
  assert.equal(v.campaigns, e.model.testCampaigns.length);
  const cost = e.validation.reduce((a, r) => a + r.cost, 0);
  const net = e.validation.reduce((a, r) => a + r.realNet, 0);
  assert.ok(Math.abs(v.roi - net / cost) < 1e-9);
  assert.ok(e.model.aucTest > 0.5);
});

test('UI strings avoid retired terminology', () => {
  const banned = [/true effect/i, /real effect/i, /value segment/i, /response type/i, /customer group/i, /truly (extra|incremental)/i];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
  const files = [...walk('src').filter((f) => /\.(ts|tsx)$/.test(f)), 'README.md'];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const re of banned) assert.ok(!re.test(t), `${f} contains banned phrase ${re}`);
  }
});
