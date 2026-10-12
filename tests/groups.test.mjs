// Customer groups on Behaviour Analytics: facts, rules, purchase breakdowns and behaviour alerts.  Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { customerFacts, ruleDefs, applyRules, purchases, behaviourAlerts, ALERT_RULES, leaning } from '../src/engine/groupInsights.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const p = { from: e.ds.maxDay - 182, to: e.ds.maxDay };
const facts = customerFacts(e.ds, e.typeOf, p);
const defs = ruleDefs(facts);
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

test('facts come straight from the order lines of the period', () => {
  const lines = e.ds.lines.filter((l) => l.day >= p.from && l.day <= p.to);
  assert.equal(facts.length, new Set(lines.map((l) => l.cid)).size);
  const f = facts[0];
  const own = lines.filter((l) => l.cid === f.cid);
  assert.ok(near(f.spend, own.reduce((t, l) => t + l.unit * l.qty, 0)));
  assert.equal(f.orders, new Set(own.map((l) => l.orderId)).size);
  assert.ok(near(f.promoSpend, own.filter((l) => l.promoId).reduce((t, l) => t + l.unit * l.qty, 0)));
  assert.ok(facts.every((x) => x.dealShare >= 0 && x.dealShare <= 1 && x.lastVisit >= 0));
});

test('rules: each option set splits customers without overlap, thirds are roughly equal', () => {
  for (const key of ['spend', 'frequency', 'visit', 'deals', 'channel', 'category']) {
    const d = defs.find((x) => x.key === key);
    const counts = d.options.map((o) => facts.filter(o.test).length);
    assert.equal(counts.reduce((a, b) => a + b, 0), facts.length, `${key} covers every customer exactly once`);
  }
  for (const key of ['spend', 'frequency']) for (const o of defs.find((x) => x.key === key).options) assert.ok(Math.abs(facts.filter(o.test).length - facts.length / 3) < facts.length * 0.12, key);
  const g = applyRules(facts, defs, { spend: 'high', channel: 'App' });
  assert.ok(g.every((f) => f.channel === 'App') && g.length < facts.length);
  assert.equal(applyRules(facts, defs, {}).length, facts.length);
});

test('purchases: brand, category and SKU breakdowns each add up to the total, scope filters lines', () => {
  const all = purchases(e.ds, new Set(facts.map((f) => f.cid)), p);
  for (const k of ['brands', 'categories', 'skus']) assert.ok(near(all[k].reduce((t, s) => t + s.spend, 0), all.spend), k);
  assert.equal(all.buyers, facts.length);
  const cat = all.categories[0].key;
  const one = purchases(e.ds, new Set(facts.map((f) => f.cid)), p, (l) => l.category === cat);
  assert.equal(one.categories.length, 1);
  assert.ok(near(one.spend, all.categories[0].spend));
  assert.ok(near(leaning(all.categories[0], all, all.categories[0], all.spend), 1), 'everyone leans 1.0 against themselves');
});

test('alerts: strict size and strength rules, no restating of the rule itself', () => {
  const alerts = behaviourAlerts(facts, defs, 20);
  for (const a of alerts) {
    assert.ok(a.n >= ALERT_RULES.minSub && a.of - a.n >= ALERT_RULES.minRest && a.n <= ALERT_RULES.maxSubShare * a.of);
    assert.ok(Math.abs(a.t) >= ALERT_RULES.minT && Math.abs(a.inside - a.rest) / a.rest >= ALERT_RULES.minRelative);
    assert.ok(!(a.rule.key === 'spend' && a.metric === 'spendPerMonth') && !(a.rule.key === 'frequency' && a.metric === 'ordersPerMonth') && !(a.rule.key === 'deals' && a.metric === 'dealShare'));
  }
  // pure noise raises no alerts: shuffle each behaviour measure independently across customers, which breaks every real link
  const n = facts.length;
  const pick = (k) => (i) => facts[(i * k + 13) % n];
  const [a1, a2, a3, a4] = [7919, 104729, 1299709, 15485863].map(pick);
  const noise = facts.map((f, i) => ({ ...f, dealShare: a1(i).dealShare, spendPerMonth: a2(i).spendPerMonth, spend: a2(i).spend, ordersPerMonth: a3(i).ordersPerMonth, catSpend: a4(i).catSpend }));
  const noiseAlerts = behaviourAlerts(noise, ruleDefs(noise), 20);
  assert.ok(noiseAlerts.length <= 1, `noise raised ${noiseAlerts.length} alerts`);
});
