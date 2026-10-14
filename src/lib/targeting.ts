// Cached, engine-level access to the prediction layer for Behaviour Analytics, Planning and Simulation.
// Heavy computations run once per loaded file (and per category) and are reused across renders.
import type { Engine } from '../engine/index.ts';
import type { TypeId } from '../engine/behaviour.ts';
import { driverAnalysis, exposures, type DriverResult } from '../engine/drivers.ts';
import { predictCategory, type CategoryPrediction } from '../engine/targeting.ts';
import { depthOptions, estimateElasticity, type ElasticityModel } from '../engine/elasticity.ts';
import { reliabilityOf, type Reliability } from '../engine/reliability.ts';

/** behaviour = customer response rules only; combined = behaviour for who, category demand curve for how deep */
export type ResponseMode = 'behaviour' | 'combined';

interface Cache {
  preds: Map<string, CategoryPrediction>;
  elasticity?: ElasticityModel;
  drivers?: DriverResult[];
  reliability?: Reliability;
}
const caches = new WeakMap<Engine, Cache>();
const cacheOf = (e: Engine) => {
  let c = caches.get(e);
  if (!c) caches.set(e, (c = { preds: new Map() }));
  return c;
};

/** A set of customers to plan for; `key` identifies it in the cache */
export interface AudienceScope { key: string; ids: Set<string>; typeOf?: Map<string, TypeId> } // typeOf: customer types to plan with, when they differ from the engine's (the key must tell the two apart)

/** stable short key for a set of customer ids */
export function audienceKey(ids: Iterable<string>): string {
  const s = [...ids].sort();
  let h = 2166136261;
  for (const id of s) for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Per customer type, the expected response to every offer in a category. With `audience`, only those customers are in
 * the customer types so the plan works on exactly those customers.
 */
export function predictionFor(e: Engine, category: string, mode: ResponseMode = 'combined', audience?: AudienceScope): CategoryPrediction {
  const c = cacheOf(e);
  const key = `${mode === 'behaviour' ? '' : `${mode}|`}${category}${audience ? `|${audience.key}` : ''}`;
  let p = c.preds.get(key);
  if (!p) {
    const depth = mode === 'combined' ? depthOptions(elasticityOf(e).byCategory.get(category)) : undefined;
    c.preds.set(key, (p = predictCategory(e.ds, audience?.typeOf ?? e.typeOf, category, e.asOf, e.resp, e.assumptions, audience?.ids, depth)));
  }
  return p;
}

/** price elasticity estimated from the actual past campaign results (once per loaded file) */
export function elasticityOf(e: Engine): ElasticityModel {
  const c = cacheOf(e);
  return (c.elasticity ??= e.elasticity ?? estimateElasticity(e.results, e.perCustomer, e.typeOf));
}

export function driversOf(e: Engine) {
  const c = cacheOf(e);
  return (c.drivers ??= driverAnalysis(exposures(e.ds, e.perCustomer)));
}

/** how far to trust the numbers: accuracy on recent campaigns, the likely range, and how sensitive the customer types are (once per loaded file) */
export function reliabilityFor(e: Engine) {
  const c = cacheOf(e);
  return (c.reliability ??= reliabilityOf(e.ds, e.perCustomer, e.records, e.assumptions));
}
