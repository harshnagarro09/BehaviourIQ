// What the app remembers in this browser: the plan, the scenarios and the finalised campaigns. Everything is saved in a
// versioned envelope and checked when it is read, so a change to the plan's fields never breaks old saved data: unknown or
// wrongly-typed fields fall back to the defaults, and unreadable data is ignored. A backup file (export / import) carries the same.
import { DEFAULT_PLAN, type PlanConfig } from './plan.ts';
import type { LiveCampaign } from './live.ts';

export const STORE_VERSION = 2;
export interface SavedScenario { id: string; name: string; cfg: PlanConfig }

/** keep only the plan fields we know, each with the type we expect; anything else becomes the default */
export function sanitizePlan(raw: unknown): PlanConfig {
  const out: Record<string, unknown> = { ...DEFAULT_PLAN };
  if (raw && typeof raw === 'object') {
    for (const [k, def] of Object.entries(DEFAULT_PLAN)) {
      const v = (raw as Record<string, unknown>)[k];
      if (v === undefined) continue;
      const ok = def === null ? v === null || typeof v === 'number' || Array.isArray(v) : Array.isArray(def) ? Array.isArray(v) : typeof def === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === typeof def;
      if (ok) out[k] = v;
    }
  }
  return out as unknown as PlanConfig;
}

const isCampaign = (c: unknown): c is LiveCampaign => {
  const x = c as Partial<LiveCampaign> | null;
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.start === 'string' && typeof x.days === 'number' && typeof x.spend === 'number' && typeof x.incMargin === 'number' && !!x.cfg;
};
export const sanitizeCampaigns = (raw: unknown): LiveCampaign[] => (Array.isArray(raw) ? raw.filter(isCampaign).map((c) => ({ ...c, cfg: sanitizePlan(c.cfg) })) : []);
export const sanitizeScenarios = (raw: unknown): SavedScenario[] =>
  (Array.isArray(raw) ? raw.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && s.cfg).slice(0, 3).map((s) => ({ id: s.id, name: s.name, cfg: sanitizePlan(s.cfg) })) : []);

/** the saved value, whether it was written by this version (an envelope) or by an older one (the bare value) */
const unwrap = (text: string | null): unknown => {
  if (!text) return undefined;
  try { const j = JSON.parse(text); return j && typeof j === 'object' && 'v' in j && 'data' in j ? j.data : j; } catch { return undefined; }
};

export function loadSaved() {
  const get = (k: string) => { try { return unwrap(localStorage.getItem(k)); } catch { return undefined; } };
  return { plan: sanitizePlan(get('behaviouriq.plan')), scenarios: sanitizeScenarios(get('behaviouriq.scenarios')), campaigns: sanitizeCampaigns(get('behaviouriq.campaigns')) };
}

export function saveKey(key: 'plan' | 'scenarios' | 'campaigns', value: unknown) {
  try { localStorage.setItem(`behaviouriq.${key}`, JSON.stringify({ v: STORE_VERSION, data: value })); } catch { /* storage unavailable: the app still works, it just forgets */ }
}

export interface Backup { app: 'behaviouriq'; v: number; savedAt: string; plan: PlanConfig; scenarios: SavedScenario[]; campaigns: LiveCampaign[] }
export const makeBackup = (plan: PlanConfig, scenarios: SavedScenario[], campaigns: LiveCampaign[]): Backup => ({ app: 'behaviouriq', v: STORE_VERSION, savedAt: new Date().toISOString(), plan, scenarios, campaigns });
/** a backup file read back; null when it is not one of ours */
export function parseBackup(text: string): Backup | null {
  try {
    const j = JSON.parse(text);
    if (!j || j.app !== 'behaviouriq' || typeof j.v !== 'number') return null;
    return { app: 'behaviouriq', v: STORE_VERSION, savedAt: String(j.savedAt ?? ''), plan: sanitizePlan(j.plan), scenarios: sanitizeScenarios(j.scenarios), campaigns: sanitizeCampaigns(j.campaigns) };
  } catch { return null; }
}
