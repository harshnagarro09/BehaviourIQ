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
// OUR_BRAND_NAME = the retailer's own-label products being promoted ("our brand"). Others are fictional competitor brands on the same shelf.
const PRODUCTS = [
  ['BEV01', `${OUR_BRAND_NAME} Cola 1.25L`, 'Beverages', OUR_BRAND_NAME, 70, 46],
  ['BEV02', `${OUR_BRAND_NAME} Iced Tea 1L`, 'Beverages', OUR_BRAND_NAME, 45, 29],
  ['BEV03', 'Fizzo Cola 1.25L', 'Beverages', 'Fizzo', 68, 45],
  ['BEV04', 'Zing Energy Drink', 'Beverages', 'Zing', 110, 72],
  ['SNK01', `${OUR_BRAND_NAME} Potato Chips`, 'Snacks', OUR_BRAND_NAME, 40, 24],
  ['SNK02', `${OUR_BRAND_NAME} Nacho Crunch`, 'Snacks', OUR_BRAND_NAME, 55, 33],
  ['SNK03', 'Crispo Salted Chips', 'Snacks', 'Crispo', 38, 23],
  ['SNK04', 'Munchies Namkeen', 'Snacks', 'Munchies', 60, 37],
  ['BRK01', `${OUR_BRAND_NAME} Corn Flakes`, 'Breakfast', OUR_BRAND_NAME, 210, 138],
  ['BRK02', `${OUR_BRAND_NAME} Muesli`, 'Breakfast', OUR_BRAND_NAME, 320, 205],
  ['BRK03', 'GoldenGrain Oats', 'Breakfast', 'GoldenGrain', 180, 118],
  ['BRK04', 'Wholesome Muesli', 'Breakfast', 'Wholesome', 290, 190],
  ['DAI01', `${OUR_BRAND_NAME} Full Cream Milk 1L`, 'Dairy', OUR_BRAND_NAME, 68, 55],
  ['DAI02', `${OUR_BRAND_NAME} Butter 100g`, 'Dairy', OUR_BRAND_NAME, 58, 42],
  ['DAI03', 'FarmFresh Milk 1L', 'Dairy', 'FarmFresh', 66, 53],
  ['DAI04', 'FarmFresh Cheese Slices', 'Dairy', 'FarmFresh', 120, 85],
  ['HSH01', `${OUR_BRAND_NAME} Detergent 1kg`, 'Household', OUR_BRAND_NAME, 180, 118],
  ['HSH02', `${OUR_BRAND_NAME} Dishwash 500ml`, 'Household', OUR_BRAND_NAME, 110, 68],
  ['HSH03', 'Sparkle Detergent 1kg', 'Household', 'Sparkle', 175, 116],
  ['HSH04', 'Sparkle Dishwash 500ml', 'Household', 'Sparkle', 105, 66],
  ['PCR01', `${OUR_BRAND_NAME} Shampoo 340ml`, 'Personal Care', OUR_BRAND_NAME, 250, 150],
  ['PCR02', `${OUR_BRAND_NAME} Soap 4-pack`, 'Personal Care', OUR_BRAND_NAME, 140, 82],
  ['PCR03', 'Silkora Shampoo 340ml', 'Personal Care', 'Silkora', 240, 146],
  ['PCR04', 'Silkora Soap 4-pack', 'Personal Care', 'Silkora', 135, 80],
].map(([id, name, category, brand, price, cost]) => ({ id, name, category, brand, price, cost, ours: brand === OUR_BRAND_NAME }));
const CATS = ['Beverages', 'Snacks', 'Breakfast', 'Dairy', 'Household', 'Personal Care'];
const byCat = (c, ours) => PRODUCTS.filter((p) => p.category === c && p.ours === ours);

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
  // Promotion types: 10% Discount, 20% Discount, flat Rs off on Rs min spend, BOGO, Bundle / Combo (3 for 2)
  ['PRM01', 'Breakfast Bonanza', '2025-09-08', 'Breakfast', 'BOGO', 50, 0, 0],
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
  ['PRM12', 'Butter Fest', '2026-02-23', 'Dairy', 'BOGO', 50, 0, 0],
  ['PRM13', 'Holi Hungama', '2026-03-02', 'Beverages', 'PCT_OFF', 10, 0, 0],
  ['PRM14', 'Holi Colours', '2026-03-09', 'Personal Care', 'FLAT_OFF', 18, 35, 250],
  ['PRM15', 'Spring Start', '2026-03-23', 'Breakfast', 'FLAT_OFF', 13, 30, 300],
  ['PRM16', 'Summer Sip', '2026-04-13', 'Beverages', 'PCT_OFF', 20, 0, 0],
  ['PRM17', 'Summer Dairy', '2026-04-27', 'Dairy', 'FLAT_OFF', 13, 8, 100],
  ['PRM18', 'IPL Night', '2026-05-04', 'Snacks', 'PCT_OFF', 20, 0, 0],
  ['PRM19', 'Household Helper', '2026-05-18', 'Household', 'PCT_OFF', 20, 0, 0],
  ['PRM20', 'Monsoon Chill', '2026-06-08', 'Beverages', 'BOGO', 50, 0, 0],
  ['PRM21', 'Muesli Month', '2026-06-15', 'Breakfast', 'PCT_OFF', 10, 0, 0],
  ['PRM22', 'Monsoon Dairy', '2026-06-22', 'Dairy', 'PCT_OFF', 10, 0, 0],
  ['PRM23', 'Monsoon Care', '2026-07-06', 'Household', 'BOGO', 50, 0, 0],
  ['PRM24', 'Glow Up', '2026-07-06', 'Personal Care', 'PCT_OFF', 10, 0, 0],
  ['PRM25', 'Monsoon Munch', '2026-07-20', 'Snacks', 'MULTIBUY_3FOR2', 33, 0, 0],
  ['PRM26', 'Independence Sale', '2026-08-03', 'Personal Care', 'PCT_OFF', 20, 0, 0],
  ['PRM27', 'Back-to-School Breakfast', '2026-08-10', 'Breakfast', 'MULTIBUY_3FOR2', 33, 0, 0],
  ['PRM28', 'Cheese Carnival', '2026-08-17', 'Dairy', 'PCT_OFF', 20, 0, 0],
  ['PRM29', 'Back-to-Work Fizz', '2026-08-24', 'Beverages', 'FLAT_OFF', 15, 10, 100],
  ['PRM30', 'Snack Festival', '2026-09-07', 'Snacks', 'FLAT_OFF', 18, 10, 100],
].map(([id, name, start, category, mechanic, depth, flat, minSpend]) => {
  const s = new Date(start + 'T00:00:00Z').getTime();
  return { id, name, category, mechanic, depth, flat, minSpend, s, e: s + 13 * 864e5, festive: /Diwali|Holi|Independence/.test(name) };
});

const START = new Date('2025-07-01T00:00:00Z').getTime();
const END = new Date('2026-09-30T00:00:00Z').getTime();
const DAY = 864e5;

// ---------------------------------------------------------------- consumer types (latent)
const TYPES = {
  anyways: { share: 0.24, trips: [2.6, 4.2], pOur: [0.74, 0.93], maxP: 0.0, thr: [12, 20], qty: [1.0, 1.0] },
  deal: { share: 0.22, trips: [1.2, 2.2], pOur: [0.06, 0.18], maxP: 0.82, thr: [7, 13], qty: [1.1, 1.5] },
  stockup: { share: 0.16, trips: [1.6, 2.8], pOur: [0.35, 0.6], maxP: 0.78, thr: [9, 16], qty: [2.6, 4.0] },
  switcher: { share: 0.16, trips: [2.0, 3.4], pOur: [0.03, 0.11], maxP: 0.72, thr: [17, 26], qty: [1.0, 1.4] },
  ignores: { share: 0.22, trips: [0.8, 1.8], pOur: [0.05, 0.25], maxP: 0.07, thr: [22, 35], qty: [1.0, 1.0] },
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
  const catW = {};
  CATS.forEach((c) => (catW[c] = Math.exp(U(-0.7, 0.7))));
  const meanW = Object.values(catW).reduce((s, w) => s + w, 0) / CATS.length;
  let active0 = START;
  let active1 = END;
  if (rng() < 0.1) active0 = START + Math.floor(U(60, 330)) * DAY;
  if (rng() < 0.07) active1 = END - Math.floor(U(70, 240)) * DAY;
  const parkUntil = {};
  const promoTrips = {};

  // dedicated promo-driven trips (the behavioural "response")
  for (const cp of CAMPAIGNS) {
    if (cp.e < active0 || cp.s > active1) continue;
    const aff = catW[cp.category] / meanW;
    let p = maxP * sigmoid((cp.depth - thr) / 3.2) * clamp(0.55 + 0.45 * aff, 0.5, 1.25);
    if (cp.festive) p *= 1.15;
    if (cp.mechanic !== 'PCT_OFF') p *= 1.05;
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
    for (const ln of lines) {
      const cp = CAMPAIGNS.find((x) => x.category === ln.cat && t >= x.s && t <= x.e);
      const useOurs = ln.forced ? true : rng() < pOur;
      const prod = pick(byCat(ln.cat, useOurs));
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
      }
      qty = clamp(qty, 1, 12);
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
        oid, cid, fmt(t), prod.id, prod.name, prod.category, prod.brand, prod.ours ? 1 : 0,
        qty, prod.price, unit, disc, promo ? promo.id : '', promo ? promo.name : '', promo ? promo.mechanic : '', prod.cost,
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
  const pref = prefOf(r[1]);
  const u = hash01('ch' + r[0]);
  r.push(u < 0.8 ? pref : CHANNELS.filter((c) => c !== pref)[u < 0.9 ? 0 : 1]);
  r.push(r[14] === 'FLAT_OFF' ? CAMPAIGNS.find((c) => c.id === r[12]).minSpend : '');
}
rows.sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[0] < b[0] ? -1 : 1));
const header = ['order_id', 'customer_id', 'order_date', 'product_id', 'product_name', 'category', 'brand', 'is_our_brand', 'quantity', 'list_price', 'unit_price', 'discount_pct', 'promo_id', 'promo_name', 'promo_mechanic', 'unit_cost', 'channel', 'min_spend'];
const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
fs.mkdirSync(path.join(root, 'public/data'), { recursive: true });
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/data/promo_behaviour_data.csv'), csv);
fs.writeFileSync(path.join(here, 'out/ground_truth.json'), JSON.stringify(truth));
const counts = {};
Object.values(truth).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
console.log('rows', rows.length, 'orders', orderSeq - 1, 'customers', N, 'bytes', csv.length, counts);
