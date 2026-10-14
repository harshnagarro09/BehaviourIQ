// Tests the real Planning/Simulation calculation (src/lib/plan.ts), not a copy of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { skuCatalog } from '../src/engine/products.ts';
import { activation } from '../src/engine/optimizer.ts';
import { behaviourAlerts, customerFacts, ruleDefs } from '../src/engine/groupInsights.ts';
import { MAX_SUBSIDY } from '../src/engine/targeting.ts';
import { classify, TYPE_RULES } from '../src/engine/segments.ts';
import { reliabilityOf, sensitivityOf, likelyRange } from '../src/engine/reliability.ts';
import { measureCampaign } from '../src/engine/measure.ts';
import { dayOf, isoOf } from '../src/engine/data.ts';
import { computePlan, planAlerts, DEFAULT_PLAN } from '../src/lib/plan.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const catalog = skuCatalog(e.ds);
const run = (patch = {}) => computePlan(e, catalog, { ...DEFAULT_PLAN, ...patch });

test('default plan: Persuadables are recommended, Sure Things and Sleeping Dogs are not, and the budget holds', () => {
  const r = run();
  assert.ok(r.recGroups.includes('persuadable'));
  assert.ok(!r.recGroups.includes('sure') && !r.recGroups.includes('dog'));
  assert.ok(r.plan.spend <= r.settings.budget + 1e-6);
  assert.ok(r.plan.allocations.length > 0 && r.plan.allocations.every((a) => a.item.type === 'persuadable'));
  assert.ok(r.plan.allocations.every((a) => a.cell.subsidy <= MAX_SUBSIDY * a.cell.investment + 1e-9));
  // the recommended budget funds everything worthwhile: the plan at that budget equals the recommendation
  assert.ok(Math.abs(r.rec.plan.incMargin - r.plan.incMargin) < 1e-6);
});

test('active and slowing / inactive customers are planned as separate segments (win-back judged on its own)', () => {
  const r = run();
  const segs = new Set(r.itemsAll.map((i) => i.segment));
  assert.deepEqual([...segs].sort(), ['active', 'lapsing']);
  const pers = r.insights.find((g) => g.type === 'persuadable');
  assert.equal(pers.segments.length, 2);
  assert.equal(pers.customers, pers.segments.reduce((t, s) => t + s.customers, 0));
  const onlyActive = run({ activity: 'active' });
  assert.ok(onlyActive.itemsAll.every((i) => i.segment === 'active'));
});

test('ticking Sure Things adds the group, but with the subsidy rule they get no money; loosening the rule funds them', () => {
  const withSure = run({ groups: ['persuadable', 'sure'] });
  assert.ok(withSure.plan.allocations.every((a) => a.item.type !== 'sure'));
  const loose = run({ groups: ['persuadable', 'sure'], maxSubsidy: null, hurdle: 0, budget: 100000 });
  assert.ok(loose.plan.allocations.some((a) => a.item.type === 'sure'));
});

test('behaviour alerts in Planning are exactly those of Behaviour Analytics for the same period', () => {
  const p = { from: Math.max(e.ds.minDay, e.ds.maxDay - 183 + 1), to: e.ds.maxDay };
  const facts = customerFacts(e.ds, e.typeOf, p);
  const expected = behaviourAlerts(facts, ruleDefs(facts));
  const mine = planAlerts(e, '6m');
  assert.equal(mine.length, expected.length);
  assert.ok(expected.length > 0);
  for (const a of mine) assert.equal(a.ids.length, a.alert.n, 'the customers of an alert are the sub-group the alert counts');
  assert.notEqual(planAlerts(e, '3m').map((a) => a.key).join(), mine.map((a) => a.key).join());
});

test('leaving an alert out removes exactly those customers from the plan', () => {
  const base = run();
  const a = base.alerts.find((x) => x.inPlan);
  assert.ok(a, 'there is an alert about a group in the plan');
  const out = run({ leaveOut: [a.key] });
  const gone = new Set(a.ids);
  assert.ok(out.ids.every((cid) => !gone.has(cid)));
  assert.equal(out.ids.length, base.ids.length - base.ids.filter((cid) => gone.has(cid)).length);
  assert.ok(activation(out.plan).every((r) => !gone.has(r.cid)));
});

test('advanced rules: depth cap, reach cap and tested-only are honoured by the plan', () => {
  assert.ok(run({ maxDepth: 15 }).plan.allocations.every((a) => a.cell.promo.depth <= 15));
  assert.ok(run({ maxCoverage: 0.5 }).plan.allocations.every((a) => a.coverage <= 0.5 + 1e-9));
  assert.ok(run({ testedOnly: true }).plan.allocations.every((a) => a.cell.history));
});

test('reliability: accuracy on recent campaigns gives a sensible range, and type rules are not razor-thin', () => {
  const rel = reliabilityOf(e.ds, e.perCustomer, e.records, e.assumptions);
  assert.ok(rel.typicalMiss > 0 && rel.typicalMiss < 0.5);
  assert.ok(rel.band >= 0.15 && rel.band <= 0.5);
  assert.equal(rel.backtest.perCampaign.length, 8);
  const r = likelyRange(82285, 0.29);
  assert.deepEqual(r, { low: 58000, high: 106000 });
  // the cutoffs are hand-set: moving them 15% changes only a minority of customers
  assert.ok(rel.sensitivity.share < 0.25, `${rel.sensitivity.share}`);
  assert.equal(sensitivityOf(e.records, 0).changed, 0, 'with no shift nobody changes type');
  assert.ok(e.records.every((r) => classify(r.b, TYPE_RULES).type === r.type), 'the named rules are the rules the app uses');
});

test('measuring a campaign: treated customers compared with those held back, only for the days the data covers', () => {
  const r = run();
  const rows = activation(r.plan);
  const start = isoOf(e.ds.maxDay - 20);
  const m = measureCampaign(e.ds, rows, start, 14);
  assert.ok(m && m.days === 14 && m.treated.n > 0 && m.held.n > 0);
  assert.ok(Math.abs(m.lift - (m.rateTreated - m.rateHeld)) < 1e-12 && Math.abs(m.extraBuyers - m.lift * m.treated.n) < 1e-9);
  // a campaign that starts after the data ends cannot be measured; one that is half covered is measured so far
  assert.equal(measureCampaign(e.ds, rows, isoOf(e.ds.maxDay + 1), 14), null);
  assert.equal(measureCampaign(e.ds, rows, isoOf(e.ds.maxDay - 6), 14).days, 7);
  assert.equal(dayOf(measureCampaign(e.ds, rows, isoOf(e.ds.maxDay - 6), 14).to), e.ds.maxDay);
  assert.equal(measureCampaign(e.ds, rows.filter((x) => x.group === 'treatment'), start, 14), null, 'no control group, no measurement');
});

import { sanitizePlan, sanitizeCampaigns, sanitizeScenarios, parseBackup, makeBackup, STORE_VERSION } from '../src/lib/store.ts';
import { lengthFactor } from '../src/lib/live.ts';

test('saved data is checked on the way in: old, partial or wrong-typed data never breaks the plan', () => {
  assert.deepEqual(sanitizePlan(undefined), DEFAULT_PLAN);
  assert.deepEqual(sanitizePlan('nonsense'), DEFAULT_PLAN);
  // an older save without the newer fields keeps what it had and takes defaults for the rest
  const old = sanitizePlan({ budget: 40000, objective: 'revenue', hurdle: 0.5, groups: ['persuadable'] });
  assert.equal(old.budget, 40000);
  assert.equal(old.objective, 'revenue');
  assert.equal(old.maxSubsidy, DEFAULT_PLAN.maxSubsidy);
  assert.deepEqual(old.leaveOut, []);
  // wrong types and unknown fields are dropped
  const bad = sanitizePlan({ budget: 'a lot', objective: 7, extra: 1, limits: [] });
  assert.equal(bad.budget, DEFAULT_PLAN.budget);
  assert.equal(bad.objective, DEFAULT_PLAN.objective);
  assert.deepEqual(bad.limits, DEFAULT_PLAN.limits);
  assert.ok(!('extra' in bad));
  assert.deepEqual(sanitizeCampaigns([{ id: 1 }, null, 'x']), []);
  assert.deepEqual(sanitizeScenarios({}), []);
});

test('a backup file round-trips, and a file that is not ours is refused', () => {
  const camp = { id: 'a', name: 'Diwali', cfg: DEFAULT_PLAN, finalisedAt: '2026-10-01T00:00:00Z', start: '2026-10-06', days: 14, summary: 's', spend: 100, budget: 200, incMargin: 50, incRevenue: 80, roi: 0.5, customers: 10 };
  const text = JSON.stringify(makeBackup({ ...DEFAULT_PLAN, budget: 12345 }, [{ id: 's', name: 'Scenario A', cfg: DEFAULT_PLAN }], [camp]));
  const back = parseBackup(text);
  assert.equal(back.v, STORE_VERSION);
  assert.equal(back.plan.budget, 12345);
  assert.equal(back.campaigns.length, 1);
  assert.equal(back.campaigns[0].name, 'Diwali');
  assert.equal(back.scenarios.length, 1);
  assert.equal(parseBackup('{"hello":1}'), null);
  assert.equal(parseBackup('not json'), null);
});

test('a campaign longer than the model window scales its money figures in proportion', () => {
  assert.equal(lengthFactor(14), 1);
  assert.equal(lengthFactor(28), 2);
  assert.equal(lengthFactor(7), 0.5);
});

import { wakingUp, SHIFT_RULES } from '../src/engine/shifts.ts';

test('customers whose last 3 months differ from their type: Lost Causes who now buy on promotion can be added to the plan', () => {
  const shifts = wakingUp(e.ds, e.typeOf, e.asOf);
  const lost = shifts.find((x) => x.from === 'lost');
  assert.ok(lost && lost.ids.length >= SHIFT_RULES.minGroup, 'some Lost Causes have started buying on promotion');
  assert.ok(lost.ids.every((cid) => e.typeOf.get(cid) === 'lost'));
  assert.ok(lost.recent.promoOrdersPerMonth >= SHIFT_RULES.minRise * lost.before.promoOrdersPerMonth);
  assert.ok(lost.chance < lost.ids.length, 'far more than the yardstick the same test gives for the 3 months before');
  // each one really has the promotion orders in the last 3 months
  const from = e.asOf - SHIFT_RULES.days;
  for (const cid of lost.ids) {
    const orders = new Set(e.ds.lines.filter((l) => l.cid === cid && l.day >= from && l.promoId).map((l) => l.orderId));
    assert.ok(orders.size >= SHIFT_RULES.minPromoOrders);
  }
  // adding them puts exactly those customers into the plan, as Persuadables; without the choice they are not in it
  const base = run();
  const added = run({ wakeUp: ['lost'] });
  assert.ok(lost.ids.every((cid) => !base.ids.includes(cid)));
  assert.ok(lost.ids.every((cid) => added.ids.includes(cid)));
  assert.equal(added.ids.length, base.ids.length + lost.ids.length);
  assert.equal(added.insights.find((g) => g.type === 'persuadable').customers, base.insights.find((g) => g.type === 'persuadable').customers + lost.ids.length);
  assert.equal(added.insights.find((g) => g.type === 'lost').customers, base.insights.find((g) => g.type === 'lost').customers - lost.ids.length);
  assert.ok(added.shifts.find((x) => x.shift.from === 'lost').added);
  assert.ok(added.plan.spend <= added.settings.budget + 1e-6);
});

import { salesSoFar } from '../src/engine/measure.ts';

test('sales so far: actual sales of the campaign customers in its categories, up to the last day the data covers', () => {
  const rows = activation(run().plan);
  const start = isoOf(e.ds.maxDay - 9);
  const s = salesSoFar(e.ds, rows, start, 14);
  assert.ok(s && s.days === 10 && s.customers > 0 && s.sales > 0);
  assert.equal(s.to, isoOf(e.ds.maxDay));
  // recomputed by hand from the order lines
  const pairs = new Set(rows.filter((r) => r.group === 'treatment').map((r) => `${r.cid}|${r.category}`));
  let sales = 0, onOffer = 0;
  for (const l of e.ds.lines) if (l.day >= e.ds.maxDay - 9 && pairs.has(`${l.cid}|${l.category}`)) { sales += l.unit * l.qty; if (l.promoId) onOffer += l.unit * l.qty; }
  assert.ok(Math.abs(s.sales - sales) < 1e-6 && Math.abs(s.onOffer - onOffer) < 1e-6);
  assert.ok(s.buyers <= s.customers && s.onOffer <= s.sales + 1e-9);
  assert.equal(salesSoFar(e.ds, rows, isoOf(e.ds.maxDay + 1), 14), null, 'not started in the data: nothing to show');
});

import { demoSales } from '../src/lib/liveDemo.ts';

test('demo live figures: the plan\'s expected result for the days gone, growing day by day and never above the customers reached', () => {
  const plan = run().plan;
  const c = { id: 'demo1', start: '2026-10-01', days: 14 };
  const a = demoSales(plan, c, 5), b = demoSales(plan, c, 14);
  assert.ok(a && b && a.sales > 0 && b.sales > a.sales && b.buyers > a.buyers);
  assert.ok(b.buyers <= b.customers && a.latest.length > 0 && a.latest.every((x) => x.day <= a.to));
  assert.deepEqual(demoSales(plan, c, 5), a, 'the same campaign always shows the same figures');
  assert.equal(demoSales(plan, c, 0), null);
});
