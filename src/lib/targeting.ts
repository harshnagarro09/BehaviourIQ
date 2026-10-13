// Cached, engine-level access to the targeting layer for the Behaviour Analytics and Customer Prediction pages.
// Heavy computations run once per loaded file (and per category) and are reused across renders.
import type { Engine } from '@/engine';
import { backtest, type Backtest } from '@/engine/backtest';
import { driverAnalysis, exposures, type DriverResult } from '@/engine/drivers';
import { predictCategory, type CategoryPrediction } from '@/engine/targeting';
import { depthOptions, estimateElasticity, type ElasticityModel } from '@/engine/elasticity';

/** behaviour = customer response rules only; combined = behaviour for who, category demand curve for how deep */
export type ResponseMode = 'behaviour' | 'combined';

interface Cache {
  preds: Map<string, CategoryPrediction>;
  elasticity?: ElasticityModel;
  drivers?: DriverResult[];
  backtest?: Backtest;
}
const caches = new WeakMap<Engine, Cache>();
const cacheOf = (e: Engine) => {
  let c = caches.get(e);
  if (!c) caches.set(e, (c = { preds: new Map() }));
  return c;
};

/** A customer audience to plan for (from Find customers); `key` identifies it in the cache */
export interface AudienceScope { key: string; ids: Set<string> }

/** stable short key for a set of customer ids */
export function audienceKey(ids: Iterable<string>): string {
  const s = [...ids].sort();
  let h = 2166136261;
  for (const id of s) for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Per customer type, the expected response to every offer in a category. With `audience`, only those customers are in
 * the customer types (the same audience Find customers shows), so the budget plan works on exactly that audience.
 */
export function predictionFor(e: Engine, category: string, mode: ResponseMode = 'behaviour', audience?: AudienceScope): CategoryPrediction {
  const c = cacheOf(e);
  const key = `${mode === 'behaviour' ? '' : `${mode}|`}${category}${audience ? `|${audience.key}` : ''}`;
  let p = c.preds.get(key);
  if (!p) {
    const depth = mode === 'combined' ? depthOptions(elasticityOf(e).byCategory.get(category)) : undefined;
    c.preds.set(key, (p = predictCategory(e.ds, e.typeOf, category, e.asOf, e.resp, e.assumptions, audience?.ids, depth)));
  }
  return p;
}

/** price elasticity estimated from the actual past campaign results (once per loaded file) */
export function elasticityOf(e: Engine): ElasticityModel {
  const c = cacheOf(e);
  return (c.elasticity ??= estimateElasticity(e.results, e.perCustomer, e.typeOf));
}

export function driversOf(e: Engine) {
  const c = cacheOf(e);
  return (c.drivers ??= driverAnalysis(exposures(e.ds, e.perCustomer)));
}

export function backtestOf(e: Engine) {
  const c = cacheOf(e);
  return (c.backtest ??= backtest(e.ds, e.perCustomer, 8, e.assumptions));
}
