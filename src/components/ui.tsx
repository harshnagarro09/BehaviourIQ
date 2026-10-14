import type { ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown } from 'lucide-react';
import { Help } from '@/components/Help';
import type { GlossaryKey } from '@/lib/glossary';
import { useApp, type PageId } from '@/state';

export function Card({ children, className = '', pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`card ${pad ? 'p-4' : ''} ${className}`}>{children}</section>;
}

export function Delta({ value, good }: { value: string; good: boolean | null }) {
  const up = !value.startsWith('-');
  const tone = good === null ? ['#eef1f6', 'var(--ink-2)'] : good ? ['var(--green-bg)', 'var(--green-dark)'] : ['var(--red-bg)', '#b91c1c'];
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-[1px] text-[11px] font-semibold" style={{ background: tone[0], color: tone[1] }}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {value.replace('-', '').replace('+', '')}
    </span>
  );
}

export function Kpi({
  label, value, delta, note, tone, help, emphasis = false,
}: { emphasis?: boolean; help?: GlossaryKey; label: string; value: ReactNode; delta?: { text: string; good: boolean | null } | null; note?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="card p-3.5" style={emphasis ? { borderLeft: '3px solid var(--green)' } : undefined}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">{label}{help && <Help term={help} />}</p>
      <p className="num mt-1.5 text-[22px] font-bold leading-none tracking-tight" style={{ color: tone === 'bad' ? 'var(--red)' : tone === 'good' ? 'var(--green-dark)' : 'var(--ink)' }}>{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] leading-snug text-[var(--ink-3)]">
        {delta && <Delta value={delta.text} good={delta.good} />}
        <span>{note}</span>
      </div>
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'red' | 'amber' | 'navy' }) {
  const m = {
    neutral: ['#eef1f6', 'var(--ink-2)'],
    green: ['var(--green-bg)', 'var(--green-dark)'],
    red: ['var(--red-bg)', '#b91c1c'],
    amber: ['#fef3c7', '#92400e'],
    navy: ['var(--navy)', '#fff'],
  } as const;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-[2px] text-[11px] font-semibold" style={{ background: m[tone][0], color: m[tone][1] }}>{children}</span>;
}

export function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full min-w-[120px] appearance-none rounded-md border border-[var(--line)] bg-white pl-2.5 pr-7 text-[12.5px] outline-none focus:border-[var(--navy)]"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-[var(--ink-3)]" />
    </div>
  );
}

export function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-[var(--line)] bg-white">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`px-3 py-1.5 text-[12px] font-semibold ${value === o.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{o.label}</button>
      ))}
    </div>
  );
}


/** Chart / Table switch for cards that can show either */

/** Marks whether the numbers in a card are actual history or a simulated result */
export function SourceChip({ kind }: { kind: 'actual' | 'simulated' }) {
  return kind === 'actual'
    ? <span className="inline-flex items-center rounded-full bg-[#e8eef7] px-2 py-0.5 text-[11px] font-semibold text-[var(--navy)]" title="Calculated from the order history in the data file (demo data)">Actual history</span>
    : <span className="inline-flex items-center rounded-full bg-[#fff1dc] px-2 py-0.5 text-[11px] font-semibold text-[#92400e]" title="Rule-based simulation from behaviour plus stated assumptions. Not a trained model and not a measurement">Simulated</span>;
}

/** Page tabs: underlined, shown at the bottom of the page header (see PageTop) */
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-x-6">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`-mb-px border-b-2 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${value === o.id ? 'border-[var(--navy)] text-[var(--ink)]' : 'border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]'}`}
        >{o.label}</button>
      ))}
    </div>
  );
}

export function ViewToggle({ value, onChange }: { value: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void }) {
  return <Toggle value={value} onChange={onChange} options={[{ id: 'chart', label: 'Chart' }, { id: 'table', label: 'Table' }]} />;
}

/** The bridge to the next stage of the story (customers -> promotions -> who to target -> budget), at the end of a view */
/** The three stages of the work, shown at the top of each stage so it is always clear where you are and what comes next */
const JOURNEY: { page: PageId; label: string }[] = [
  { page: 'analytics', label: 'Understand' },
  { page: 'planning', label: 'Plan' },
  { page: 'simulation', label: 'Simulate' },
  { page: 'live', label: 'Run' },
];
export function Journey() {
  const { page, go } = useApp();
  const at = JOURNEY.findIndex((j) => j.page === page);
  if (at < 0) return null;
  return (
    <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-[12px]">
      {JOURNEY.map((j, i) => (
        <span key={j.page} className="flex items-center gap-1">
          <button onClick={() => go(j.page)} aria-current={i === at ? 'step' : undefined}
            className={`rounded-full px-2.5 py-1 font-semibold ${i === at ? 'bg-[var(--navy)] text-white' : i < at ? 'text-[var(--green-dark)] hover:bg-[var(--page)]' : 'text-[var(--ink-3)] hover:bg-[var(--page)]'}`}>
            {i < at && <Check className="mr-1 inline h-3 w-3" strokeWidth={3} />}{j.label}
          </button>
          {i < JOURNEY.length - 1 && <ArrowRight className="h-3 w-3 text-[var(--ink-3)]" />}
        </span>
      ))}
    </nav>
  );
}

export function NextStep({ text, action, onClick }: { text: ReactNode; action: string; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-white px-4 py-3">
      <p className="text-[12.5px] leading-snug text-[var(--ink-2)]"><span className="mr-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">Next step</span>{text}</p>
      <button onClick={onClick} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--navy)] px-4 text-[12.5px] font-semibold text-white hover:opacity-95">{action}<ArrowRight className="h-3.5 w-3.5" /></button>
    </div>
  );
}
