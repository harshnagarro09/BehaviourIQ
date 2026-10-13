// KPI methodology, customer types, promotion catalogue and budget optimiser.  Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { TYPE_IDS } from '../src/engine/insights.ts';
import { catalogue, eligibility } from '../src/engine/promotions.ts';
import { predictCategory } from '../src/engine/targeting.ts';
import { responseProfiles } from '../src/engine/response.ts';
import { optimise, activation, minDetectableUplift } from '../src/engine/optimizer.ts';
import { exposures } from '../src/engine/drivers.ts';
import { backtest } from '../src/engine/backtest.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const category = 'Personal Care';
const resp = responseProfiles(e.ds, e.perCustomer, e.asOf, (cid) => e.recById.get(cid).b.avgQty);
const pred = predictCategory(e.ds, e.typeOf, category, e.asOf, resp, e.assumptions);
const items = TYPE_IDS.map((t) => ({ id: t, type: t, category, members: pred.members.get(t), cells: pred.cells.get(t) }));
const settings = (o) => ({ budget: 1e6, objective: 'margin', hurdle: 0, holdout: 0, includeExcluded: false, allowed: () => true, ...o });

test('ROI = incremental margin / promo investment; promo revenue is promoted lines only', () => {
  for (const r of e.results) {
    assert.ok(Math.abs(r.roi - r.incMargin / r.discountCost) < 1e-9);
    assert.ok(Math.abs(r.incMargin - (r.windowMargin - r.baseMargin)) < 1e-6);
    assert.ok(r.promoRevenue <= r.revenue + 1e-6);
  }
  const c = e.results[0].campaign;
  const fromLines = e.ds.lines.filter((l) => l.promoId === c.id).reduce((t, l) => t + l.unit * l.qty, 0);
  assert.ok(e.results[0].promoRevenue <= fromLines + 1e-6, 'never more than the promoted lines took');
});

test('net promo profit is not shown on Behaviour Analytics or Customer Prediction', () => {
  for (const f of ['src/pages/Analytics.tsx', 'src/pages/CustomerPrediction.tsx']) {
    const t = fs.readFileSync(f, 'utf8');
    // as a KPI, column, chart metric or help term (the note explaining its removal is allowed)
    assert.ok(!/(label=|['"`>]\s*)net (promo )?profit|help="netProfit"|\.net\b/i.test(t), `${f} still shows net profit`);
  }
});

test('the data holds the wider set of mechanics; cashback is costed from points', () => {
  const mechs = new Set(e.ds.campaigns.map((c) => c.mechanic));
  for (const m of ['PCT_OFF', 'FLAT_OFF', 'BOGO', 'MULTIBUY_3FOR2', 'B1G1_50', 'TIERED', 'COMBO', 'CASHBACK']) assert.ok(mechs.has(m), m);
  const cb = e.results.find((r) => r.campaign.mechanic === 'CASHBACK');
  assert.ok(cb.rewardCost > 0 && cb.campaign.depth === 10);
  assert.equal(catalogue(e.ds, category).length, 12);
});

test('targeting uses only the four customer types; Sleeping Dogs are excluded by default', () => {
  assert.deepEqual([...pred.members.keys()], TYPE_IDS);
  assert.equal([...pred.members.values()].reduce((t, m) => t + m.length, 0), e.records.length);
  assert.ok(optimise(items, settings()).allocations.every((a) => a.item.type !== 'dog'));
  assert.ok(!fs.existsSync('src/engine/segmentation.ts'), 'the 10-segment layer is gone');
});

test('Sleeping Dogs get negative predicted uplift from every offer; Persuadables move most', () => {
  for (const c of pred.cells.get('dog')) assert.ok(c.uplift < 0, c.promo.key);
  const best = (t) => Math.max(...pred.cells.get(t).filter((c) => c.eligible.ok).map((c) => c.uplift));
  assert.ok(best('persuadable') > best('sure') && best('persuadable') > best('lost'));
});

test('guardrail: no offer below the margin floor (BOGO not allowed on thin-margin dairy)', () => {
  const bogo = (cat) => catalogue(e.ds, cat).find((p) => p.key === 'bogo');
  assert.equal(eligibility(e.ds, 'Dairy', bogo('Dairy')).ok, false);
  assert.equal(eligibility(e.ds, 'Personal Care', bogo('Personal Care')).ok, true);
});

test('optimiser stays within budget, respects the hurdle and gives one offer per audience', () => {
  for (const budget of [2000, 8000, 20000]) {
    const plan = optimise(items, settings({ budget, hurdle: 0.25, holdout: 0.1 }));
    assert.ok(plan.spend <= budget + 1e-6, `spend ${plan.spend} > ${budget}`);
    assert.ok(plan.allocations.every((a) => a.roi >= 0.25));
    assert.equal(new Set(plan.allocations.map((a) => a.item.id)).size, plan.allocations.length);
  }
});

test('optimiser matches brute force on a small case', () => {
  const mk = (id, opts) => ({
    id, type: 'sure', category, members: ['x'],
    cells: opts.map(([cost, val], i) => ({ promo: { key: id + i, family: 'price' }, eligible: { ok: true }, investment: cost, incMargin: val, incRevenue: val, incBuyers: 1, uplift: 0.1, roi: val / cost, history: true, p1: 0.5 })),
  });
  const toy = [mk('a', [[100, 60], [250, 120]]), mk('b', [[150, 100], [300, 150]]), mk('c', [[80, 30], [200, 90]])];
  let best = 0;
  for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) {
    const pick = [[toy[0], i], [toy[1], j], [toy[2], k]].filter(([, x]) => x >= 0).map(([t, x]) => t.cells[x]);
    if (pick.reduce((t, c) => t + c.investment, 0) <= 450) best = Math.max(best, pick.reduce((t, c) => t + c.incMargin, 0));
  }
  const plan = optimise(toy, settings({ budget: 450, includeExcluded: true }));
  assert.ok(plan.incMargin >= best - 1e-6, `optimiser ${plan.incMargin} < brute force ${best}`);
  assert.ok(plan.spend <= 450);
});

test('activation file holds out the stated share and is stable', () => {
  const plan = optimise(items, settings({ holdout: 0.1 }));
  const rows = activation(plan);
  const hold = rows.filter((r) => r.group === 'holdout').length;
  assert.ok(rows.length > 0 && Math.abs(hold / rows.length - 0.1) < 0.03);
  assert.deepEqual(activation(plan), rows);
  assert.ok(minDetectableUplift(0.3, 1000, 1000) < minDetectableUplift(0.3, 100, 100));
});

test('response drivers use only behaviour from before each campaign', () => {
  const byId = new Map(e.ds.campaigns.map((c) => [c.id, c]));
  for (const x of exposures(e.ds, e.perCustomer)) {
    const c = byId.get(x.campaignId);
    assert.ok(x.f.recency >= 0 && x.f.tenure <= c.start - e.ds.minDay);
  }
});

test('backtest: segment prediction is calibrated on recent campaigns', () => {
  const bt = backtest(e.ds, e.perCustomer, 8, e.assumptions);
  assert.ok(Math.abs(bt.overall.predicted - bt.overall.actual) < 0.05, `${bt.overall.predicted} vs ${bt.overall.actual}`);
  assert.ok(bt.gains[bt.gains.length - 1].captured > 0.99);
});

// ------------------------------------------------------------------ Planning and Simulation use the same logic
import { buildScenario } from '../src/engine/planner.ts';
import { aggregateGroup, worthTargeting, TARGET_HURDLE, MIN_SEG_UPLIFT } from '../src/engine/targeting.ts';

test('planner: scenarios come from the promotion catalogue and never include net profit', () => {
  assert.equal(e.recommendations.length, 6);
  for (const r of e.recommendations) {
    assert.ok(r.scenarios.length >= 8 && r.scenarios.every((s) => s.option.key && 'incMargin' in s && !('net' in s)));
    assert.ok(r.scenarios.some((s) => s.option.family === 'volume' || s.option.family === 'bundle'), 'new mechanics are scored');
  }
});

test('planner: recommended audiences are customer types that clear the uplift and ROI bar; Sleeping Dogs never', () => {
  for (const r of e.recommendations.filter((x) => x.best)) {
    const b = r.best;
    assert.equal(b.audience.byType.dog.targeted, 0);
    assert.ok(b.incMargin > 0 && b.roi >= TARGET_HURDLE - 1e-9);
    assert.ok(Math.abs(b.roi - b.incMargin / b.discountCost) < 1e-9);
    for (const t of ['persuadable', 'sure', 'lost']) assert.ok([0, b.audience.byType[t].total].includes(b.audience.byType[t].targeted), 'a type is included whole or not at all');
    assert.ok(b.incMargin >= b.blanket.incMargin - 1e-6 || b.blanket.roi <= b.roi, 'targeting beats sending to everyone');
  }
});

test('planner: a mechanic never run in the category is flagged for a test', () => {
  const r = e.recommendations.find((x) => x.best && !x.best.tested);
  if (r) assert.equal(r.flag, 'attention');
});

test('planner and Customer Prediction agree on the per-type numbers for the same category', () => {
  const r = e.recommendations.find((x) => x.candidate.category === 'Snacks');
  const p = predictCategory(e.ds, e.typeOf, 'Snacks', e.asOf, e.resp, e.assumptions, new Set(e.records.filter((x) => x.b.recencyDays <= 90).map((x) => x.cid)));
  const i = p.promos.findIndex((x) => x.key === r.best.option.key);
  const cells = ['persuadable', 'sure', 'lost', 'dog'].map((t) => p.cells.get(t)[i]);
  const s = buildScenario(cells);
  assert.ok(Math.abs(s.incMargin - r.best.incMargin) / Math.abs(r.best.incMargin) < 0.02);
});

test('simulation building blocks: guardrail blocks thin-margin offers, an untested mechanic is discounted, a budget cap is respected', () => {
  const dairy = catalogue(e.ds, 'Dairy');
  const ctxs = e.records.filter((x) => x.type === 'persuadable').slice(0, 40).map((x) => x.cid);
  const cell = (def, cat = 'Dairy') => aggregateGroup(e.ds, ctxs.map((c) => buildCtxsOne(c, cat)), 'persuadable', cat, def, e.resp, e.assumptions);
  const bogo = cell(dairy.find((p) => p.key === 'bogo'));
  assert.equal(bogo.eligible.ok, false);
  assert.ok(!worthTargeting(bogo));
  const ok = cell(dairy.find((p) => p.key === 'pct10'));
  assert.ok(ok.eligible.ok && ok.uplift > 0 && ok.investment > 0 && MIN_SEG_UPLIFT > 0);
});

import { makeCtx } from '../src/engine/simulation.ts';
function buildCtxsOne(cid, cat) { return makeCtx(e.ds, cid, cat, e.asOf); }

// ------------------------------------------------------------------ Customer Prediction audience builder
import { buildAudience, applyFilters, audienceKpis, exportTable, GOALS, DEFAULT_AUDIENCE, sortRows } from '../src/engine/audience.ts';
import { toCsv, toXlsx } from '../src/lib/download.ts';

const aud = buildAudience(e, predictCategory(e.ds, e.typeOf, 'Snacks', e.asOf, e.resp, e.assumptions), 'recommended');

test('audience: every customer is scored once, scores run 0-100, Sleeping Dogs are never offered', () => {
  assert.equal(aud.rows.length, e.records.length);
  assert.ok(aud.rows.every((r) => r.score >= 0 && r.score <= 100 && r.reason && r.reasons.length));
  assert.ok(aud.rows.filter((r) => r.type === 'dog').every((r) => !r.offer && r.status === 'avoid'));
  assert.equal(aud.offerByType.sure, null, 'Sure Things buy anyway: no discount');
  const s = sortRows(aud.rows, 'score');
  assert.ok(s[0].score >= s[s.length - 1].score);
});

test('audience: KPIs are the sum of the filtered rows, and every goal filter is honoured', () => {
  for (const g of GOALS) {
    const rows = applyFilters(aud.rows, g.filters);
    const k = audienceKpis(rows);
    assert.equal(k.customers, rows.length);
    assert.ok(Math.abs(k.extraBuyers - rows.filter((r) => r.offer).reduce((t, r) => t + r.uplift, 0)) < 1e-9);
    assert.ok(Math.abs(k.buyersWith - k.buyersWithout - k.extraBuyers) < 1e-9);
    if (g.filters.recommendedOnly) assert.ok(rows.every((r) => r.status === 'target'));
    if (g.filters.activity === 'lapsing') assert.ok(rows.every((r) => r.activity !== 'active'));
    if (g.filters.type === 'notDog') assert.ok(rows.every((r) => r.type !== 'dog'));
  }
  assert.equal(applyFilters(aud.rows, DEFAULT_AUDIENCE).length, aud.rows.length);
  assert.deepEqual(applyFilters(aud.rows, { ...DEFAULT_AUDIENCE, search: aud.rows[0].cid }).map((r) => r.cid), [aud.rows[0].cid]);
});

test('download: the file holds exactly the filtered audience, as CSV and as a valid .xlsx', () => {
  const rows = applyFilters(aud.rows, GOALS[0].filters);
  const { head, data } = exportTable(rows, 'Snacks');
  assert.deepEqual(data.map((d) => d[0]), rows.map((r) => r.cid));
  assert.ok(head.includes('response_score') && head.includes('targeting_reason') && head.includes('customer_type'));
  const csv = toCsv(head, data);
  assert.equal(csv.trim().split('\r\n').length, rows.length + 1);
  const x = toXlsx(head, data);
  assert.equal(String.fromCharCode(x[0], x[1]), 'PK');
  const text = new TextDecoder().decode(x);
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) assert.ok(text.includes(part), part);
  assert.ok(text.includes(rows[rows.length - 1].cid));
});

// ---------------------------------------------------------------- budget by brand / category / SKU
import { skuCatalog } from '../src/engine/products.ts';
import { rangeItems, rangeShares, rollDown, scaleCell } from '../src/engine/budgetScope.ts';

const catalog = skuCatalog(e.ds);
const predFor = (c) => predictCategory(e.ds, e.typeOf, c, e.asOf, resp, e.assumptions);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test('product catalogue: SKU shares of regular sales sum to 1 in every category', () => {
  assert.ok(catalog.length > 0);
  for (const c of new Set(catalog.map((s) => s.category))) near(catalog.filter((s) => s.category === c).reduce((t, s) => t + s.share, 0), 1) || assert.fail(c);
  assert.ok(catalog.every((s) => s.brand && s.category && s.productId && s.share >= 0));
});

test('budget scope: scaling keeps ROI and buying chance, scales money; SKU plan rolls up to the plan exactly', () => {
  const cell = pred.cells.get('persuadable').find((c) => c.investment > 0);
  const half = scaleCell(cell, 0.5);
  assert.ok(near(half.investment, cell.investment / 2) && near(half.incMargin, cell.incMargin / 2) && near(half.incRevenue, cell.incRevenue / 2));
  assert.equal(half.roi, cell.roi);
  assert.equal(half.uplift, cell.uplift);

  const brand = catalog[0].brand;
  for (const range of [catalog, catalog.filter((s) => s.brand === brand), catalog.filter((s) => s.brand === brand && s.category === category), [catalog.find((s) => s.category === category)]]) {
    const its = rangeItems(range, predFor);
    const plan = optimise(its, settings({ budget: 30000, hurdle: 0.25, holdout: 0.1 }));
    const rows = rollDown(plan, range);
    near(rows.reduce((t, r) => t + r.spend, 0), plan.spend) || assert.fail('spend reconciles');
    near(rows.reduce((t, r) => t + r.incMargin, 0), plan.incMargin) || assert.fail('margin reconciles');
    near(rows.reduce((t, r) => t + r.incRevenue, 0), plan.incRevenue) || assert.fail('revenue reconciles');
    assert.ok(plan.spend <= 30000 + 1e-6, 'within budget');
    assert.ok(rows.every((r) => range.includes(r.sku)), 'money only goes to SKUs in range');
    for (const [c, sh] of rangeShares(range)) assert.ok(sh > 0 && sh <= 1 + 1e-9, c);
  }
});

test('budget scope: the SKUs of a category, planned one by one with the budget split by share, add up to the category plan', () => {
  const skus = catalog.filter((s) => s.category === category);
  const big = settings({ budget: 1e7, hurdle: 0.25, holdout: 0 });
  const whole = optimise(rangeItems(skus, predFor), big);
  const parts = skus.map((s) => optimise(rangeItems([s], predFor), big));
  near(parts.reduce((t, p) => t + p.spend, 0), whole.spend, 1e-4) || assert.fail('spend');
  near(parts.reduce((t, p) => t + p.incMargin, 0), whole.incMargin, 1e-4) || assert.fail('margin');
});

// ---------------------------------------------------------------- budget planner: limits, business as usual, reasons
import { pastPractice, explainPlan, unallocated } from '../src/engine/budgetScope.ts';

const allItems = rangeItems(catalog, predFor);
const spendIn = (plan, c) => plan.allocations.filter((a) => a.item.category === c).reduce((t, a) => t + a.spend, 0);
const base30 = settings({ budget: 30000, hurdle: 0.25, holdout: 0.1 });

test('limits: a category maximum is never exceeded and a reachable minimum is met, within budget', () => {
  const free = optimise(allItems, base30);
  const top = [...new Set(free.allocations.map((a) => a.item.category))].sort((a, b) => spendIn(free, b) - spendIn(free, a));
  const [big, small] = [top[0], top[top.length - 1]];
  const max = Math.round(spendIn(free, big) / 2);
  const plan = optimise(allItems, { ...base30, limits: { [big]: { max }, [small]: { min: 2000 } } });
  assert.ok(spendIn(plan, big) <= max + 1e-6, `max ${max} exceeded: ${spendIn(plan, big)}`);
  assert.ok(spendIn(plan, small) >= 2000 - 1e-6 || plan.limitIssues.some((x) => x.category === small && x.kind === 'min-unreachable'));
  assert.ok(plan.spend <= 30000 + 1e-6);
  assert.ok(plan.incMargin <= free.incMargin + 1e-6, 'limits can only cost value');
  assert.ok(plan.limitIssues.some((x) => x.category === big && x.kind === 'max-binding'));
});

test('limits: an unreachable minimum is reported, and minimums above the budget are set aside', () => {
  const c = catalog[0].category;
  const plan = optimise(allItems, { ...base30, limits: { [c]: { min: 1e7 } } });
  assert.ok(plan.limitIssues.some((x) => x.category === c && x.kind === 'min-unreachable' && x.possible < 1e7));
  const cats = [...new Set(allItems.map((i) => i.category))];
  const over = optimise(allItems, { ...base30, budget: 3000, limits: Object.fromEntries(cats.map((k) => [k, { min: 1000 }])) });
  assert.ok(over.limitIssues.some((x) => x.kind === 'mins-over-budget'));
  assert.ok(over.spend <= 3000 + 1e-6);
});

test('business as usual: splits the budget like actual past spend, never spends more than the budget', () => {
  const bau = pastPractice(e.results, allItems, catalog, 30000);
  assert.ok(bau.spend <= 30000 + 1e-6);
  near(bau.rows.reduce((t, r) => t + r.allotted, 0), 30000) || assert.fail('allotted sums to budget');
  const past = new Map();
  for (const r of e.results) past.set(r.campaign.category, (past.get(r.campaign.category) ?? 0) + r.discountCost);
  const tot = [...past.values()].reduce((a, b) => a + b, 0);
  for (const r of bau.rows) near(r.allotted / 30000, past.get(r.category) / tot) || assert.fail(r.category);
  assert.ok(optimise(allItems, base30).incMargin >= bau.incMargin, 'the optimised plan beats past practice on its own goal');
});

test('reasons: every category in range is explained, funded money matches the plan, Sleeping Dogs are never offered', () => {
  const plan = optimise(allItems, base30);
  const adv = explainPlan(plan, null, allItems);
  assert.deepEqual(adv.map((a) => a.category).sort(), [...new Set(allItems.map((i) => i.category))].sort());
  near(adv.reduce((t, a) => t + a.spend, 0), plan.spend) || assert.fail('spend');
  for (const a of adv) {
    assert.ok(a.headline.length > 10);
    assert.ok(a.types.find((t) => t.type === 'dog')?.funded === false);
    assert.equal(a.status === 'funded' || a.status === 'capped' || a.status === 'raised', a.spend > 0);
  }
  assert.ok(typeof unallocated(plan, null).text === 'string');
  const big = optimise(allItems, { ...base30, budget: 1e6 });
  assert.match(unallocated(big, null).text, /already funded/);
});

test('audience: goals set who is in the audience, not who is offered; the type mix and offer split agree everywhere', () => {
  for (const g of GOALS.filter((x) => x.id !== 'custom')) assert.ok(!g.filters.recommendedOnly, `${g.id} does not pre-filter to recommended customers`);
  const rows = applyFilters(aud.rows, GOALS[0].filters);
  const types = new Set(rows.map((r) => r.type));
  assert.ok(types.size >= 3, 'an active-customer audience holds several customer types');
  const k = audienceKpis(rows);
  const byType = Object.fromEntries(['persuadable', 'sure', 'lost', 'dog'].map((t) => [t, rows.filter((r) => r.type === t)]));
  assert.equal(Object.values(byType).reduce((s, x) => s + x.length, 0), k.customers);
  assert.equal(Object.values(byType).reduce((s, x) => s + x.filter((r) => r.offer).length, 0), k.offered);
  // a customer gets an offer exactly when their type does; Sleeping Dogs never
  for (const r of rows) assert.equal(!!r.offer, !!aud.offerByType[r.type]);
  const { data } = exportTable(rows, 'Snacks');
  assert.equal(data.filter((d) => d[6] !== 'No offer').length, k.offered, 'the download marks the same customers as offered');
});

test('customer types: a quantity jump on deals alone does not make someone a Persuadable', () => {
  for (const r of e.records) if (r.type === 'persuadable' && r.b.respRate < 0.2) assert.ok(r.b.qtyRatio >= 1.7 && r.b.respRate >= 0.1, r.cid);
});
