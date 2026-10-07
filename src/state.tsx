import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildEngine, type Engine } from '@/engine';

export type PageId = 'analytics' | 'customers' | 'planning' | 'simulation' | 'advisor';

export interface Decision {
  status: 'accepted' | 'rejected';
  optionKey: string;
}

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
  decisions: Record<string, Decision>;
  decide: (id: string, d: Decision | null) => void;
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

const PAGES: PageId[] = ['analytics', 'customers', 'planning', 'simulation', 'advisor'];
const DEFAULT_URL = `${import.meta.env.BASE_URL}data/promo_behaviour_data.csv`;

export function AppProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('promo_behaviour_data.csv');
  const [page, setPage] = useState<PageId>(() => {
    const h = window.location.hash.replace('#/', '').split('?')[0] as PageId;
    return PAGES.includes(h) ? h : 'analytics';
  });
  const [params, setParams] = useState<Record<string, string>>(hashQuery);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    try {
      return JSON.parse(localStorage.getItem('behaviouriq.decisions') ?? '{}');
    } catch {
      return {};
    }
  });

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

  const decide = useCallback((id: string, d: Decision | null) => {
    setDecisions((prev) => {
      const next = { ...prev };
      if (d) next[id] = d;
      else delete next[id];
      try {
        localStorage.setItem('behaviouriq.decisions', JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ engine, error, source, loadText, page, go, params, syncParams, decisions, decide }),
    [engine, error, source, loadText, page, go, params, syncParams, decisions, decide],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
