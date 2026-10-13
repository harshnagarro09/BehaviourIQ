// Where the return of past promotions comes from: promotion-window sales split into baseline and uplift for every
// promotion x SKU, so any selection (brand, category, SKU, promotion) is a plain sum of rows and always reconciles with
// the campaign totals (campaigns.ts) and the KPIs on Behaviour Analytics (lib/analytics.ts aggregate()).
//
// For each customer a campaign reached (same reach rule and window as campaigns.ts):
//   units, revenue, promo cost, margin   come straight from their order lines in the window, per SKU          (actual)
//   baseline units                        their own pre-campaign buying rate for the CATEGORY x window length,
//                                         split across the category's SKUs by each SKU's normal sales mix   (estimate)
//   uplift = units - baseline;  incremental margin = margin after promo cost - baseline units x full margin  (estimate)
// Summed over the SKUs of a campaign this equals the campaign's own units, baseline, cost and incremental margin.
import type { CustomerCampaign } from './campaigns.ts';
import { cutIndex } from './behaviour.ts';
import { POINTS_REDEMPTION, type Campaign, type Dataset } from './data.ts';
import { skuCatalog } from './products.ts';

export interface ReturnRow {
  campaignId: string;
  productId: string;
  product: string;
  brand: string;
  category: string;
  units: number; // units sold in the promotion window (actual)
  revenue: number; // cash received on them (actual)
  cost: number; // promo cost: till discount + redeemed points (actual)
  margin: number; // margin on them after the promo cost (actual)
  base: number; // baseline units (estimate)
  baseRevenue: number; // baseline units at full price (estimate)
  baseMargin: number; // baseline units at full margin (estimate)
}

export interface ReturnTotals {
  units: number; base: number; uplift: number;
  revenue: number; baseRevenue: number; incRevenue: number;
  cost: number; incMargin: number; roi: number;
}

export function returnRows(ds: Dataset, perCustomer: Map<string, CustomerCampaign[]>, camps: Campaign[], ok: (cid: string) => boolean): ReturnRow[] {
  const catalog = skuCatalog(ds);
  const byId = new Map(camps.map((c) => [c.id, c]));
  const inCat = new Map<string, typeof catalog>();
  for (const s of catalog) inCat.set(s.category, [...(inCat.get(s.category) ?? []), s]);
  const meta = new Map(catalog.map((s) => [s.productId, s]));
  const out = new Map<string, ReturnRow>();
  const row = (c: Campaign, productId: string) => {
    const k = `${c.id}|${productId}`;
    let r = out.get(k);
    if (!r) {
      const s = meta.get(productId)!;
      out.set(k, (r = { campaignId: c.id, productId, product: s.product, brand: s.brand, category: s.category, units: 0, revenue: 0, cost: 0, margin: 0, base: 0, baseRevenue: 0, baseMargin: 0 }));
    }
    return r;
  };
  for (const [cid, rows] of perCustomer) {
    if (!ok(cid)) continue;
    const lines = ds.byCustomer.get(cid)!;
    for (const cc of rows) {
      const c = byId.get(cc.campaignId);
      if (!c) continue;
      const econ = ds.ourEcon[c.category];
      for (const s of inCat.get(c.category) ?? []) {
        if (s.share <= 0) continue;
        const r = row(c, s.productId);
        const b = cc.baselineUnits * s.share;
        r.base += b;
        r.baseRevenue += b * econ.list;
        r.baseMargin += b * (econ.list - econ.cost);
      }
      for (let i = cutIndex(lines, c.start); i < lines.length && lines[i].day <= c.end; i++) {
        const l = lines[i];
        if (l.category !== c.category || !l.ours) continue;
        const r = row(c, l.productId);
        const pts = l.reward * POINTS_REDEMPTION;
        r.units += l.qty;
        r.revenue += l.unit * l.qty;
        r.cost += (l.list - l.unit) * l.qty + pts;
        r.margin += (l.unit - l.cost) * l.qty - pts;
      }
    }
  }
  return [...out.values()];
}

export function sumReturns(rows: ReturnRow[]): ReturnTotals {
  let units = 0, base = 0, revenue = 0, baseRevenue = 0, cost = 0, margin = 0, baseMargin = 0;
  for (const r of rows) { units += r.units; base += r.base; revenue += r.revenue; baseRevenue += r.baseRevenue; cost += r.cost; margin += r.margin; baseMargin += r.baseMargin; }
  const incMargin = margin - baseMargin;
  return { units, base, uplift: units - base, revenue, baseRevenue, incRevenue: revenue - baseRevenue, cost, incMargin, roi: cost > 0 ? incMargin / cost : 0 };
}
