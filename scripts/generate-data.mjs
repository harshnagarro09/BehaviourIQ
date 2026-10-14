// Generates the single demo dataset: public/data/promo_behaviour_data.csv
// One row = one product line in one order. Everything the app shows is derived from this file.
// Seeded, so output is reproducible:  node scripts/generate-data.mjs
// The latent consumer type used to simulate each customer is written to scripts/out/ground_truth.json
// ONLY for validating the classifier. It is never shipped with the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Names (keep in sync with src/lib/brand.ts). Names only: nothing numeric depends on them.
const RETAILER_NAME = 'Reliance Fresh';
const OUR_BRAND_NAME = 'Reliance Fresh';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261007);
const U = (a, b) => a + (b - a) * rng();
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const wpick = (items, weights) => {
  const tot = weights.reduce((s, w) => s + w, 0);
  let r = rng() * tot;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
};

// ---------------------------------------------------------------- catalogue
// Business design of the demo data (own-label gross margin by category, set so every promotion type is economically coherent):
//   Personal Care ~73%, Snacks ~73%, Household ~56%, Beverages ~49%, Breakfast ~47%, Dairy ~34%.
// BOGO (50% off every unit) is only run where margin is clearly above 50% (Personal Care, Snacks), as a retailer would.
// The catalogue holds only the retailer's own-label products ("our brand"). A retailer has no visibility of what customers buy from
// competitors, so competitor products and purchases do not exist anywhere in this data.
const PRODUCTS = [
  ['BEV01', `${OUR_BRAND_NAME} Cola 1.25L`, 'Beverages', OUR_BRAND_NAME, 70, 36],
  ['BEV02', `${OUR_BRAND_NAME} Iced Tea 1L`, 'Beverages', OUR_BRAND_NAME, 45, 23],
  ['SNK01', `${OUR_BRAND_NAME} Potato Chips`, 'Snacks', OUR_BRAND_NAME, 40, 11],
  ['SNK02', `${OUR_BRAND_NAME} Nacho Crunch`, 'Snacks', OUR_BRAND_NAME, 55, 15],
  ['BRK01', `${OUR_BRAND_NAME} Corn Flakes`, 'Breakfast', OUR_BRAND_NAME, 210, 112],
  ['BRK02', `${OUR_BRAND_NAME} Muesli`, 'Breakfast', OUR_BRAND_NAME, 320, 172],
  ['DAI01', `${OUR_BRAND_NAME} Full Cream Milk 1L`, 'Dairy', OUR_BRAND_NAME, 68, 45],
  ['DAI02', `${OUR_BRAND_NAME} Butter 100g`, 'Dairy', OUR_BRAND_NAME, 58, 38],
  ['HSH01', `${OUR_BRAND_NAME} Detergent 1kg`, 'Household', OUR_BRAND_NAME, 180, 80],
  ['HSH02', `${OUR_BRAND_NAME} Dishwash 500ml`, 'Household', OUR_BRAND_NAME, 110, 48],
  ['PCR01', `${OUR_BRAND_NAME} Shampoo 340ml`, 'Personal Care', OUR_BRAND_NAME, 250, 68],
  ['PCR02', `${OUR_BRAND_NAME} Soap 4-pack`, 'Personal Care', OUR_BRAND_NAME, 140, 38],
].map(([id, name, category, brand, price, cost]) => ({ id, name, category, brand, price, cost, ours: brand === OUR_BRAND_NAME }));
const CATS = ['Beverages', 'Snacks', 'Breakfast', 'Dairy', 'Household', 'Personal Care'];
const byCat = (c) => PRODUCTS.filter((p) => p.category === c);

// Complementary categories (drives basket behaviour)
const PAIRS = {
  Snacks: ['Beverages', 0.6],
  Beverages: ['Snacks', 0.5],
  Breakfast: ['Dairy', 0.7],
  Dairy: ['Breakfast', 0.4],
  Household: ['Personal Care', 0.3],
  'Personal Care': ['Household', 0.3],
};

// ---------------------------------------------------------------- campaigns (14-day windows)
const CAMPAIGNS = [
  // id, name, start, category, mechanic, typical depth %, flat rupees off, minimum spend (FLAT_OFF only)
  // Mechanics: PCT_OFF (10/15/20/25%), FLAT_OFF (Rs off on a minimum spend), BOGO (buy 1 get 1 free), MULTIBUY_3FOR2,
  // B1G1_50 (second unit half price), TIERED (buy 2+ save 15%), COMBO (two different products together, 20% off each),
  // CASHBACK (10% back as loyalty points; shelf price unchanged, the reward is written to reward_value)
  ['PRM01', 'Breakfast Bonanza', '2025-09-08', 'Breakfast', 'PCT_OFF', 20, 0, 0],
  ['PRM02', 'Soap Saver', '2025-09-29', 'Personal Care', 'BOGO', 50, 0, 0],
  ['PRM03', 'Pre-Diwali Clean-Up', '2025-10-06', 'Household', 'PCT_OFF', 20, 0, 0],
  ['PRM04', 'Diwali Dhamaka', '2025-10-13', 'Beverages', 'PCT_OFF', 20, 0, 0],
  ['PRM05', 'Dairy Fresh Fest', '2025-11-10', 'Dairy', 'PCT_OFF', 10, 0, 0],
  ['PRM06', 'Winter Skin', '2025-11-17', 'Personal Care', 'PCT_OFF', 10, 0, 0],
  ['PRM07', 'Munch Mania', '2025-11-24', 'Snacks', 'PCT_OFF', 10, 0, 0],
  ['PRM08', 'Year-End Stock-Up', '2025-12-15', 'Household', 'MULTIBUY_3FOR2', 33, 0, 0],
  ['PRM09', 'New Year Fitness', '2026-01-12', 'Breakfast', 'PCT_OFF', 20, 0, 0],
  ['PRM10', 'Spring Clean', '2026-02-02', 'Household', 'FLAT_OFF', 20, 30, 250],
  ['PRM11', 'Snack Attack', '2026-02-09', 'Snacks', 'BOGO', 50, 0, 0],
  ['PRM12', 'Butter Fest', '2026-02-23', 'Dairy', 'PCT_OFF', 10, 0, 0],
  ['PRM13', 'Holi Hungama', '2026-03-02', 'Beverages', 'PCT_OFF', 10, 0, 0],
  ['PRM14', 'Holi Colours', '2026-03-09', 'Personal Care', 'FLAT_OFF', 18, 35, 250],
  ['PRM15', 'Spring Start', '2026-03-23', 'Breakfast', 'FLAT_OFF', 13, 30, 300],
  ['PRM16', 'Summer Sip', '2026-04-13', 'Beverages', 'PCT_OFF', 20, 0, 0],
  ['PRM17', 'Summer Dairy', '2026-04-27', 'Dairy', 'FLAT_OFF', 13, 8, 100],
  ['PRM18', 'IPL Night', '2026-05-04', 'Snacks', 'PCT_OFF', 20, 0, 0],
  ['PRM19', 'Household Helper', '2026-05-18', 'Household', 'PCT_OFF', 20, 0, 0],
  ['PRM20', 'Monsoon Chill', '2026-06-08', 'Beverages', 'PCT_OFF', 20, 0, 0],
  ['PRM21', 'Muesli Month', '2026-06-15', 'Breakfast', 'PCT_OFF', 10, 0, 0],
  ['PRM22', 'Monsoon Dairy', '2026-06-22', 'Dairy', 'PCT_OFF', 10, 0, 0],
  ['PRM23', 'Monsoon Care', '2026-07-06', 'Household', 'MULTIBUY_3FOR2', 33, 0, 0],
  ['PRM24', 'Glow Up', '2026-07-06', 'Personal Care', 'PCT_OFF', 10, 0, 0],
  ['PRM25', 'Monsoon Munch', '2026-07-20', 'Snacks', 'MULTIBUY_3FOR2', 33, 0, 0],
  ['PRM26', 'Independence Sale', '2026-08-03', 'Personal Care', 'PCT_OFF', 20, 0, 0],
  ['PRM27', 'Back-to-School Breakfast', '2026-08-10', 'Breakfast', 'MULTIBUY_3FOR2', 33, 0, 0],
  ['PRM28', 'Cheese Carnival', '2026-08-17', 'Dairy', 'PCT_OFF', 20, 0, 0],
  ['PRM29', 'Back-to-Work Fizz', '2026-08-24', 'Beverages', 'FLAT_OFF', 15, 10, 100],
  ['PRM30', 'Snack Festival', '2026-09-07', 'Snacks', 'FLAT_OFF', 18, 10, 100],
  // second wave of mechanics (added for the wider promotion catalogue)
  ['PRM31', 'Breakfast Combo Week', '2025-11-03', 'Breakfast', 'COMBO', 20, 0, 0],
  ['PRM32', 'Winter Snack Tiers', '2025-12-22', 'Snacks', 'TIERED', 15, 0, 0],
  ['PRM33', 'Fresh Rewards Cashback', '2026-01-05', 'Dairy', 'CASHBACK', 10, 0, 0],
  ['PRM34', 'Second Bottle Half Price', '2026-01-19', 'Beverages', 'B1G1_50', 25, 0, 0],
  ['PRM35', 'Clean Home Volume Deal', '2026-03-30', 'Household', 'TIERED', 15, 0, 0],
  ['PRM36', 'Snack 15% Saver', '2026-03-23', 'Snacks', 'PCT_OFF', 15, 0, 0],
  ['PRM37', 'Glow Combo Pack', '2026-05-11', 'Personal Care', 'COMBO', 20, 0, 0],
  ['PRM38', 'Cashback Home Care', '2026-09-14', 'Household', 'CASHBACK', 10, 0, 0],
  ['PRM39', 'Milk Mega Saver', '2026-09-14', 'Dairy', 'PCT_OFF', 25, 0, 0],
].map(([id, name, start, category, mechanic, depth, flat, minSpend]) => {
  const s = new Date(start + 'T00:00:00Z').getTime();
  return { id, name, category, mechanic, depth, flat, minSpend, s, e: s + 13 * 864e5, festive: /Diwali|Holi|Independence/.test(name) };
});

const VOLUME = new Set(['BOGO', 'MULTIBUY_3FOR2', 'B1G1_50', 'TIERED']);

const START = new Date('2025-07-01T00:00:00Z').getTime();
const END = new Date('2026-09-30T00:00:00Z').getTime();
const DAY = 864e5;

// ---------------------------------------------------------------- consumer types (latent)
// Latent design -> business customer type:  anyways = Sure Thing | deal, stockup, switcher = Persuadable |
// ignores = Lost Cause | dog = Sleeping Dog (buys the brand regularly but buys LESS while it is on offer).
// Shares follow what uplift studies typically find: customers who buy BECAUSE of an offer (deal, stockup, switcher) are a
// clear minority (~20%), while customers who would buy anyway (~35%) or never respond (~35%) make up most of the base, and
// customers put off by offers (Sleeping Dogs) are a small group (~10%).
const TYPES = {
  dog: { share: 0.10, trips: [2.4, 4.0], pOur: [0.55, 0.85], maxP: 0.0, thr: [40, 50], qty: [1.0, 1.0] },
  anyways: { share: 0.35, trips: [2.6, 4.2], pOur: [0.74, 0.93], maxP: 0.0, thr: [12, 20], qty: [1.0, 1.0] },
  deal: { share: 0.06, trips: [1.2, 2.2], pOur: [0.06, 0.18], maxP: 0.82, thr: [7, 13], qty: [1.1, 1.5] },
  stockup: { share: 0.11, trips: [1.6, 2.8], pOur: [0.35, 0.6], maxP: 0.78, thr: [9, 16], qty: [2.6, 4.0] },
  switcher: { share: 0.04, trips: [2.0, 3.4], pOur: [0.03, 0.11], maxP: 0.72, thr: [17, 26], qty: [1.0, 1.4] },
  ignores: { share: 0.34, trips: [0.8, 1.8], pOur: [0.05, 0.25], maxP: 0.07, thr: [22, 35], qty: [1.0, 1.0] },
};
// What each latent type tends to buy (multiplier on how often a category lands in the basket; 1 = average). Each customer
// still varies around their type's profile, so the groups overlap but differ in a consistent, explainable way:
//   loyal regulars (anyways)   daily staples: milk, butter, cereal
//   promo-averse regulars (dog) premium personal and home care bought at full price
//   deal seekers               impulse categories that are promoted often: snacks and drinks
//   stock-up shoppers          storable goods worth buying in bulk: household and personal care
//   switchers                  packaged brands they compare on price: breakfast and drinks
//   occasional shoppers        top-up trips: milk and a drink
// A basket holds each category at most once, which evens out preferences; the profile is sharpened to survive that.
const AFFINITY_STRENGTH = 1.8;
const CAT_AFFINITY = {
  anyways: { Beverages: 0.8, Snacks: 0.6, Breakfast: 1.5, Dairy: 2.4, Household: 0.8, 'Personal Care': 0.7 },
  dog: { Beverages: 0.6, Snacks: 0.5, Breakfast: 0.9, Dairy: 0.8, Household: 1.5, 'Personal Care': 2.4 },
  deal: { Beverages: 1.9, Snacks: 2.3, Breakfast: 0.6, Dairy: 0.7, Household: 0.7, 'Personal Care': 0.7 },
  stockup: { Beverages: 0.9, Snacks: 0.8, Breakfast: 0.6, Dairy: 0.5, Household: 2.4, 'Personal Care': 1.6 },
  switcher: { Beverages: 1.6, Snacks: 1.1, Breakfast: 1.9, Dairy: 0.6, Household: 0.8, 'Personal Care': 0.8 },
  ignores: { Beverages: 1.5, Snacks: 1.2, Breakfast: 0.5, Dairy: 2.0, Household: 0.6, 'Personal Care': 0.6 },
};
const TYPE_KEYS = Object.keys(TYPES);

const N = 520;
const DOW_BASE = [1.5, 0.8, 0.8, 0.85, 0.9, 1.1, 1.55]; // Sun..Sat
const MONTH = { 0: 0.95, 1: 0.95, 2: 1.05, 3: 1.0, 4: 1.0, 5: 0.95, 6: 0.95, 7: 1.0, 8: 1.0, 9: 1.2, 10: 1.15, 11: 1.15 };
function catSeason(cat, m) {
  if (cat === 'Beverages' && m >= 3 && m <= 5) return 1.6;
  if (cat === 'Beverages' && m >= 9 && m <= 10) return 1.2;
  if (cat === 'Household' && (m === 9 || m === 10)) return 1.5;
  if (cat === 'Snacks' && (m === 9 || m === 10 || m === 11)) return 1.3;
  if (cat === 'Breakfast' && m === 0) return 1.3;
  if (cat === 'Dairy' && m >= 4 && m <= 5) return 0.9;
  return 1;
}

const rows = [];
const truth = {};
let orderSeq = 1;
const fmt = (d) => new Date(d).toISOString().slice(0, 10);

for (let i = 1; i <= N; i++) {
  const cid = 'C' + String(i).padStart(4, '0');
  const type = wpick(TYPE_KEYS, TYPE_KEYS.map((k) => TYPES[k].share));
  truth[cid] = type;
  const base = TYPES[type];
  // 8% hybrids blend with a second type -> realistic overlap between types
  const mix = rng() < 0.08 ? pick(TYPE_KEYS.filter((k) => k !== type)) : null;
  const mixT = mix ? TYPES[mix] : null;
  const blend = (a, b) => (mix ? 0.65 * a + 0.35 * b : a);
  const tripsPerMonth = U(...base.trips);
  const pOur = clamp(blend(U(...base.pOur), mixT ? U(...mixT.pOur) : 0), 0.01, 0.97);
  const maxP = blend(base.maxP, mixT ? mixT.maxP : 0) * U(0.85, 1.1);
  const thr = blend(U(...base.thr), mixT ? U(...mixT.thr) : 0);
  const qtyMult = blend(U(...base.qty), mixT ? U(...mixT.qty) : 0);
  const parks = type === 'stockup' || mix === 'stockup';
  const weekend = U(0.7, 2.0);
  const hhQty = wpick([1, 2, 3], [0.62, 0.3, 0.08]);
  // personal taste around the category profile of the customer's type (hybrids blend the two profiles)
  const catW = {};
  CATS.forEach((c) => (catW[c] = Math.exp(U(-0.5, 0.5)) * ((mix ? CAT_AFFINITY[type][c] ** 0.65 * CAT_AFFINITY[mix][c] ** 0.35 : CAT_AFFINITY[type][c]) ** AFFINITY_STRENGTH)));
  const meanW = Object.values(catW).reduce((s, w) => s + w, 0) / CATS.length;
  let active0 = START;
  let active1 = END;
  if (rng() < 0.16) active0 = START + Math.floor(U(60, 450)) * DAY; // late joiners, some within the last 90 days (new customers)
  if (rng() < 0.07) active1 = END - Math.floor(U(70, 240)) * DAY;
  const parkUntil = {};
  const promoTrips = {};
  // a few Lost Causes (and the odd Sleeping Dog) start responding to offers in the last 3 months: their earlier years say
  // "never reacts", their recent weeks say otherwise. The choice is hashed from the id so the random stream is unchanged.
  const wakes = (type === 'ignores' && hash01(cid + 'wake') < 0.12) || (type === 'dog' && hash01(cid + 'wake') < 0.06);
  const wakeDay = wakes ? END - Math.floor(30 + 55 * hash01(cid + 'day')) * DAY : Infinity;

  // dedicated promo-driven trips (the behavioural "response")
  for (const cp of CAMPAIGNS) {
    if (cp.e < active0 || cp.s > active1) continue;
    const aff = catW[cp.category] / meanW;
    // a points reward is worth less to a shopper than the same money off at the till
    const felt = cp.mechanic === 'CASHBACK' ? cp.depth * 0.7 : cp.depth;
    const woke = cp.s >= wakeDay;
    let p = (woke ? 0.7 : maxP) * sigmoid((felt - (woke ? 12 : thr)) / 3.2) * clamp(0.55 + 0.45 * aff, 0.5, 1.25);
    if (cp.festive) p *= 1.15;
    if (cp.mechanic !== 'PCT_OFF') p *= 1.05;
    // mechanic fit by behaviour: stock-up shoppers like volume mechanics, deal seekers want instant savings,
    // frequent shoppers are the ones who come back to spend points
    if (VOLUME.has(cp.mechanic)) p *= parks ? 1.3 : type === 'switcher' ? 0.85 : 1;
    if (cp.mechanic === 'CASHBACK') p *= (type === 'deal' ? 0.6 : type === 'switcher' ? 0.75 : 1) * (tripsPerMonth >= 2 ? 1.2 : 0.85);
    if (cp.mechanic === 'COMBO') p *= type === 'deal' || type === 'switcher' ? 1.1 : 0.95;
    p = clamp(p, 0, 0.93);
    if (rng() < p) {
      const ts = cp.s + Math.floor(rng() * 14) * DAY;
      (promoTrips[ts] ||= []).push(cp);
    }
  }

  for (let t = Math.max(START, active0); t <= Math.min(END, active1); t += DAY) {
    const dt = new Date(t);
    const dow = dt.getUTCDay();
    const m = dt.getUTCMonth();
    const isWe = dow === 0 || dow === 6;
    const dowF = (DOW_BASE[dow] * (isWe ? weekend : 1)) / 1.1;
    const pTrip = clamp((tripsPerMonth / 30) * dowF * MONTH[m], 0, 0.9);
    const dedicated = promoTrips[t];
    const regular = rng() < pTrip;
    if (!regular && !dedicated) continue;

    const lines = [];
    if (dedicated) for (const cp of dedicated) lines.push({ cat: cp.category, forced: cp });
    if (regular || (dedicated && rng() < 0.55)) {
      const nCats = wpick([1, 2, 3, 4], [0.3, 0.38, 0.24, 0.08]);
      const chosen = new Set(lines.map((l) => l.cat));
      let guard = 0;
      while (chosen.size < nCats + (dedicated ? 1 : 0) && guard++ < 12) {
        const ws = CATS.map((c) => {
          let w = catW[c] * catSeason(c, m);
          if (parkUntil[c] && t < parkUntil[c]) w *= 0.12;
          if (type === 'deal') w *= 0.5;
          return w;
        });
        let c;
        if (chosen.size && rng() < 0.45) {
          const last = [...chosen][chosen.size - 1];
          const pr = PAIRS[last];
          c = pr && rng() < pr[1] ? pr[0] : wpick(CATS, ws);
        } else c = wpick(CATS, ws);
        chosen.add(c);
      }
      for (const c of chosen) if (!lines.find((l) => l.cat === c)) lines.push({ cat: c, forced: null });
    }
    const oid = 'O' + String(orderSeq++).padStart(6, '0');
    // a combo is bought as a pair: the forced line pulls in the other product of the category
    for (const ln of [...lines]) {
      if (ln.forced && ln.forced.mechanic === 'COMBO') {
        const [a, b] = byCat(ln.cat);
        ln.prod = a;
        lines.push({ cat: ln.cat, forced: ln.forced, prod: b });
      }
    }
    for (const ln of lines) {
      const cp = CAMPAIGNS.find((x) => x.category === ln.cat && t >= x.s && t <= x.e);
      // Sleeping Dogs are put off by offers: they largely stop buying the promoted brand while it is on promotion
      const dogOff = type === 'dog' && t < wakeDay && CAMPAIGNS.some((x) => x.category === ln.cat && t >= x.s && t <= x.e + 14);
      // a basket line is only visible to the retailer if the customer bought our brand; otherwise there is no record
      if (!ln.forced && !(rng() < (dogOff ? pOur * 0.2 : pOur))) continue;
      const prod = ln.prod ?? pick(byCat(ln.cat));
      let qty = wpick([1, 2, 3], [0.7, 0.24, 0.06]) * (hhQty > 1 && rng() < 0.4 ? 2 : 1);
      qty = clamp(qty, 1, 4);
      let disc = 0;
      let promo = null;
      if (prod.ours && cp) {
        promo = cp;
        disc = cp.depth;
        if (ln.forced) {
          qty = Math.round(qty * (1 + (qtyMult - 1) * (parks ? 1 : 0.25)));
          if (parks) parkUntil[ln.cat] = t + Math.round(14 + 6 * qty) * DAY;
        }
        if (cp.mechanic === 'FLAT_OFF' && ln.forced) qty = Math.max(qty, Math.ceil(cp.minSpend / prod.price));
        if (cp.mechanic === 'BOGO') qty = Math.max(2, qty + (qty % 2));
        if (cp.mechanic === 'MULTIBUY_3FOR2') qty = Math.max(3, Math.ceil(qty / 3) * 3);
        if (cp.mechanic === 'B1G1_50') qty = Math.max(2, qty + (qty % 2));
        if (cp.mechanic === 'TIERED' && ln.forced) qty = Math.max(2, qty);
        if (cp.mechanic === 'CASHBACK') disc = 0; // paid at shelf price, rewarded in points
      }
      qty = clamp(qty, 1, 12);
      let reward = 0;
      if (promo && promo.mechanic === 'CASHBACK') reward = Math.round(prod.price * qty * promo.depth) / 100;
      if (promo && (promo.mechanic === 'TIERED' && qty < 2 || promo.mechanic === 'COMBO' && !ln.forced)) {
        disc = 0; // volume tier or combo pair not met: full price, not a promoted line
        promo = null;
      }
      let unit = Math.round(prod.price * (1 - disc / 100) * 100) / 100;
      if (promo && promo.mechanic === 'FLAT_OFF') {
        if (prod.price * qty >= promo.minSpend) {
          unit = Math.max(1, prod.price - promo.flat);
          disc = Math.round((promo.flat / prod.price) * 1000) / 10;
        } else {
          unit = prod.price; // spend threshold not met: no discount, not a promoted line
          disc = 0;
          promo = null;
        }
      }
      rows.push([
        oid, cid, fmt(t), prod.id, prod.name, prod.category, prod.brand,
        qty, prod.price, unit, disc, promo ? promo.id : '', promo ? promo.name : '', promo ? promo.mechanic : '', prod.cost, reward,
      ]);
    }
  }
}

// channel: derived by hashing ids so the simulation's random stream (and every other column) is unchanged
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
const CHANNELS = ['Store', 'App', 'Online'];
const prefOf = (cid) => { const u = hash01('pref' + cid); return u < 0.45 ? 'Store' : u < 0.8 ? 'App' : 'Online'; };
for (const r of rows) {
  const reward = r.pop();
  const pref = prefOf(r[1]);
  const u = hash01('ch' + r[0]);
  r.push(u < 0.8 ? pref : CHANNELS.filter((c) => c !== pref)[u < 0.9 ? 0 : 1]);
  r.push(r[13] === 'FLAT_OFF' ? CAMPAIGNS.find((c) => c.id === r[11]).minSpend : '');
  r.push(reward || '');
}
// Own-label ranges: the retailer sells each product under three of its own labels (core, premium, value). Assigned by hashing
// ids AFTER the simulation, so the random stream, prices, costs, promotions and every number the app reports are unchanged;
// only brand / SKU detail is added. A customer mostly sticks to one label (80%), the rest of the time it varies by order.
const LABELS = [
  { brand: OUR_BRAND_NAME, tag: '', w: 0.5 },
  { brand: 'Good Life', tag: 'G', w: 0.3 },
  { brand: 'Fresh Basics', tag: 'B', w: 0.2 },
];
const labelOf = (u) => { let r = u; for (const l of LABELS) { if (r < l.w) return l; r -= l.w; } return LABELS[0]; };
for (const r of rows) {
  const loyal = hash01("lab" + r[1] + r[5]);
  const l = labelOf(hash01('mix' + r[0] + r[3]) < 0.8 ? loyal : hash01('alt' + r[0] + r[3]));
  const base = r[4].startsWith(OUR_BRAND_NAME + ' ') ? r[4].slice(OUR_BRAND_NAME.length + 1) : r[4];
  r[3] = r[3] + l.tag;
  r[4] = `${l.brand} ${base}`;
  r[6] = l.brand;
}
rows.sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[0] < b[0] ? -1 : 1));
const header = ['order_id', 'customer_id', 'order_date', 'product_id', 'product_name', 'category', 'brand', 'quantity', 'list_price', 'unit_price', 'discount_pct', 'promo_id', 'promo_name', 'promo_mechanic', 'unit_cost', 'channel', 'min_spend', 'reward_value'];
const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
fs.mkdirSync(path.join(root, 'public/data'), { recursive: true });
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/data/promo_behaviour_data.csv'), csv);
fs.writeFileSync(path.join(here, 'out/ground_truth.json'), JSON.stringify(truth));
const counts = {};
Object.values(truth).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
console.log('rows', rows.length, 'orders', orderSeq - 1, 'customers', N, 'bytes', csv.length, counts);
