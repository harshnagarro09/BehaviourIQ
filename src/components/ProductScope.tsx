import { useState } from 'react';
import { Picker } from '@/components/Picker';

interface ProductLike { productId: string; product: string; brand: string; category: string }
const uniq = (xs: string[]) => [...new Set(xs)].sort();
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Always-visible Brand -> Category -> SKU filter. Each picker starts at "All" and lists only what exists under the
 * choices above it, with product counts; a pick that no longer exists falls back to "All".
 */
export interface ProductSelection { brand: string; category: string; sku: string }

/** With `ctrl`, the selection lives outside (e.g. in the shared plan); otherwise the hook keeps it */
export function useProductFilter<T extends ProductLike>(items: T[], ctrl?: { value: ProductSelection; onChange: (v: ProductSelection) => void }) {
  const [own, setOwn] = useState<ProductSelection>({ brand: 'all', category: 'all', sku: 'all' });
  const sel = ctrl?.value ?? own;
  const put = (v: ProductSelection) => (ctrl ? ctrl.onChange(v) : setOwn(v));
  const { brand, category, sku } = sel;
  const setBrand = (v: string) => put({ brand: v, category: 'all', sku: 'all' });
  const setCategory = (v: string) => put({ ...sel, category: v, sku: 'all' });
  const setSku = (v: string) => put({ ...sel, sku: v });

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
    <Picker label="Brand" value={b} onChange={setBrand}
      options={[{ value: 'all', label: 'All brands', hint: count(brands.length, 'brand') }, ...brands.map((x) => ({ value: x, label: x, hint: count(items.filter((s) => s.brand === x).length, 'product') }))]} />
  );
  const categoryPicker = (
    <Picker label="Category" value={c} onChange={setCategory}
      options={[{ value: 'all', label: 'All categories', hint: count(cats.length, 'category', 'categories') }, ...cats.map((x) => ({ value: x, label: x, hint: count(inBrand.filter((s) => s.category === x).length, 'product') }))]} />
  );
  const skuPicker = (
    <Picker label="Product (SKU)" value={p} onChange={setSku} placeholder="Search products"
      options={[{ value: 'all', label: 'All products', hint: count(inCat.length, 'product') }, ...inCat.map((x) => ({ value: x.productId, label: x.product, hint: x.productId, group: c === 'all' ? x.category : undefined }))]} />
  );
  const controls = <div className="grid gap-3 sm:grid-cols-3">{brandPicker}{categoryPicker}{skuPicker}</div>;
  return {
    picked, label, controls, pickers: [brandPicker, categoryPicker, skuPicker] as const, isAll: b === 'all' && c === 'all' && p === 'all', category: c,
    reset: () => put({ brand: 'all', category: 'all', sku: 'all' }),
    /** focus on one category (all its brands and products), e.g. the category chosen on another tab */
    setCategory: (v: string) => put({ brand: 'all', category: v, sku: 'all' }),
  };
}
