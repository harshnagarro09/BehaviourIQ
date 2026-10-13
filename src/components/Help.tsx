import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';

const BY_LABEL: Record<string, GlossaryKey> = {
  'Incremental margin': 'incMargin', ROI: 'roi', Uplift: 'uplift', Subsidy: 'leakage', 'Subsidy rate': 'leakage', Baseline: 'baseline', Incrementality: 'incrementality', 'Promo ROI': 'roi', 'Extra profit': 'incMargin', 'Extra sales': 'incRevenue',
};
/** a label that gets a "?" when the glossary knows the term */
export function Lbl({ t }: { t: string }): ReactNode {
  const k = BY_LABEL[t];
  return k ? <>{t}<Help term={k} /></> : t;
}

/**
 * Small "?" with a plain-English tooltip (hover or keyboard focus). The tip is fixed-positioned just below the
 * "?" and flips above only when the "?" sits at the very bottom of the screen.
 */
export function Help({ term, below: forceBelow = false }: { term: GlossaryKey; below?: boolean }) {
  const g = GLOSSARY[term];
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = forceBelow || r.bottom + 120 < window.innerHeight || r.top < 170; // directly under the "?"; above only when it is at the very bottom of the screen
    setPos({ left: Math.min(Math.max(12, r.left + r.width / 2 - 16), window.innerWidth - 244), top: below ? r.bottom + 6 : r.top - 6, below });
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
      {pos && createPortal(
        <span
          id={id}
          role="tooltip"
          style={{ position: 'fixed', left: pos.left, top: pos.top, transform: pos.below ? undefined : 'translateY(-100%)', width: 228, zIndex: 60 }}
          className="pointer-events-none rounded-md bg-[var(--navy)] px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
        >
          <b className="block text-[11.5px]">{g.term}</b>
          {g.text.split('\n').map((line, i) => {
            const k = line.indexOf(': ');
            return k > 0 && g.text.includes('\n')
              ? <span key={i} className="mt-1 block"><b>{line.slice(0, k)}:</b> {line.slice(k + 2)}</span>
              : <span key={i} className="block">{line}</span>;
          })}
        </span>,
        document.body,
      )}
    </span>
  );
}
