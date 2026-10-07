import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';

const BY_LABEL: Record<string, GlossaryKey> = {
  'Net profit': 'netProfit', ROI: 'roi', Uplift: 'uplift', Leakage: 'leakage', 'Customer type': 'customerType', 'Promo ROI': 'roi',
};
/** a label that gets a "?" when the glossary knows the term */
export function Lbl({ t }: { t: string }): ReactNode {
  const k = BY_LABEL[t];
  return k ? <>{t}<Help term={k} /></> : t;
}

/**
 * Small "?" with a plain-English tooltip (hover or keyboard focus). The tip is fixed-positioned above the
 * "?" so it never sits on top of the short key under a panel title, and flips below only when there is no room.
 */
export function Help({ term }: { term: GlossaryKey }) {
  const g = GLOSSARY[term];
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 120;
    setPos({ left: Math.min(Math.max(12, r.left + r.width / 2 - 130), window.innerWidth - 272), top: below ? r.bottom + 6 : r.top - 6, below });
  };
  const hide = () => setPos(null);
  return (
    <span className="relative ml-1 inline-flex align-middle" onClick={(e) => e.stopPropagation()}>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`What is ${g.term}?`}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
        className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-[var(--line)] bg-white text-[9.5px] font-bold normal-case tracking-normal text-[var(--ink-3)] hover:border-[var(--navy)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navy)]"
      >?</span>
      {pos && (
        <span
          id={id}
          role="tooltip"
          style={{ position: 'fixed', left: pos.left, top: pos.top, transform: pos.below ? undefined : 'translateY(-100%)', width: 260, zIndex: 60 }}
          className="pointer-events-none rounded-md bg-[var(--navy)] px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
        >
          <b className="block text-[12px]">{g.term}</b>{g.text}
        </span>
      )}
    </span>
  );
}
