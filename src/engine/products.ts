// The product hierarchy (brand -> category -> SKU) and each SKU's share of its category's regular sales.
//
// Regular sales = units sold outside any promotion window of the category (and the 21 days after it), i.e. the normal,
// full-price mix. This "base volume" share is how category-level baselines, spend and volume are split down to SKUs
// (see docs/Behaviour driven budget optimization.md: SAP splits category spend to SKUs by base-volume ratio).
// A category with no regular sales at all falls back to an equal split; an SKU with no regular sales gets share 0.
import type { Dataset } from './data.ts';

export interface Sku {
  productId: string;
  product: string;
  brand: string;
  category: string;
  share: number; // share of the category's regular units (the SKUs of one category sum to 1)
  regularUnits: number;
}

const cache = new WeakMap<Dataset, Sku[]>();

export function skuCatalog(ds: Dataset): Sku[] {
  const hit = cache.get(ds);
  if (hit) return hit;
  const meta = new Map<string, Sku>();
  for (const l of ds.lines) {
    let s = meta.get(l.productId);
    if (!s) meta.set(l.productId, (s = { productId: l.productId, product: l.product || l.productId, brand: l.brand || 'Unknown brand', category: l.category, share: 0, regularUnits: 0 }));
    if (!ds.campaigns.some((c) => c.category === l.category && l.day >= c.start && l.day <= c.end + 21)) s.regularUnits += l.qty;
  }
  const out = [...meta.values()];
  for (const cat of new Set(out.map((s) => s.category))) {
    const skus = out.filter((s) => s.category === cat);
    const tot = skus.reduce((a, s) => a + s.regularUnits, 0);
    for (const s of skus) s.share = tot > 0 ? s.regularUnits / tot : 1 / skus.length;
  }
  out.sort((a, b) => a.brand.localeCompare(b.brand) || a.category.localeCompare(b.category) || a.product.localeCompare(b.product));
  cache.set(ds, out);
  return out;
}
