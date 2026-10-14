// Planning inputs: the budget field, the goal switch and the advanced settings.

import { useState, type ReactNode } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import { Help } from '@/components/Help';
import { type Objective } from '@/engine/targeting';
import { GOALS, type LimitInput, LABEL } from './shared';

// ------------------------------------------------------------------------ setup fields
export function BudgetField({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="min-w-0">
      <span className={LABEL}>Budget</span>
      <div className="flex h-10 items-center gap-3 rounded-lg border border-[var(--line)] bg-white pl-3 pr-3 focus-within:border-[var(--navy)]">
        <span className="text-[13px] font-semibold text-[var(--ink-3)]">₹</span>
        <input inputMode="numeric" aria-label="Budget in rupees" value={editing ?? value.toLocaleString('en-IN')}
          onFocus={() => setEditing(String(value))} onBlur={() => setEditing(null)}
          onChange={(ev) => { const d = ev.target.value.replace(/[^\d]/g, ''); setEditing(d); onChange(Math.min(1e8, +d || 0)); }}
          className="num w-[78px] shrink-0 bg-transparent text-[14px] font-bold outline-none" />
        <input type="range" min={0} max={max} step={500} value={Math.min(value, max)} onChange={(ev) => onChange(+ev.target.value)} className="min-w-0 flex-1 accent-[var(--navy)]" aria-label="Budget slider" />
      </div>
    </div>
  );
}

export function AimField({ value, onChange }: { value: Objective; onChange: (v: Objective) => void }) {
  const goal = GOALS.find((g) => g.id === value)!;
  return (
    <div className="min-w-0">
      <span className={`${LABEL} flex items-center gap-1`}>Goal<span title={GOALS.map((g) => g.text).join('\n')}><Info className="h-3 w-3 cursor-help" /></span></span>
      <div className="flex h-10 rounded-lg border border-[var(--line)] bg-white p-1" role="radiogroup" aria-label="Goal">
        {GOALS.map((g) => (
          <button key={g.id} role="radio" aria-checked={value === g.id} title={g.text} onClick={() => onChange(g.id)}
            className={`flex-1 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-semibold transition-colors ${value === g.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{g.label}</button>
        ))}
      </div>
      <span className="sr-only">{goal.text}</span>
    </div>
  );
}

// ------------------------------------------------------------------------ discounts & rules (opened from the setup card)
export function Rules(p: {
  hurdle: number; setHurdle: (v: number) => void;
  limitInput: LimitInput; setLimitInput: (v: LimitInput) => void; cats: string[];
  maxDepth: number | null; setMaxDepth: (v: number | null) => void;
  testedOnly: boolean; setTestedOnly: (v: boolean) => void;
  maxCoverage: number; setMaxCoverage: (v: number) => void;
  maxSubsidy: number | null; setMaxSubsidy: (v: number | null) => void;
  onReset?: () => void;
}) {
  const anyLimit = Object.values(p.limitInput).some((l) => l.min || l.max);
  const seg = <T extends string>(value: T, options: { id: T; label: string }[], onChange: (v: T) => void) => (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-white p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${value === o.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{o.label}</button>
      ))}
    </div>
  );
  return (
    <div className="mt-3 grid gap-x-8 gap-y-4 rounded-xl bg-[var(--page)] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <Field label={<>Minimum return per ₹1<Help term="hurdle" /></>} text="Only fund offers that bring back their cost plus at least this much profit for every ₹1 spent.">
          {seg(String(p.hurdle), ['0', '0.25', '0.5', '1'].map((h) => ({ id: h, label: h === '0' ? 'Break even' : `₹${h}` })), (v) => p.setHurdle(+v))}
        </Field>
        <Field label="Most of the discount that may pay for sales that happen anyway" text="Some customers would buy without the offer, so part of every discount simply pays them for that. Above this share, an offer mostly rewards existing buying instead of creating new sales and is not used. This is what keeps Sure Things out.">
          {seg(p.maxSubsidy == null ? 'none' : String(p.maxSubsidy), [{ id: '0.15', label: '15%' }, { id: '0.25', label: '25%' }, { id: '0.4', label: '40%' }, { id: 'none', label: 'No limit' }], (v) => p.setMaxSubsidy(v === 'none' ? null : +v))}
        </Field>
        <Field label="Deepest discount allowed" text="Cap how deep any offer may go (its effective % off), for example to protect the brand's price image. Offers deeper than this are not used.">
          {seg(p.maxDepth == null ? 'none' : String(p.maxDepth), [{ id: 'none', label: 'No limit' }, ...[10, 15, 20, 25].map((d) => ({ id: String(d), label: `${d}%` }))], (v) => p.setMaxDepth(v === 'none' ? null : +v))}
        </Field>
        <Field label="How much of each group to reach" text="The most of a customer group that may get the offer. Less than all of it suits a first, smaller roll-out; the plan then spends less.">
          {seg(String(p.maxCoverage), [{ id: '1', label: 'All of it' }, { id: '0.75', label: 'Up to 75%' }, { id: '0.5', label: 'Up to half' }, { id: '0.25', label: 'Up to 25%' }], (v) => p.setMaxCoverage(+v))}
        </Field>
        <label className="flex items-start gap-2.5 rounded-lg bg-white p-3 ring-1 ring-[var(--line)]">
          <input type="checkbox" checked={p.testedOnly} onChange={(ev) => p.setTestedOnly(ev.target.checked)} className="mt-0.5 accent-[var(--navy)]" />
          <span>
            <span className="block text-[12.5px] font-semibold">Only offers already run in that category</span>
            <span className="block text-[11.5px] leading-snug text-[var(--ink-3)]">Leave out promotion types never tried in a category. Their estimates rest on assumptions, so this keeps the plan to proven offers.</span>
          </span>
        </label>
        {p.onReset && <button onClick={p.onReset} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--navy)] hover:underline"><RotateCcw className="h-3 w-3" />Back to the standard settings</button>}
      </div>
      <Field label="Spending limits by category (optional)" text="Set the least and/or most the plan may spend on each product category, in ₹. Use a minimum when you have committed to spend on a category (for example a supplier deal); use a maximum to cap it. Leave a box empty for no limit.">
        <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-white">
          <table className="w-full text-[12px]">
            <thead><tr className="whitespace-nowrap text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]"><th className="px-3 py-2">Category</th><th className="px-2 py-2">Min ₹</th><th className="px-2 py-2 pr-3">Max ₹</th></tr></thead>
            <tbody>
              {p.cats.map((c) => {
                const v = p.limitInput[c] ?? { min: '', max: '' };
                const set = (k: 'min' | 'max', x: string) => p.setLimitInput({ ...p.limitInput, [c]: { ...v, [k]: x } });
                return (
                  <tr key={c} className="border-t border-[var(--line-2)]">
                    <td className="whitespace-nowrap px-3 py-1 font-medium">{c}</td>
                    {(['min', 'max'] as const).map((k) => (
                      <td key={k} className={`py-1 ${k === 'min' ? 'px-2' : 'px-2 pr-3'}`}>
                        <input type="number" min={0} step={500} placeholder="–" value={v[k]} onChange={(ev) => set(k, ev.target.value)} aria-label={`${k === 'min' ? 'Minimum' : 'Maximum'} for ${c}`}
                          className="num h-7 w-full min-w-[72px] rounded-md border border-[var(--line)] bg-white px-2 text-[12px] outline-none focus:border-[var(--navy)]" />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {anyLimit && <button onClick={() => p.setLimitInput({})} className="mt-2 text-[12px] font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]">Clear limits</button>}
      </Field>
    </div>
  );
}

function Field({ label, text, children }: { label: ReactNode; text: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-semibold">{label}</p>
      <p className="mb-1.5 mt-0.5 text-[11.5px] leading-snug text-[var(--ink-3)]">{text}</p>
      {children}
    </div>
  );
}
