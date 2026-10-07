import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useApp, type PageId } from '@/state';

type StepId = 'behaviour' | 'prediction' | 'decision' | 'proof';

const STEPS: { id: StepId; label: string; hint: string; to: { page: PageId; tab?: string } }[] = [
  { id: 'behaviour', label: 'Behaviour', hint: 'What customers did', to: { page: 'analytics', tab: 'behaviour' } },
  { id: 'prediction', label: 'Prediction', hint: 'Chance of buying with vs without a promotion', to: { page: 'customers' } },
  { id: 'decision', label: 'Decision', hint: 'Which offers are worth it', to: { page: 'planning' } },
  { id: 'proof', label: 'Proof', hint: 'Does it work on campaigns the model never saw', to: { page: 'analytics', tab: 'prediction' } },
];

/** Which steps the current page (and Behaviour Analytics tab) covers. */
export function stepsFor(page: PageId, tab: string): StepId[] {
  if (page === 'analytics') {
    if (tab === 'prediction') return ['prediction', 'proof'];
    if (tab === 'impact') return ['decision', 'proof'];
    return ['behaviour'];
  }
  if (page === 'customers') return ['prediction', 'decision'];
  if (page === 'planning' || page === 'simulation') return ['decision'];
  return ['behaviour', 'prediction', 'decision', 'proof'];
}

const KEY = 'behaviouriq.storyStrip.hidden';
const readHidden = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

export function StoryStrip() {
  const { page, tab, go } = useApp();
  const [hidden, setHidden] = useState(readHidden);
  const set = (v: boolean) => {
    setHidden(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const active = stepsFor(page, tab);

  if (hidden) {
    return (
      <div className="mt-2 flex h-5 items-center">
        <button onClick={() => set(false)} className="text-[10px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">Show story: Behaviour → Prediction → Decision → Proof</button>
      </div>
    );
  }
  return (
    <nav aria-label="Story" className="mt-2.5 flex h-7 items-center gap-1.5">
      {STEPS.map((s, i) => {
        const on = active.includes(s.id);
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <button
              onClick={() => go(s.to.page, s.to.tab ? { tab: s.to.tab } : {})}
              title={s.hint}
              aria-current={on ? 'step' : undefined}
              className={`flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[10.5px] font-semibold uppercase tracking-wider transition-colors ${on ? 'bg-[var(--navy)] text-white' : 'bg-[var(--bg)] text-[var(--ink-3)] hover:text-[var(--ink)]'}`}
            >
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8.5px] ${on ? 'bg-white/20' : 'bg-[var(--line)]'}`}>{i + 1}</span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-[var(--ink-3)]" />}
          </div>
        );
      })}
      <button onClick={() => set(true)} aria-label="Hide story strip" title="Hide" className="ml-1 rounded p-1 text-[var(--ink-3)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"><X className="h-3 w-3" /></button>
    </nav>
  );
}
