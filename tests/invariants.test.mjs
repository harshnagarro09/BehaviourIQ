// Run with: npm test  (node --test, no extra dependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildEngine } from '../src/engine/index.ts';
import { TYPES } from '../src/engine/segments.ts';
import { pastResultsTakeaway, behaviourTakeaway, NOT_ENOUGH } from '../src/lib/takeaways.ts';

const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
test('four customer types with the industry names', () => {
  assert.deepEqual(TYPES.map((t) => t.name), ['Persuadables', 'Sure Things', 'Lost Causes', 'Sleeping Dogs']);
  assert.equal(new Set(e.records.map((r) => r.type)).size, 4);
});

test('demo data: volume deals draw an above-average response and BOGO pays back; high redemption is not profit', () => {
  const by = {};
  const all = { c: 0, b: 0 };
  for (const r of e.results) { const k = r.campaign.mechanic; const a = (by[k] ||= { c: 0, b: 0, inc: 0 }); a.c += r.customers; a.b += r.buyers; a.inc += r.incMargin; all.c += r.customers; all.b += r.buyers; }
  const rate = (k) => by[k].b / by[k].c;
  for (const k of ['BOGO', 'MULTIBUY_3FOR2', 'B1G1_50']) assert.ok(rate(k) > all.b / all.c, `${k} response is above average`);
  assert.ok(by.BOGO.inc > 0, 'BOGO pays for itself');
  // a deep cut on a thin-margin staple is redeemed by customers who buy it anyway: lots of redemptions, money lost
  const deep = e.results.find((r) => r.campaign.category === 'Dairy' && r.campaign.depth >= 25);
  assert.ok(deep.respRate > all.b / all.c && deep.roi < 0, 'deep dairy cut: high redemption, negative ROI');
});

test('simulation is rule-based: no model code left', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
  const banned = [/trainModel/, /predictWith/, /\bAUC\b/, /logistic/i, /Buys Anyways/, /Deal-Only/, /Stock-Up Buyer/];
  for (const f of walk('src').filter((f) => /\.(ts|tsx)$/.test(f))) { const t = fs.readFileSync(f, 'utf8'); for (const re of banned) assert.ok(!re.test(t), `${f} contains ${re}`); }
  assert.ok(!fs.existsSync('src/engine/model.ts'));
});

test('takeaways', () => {
  assert.equal(pastResultsTakeaway({ campaigns: 0, lost: 0, cost: 0, incRevenue: 0, roi: 0, incShare: 0, units: 0 }), NOT_ENOUGH);
  assert.equal(behaviourTakeaway([{ name: 'A', n: 10, roi: 1.2, resp: 0.4 }, { name: 'B', n: 10, roi: -0.5, resp: 0.1 }]), 'A return the most on promotions (ROI 1.20, 40% response); B the least (ROI -0.50). Spend should follow the customer type, not the calendar.');
});

test('the data file has no competitor data: only the retailer own labels, no competitor flag', () => {
  const lines = fs.readFileSync('public/data/promo_behaviour_data.csv', 'utf8').trim().split(String.fromCharCode(10));
  const head = lines[0].split(',');
  assert.ok(!head.includes('is_our_brand'));
  const bi = head.indexOf('brand');
  assert.deepEqual([...new Set(lines.slice(1).map((l) => l.split(',')[bi]))].sort(), ['Fresh Basics', 'Good Life', 'Reliance Fresh']);
  const gen = fs.readFileSync('scripts/generate-data.mjs', 'utf8');
  for (const name of ['Fizzo', 'Zing', 'Crispo', 'Munchies', 'GoldenGrain', 'Wholesome', 'DairyDale', 'Sparkle', 'Silkora']) assert.ok(!gen.includes(name), `${name} still in the generator`);
});

test('brand names come from one source', () => {
  const brand = fs.readFileSync('src/lib/brand.ts', 'utf8');
  const gen = fs.readFileSync('scripts/generate-data.mjs', 'utf8');
  for (const k of ['RETAILER_NAME', 'OUR_BRAND_NAME']) assert.equal(brand.match(new RegExp(`${k} = '([^']+)'`))?.[1], gen.match(new RegExp(`${k} = '([^']+)'`))?.[1]);
});
