// Customer groups on Behaviour Analytics: facts, rules, purchase breakdowns and behaviour alerts.  Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { customerFacts, ruleDefs, applyRules, purchases, behaviourAlerts, ALERT_RULES, leaning } from '../src/engine/groupInsights.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const p = { from: e.ds.maxDay - 182, to: e.ds.maxDay };
const facts = customerFacts(e.ds, e.typeOf, p);
const defs = ruleDefs(facts, e.ds.campaigns);
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

test('rules: favourite category is gone; every promotion bought on in the period can be picked', () => {
  assert.deepEqual(defs.map((d) => d.key), ['spend', 'frequency', 'visit', 'deals', 'channel', 'promo']);
  const promo = ruleDefs(facts, e.ds.campaigns).find((d) => d.key === 'promo');
  const bought = new Set(e.ds.lines.filter((l) => l.day >= p.from && l.day <= p.to && l.promoId).map((l) => l.promoId));
  assert.deepEqual(new Set(promo.options.map((o) => o.value)), bought, 'one option per promotion bought on in the period');
  assert.ok(promo.options.length > 3);
  for (const o of promo.options) {
    const who = new Set(e.ds.lines.filter((l) => l.day >= p.from && l.day <= p.to && l.promoId === o.value).map((l) => l.cid));
    assert.equal(facts.filter(o.test).length, who.size, o.label);
  }
});

test('customer groups buy different things: the demo data is not the same mix for every type', () => {
  const top = (t) => {
    const P = purchases(e.ds, new Set(facts.filter((f) => f.type === t).map((f) => f.cid)), p);
    const A = purchases(e.ds, new Set(facts.map((f) => f.cid)), p);
    return P.categories.map((c) => ({ k: c.key, l: c.spend / P.spend / ((A.categories.find((x) => x.key === c.key)?.spend ?? 0) / A.spend) })).sort((a, b) => b.l - a.l)[0].k;
  };
  const leaders = new Set(['persuadable', 'sure', 'lost', 'dog'].map(top));
  assert.ok(leaders.size >= 3, `the category each type leans to most: ${[...leaders].join(', ')}`);
});

test('rules: each option set splits customers without overlap, thirds are roughly equal', () => {
  for (const key of ['spend', 'frequency', 'visit', 'deals', 'channel']) {
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

// ---------------------------------------------------------------- where the return comes from (Promotion results)
import { returnRows, sumReturns } from '../src/engine/returns.ts';

test('return breakdown: promotion x SKU rows add up to every campaign, and any slice is total = baseline + uplift', () => {
  const rows = returnRows(e.ds, e.perCustomer, e.ds.campaigns, () => true);
  for (const r of e.results) {
    const t = sumReturns(rows.filter((x) => x.campaignId === r.campaign.id));
    assert.ok(near(t.units, r.units) && near(t.base, r.baselineUnits), `${r.campaign.name} units / baseline`);
    assert.ok(near(t.cost, r.discountCost) && near(t.incMargin, r.incMargin) && near(t.incRevenue, r.incRevenue), `${r.campaign.name} money`);
  }
  // brand, category and SKU splits all sum back to the overall total
  const all = sumReturns(rows);
  for (const key of ['brand', 'category', 'productId']) {
    const parts = [...new Set(rows.map((r) => r[key]))].map((v) => sumReturns(rows.filter((r) => r[key] === v)));
    assert.ok(near(parts.reduce((s, x) => s + x.units, 0), all.units) && near(parts.reduce((s, x) => s + x.uplift, 0), all.uplift), key);
  }
  assert.ok(near(all.units, all.base + all.uplift));
  // only the customers passed in are counted
  const one = e.records.find((r) => r.type === 'sure').cid;
  const solo = sumReturns(returnRows(e.ds, e.perCustomer, e.ds.campaigns, (cid) => cid === one));
  const own = e.perCustomer.get(one).reduce((s, r) => s + r.units, 0);
  assert.ok(near(solo.units, own));
});

test('"bought on promotion" follows the product filter: only promotions the chosen products were bought under', () => {
  const lines = e.ds.lines.filter((l) => l.day >= p.from && l.day <= p.to && l.promoId);
  const camp = new Map(e.ds.campaigns.map((c) => [c.id, c]));
  const check = (keep, what) => {
    const pids = new Set(e.ds.lines.filter(keep).map((l) => l.productId));
    const opts = ruleDefs(facts, e.ds.campaigns, (id) => pids.has(id)).find((d) => d.key === 'promo').options;
    const expect = new Set(lines.filter((l) => pids.has(l.productId)).map((l) => l.promoId));
    assert.deepEqual(new Set(opts.map((o) => o.value)), expect, `${what}: exactly the promotions its products were bought under`);
    for (const o of opts) {
      const who = new Set(lines.filter((l) => l.promoId === o.value && pids.has(l.productId)).map((l) => l.cid));
      assert.equal(facts.filter(o.test).length, who.size, `${what}: ${o.label} buyers`);
    }
    return opts;
  };
  const snacks = check((l) => l.category === 'Snacks', 'Snacks');
  assert.ok(snacks.length > 0 && snacks.every((o) => camp.get(o.value).category === 'Snacks'), 'no promotion from another category');
  const brand = e.ds.lines[0].brand;
  check((l) => l.brand === brand && l.category === 'Household', `${brand} Household`);
  const sku = e.ds.lines.find((l) => l.promoId && l.day >= p.from).productId;
  const one = check((l) => l.productId === sku, sku);
  assert.ok(one.every((o) => camp.get(o.value).category === e.ds.lines.find((l) => l.productId === sku).category));
});
