// Run with: npm test  (node --test, no extra dependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildEngine } from '../src/engine/index.ts';
import { buildCtxs, activeAt } from '../src/engine/planner.ts';
import { promoOptions, compareOptions, behaviourSignals, SIGNAL_NAMES } from '../src/engine/options.ts';
import { expect } from '../src/engine/economics.ts';
import { TYPES } from '../src/engine/segments.ts';
import { pastResultsTakeaway, behaviourTakeaway, NOT_ENOUGH } from '../src/lib/takeaways.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
const category = 'Personal Care';
const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), category, e.asOf);
const options = promoOptions(e.ds, category);

test('four customer types with the industry names', () => {
  assert.deepEqual(TYPES.map((t) => t.name), ['Persuadables', 'Sure Things', 'Lost Causes', 'Sleeping Dogs']);
  assert.equal(new Set(e.records.map((r) => r.type)).size, 4);
});

test('uplift = chance with offer - baseline; only Sleeping Dogs can be negative', () => {
  const cmp = compareOptions(e.ds, ctxs, category, options, e.assumptions);
  for (const [k, m] of cmp.exps) for (const [cid, x] of m) {
    assert.ok(Math.abs(x.uplift - (x.p1 - x.p0)) < 1e-9);
    if (e.typeOf.get(cid) !== 'dog') assert.ok(x.uplift >= -1e-9, `${cid} ${k}`);
  }
  const dog = ctxs.find((c) => e.typeOf.get(c.cid) === 'dog');
  assert.ok(expect(e.ds, dog, { category, depth: 20, mechanic: 'PCT_OFF' }).uplift < 0, 'a Sleeping Dog buys less when offered a discount');
});

test('no promotion adds nothing; profit identity holds', () => {
  const none = options.find((o) => o.family === 'none');
  for (const x of compareOptions(e.ds, ctxs, category, options).exps.get(none.key).values()) assert.ok(Math.abs(x.uplift) < 1e-9 && Math.abs(x.net) < 1e-6);
  for (const o of options.filter((x) => x.family !== 'none')) for (const c of ctxs.slice(0, 30)) {
    const x = expect(e.ds, c, { category, depth: o.depth, mechanic: o.mechanic, minSpend: o.minSpend });
    assert.ok(Math.abs(x.net - (x.profitOffer - x.profitBase - x.pullForward - x.contactCost)) < 1e-6);
  }
});

test('demo data: BOGO has the highest response and is NOT loss-making', () => {
  const by = {};
  for (const r of e.results) { const k = r.campaign.mechanic; const a = (by[k] ||= { c: 0, b: 0, net: 0 }); a.c += r.customers; a.b += r.buyers; a.net += r.netProfit; }
  const resp = (k) => by[k].b / by[k].c;
  assert.ok(Object.keys(by).every((k) => resp('BOGO') >= resp(k) - 1e-9), 'BOGO has the best response');
  assert.ok(by.BOGO.net > 0, 'BOGO is profitable');
  assert.ok(Object.values(by).every((a) => a.net > 0), 'no promotion type loses money overall');
});

test('simulation is rule-based: no model code left', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
  const banned = [/trainModel/, /predictWith/, /\bAUC\b/, /logistic/i, /Buys Anyways/, /Deal-Only/, /Stock-Up Buyer/];
  for (const f of walk('src').filter((f) => /\.(ts|tsx)$/.test(f))) { const t = fs.readFileSync(f, 'utf8'); for (const re of banned) assert.ok(!re.test(t), `${f} contains ${re}`); }
  assert.ok(!fs.existsSync('src/engine/model.ts'));
});

test('the behaviour signals are shown for every customer, with no competitor data', () => {
  const sig = behaviourSignals(ctxs[0], category);
  assert.deepEqual(sig.map((s) => s.factor), [...SIGNAL_NAMES]);
  assert.ok(sig.every((s) => s.reading && s.use));
});

test('takeaways', () => {
  assert.equal(pastResultsTakeaway({ campaigns: 0, lost: 0, incShare: 0, units: 0 }), NOT_ENOUGH);
  assert.equal(behaviourTakeaway([{ name: 'A', n: 10, net: 5 }, { name: 'B', n: 10, net: -5 }]), 'A customers earn money from promotions; B cost money.');
});

test('the data file has no competitor data: one brand, no competitor flag, no other brands', () => {
  const lines = fs.readFileSync('public/data/promo_behaviour_data.csv', 'utf8').trim().split(String.fromCharCode(10));
  const head = lines[0].split(',');
  assert.ok(!head.includes('is_our_brand'));
  const bi = head.indexOf('brand');
  assert.deepEqual([...new Set(lines.slice(1).map((l) => l.split(',')[bi]))], ['Reliance Fresh']);
  const gen = fs.readFileSync('scripts/generate-data.mjs', 'utf8');
  for (const name of ['Fizzo', 'Zing', 'Crispo', 'Munchies', 'GoldenGrain', 'Wholesome', 'DairyDale', 'Sparkle', 'Silkora']) assert.ok(!gen.includes(name), `${name} still in the generator`);
});

test('brand names come from one source', () => {
  const brand = fs.readFileSync('src/lib/brand.ts', 'utf8');
  const gen = fs.readFileSync('scripts/generate-data.mjs', 'utf8');
  for (const k of ['RETAILER_NAME', 'OUR_BRAND_NAME']) assert.equal(brand.match(new RegExp(`${k} = '([^']+)'`))?.[1], gen.match(new RegExp(`${k} = '([^']+)'`))?.[1]);
});
