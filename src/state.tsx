import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildEngine, type Engine } from '@/engine';
import type { PlanConfig } from '@/lib/plan';
import { loadSaved, saveKey, type Backup } from '@/lib/store';
import type { LiveCampaign } from '@/lib/live';

export type PageId = 'analytics' | 'planning' | 'simulation' | 'live' | 'advisor';

/** A what-if version of the plan, tried on Simulation > Test the plan; it never changes the plan until applied */
export interface Scenario { id: string; name: string; cfg: PlanConfig }


interface Ctx {
  engine: Engine | null;
  error: string | null;
  source: string;
  loadText: (text: string, name: string) => void;
  page: PageId;
  go: (p: PageId, params?: Record<string, string>) => void;
  params: Record<string, string>;
  /** write the current view's parameters into the address (for sharing / jumping straight to a view) */
  syncParams: (p: Record<string, string>) => void;
  /** the promotion plan built on Planning; Simulation tests it and can apply a scenario back to it */
  plan: PlanConfig;
  /** change the plan; `from` names where the change came from (e.g. a simulated scenario), so it can be shown and undone */
  setPlan: (cfg: PlanConfig, from?: string) => void;
  planFrom: string | null;
  undoPlan: (() => void) | null;
  scenarios: Scenario[];
  setScenarios: (s: Scenario[]) => void;
  /** finalised plans, scheduled as dated campaigns (Live campaigns) */
  campaigns: LiveCampaign[];
  setCampaigns: (c: LiveCampaign[]) => void;
  /** replace the plan, scenarios and campaigns from a backup file */
  restore: (b: Backup) => void;
  /** the campaign name being typed in "Finalise and schedule", shared so Simulation can show it */
  campaignName: string;
  setCampaignName: (n: string) => void;
}

const C = createContext<Ctx>(null as never);
export const useApp = () => useContext(C);
export function useEngine(): Engine {
  const e = useContext(C).engine;
  if (!e) throw new Error('engine not ready');
  return e;
}

const hashQuery = (): Record<string, string> => Object.fromEntries(new URLSearchParams(window.location.hash.split('?')[1] ?? ''));
const toHash = (p: string, pr: Record<string, string>) => {
  const q = new URLSearchParams(pr).toString();
  return `#/${p}${q ? `?${q}` : ''}`;
};

const PAGES: PageId[] = ['analytics', 'planning', 'simulation', 'live', 'advisor'];
const DEFAULT_URL = `${import.meta.env.BASE_URL}data/promo_behaviour_data.csv`;

export function AppProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('promo_behaviour_data.csv');
  // old addresses still work
  const [start] = useState(() => {
    const h = window.location.hash.replace('#/', '').split('?')[0];
    const q = hashQuery();
    if (h === 'customers') return { page: 'simulation' as PageId, params: {} }; // the old Customer Prediction address
    return { page: PAGES.includes(h as PageId) ? (h as PageId) : 'analytics', params: q };
  });
  const [page, setPage] = useState<PageId>(start.page);
  const [params, setParams] = useState<Record<string, string>>(start.params);

  const [saved] = useState(loadSaved);
  const [plan, setPlanState] = useState<PlanConfig>(saved.plan);
  const [campaignName, setCampaignName] = useState('');
  const [prevPlan, setPrevPlan] = useState<PlanConfig | null>(null);
  const [planFrom, setPlanFrom] = useState<string | null>(null);
  const [scenarios, setScenarioState] = useState<Scenario[]>(saved.scenarios);
  const [campaigns, setCampaignState] = useState<LiveCampaign[]>(saved.campaigns);
  const setScenarios = useCallback((s: Scenario[]) => { setScenarioState(s); saveKey('scenarios', s); }, []);
  const setPlan = useCallback((cfg: PlanConfig, from?: string) => {
    setPlanState((cur) => { if (from) setPrevPlan(cur); return cfg; });
    setPlanFrom(from ?? null);
    if (!from) setPrevPlan(null);
    saveKey('plan', cfg);
  }, []);
  const undoPlan = useMemo(() => (prevPlan ? () => { setPlanState(prevPlan); saveKey('plan', prevPlan); setPrevPlan(null); setPlanFrom(null); } : null), [prevPlan]);
  const setCampaigns = useCallback((c: LiveCampaign[]) => { setCampaignState(c); saveKey('campaigns', c); }, []);
  /** replace everything from a backup file */
  const restore = useCallback((b: Backup) => { setPlanState(b.plan); saveKey('plan', b.plan); setPrevPlan(null); setPlanFrom(null); setScenarioState(b.scenarios); saveKey('scenarios', b.scenarios); setCampaignState(b.campaigns); saveKey('campaigns', b.campaigns); }, []);

  const loadText = useCallback((text: string, name: string) => {
    setEngine(null);
    setError(null);
    // let the loading state paint before the (synchronous) number crunching
    setTimeout(() => {
      try {
        setEngine(buildEngine(text));
        setSource(name);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 30);
  }, []);

  useEffect(() => {
    fetch(DEFAULT_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${DEFAULT_URL} (${r.status})`);
        return r.text();
      })
      .then((t) => loadText(t, 'promo_behaviour_data.csv'))
      .catch((e) => setError(String(e.message ?? e)));
  }, [loadText]);

  const go = useCallback((p: PageId, pr: Record<string, string> = {}) => {
    setPage(p);
    setParams(pr);
    window.history.replaceState(null, '', toHash(p, pr));
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, []);

  const syncParams = useCallback((pr: Record<string, string>) => {
    const p = window.location.hash.replace('#/', '').split('?')[0];
    window.history.replaceState(null, '', toHash(p, pr));
  }, []);

  const value = useMemo(
    () => ({ engine, error, source, loadText, page, go, params, syncParams, plan, setPlan, planFrom, undoPlan, scenarios, setScenarios, campaigns, setCampaigns, restore, campaignName, setCampaignName }),
    [engine, error, source, loadText, page, go, params, syncParams, plan, setPlan, planFrom, undoPlan, scenarios, setScenarios, campaigns, setCampaigns, restore, campaignName, setCampaignName],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
