// Cached, engine-level access to the targeting layer for the Behaviour Analytics and Customer Prediction pages.
// Heavy computations run once per loaded file (and per category) and are reused across renders.
import type { Engine } from '@/engine';
import { backtest, type Backtest } from '@/engine/backtest';
import { driverAnalysis, exposures, type DriverResult } from '@/engine/drivers';
import { predictCategory, type CategoryPrediction } from '@/engine/targeting';

interface Cache {
  preds: Map<string, CategoryPrediction>;
  drivers?: DriverResult[];
  backtest?: Backtest;
}
const caches = new WeakMap<Engine, Cache>();
const cacheOf = (e: Engine) => {
  let c = caches.get(e);
  if (!c) caches.set(e, (c = { preds: new Map() }));
  return c;
};

export function predictionFor(e: Engine, category: string): CategoryPrediction {
  const c = cacheOf(e);
  let p = c.preds.get(category);
  if (!p) c.preds.set(category, (p = predictCategory(e.ds, e.typeOf, category, e.asOf, e.resp, e.assumptions)));
  return p;
}

export function driversOf(e: Engine) {
  const c = cacheOf(e);
  return (c.drivers ??= driverAnalysis(exposures(e.ds, e.perCustomer)));
}

export function backtestOf(e: Engine) {
  const c = cacheOf(e);
  return (c.backtest ??= backtest(e.ds, e.perCustomer, 8, e.assumptions));
}
