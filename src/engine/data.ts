// CSV -> typed order lines + indexes. Everything in the app is derived from this one file.

export const DAY_MS = 86_400_000;

export interface Line {
  orderId: string;
  cid: string;
  day: number; // days since 1970-01-01
  productId: string;
  product: string;
  category: string;
  brand: string;
  ours: boolean;
  qty: number;
  list: number;
  unit: number;
  disc: number; // % discount applied
  promoId: string;
  promoName: string;
  mechanic: string;
  cost: number;
  channel: string;
  minSpend: number;
}

export interface Campaign {
  id: string;
  name: string;
  category: string;
  mechanic: string;
  depth: number; // % off (max seen)
  flat: number; // rupees off per unit (flat offers)
  minSpend: number; // minimum spend for flat offers
  start: number; // day number
  end: number;
  idx: number;
}

export interface Dataset {
  lines: Line[];
  byCustomer: Map<string, Line[]>; // sorted by day
  customers: string[];
  minDay: number;
  maxDay: number;
  campaigns: Campaign[];
  categories: string[];
  /** per category: avg list price / unit cost of our brand */
  ourEcon: Record<string, { list: number; cost: number }>;
  /** per category: global our-brand units per customer-day outside promo windows (prior for baselines) */
  priorRate: Record<string, number>;
}

export function dayOf(iso: string): number {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}
export function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

const REQUIRED = [
  'order_id', 'customer_id', 'order_date', 'product_id', 'product_name', 'category', 'brand', 'is_our_brand',
  'quantity', 'list_price', 'unit_price', 'discount_pct', 'promo_id', 'promo_name', 'promo_mechanic', 'unit_cost',
];

export function parseCsv(text: string): Line[] {
  const rows = text.split(/\r?\n/);
  const head = rows[0].trim().split(',');
  const ix: Record<string, number> = { channel: head.indexOf('channel'), min_spend: head.indexOf('min_spend') };
  REQUIRED.forEach((c) => {
    const i = head.indexOf(c);
    if (i < 0) throw new Error(`CSV is missing required column "${c}"`);
    ix[c] = i;
  });
  const out: Line[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const f = row.split(',');
    out.push({
      orderId: f[ix.order_id],
      cid: f[ix.customer_id],
      day: dayOf(f[ix.order_date]),
      productId: f[ix.product_id],
      product: f[ix.product_name],
      category: f[ix.category],
      brand: f[ix.brand],
      ours: f[ix.is_our_brand] === '1',
      qty: +f[ix.quantity],
      list: +f[ix.list_price],
      unit: +f[ix.unit_price],
      disc: +f[ix.discount_pct],
      promoId: f[ix.promo_id],
      promoName: f[ix.promo_name],
      mechanic: f[ix.promo_mechanic],
      cost: +f[ix.unit_cost],
      channel: ix.channel >= 0 ? f[ix.channel] : 'Unknown',
      minSpend: ix.min_spend >= 0 && f[ix.min_spend] ? +f[ix.min_spend] : 0,
    });
  }
  return out;
}

export function buildDataset(lines: Line[]): Dataset {
  lines.sort((a, b) => a.day - b.day);
  const byCustomer = new Map<string, Line[]>();
  let minDay = Infinity;
  let maxDay = -Infinity;
  const camp = new Map<string, Campaign>();
  const cats = new Set<string>();
  const econ: Record<string, { l: number; c: number; n: number }> = {};
  for (const l of lines) {
    let arr = byCustomer.get(l.cid);
    if (!arr) byCustomer.set(l.cid, (arr = []));
    arr.push(l);
    if (l.day < minDay) minDay = l.day;
    if (l.day > maxDay) maxDay = l.day;
    cats.add(l.category);
    if (l.ours) {
      const e = (econ[l.category] ||= { l: 0, c: 0, n: 0 });
      e.l += l.list * l.qty;
      e.c += l.cost * l.qty;
      e.n += l.qty;
    }
    if (l.promoId) {
      const c = camp.get(l.promoId);
      if (!c) {
        camp.set(l.promoId, {
          id: l.promoId, name: l.promoName, category: l.category, mechanic: l.mechanic,
          depth: l.disc, flat: l.list - l.unit, minSpend: l.minSpend, start: l.day, end: l.day, idx: 0,
        });
      } else {
        if (l.day < c.start) c.start = l.day;
        if (l.day > c.end) c.end = l.day;
        if (l.disc > c.depth) c.depth = l.disc;
        if (l.list - l.unit > c.flat) c.flat = l.list - l.unit;
        if (l.minSpend && !c.minSpend) c.minSpend = l.minSpend;
      }
    }
  }
  const campaigns = [...camp.values()].sort((a, b) => a.start - b.start);
  campaigns.forEach((c, i) => (c.idx = i));
  const ourEcon: Dataset['ourEcon'] = {};
  for (const k of Object.keys(econ)) ourEcon[k] = { list: econ[k].l / econ[k].n, cost: econ[k].c / econ[k].n };
  // a flat Rs-off offer is compared with percentage offers through its equivalent depth
  for (const c of campaigns) if (c.mechanic === 'FLAT_OFF' && ourEcon[c.category]) c.depth = Math.round((c.flat / ourEcon[c.category].list) * 100);

  const customers = [...byCustomer.keys()].sort();
  // prior rate: our units per customer-day outside any promo window (+21d tail)
  const priorRate: Record<string, number> = {};
  const span = maxDay - minDay + 1;
  for (const cat of cats) {
    const wins = campaigns.filter((c) => c.category === cat);
    let excl = 0;
    for (const w of wins) excl += w.end - w.start + 1 + 21;
    const days = Math.max(30, span - excl);
    let units = 0;
    for (const l of lines) {
      if (l.category !== cat || !l.ours) continue;
      if (wins.some((w) => l.day >= w.start && l.day <= w.end + 21)) continue;
      units += l.qty;
    }
    priorRate[cat] = units / (days * customers.length);
  }
  return { lines, byCustomer, customers, minDay, maxDay, campaigns, categories: [...cats].sort(), ourEcon, priorRate };
}
