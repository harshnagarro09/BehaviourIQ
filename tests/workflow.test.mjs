// The planning workflow at engine level: plan for chosen customer groups -> budget -> what-if scenario. Mirrors what
// src/lib/plan.ts does for Planning and Simulation (same prediction, same optimiser), without the UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { predictCategory } from '../src/engine/targeting.ts';
import { depthOptions } from '../src/engine/elasticity.ts';
import { activityOf } from '../src/engine/audience.ts';
import { optimise, activation, qualifies } from '../src/engine/optimizer.ts';
import { skuCatalog } from '../src/engine/products.ts';
import { rangeItems, rollDown, explainPlan, pastPractice } from '../src/engine/budgetScope.ts';
import { toCsv, toXlsx } from '../src/lib/download.ts';
import { MAX_SUBSIDY } from '../src/engine/targeting.ts';
import { statusOf, progressOf, endOf, addDays } from '../src/lib/live.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
// the same prediction the app uses: customer behaviour + the category demand curve, limited to the customers planned for
const predict = (c, only) => predictCategory(e.ds, e.typeOf, c, e.asOf, e.resp, e.assumptions, only, depthOptions(e.elasticity.byCategory.get(c)));
const catalog = skuCatalog(e.ds);
const range = catalog.filter((s) => s.share > 0);
const settings = (o = {}) => ({ budget: 30000, objective: 'margin', hurdle: 0.25, holdout: 0.1, includeExcluded: false, allowed: () => true, ...o });
// "Start from: Active customers", as Planning does by default
const active = new Set(e.records.filter((r) => activityOf(r.b) === 'active').map((r) => r.cid));
const itemsAll = rangeItems(range, (c) => predict(c, active));
const forGroups = (groups) => itemsAll.filter((i) => groups.includes(i.type));

test('the plan only reaches the customer groups chosen, among the customers it starts from', () => {
  const plan = optimise(forGroups(['persuadable']), settings());
  assert.ok(plan.allocations.length > 0 && plan.allocations.every((a) => a.item.type === 'persuadable'));
  assert.ok(activation(plan).every((r) => active.has(r.cid) && e.typeOf.get(r.cid) === 'persuadable'));
  const sku = rollDown(plan, range);
  assert.ok(Math.abs(sku.reduce((t, r) => t + r.spend, 0) - plan.spend) < 1e-6, 'the product split adds up to the plan');
  assert.equal(optimise(forGroups([]), settings()).spend, 0, 'no group, no plan');
});

test('recommended groups: a group is recommended when an offer for it clears the bar; Sleeping Dogs never', () => {
  const s = settings();
  const recommended = ['persuadable', 'sure', 'lost', 'dog'].filter((t) => t !== 'dog' && itemsAll.some((i) => i.type === t && i.members.length && i.cells.some((c) => qualifies(c, s))));
  assert.ok(recommended.includes('persuadable'));
  assert.ok(!recommended.includes('dog'));
  const plan = optimise(itemsAll, s);
  assert.ok(plan.allocations.every((a) => a.item.type !== 'dog'), 'Sleeping Dogs are excluded unless asked for');
  assert.ok(plan.allocations.every((a) => recommended.includes(a.item.type)), 'money only goes to groups that pay back');
});

test('the budget is respected at every level and money never goes where no offer pays back', () => {
  const items = forGroups(['persuadable', 'sure', 'lost']);
  for (const budget of [0, 2000, 15000, 80000]) {
    const plan = optimise(items, settings({ budget }));
    assert.ok(plan.spend <= budget + 1e-6, `spend within ${budget}`);
    assert.ok(plan.allocations.every((a) => a.roi >= 0.25 - 1e-9 && a.incMargin > 0));
  }
  const plan = optimise(items, settings());
  const advice = explainPlan(plan, null, items);
  assert.ok(Math.abs(advice.reduce((t, a) => t + a.spend, 0) - plan.spend) < 1e-6, 'category reasons cover the whole plan');
  assert.ok(pastPractice(e.results, items, range, 30000).spend <= 30000 + 1e-6);
});

test('the recommended budget is where returns level off', () => {
  const items = forGroups(['persuadable', 'sure', 'lost']);
  const at = (budget) => optimise(items, settings({ budget }));
  const level = at(100000).recommendedBudget;
  assert.ok(level > 2000);
  const small = at(Math.round(level / 4)), mid = at(Math.round(level / 2));
  assert.ok(small.spend < mid.spend && small.incMargin < mid.incMargin, 'below the level, more budget buys more');
  assert.ok(at(level).incMargin >= 0.97 * at(level * 3).incMargin, 'the recommended budget captures nearly all the value');
});

test('a scenario with one offer for everyone is planned the same way and changes the result', () => {
  const groups = ['persuadable', 'sure', 'lost'];
  const best = optimise(forGroups(groups), settings());
  const onlyPct20 = optimise(forGroups(groups), settings({ allowed: (p) => p.key === 'pct20' }));
  assert.ok(onlyPct20.allocations.every((a) => a.cell.promo.key === 'pct20'));
  assert.ok(best.incMargin >= onlyPct20.incMargin - 1e-6, 'the best discount per group is at least as good as one offer for all');
});

test('advanced settings: a reach cap and a depth cap are honoured', () => {
  const items = forGroups(['persuadable', 'sure']);
  const half = optimise(items, settings({ maxCoverage: 0.5 }));
  assert.ok(half.allocations.length > 0 && half.allocations.every((a) => a.coverage <= 0.5 + 1e-9), 'no group reached beyond half');
  assert.ok(half.spend <= optimise(items, settings()).spend + 1e-6);
  const shallow = optimise(items, settings({ allowed: (p) => p.depth <= 15 }));
  assert.ok(shallow.allocations.every((a) => a.cell.promo.depth <= 15));
});

test('the customer list download holds exactly the planned customers, as CSV and as a valid .xlsx', () => {
  const plan = optimise(forGroups(['persuadable']), settings());
  const rows = activation(plan);
  const head = ['customer_id', 'customer_group', 'category', 'offer', 'group'];
  const data = rows.map((r) => [r.cid, r.type, r.category, r.offer, r.group]);
  assert.equal(toCsv(head, data).trim().split('\r\n').length, rows.length + 1);
  const x = toXlsx(head, data);
  assert.equal(String.fromCharCode(x[0], x[1]), 'PK');
  assert.ok(new TextDecoder().decode(x).includes(rows[rows.length - 1].cid));
});

test('live campaigns: status and progress follow the dates; stopping early ends it', () => {
  const c = { start: '2026-10-10', days: 14 };
  assert.equal(statusOf(c, '2026-10-09'), 'scheduled');
  assert.equal(statusOf(c, '2026-10-10'), 'running');
  assert.equal(statusOf(c, '2026-10-23'), 'running', 'the last day still runs');
  assert.equal(statusOf(c, '2026-10-24'), 'ended');
  assert.deepEqual(progressOf(c, '2026-10-13'), { day: 4, share: 4 / 14, left: 10 });
  assert.equal(endOf(c), '2026-10-23');
  const stopped = { ...c, stoppedOn: '2026-10-13' };
  assert.equal(statusOf(stopped, '2026-10-13'), 'ended');
  assert.equal(endOf(stopped), '2026-10-13');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('recommendation rule: money mostly buys new sales, so Sure Things are not funded; lapsing customers are judged on their own', () => {
  const s = settings({ maxSubsidy: MAX_SUBSIDY });
  const plan = optimise(itemsAll, s);
  assert.ok(plan.allocations.length > 0);
  assert.ok(plan.allocations.every((a) => a.cell.subsidy <= MAX_SUBSIDY * a.cell.investment + 1e-9), 'no funded offer spends more than the limit on sales that happen anyway');
  assert.ok(plan.allocations.every((a) => a.item.type !== 'sure'), 'Sure Things: most of their discount pays for buying they would do anyway');
  assert.ok(plan.allocations.every((a) => a.item.type !== 'dog'));
  // without the limit, the old behaviour comes back: a small-uplift Sure Things offer can pay back on ROI alone
  const loose = optimise(itemsAll, settings({ budget: 100000 }));
  assert.ok(loose.allocations.some((a) => a.item.type === 'sure'), 'the limit is what keeps them out');
  // lapsing customers, planned as their own segment, can earn a win-back offer when it pays on their own numbers
  const lapsing = new Set(e.records.filter((r) => activityOf(r.b) !== 'active').map((r) => r.cid));
  const win = optimise(rangeItems(range, (c) => predict(c, lapsing)), s);
  assert.ok(win.allocations.every((a) => a.item.type === 'persuadable'), 'win-back only for groups that react to offers');
  assert.ok(win.allocations.length > 0, 'at least one win-back offer pays back in this data');
});
