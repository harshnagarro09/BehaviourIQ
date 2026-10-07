import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import type { TypeId } from '@/engine/behaviour';
import { TYPE_BY_ID } from '@/engine/segments';

export function Card({ children, className = '', pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`card ${pad ? 'p-4' : ''} ${className}`}>{children}</section>;
}

export function CardTitle({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[12.5px] font-semibold tracking-tight">{title}</h3>
        {sub && <p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-3)]">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Delta({ value, good }: { value: string; good: boolean | null }) {
  const up = !value.startsWith('-');
  const tone = good === null ? ['#eef1f6', 'var(--ink-2)'] : good ? ['var(--green-bg)', 'var(--green-dark)'] : ['var(--red-bg)', '#b91c1c'];
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-[1px] text-[10px] font-semibold" style={{ background: tone[0], color: tone[1] }}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {value.replace('-', '').replace('+', '')}
    </span>
  );
}

export function Kpi({
  label, value, delta, note, tone,
}: { label: string; value: ReactNode; delta?: { text: string; good: boolean | null } | null; note?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="card p-3.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">{label}</p>
      <p className="num mt-1.5 text-[22px] font-bold leading-none tracking-tight" style={{ color: tone === 'bad' ? 'var(--red)' : tone === 'good' ? 'var(--green-dark)' : 'var(--ink)' }}>{value}</p>
      <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-[var(--ink-3)]">
        {delta && <Delta value={delta.text} good={delta.good} />}
        <span className="truncate">{note}</span>
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
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-[2px] text-[10px] font-semibold" style={{ background: m[tone][0], color: m[tone][1] }}>{children}</span>;
}

export function Btn({
  children, onClick, variant = 'ghost', disabled, className = '',
}: { children: ReactNode; onClick?: () => void; variant?: 'ghost' | 'accept' | 'reject' | 'navy' | 'ai'; disabled?: boolean; className?: string }) {
  const v = {
    ghost: 'border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--page)]',
    accept: 'border border-[#a7e8c8] bg-[#d1fae5] text-[#065f46] hover:bg-[#bbf3d8]',
    reject: 'border border-[#fbc4c4] bg-[#fee2e2] text-[#b91c1c] hover:bg-[#fdd0d0]',
    navy: 'bg-[var(--navy)] text-white hover:bg-black',
    ai: 'border border-[#f5c98a] bg-[#fff7ea] text-[#b45309] hover:bg-[#ffefd2]',
  }[variant];
  return (
    <button disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`}>
      {children}
    </button>
  );
}

export function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full min-w-[120px] appearance-none rounded-md border border-[var(--line)] bg-white pl-2.5 pr-7 text-[11.5px] outline-none focus:border-[var(--navy)]"
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
        <button key={o.id} onClick={() => onChange(o.id)} className={`px-3 py-1.5 text-[11px] font-semibold ${value === o.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function TypeBadge({ type }: { type: TypeId }) {
  const t = TYPE_BY_ID[type];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium">
      <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.short}
    </span>
  );
}

export function Meter({ value, color = 'var(--green)', width = 90 }: { value: number; color?: string; width?: number }) {
  return (
    <span className="inline-block h-1.5 overflow-hidden rounded-full bg-[var(--line)] align-middle" style={{ width }}>
      <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </span>
  );
}


/** Chart / Table switch for cards that can show either */
export function ViewToggle({ value, onChange }: { value: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void }) {
  return <Toggle value={value} onChange={onChange} options={[{ id: 'chart', label: 'Chart' }, { id: 'table', label: 'Table' }]} />;
}

/**
 * A card for charts: a plain-language line saying what it shows, a short always-visible key that explains every
 * colour / axis / mark, and a collapse arrow so secondary charts can be tucked away.
 */
export function Panel({
  title, what, legend, right, children, defaultOpen = true, flush = false, className = '',
}: {
  title: ReactNode; what?: ReactNode; legend?: { label: string; text: string; color?: string }[]; right?: ReactNode;
  children: ReactNode; defaultOpen?: boolean; flush?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`card ${className}`}>
      <div className="flex flex-wrap items-start gap-2 px-4 py-3">
        <button onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'} className="mt-0.5 rounded p-0.5 text-[var(--ink-3)] hover:bg-[var(--page)]">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setOpen(!open)}>
          <h3 className="text-[12.5px] font-semibold tracking-tight">{title}</h3>
          {what && <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--ink-3)]">{what}</p>}
        </div>
        {open && right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {open && legend && legend.length > 0 && (
        <p className="mx-4 mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-snug text-[var(--ink-3)]">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-start gap-1.5">
              {l.color && <span className="mt-[3px] h-2 w-2 shrink-0 rounded-sm" style={{ background: l.color }} />}
              <span><b className="font-semibold text-[var(--ink-2)]">{l.label}:</b> {l.text}</span>
            </span>
          ))}
        </p>
      )}
      {open && <div className={flush ? '' : 'px-4 pb-4'}>{children}</div>}
    </section>
  );
}
