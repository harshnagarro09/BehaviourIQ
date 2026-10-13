// Find customers -> Plan the budget: the audience built in Find customers is exactly what the budget plan works on.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { predictCategory } from '../src/engine/targeting.ts';
import { estimateElasticity, depthOptions } from '../src/engine/elasticity.ts';
import { buildAudience, applyFilters, audienceKpis, describeFilters, exportTable, GOALS, DEFAULT_AUDIENCE } from '../src/engine/audience.ts';
import { optimise, activation } from '../src/engine/optimizer.ts';
import { skuCatalog } from '../src/engine/products.ts';
import { rangeItems, rollDown, explainPlan, pastPractice } from '../src/engine/budgetScope.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const model = estimateElasticity(e.results, e.perCustomer, e.typeOf);
// the same prediction the app uses for Plan the budget: behaviour + price elasticity, limited to an audience
const predict = (c, only) => predictCategory(e.ds, e.typeOf, c, e.asOf, e.resp, e.assumptions, only, depthOptions(model.byCategory.get(c)));
const catalog = skuCatalog(e.ds);
const settings = (o = {}) => ({ budget: 30000, objective: 'margin', hurdle: 0.25, holdout: 0.1, includeExcluded: false, allowed: () => true, ...o });
const category = 'Snacks';
const findRows = (filters) => applyFilters(buildAudience(e, predict(category), 'recommended').rows, filters);

test('the plan works on exactly the customers Find customers lists', () => {
  const rows = findRows(GOALS[0].filters);
  const ids = new Set(rows.map((r) => r.cid));
  const P = predict(category, ids);
  const members = [...P.members.values()].flat();
  assert.equal(members.length, ids.size, 'every audience customer is in one customer type, nobody else');
  assert.ok(members.every((c) => ids.has(c)));
  for (const t of ['persuadable', 'sure', 'lost', 'dog']) assert.equal(P.members.get(t).length, rows.filter((r) => r.type === t).length, `${t}: same count as Find customers`);
  // and the plan only ever contacts audience customers, within budget
  const range = catalog.filter((s) => s.category === category && s.share > 0);
  const plan = optimise(rangeItems(range, (c) => predict(c, ids)), settings());
  assert.ok(plan.spend <= 30000 + 1e-6);
  assert.ok(activation(plan).every((r) => ids.has(r.cid)), 'no customer outside the audience gets an offer or is held out');
  assert.ok(Math.abs(plan.incUnits - plan.allocations.reduce((t, a) => t + a.incUnits, 0)) < 1e-6);
  // the product roll-down still adds up to the plan
  const sku = rollDown(plan, range);
  assert.ok(Math.abs(sku.reduce((t, r) => t + r.spend, 0) - plan.spend) < 1e-6);
});

test('changing the audience in Find customers changes the plan; Sleeping Dogs are never offered', () => {
  const range = catalog.filter((s) => s.share > 0);
  const planFor = (filters) => {
    const ids = new Set(findRows(filters).map((r) => r.cid));
    return { ids, plan: optimise(rangeItems(range, (c) => predict(c, ids)), settings()) };
  };
  const everyone = planFor(DEFAULT_AUDIENCE);
  const sureOnly = planFor({ ...DEFAULT_AUDIENCE, type: 'sure' });
  const pers = planFor({ ...DEFAULT_AUDIENCE, type: 'persuadable' });
  assert.ok(everyone.plan.allocations.every((a) => a.item.type !== 'dog'));
  assert.ok(pers.plan.allocations.length > 0 && pers.plan.allocations.every((a) => a.item.type === 'persuadable'));
  // customers who buy anyway: offers barely change what they do, so the plan spends far less on them per customer
  assert.ok(sureOnly.plan.incMargin < pers.plan.incMargin, 'a Sure Things audience earns less extra margin than a Persuadables one');
  assert.ok(sureOnly.plan.allocations.every((a) => a.item.type === 'sure'));
});

test('the budget is respected at every level and spend never goes where no offer pays back', () => {
  const ids = new Set(findRows(GOALS[0].filters).map((r) => r.cid));
  const range = catalog.filter((s) => s.share > 0);
  const items = rangeItems(range, (c) => predict(c, ids));
  for (const budget of [0, 2000, 15000, 80000]) {
    const plan = optimise(items, settings({ budget }));
    assert.ok(plan.spend <= budget + 1e-6, `spend within ${budget}`);
    assert.ok(plan.allocations.every((a) => a.roi >= 0.25 - 1e-9 && a.incMargin > 0), 'every funded offer clears the minimum return and adds margin');
  }
  const plan = optimise(items, settings());
  const advice = explainPlan(plan, null, items);
  assert.ok(Math.abs(advice.reduce((t, a) => t + a.spend, 0) - plan.spend) < 1e-6, 'category reasons cover the whole plan');
  const bau = pastPractice(e.results, items, range, 30000);
  assert.ok(bau.spend <= 30000 + 1e-6);
});

test('Find customers describes its targeting criteria and its download matches what it hands over', () => {
  assert.deepEqual(describeFilters(GOALS[0].filters, category), ['all except Sleeping Dogs', 'active']);
  assert.deepEqual(describeFilters(DEFAULT_AUDIENCE, category), []);
  const rows = findRows(GOALS[2].filters);
  assert.ok(describeFilters(GOALS[2].filters, category).includes(`regular ${category} buyers`));
  const { data } = exportTable(rows, category);
  assert.deepEqual(data.map((d) => d[0]), rows.map((r) => r.cid));
  assert.equal(audienceKpis(rows).customers, rows.length);
});

test('an audience built for one category can be planned for another: the audience stays, the products change the plan', () => {
  // "Win back inactive customers" built in Find customers for Beverages ...
  const bev = applyFilters(buildAudience(e, predict('Beverages'), 'recommended').rows, GOALS[1].filters);
  const ids = new Set(bev.map((r) => r.cid));
  assert.ok(ids.size > 0);
  // ... planned for Personal Care instead: same customers, Personal Care's own predictions for them
  const pc = catalog.filter((s) => s.category === 'Personal Care' && s.share > 0);
  const bv = catalog.filter((s) => s.category === 'Beverages' && s.share > 0);
  const itemsPc = rangeItems(pc, (c) => predict(c, ids));
  const itemsBv = rangeItems(bv, (c) => predict(c, ids));
  assert.equal(itemsPc.reduce((t, i) => t + i.members.length, 0), ids.size, 'the audience is not discarded when the product changes');
  assert.ok(itemsPc.every((i) => i.category === 'Personal Care' && i.members.every((c) => ids.has(c))));
  const pPc = optimise(itemsPc, settings()), pBv = optimise(itemsBv, settings());
  assert.ok(pPc.spend <= 30000 + 1e-6 && pBv.spend <= 30000 + 1e-6);
  assert.ok(pPc.allocations.every((a) => a.item.category === 'Personal Care'));
  // the recommendation really depends on the product, not only its label
  assert.notDeepEqual(itemsPc[0].cells.map((c) => Math.round(c.p0 * 1e6)), itemsBv[0].cells.map((c) => Math.round(c.p0 * 1e6)));
});

test('starting from scratch: only the ticked customer groups are planned for, and no groups means no plan', () => {
  const range = catalog.filter((s) => s.share > 0);
  const pick = (types) => new Set(e.records.filter((r) => types.includes(r.type)).map((r) => r.cid));
  const two = pick(['sure', 'lost']);
  const items = rangeItems(range, (c) => predict(c, two));
  for (const i of items) {
    if (i.type === 'sure' || i.type === 'lost') assert.equal(i.members.length, e.records.filter((r) => r.type === i.type).length, `all ${i.type} included`);
    else assert.equal(i.members.length, 0, `${i.type} left out`);
  }
  const plan = optimise(items, settings());
  assert.ok(plan.allocations.every((a) => a.item.type === 'sure' || a.item.type === 'lost'));
  assert.ok(activation(plan).every((r) => two.has(r.cid)));
  const nobody = optimise(rangeItems(range, (c) => predict(c, new Set())), settings());
  assert.equal(nobody.allocations.length, 0);
  assert.equal(nobody.spend, 0);
});

test('budget changes drive the plan up to where returns level off; the recommended budget is that level', () => {
  const range = catalog.filter((s) => s.share > 0);
  const ids = new Set(e.records.filter((r) => r.type !== 'dog').map((r) => r.cid));
  const items = rangeItems(range, (c) => predict(c, ids));
  const at = (budget) => optimise(items, settings({ budget }));
  const level = at(30000).recommendedBudget;
  assert.ok(level > 2000, 'there is room to spend');
  const small = at(Math.round(level / 4)), mid = at(Math.round(level / 2));
  assert.ok(small.spend < mid.spend && small.incMargin < mid.incMargin, 'more budget below the level buys more');
  assert.ok(mid.spend <= Math.round(level / 2) + 1e-6);
  const big = at(level * 3), atLevel = at(level);
  assert.ok(big.incMargin >= atLevel.incMargin - 1e-6 && big.incMargin <= atLevel.maxUsefulValue + 1e-6, 'beyond the level, extra budget adds (almost) nothing');
  assert.ok(atLevel.incMargin >= 0.97 * at(level * 3).incMargin, 'the recommended budget captures nearly all the available value');
});

test('Find customers "All categories": every customer once, in the category where an offer helps most, and Plan the budget accepts it', async () => {
  const { buildAudienceAll, ALL_CATEGORIES } = await import('../src/engine/audience.ts');
  const A = buildAudienceAll(e, (c) => predict(c));
  assert.equal(A.rows.length, e.records.length);
  assert.equal(new Set(A.rows.map((r) => r.cid)).size, e.records.length, 'each customer appears once');
  assert.ok(A.rows.every((r) => e.ds.categories.includes(r.category)));
  assert.ok(new Set(A.rows.map((r) => r.category)).size > 1, 'customers are spread over several categories');
  // the row chosen for a customer is never worse than the Snacks-only row
  const snacks = buildAudience(e, predict('Snacks'), 'recommended').rows;
  const rank = { target: 3, optional: 2, hold: 1, avoid: 0 };
  A.rows.forEach((r, i) => assert.ok(rank[r.status] >= rank[snacks[i].status], r.cid));
  assert.ok(A.rows.filter((r) => r.type === 'dog').every((r) => !r.offer));
  assert.ok(A.rows.every((r) => r.score >= 0 && r.score <= 100));
  // exporting names each customer's own category; the audience can be planned for any product
  const { head, data } = exportTable(A.rows);
  assert.equal(data[0][head.indexOf('promoted_category')], A.rows[0].category);
  assert.ok(describeFilters({ ...DEFAULT_AUDIENCE, categoryBuyers: true }, ALL_CATEGORIES).length === 1);
  const ids = new Set(A.rows.filter((r) => r.status === 'target').map((r) => r.cid));
  const range = catalog.filter((s) => s.category === 'Dairy' && s.share > 0);
  const plan = optimise(rangeItems(range, (c) => predict(c, ids)), settings());
  assert.ok(plan.spend <= 30000 + 1e-6);
});
