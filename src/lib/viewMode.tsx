import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ViewMode = 'summary' | 'detailed';
/** Mode used when the viewer has not chosen one yet. Flip this one constant to change the default. */
export const DEFAULT_VIEW_MODE: ViewMode = 'summary';
const KEY = 'behaviouriq.viewMode';

const read = (): ViewMode => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'summary' || v === 'detailed' ? v : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
};

interface Ctx { mode: ViewMode; summary: boolean; setMode: (m: ViewMode) => void }
const C = createContext<Ctx>({ mode: DEFAULT_VIEW_MODE, summary: DEFAULT_VIEW_MODE === 'summary', setMode: () => {} });
export const useViewMode = () => useContext(C);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ViewMode>(read);
  const setMode = useCallback((m: ViewMode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* storage unavailable */ }
  }, []);
  const value = useMemo(() => ({ mode, summary: mode === 'summary', setMode }), [mode, setMode]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
