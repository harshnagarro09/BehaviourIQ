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

test('brand names come from one source and the old placeholder name is gone', () => {
  const brand = fs.readFileSync('src/lib/brand.ts', 'utf8');
  const gen = fs.readFileSync('scripts/generate-data.mjs', 'utf8');
  for (const k of ['RETAILER_NAME', 'OUR_BRAND_NAME']) {
    const a = brand.match(new RegExp(`${k} = '([^']+)'`))?.[1];
    const b = gen.match(new RegExp(`${k} = '([^']+)'`))?.[1];
    assert.ok(a && a === b, `${k} must match between brand.ts and generate-data.mjs`);
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
  const files = [...walk('src'), ...walk('tests'), 'README.md', 'docs/PROJECT_GUIDE.md', 'scripts/generate-data.mjs', 'public/data/promo_behaviour_data.csv'].filter((f) => !f.endsWith('invariants.test.mjs'));
  for (const f of files) assert.ok(!/Aurora/.test(fs.readFileSync(f, 'utf8')), `${f} still mentions the old placeholder brand`);
});

test('engine identifies our brand by the is_our_brand column', () => {
  const ours = e.ds.lines ? e.ds.lines.filter((l) => l.ours).length : null;
  const csv = fs.readFileSync('public/data/promo_behaviour_data.csv', 'utf8').trim().split('\n').slice(1);
  const n = csv.filter((l) => l.split(',')[7] === '1').length;
  assert.ok(n > 0 && csv.filter((l) => l.split(',')[7] === '1').every((l) => l.split(',')[6] === 'Reliance Fresh'));
  assert.ok(ours === null || ours === n);
});

// ---- takeaway sentences: every number must equal the engine value it came from
import { predictionTakeaway, proofTakeaway, customerTakeaway, planningTakeaway, simulationTakeaway, pastResultsTakeaway, behaviourTakeaway, NOT_ENOUGH } from '../src/lib/takeaways.ts';
const nums = (s) => (s.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

test('prediction takeaway quotes the model AUC, test-campaign count and top-two share', () => {
  const t = predictionTakeaway({ groups: e.model.groupImportance, auc: e.model.aucTest, testCampaigns: e.model.testCampaigns.length });
  const top2 = [...e.model.groupImportance].sort((a, b) => b.share - a.share).slice(0, 2).reduce((s, g) => s + g.share, 0);
  assert.ok(t.includes(`AUC ${e.model.aucTest.toFixed(2)}`));
  assert.ok(t.includes(`on ${e.model.testCampaigns.length} unseen campaigns`));
  assert.ok(t.includes(`about ${Math.round(top2 * 100)}%`));
});

test('proof takeaway quotes the backtest ROI for model and blanket promotion', () => {
  const v = summariseValidation(e.validation);
  const t = proofTakeaway({ roi: v.roi, broadRoi: v.broadRoi, campaigns: v.campaigns });
  assert.ok(t.includes(`ROI ${v.roi.toFixed(2)} vs ${v.broadRoi.toFixed(2)}`));
  const strat = (re) => e.strategies.find((s) => re.test(s.name));
  assert.ok(Math.abs(v.roi - strat(/persuadable/i).roi) < 1e-9 && Math.abs(v.broadRoi - strat(/everyone/i).roi) < 1e-9);
});

test('customer takeaway uses P0, P1 and net of the selected customer', () => {
  const t = customerTakeaway({ cid: 'C0001', p0: 0.33, best: { label: '10% Discount', p1: 0.47, net: 65.4 } });
  assert.deepEqual(nums(t).slice(1), [33, 47, 10, 14, 65]);
  assert.ok(customerTakeaway({ cid: 'C0001', p0: 0.33, best: null }).includes('no promotion earns more than it costs'));
});

test('past-results, behaviour, planning and simulation takeaways', () => {
  assert.equal(pastResultsTakeaway({ campaigns: 30, lost: 9, incShare: 0.767, units: 18508 }), 'Across 30 campaigns, 9 lost money; an estimated 77% of promoted sales would have happened anyway.');
  assert.equal(pastResultsTakeaway({ campaigns: 0, lost: 0, incShare: 0, units: 0 }), NOT_ENOUGH);
  const t = behaviourTakeaway([{ name: 'A', n: 10, net: 5 }, { name: 'B', n: 10, net: -5 }, { name: 'C', n: 10, net: -1 }]);
  assert.equal(t, 'A customers earn money from promotions; B and C cost money.');
  assert.equal(behaviourTakeaway([{ name: 'A', n: 2, net: 5 }]), NOT_ENOUGH);
  const net = e.recommendations.reduce((s, r) => s + (r.best?.net ?? 0), 0);
  const att = e.recommendations.filter((r) => r.flag === 'attention').length;
  assert.ok(planningTakeaway({ campaigns: e.recommendations.length, net, flagged: att }).startsWith(`${e.recommendations.length} campaigns planned`));
  assert.ok(simulationTakeaway({ targeted: 0, total: 10, net: 0, roi: 0 }).startsWith('No customer meets'));
});

test('glossary covers the jargon terms and every customer type', async () => {
  const { GLOSSARY } = await import('../src/lib/glossary.ts');
  for (const k of ['auc', 'uplift', 'leakage', 'incrementality', 'roi', 'calibration', 'netProfit', 'pullForward', 'customerType']) assert.ok(GLOSSARY[k], `missing ${k}`);
  for (const t of new Set(e.records.map((r) => r.type))) assert.ok(GLOSSARY[t], `missing customer type ${t}`);
  for (const [k, g] of Object.entries(GLOSSARY)) assert.ok(g.text.split(/(?<=\.)\s/).length <= 2 && g.text.length < 230, `${k} help text too long`);
});

test('signal labels cover all model inputs; top-3 sentence uses real weights', async () => {
  const { SIGNAL_LABELS, signalLabel } = await import('../src/lib/signalLabels.ts');
  const { signalsTakeaway } = await import('../src/lib/takeaways.ts');
  const { PREDICTION_WINDOW_DAYS, FEATURES } = await import('../src/engine/model.ts');
  for (const f of FEATURES) assert.ok(SIGNAL_LABELS[f.key], `no plain-English label for ${f.key}`);
  assert.equal(signalLabel('nope', 'Original name'), 'Original name');
  assert.equal(e.model.importance.length, 19);
  const top = [...e.model.importance].sort((a, b) => b.share - a.share).slice(0, 3);
  const t = signalsTakeaway(e.model.importance);
  for (const i of top) assert.ok(t.includes(`(${Math.round(i.share * 100)}%)`), `missing share of ${i.key}`);
  assert.equal(PREDICTION_WINDOW_DAYS, 14);
});
