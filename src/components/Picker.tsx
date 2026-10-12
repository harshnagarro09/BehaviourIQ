import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface PickOption {
  value: string;
  label: string;
  hint?: string; // short grey text on the right (a count, a category)
  group?: string; // options with the same group are listed under one heading
}

/**
 * A friendlier dropdown than the native <select>: shows the current choice with a short hint, opens a list with optional
 * search and group headings, and marks the current choice. Closes on outside click, Escape or a pick.
 */
export function Picker({ label, value, options, onChange, searchable = options.length > 8, placeholder = 'Search', active = false }: {
  label: string; value: string; options: PickOption[]; onChange: (v: string) => void; searchable?: boolean; placeholder?: string;
  active?: boolean; // shows the picker as a filter that is switched on
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(t)) : options;
  }, [options, q]);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };

  let lastGroup: string | undefined;
  return (
    <div ref={box} className="relative min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">{label}</span>
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} title={current?.label}
        className={`flex h-10 w-full items-center gap-2 rounded-lg border px-3 text-left transition-colors hover:border-[var(--ink-3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navy)] ${open || active ? 'border-[var(--navy)]' : 'border-[var(--line)]'} ${active ? 'bg-[#eef3fa]' : 'bg-white'}`}>
        <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${active ? 'text-[var(--navy)]' : 'text-[var(--ink)]'}`}>{current?.label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--ink-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-full min-w-[240px] max-w-[380px] rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-[0_12px_32px_rgba(11,28,47,0.14)]" role="listbox" aria-label={label}>
          {searchable && (
            <div className="mb-1 flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 focus-within:border-[var(--navy)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
              <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={placeholder}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && shown[0]) pick(shown[0].value); }}
                className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
            </div>
          )}
          <div className="max-h-[300px] overflow-y-auto">
            {shown.map((o, i) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const on = o.value === value;
              return (
                <div key={o.value}>
                  {heading && <p className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">{heading}</p>}
                  <button type="button" role="option" aria-selected={on} onClick={() => pick(o.value)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] ${on ? 'bg-[#eef3fa] font-semibold text-[var(--navy)]' : 'text-[var(--ink)] hover:bg-[var(--page)]'}`}>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-[11px] text-[var(--ink-3)]">{o.hint}</span>}
                    <Check className={`h-3.5 w-3.5 shrink-0 ${on ? 'opacity-100' : 'opacity-0'}`} />
                  </button>
                  {o.value === 'all' && i < shown.length - 1 && <div className="mx-2 my-1 border-t border-[var(--line-2)]" />}
                </div>
              );
            })}
            {!shown.length && <p className="px-2.5 py-3 text-[12px] text-[var(--ink-3)]">Nothing matches "{q}".</p>}
          </div>
        </div>
      )}
    </div>
  );
}
