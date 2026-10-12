import { useState, type ReactNode } from 'react';
import { Picker } from '@/components/Picker';

export type ScopeLevel = 'overall' | 'brand' | 'category' | 'sku';
export const SCOPE_LEVELS: { value: ScopeLevel; label: string }[] = [
  { value: 'overall', label: 'Overall' }, { value: 'brand', label: 'By brand' }, { value: 'category', label: 'By category' }, { value: 'sku', label: 'By SKU' },
];

interface ProductLike { productId: string; product: string; brand: string; category: string }
const uniq = (xs: string[]) => [...new Set(xs)].sort();
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Overall / brand / brand -> category / brand -> category -> SKU drill-down over a product list.
 * Each dropdown lists only what exists under the one above it; a stale pick falls back to the first option.
 */
export function useProductScope<T extends ProductLike>(items: T[], labels: Partial<Record<ScopeLevel, string>> = {}) {
  const [level, setLevel] = useState<ScopeLevel>('overall');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [sku, setSku] = useState('');

  const brands = uniq(items.map((s) => s.brand));
  const b = brands.includes(brand) ? brand : brands[0] ?? '';
  const cats = uniq(items.filter((s) => s.brand === b).map((s) => s.category));
  const c = cats.includes(category) ? category : cats[0] ?? '';
  const prods = items.filter((s) => s.brand === b && s.category === c).sort((x, y) => x.product.localeCompare(y.product));
  const p = prods.some((s) => s.productId === sku) ? sku : prods[0]?.productId ?? '';

  const picked = level === 'overall' ? items
    : level === 'brand' ? items.filter((s) => s.brand === b)
    : level === 'category' ? items.filter((s) => s.brand === b && s.category === c)
    : items.filter((s) => s.productId === p);
  const label = level === 'overall' ? (labels.overall ?? 'all products') : level === 'brand' ? b : level === 'category' ? `${b} · ${c}` : prods.find((s) => s.productId === p)?.product ?? '';

  const field = (el: ReactNode) => <div className="min-w-[170px] flex-1">{el}</div>;
  const controls = (
    <div className="flex flex-wrap gap-2">
      {field(<Picker label="Level" value={level} onChange={(v) => setLevel(v as ScopeLevel)} options={SCOPE_LEVELS.map((o) => ({ ...o, label: labels[o.value] ?? o.label }))} />)}
      {level !== 'overall' && field(<Picker label="Brand" value={b} onChange={setBrand} options={brands.map((x) => ({ value: x, label: x, hint: count(items.filter((s) => s.brand === x).length, 'product') }))} />)}
      {(level === 'category' || level === 'sku') && field(<Picker label="Category" value={c} onChange={setCategory} options={cats.map((x) => ({ value: x, label: x }))} />)}
      {level === 'sku' && field(<Picker label="SKU" value={p} onChange={setSku} options={prods.map((x) => ({ value: x.productId, label: x.product, hint: x.productId }))} />)}
    </div>
  );
  return { level, picked, label, controls };
}

/**
 * Always-visible Brand -> Category -> SKU filter. Each picker starts at "All" and lists only what exists under the
 * choices above it, with product counts; a pick that no longer exists falls back to "All".
 */
export function useProductFilter<T extends ProductLike>(items: T[]) {
  const [brand, setBrand] = useState('all');
  const [category, setCategory] = useState('all');
  const [sku, setSku] = useState('all');

  const brands = uniq(items.map((s) => s.brand));
  const b = brands.includes(brand) ? brand : 'all';
  const inBrand = items.filter((s) => b === 'all' || s.brand === b);
  const cats = uniq(inBrand.map((s) => s.category));
  const c = cats.includes(category) ? category : 'all';
  const inCat = inBrand.filter((s) => c === 'all' || s.category === c).sort((x, y) => x.category.localeCompare(y.category) || x.product.localeCompare(y.product));
  const p = inCat.some((s) => s.productId === sku) ? sku : 'all';
  const picked = p === 'all' ? inCat : inCat.filter((s) => s.productId === p);

  const label = p !== 'all' ? picked[0]?.product ?? ''
    : b === 'all' && c === 'all' ? 'all brands and categories'
    : b === 'all' ? `${c}, all brands` : c === 'all' ? `${b}, all categories` : `${b} ${c}`;

  const brandPicker = (
    <Picker label="Brand" value={b} onChange={(v) => { setBrand(v); setCategory('all'); setSku('all'); }}
      options={[{ value: 'all', label: 'All brands', hint: count(brands.length, 'brand') }, ...brands.map((x) => ({ value: x, label: x, hint: count(items.filter((s) => s.brand === x).length, 'product') }))]} />
  );
  const categoryPicker = (
    <Picker label="Category" value={c} onChange={(v) => { setCategory(v); setSku('all'); }}
      options={[{ value: 'all', label: 'All categories', hint: count(cats.length, 'category', 'categories') }, ...cats.map((x) => ({ value: x, label: x, hint: count(inBrand.filter((s) => s.category === x).length, 'product') }))]} />
  );
  const skuPicker = (
    <Picker label="Product (SKU)" value={p} onChange={setSku} placeholder="Search products"
      options={[{ value: 'all', label: 'All products', hint: count(inCat.length, 'product') }, ...inCat.map((x) => ({ value: x.productId, label: x.product, hint: x.productId, group: c === 'all' ? x.category : undefined }))]} />
  );
  const controls = <div className="grid gap-3 sm:grid-cols-3">{brandPicker}{categoryPicker}{skuPicker}</div>;
  return { picked, label, controls, pickers: [brandPicker, categoryPicker, skuPicker] as const, isAll: b === 'all' && c === 'all' && p === 'all', reset: () => { setBrand('all'); setCategory('all'); setSku('all'); } };
}
