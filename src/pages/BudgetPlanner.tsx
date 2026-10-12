// Plan the budget: where a promotion budget should go across brands, categories and SKUs, and why.
// Engine: decisions per customer type x category (engine/optimizer.ts, exact knapsack with optional category limits), scaled to
// the products picked and split down to SKUs by regular-sales share (engine/budgetScope.ts). See docs/Behaviour driven budget optimization.md.
// Layout: one compact toolbar (products, budget, aim, rules), then two columns: the allocation with its reasons on the left
// and a sticky summary (spend, expected result, comparison, download) on the right; secondary analysis folds away below.
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Download, Info, RotateCcw, Scale, SlidersHorizontal, TrendingUp, Users } from 'lucide-react';
import { useEngine } from '@/state';
import { Help } from '@/components/Help';
import { Chip, SourceChip } from '@/components/ui';
import { Frontier, GroupedBars } from '@/components/charts';
import { useProductFilter } from '@/components/ProductScope';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import { FAMILY_LABEL, type Family } from '@/engine/promotions';
import type { Objective } from '@/engine/targeting';
import { activation, optimise, type OptSettings, type Plan, type SpendLimit } from '@/engine/optimizer';
import {
  explainPlan, pastPractice, PLAIN_TYPE, rangeItems, rangeShares, rollDown, unallocated,
  type CategoryAdvice, type CategoryStatus, type PastPlan, type SkuAllocation,
} from '@/engine/budgetScope';
import { skuCatalog, type Sku } from '@/engine/products';
import { predictionFor } from '@/lib/targeting';
import { saveFile, toCsv, toXlsx } from '@/lib/download';
import { inr, int, pct } from '@/lib/fmt';

const FAMILIES: Family[] = ['price', 'threshold', 'volume', 'bundle', 'loyalty', 'partner'];
const DEFAULT_FAMILIES: Family[] = ['price', 'threshold', 'volume', 'bundle', 'loyalty'];
const GOALS: { id: Objective; label: string; text: string }[] = [
  { id: 'margin', label: 'Profit', text: 'Most profit: puts money where it adds the most margin after paying for the offer.' },
  { id: 'revenue', label: 'Sales', text: 'Most sales: puts money where it adds the most sales. Extra sales can come with thinner margin.' },
  { id: 'buyers', label: 'Buyers', text: 'Most buyers: puts money where it wins the most extra buyers. More buyers is not always more profit.' },
];
const STATUS: Record<CategoryStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  funded: { label: 'Funded', tone: 'green' },
  capped: { label: 'At your limit', tone: 'amber' },
  raised: { label: 'Raised to minimum', tone: 'amber' },
  outranked: { label: 'Not funded', tone: 'neutral' },
  'no-payback': { label: "Doesn't pay off", tone: 'red' },
  'min-unmet': { label: 'Minimum not reachable', tone: 'red' },
};
const per1 = (roi: number) => `₹${roi.toFixed(2)}`;
type LimitInput = Record<string, { min: string; max: string }>;
const num = (s: string) => (s.trim() === '' || !Number.isFinite(+s) || +s < 0 ? null : +s);
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]';

export function BudgetView() {
  const e = useEngine();
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const { picked, label: rangeLabel, pickers, isAll, reset } = useProductFilter(catalog);
  const range = useMemo(() => picked.filter((s) => s.share > 0), [picked]);
  const rangeKey = range.map((s) => s.productId).join('|');
  const noRegular = picked.length > 0 && range.length === 0;

  const [budget, setBudget] = useState(30000);
  const [objective, setObjective] = useState<Objective>('margin');
  const [hurdle, setHurdle] = useState(0.25);
  const [holdout, setHoldout] = useState(0.1);
  const [includeDogs, setIncludeDogs] = useState(false);
  const [families, setFamilies] = useState<Set<Family>>(new Set(DEFAULT_FAMILIES));
  const [limitInput, setLimitInput] = useState<LimitInput>({});
  const [rulesOpen, setRulesOpen] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- rangeKey is the identity of range
  const items = useMemo(() => rangeItems(range, (c) => predictionFor(e, c)), [e, rangeKey]);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const limits = useMemo(() => {
    const out: Record<string, SpendLimit> = {};
    for (const c of cats) { const l = limitInput[c]; if (!l) continue; const min = num(l.min), max = num(l.max); if (min || max != null) out[c] = { min, max }; }
    return out;
  }, [limitInput, cats]);
  const limitCount = Object.keys(limits).length;
  const settings: OptSettings = useMemo(() => ({ budget, objective, hurdle, holdout, includeExcluded: includeDogs, allowed: (p) => families.has(p.family), limits: limitCount ? limits : undefined }),
    [budget, objective, hurdle, holdout, includeDogs, families, limits, limitCount]);
  const plan = useMemo(() => optimise(items, settings), [items, settings]);
  const free = useMemo(() => (limitCount ? optimise(items, { ...settings, limits: undefined }) : null), [items, settings, limitCount]);
  const advice = useMemo(() => explainPlan(plan, free, items), [plan, free, items]);
  const bau = useMemo(() => pastPractice(e.results, items, range, budget), [e, items, range, budget]);
  const skuRows = useMemo(() => rollDown(plan, range), [plan, range]);
  const left = unallocated(plan, free);
  const reached = useMemo(() => new Set(activation(plan).filter((r) => r.group === 'treatment').map((r) => r.cid)).size, [plan]);
  const sliderMax = Math.max(20000, Math.ceil(Math.max((free ?? plan).recommendedBudget * 1.5, budget * 1.2) / 5000) * 5000);
  const shares = rangeShares(range);
  const changedRules = [hurdle !== 0.25, holdout !== 0.1, includeDogs, families.size !== DEFAULT_FAMILIES.length || !DEFAULT_FAMILIES.every((f) => families.has(f))].filter(Boolean).length + limitCount;

  const exportPlan = (kind: 'xlsx' | 'csv') => {
    const head = ['Brand', 'Category', 'SKU id', 'SKU', 'Customer type', 'Offer', 'Share of group offered', 'Budget (Rs)', 'Expected extra sales (Rs)', 'Expected extra margin (Rs)', 'Return per Rs 1 (ROI)', 'Why'];
    const why = new Map(advice.map((a) => [a.category, a.headline]));
    const rows = skuRows.map((r) => {
      const a = plan.allocations.find((x) => x.item.category === r.sku.category && x.item.type === r.type);
      return [r.sku.brand, r.sku.category, r.sku.productId, r.sku.product, TYPE_BY_ID[r.type].name, r.offer, a ? pct(a.coverage) : '', Math.round(r.spend), Math.round(r.incRevenue), Math.round(r.incMargin), r.spend > 0 ? +(r.incMargin / r.spend).toFixed(2) : 0, why.get(r.sku.category) ?? ''];
    });
    if (kind === 'csv') saveFile('promotion_budget_plan.csv', toCsv(head, rows), 'text/csv;charset=utf-8');
    else saveFile('promotion_budget_plan.xlsx', toXlsx(head, rows, 'Budget plan'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const exportAudience = () => saveFile('campaign_customer_list.csv', toCsv(['customer_id', 'customer_type', 'category', 'products', 'offer', 'group'],
    activation(plan).map((r) => [r.cid, TYPE_BY_ID[r.type].name, r.category, rangeLabel, r.offer, r.group])), 'text/csv;charset=utf-8');

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ one compact toolbar */}
      <section className="card p-4">
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.45fr)_auto]">
          {pickers[0]}{pickers[1]}{pickers[2]}
          <BudgetField value={budget} onChange={setBudget} max={sliderMax} />
          <AimField value={objective} onChange={setObjective} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line-2)] pt-3 text-[12px] text-[var(--ink-3)]">
          {noRegular
            ? <span className="font-medium text-[var(--red)]">This product has no regular (non-promotion) sales in the data, so its share of a promotion can't be estimated. Please pick another.</span>
            : <span title={range.length < catalog.length ? [...shares].map(([c, s]) => `${pct(s)} of ${c} regular sales`).join(', ') : undefined}>
                <b className="font-semibold text-[var(--ink-2)]">{int(range.length)}</b> product{range.length === 1 ? '' : 's'} in <b className="font-semibold text-[var(--ink-2)]">{cats.length}</b> categor{cats.length === 1 ? 'y' : 'ies'}
              </span>}
          {!isAll && <button onClick={reset} className="inline-flex items-center gap-1 font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]"><RotateCcw className="h-3 w-3" />All products</button>}
          {!noRegular && <span className="hidden h-3 w-px bg-[var(--line)] sm:inline-block" />}
          {!noRegular && (
            <span>Returns level off at about{' '}
              <button className="font-semibold text-[var(--ink-2)] underline decoration-dotted underline-offset-2 hover:text-[var(--ink)]" onClick={() => setBudget(Math.max(500, Math.round(plan.recommendedBudget / 500) * 500))} title="Set the budget to this amount">{inr(plan.recommendedBudget)}</button>
            </span>
          )}
          <button onClick={() => setRulesOpen(!rulesOpen)} aria-expanded={rulesOpen}
            className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold ${rulesOpen ? 'border-[var(--navy)] bg-[#eef3fa] text-[var(--navy)]' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />Spending rules
            {changedRules > 0 && <span className="rounded-full bg-[var(--navy)] px-1.5 text-[10.5px] text-white">{changedRules}</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rulesOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {rulesOpen && <Rules {...{ hurdle, setHurdle, holdout, setHoldout, families, setFamilies, includeDogs, setIncludeDogs, limitInput, setLimitInput, cats, advice }} />}
      </section>

      {noRegular || !items.length ? null : (
        <>
          {/* the two cards share one row and one height, so nothing is left empty beside them */}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 xl:col-start-1 xl:row-start-1"><Allocation plan={plan} advice={advice} range={range} rows={skuRows} /></div>
            <div className="min-w-0 xl:col-start-2 xl:row-start-1">
              <Summary plan={plan} budget={budget} bau={bau} left={left} reached={reached} advice={advice} onExport={exportPlan} onAudience={exportAudience} />
            </div>
          </div>
          <Details plan={plan} bau={bau} advice={advice} budget={budget} objective={objective} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------ toolbar fields
function BudgetField({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) {
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

function AimField({ value, onChange }: { value: Objective; onChange: (v: Objective) => void }) {
  const goal = GOALS.find((g) => g.id === value)!;
  return (
    <div className="min-w-0">
      <span className={`${LABEL} flex items-center gap-1`}>Aim for<span title={GOALS.map((g) => g.text).join('\n')}><Info className="h-3 w-3 cursor-help" /></span></span>
      <div className="flex h-10 rounded-lg border border-[var(--line)] bg-white p-1" role="radiogroup" aria-label="Aim for">
        {GOALS.map((g) => (
          <button key={g.id} role="radio" aria-checked={value === g.id} title={g.text} onClick={() => onChange(g.id)}
            className={`flex-1 rounded-md px-3 text-[12.5px] font-semibold transition-colors ${value === g.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{g.label}</button>
        ))}
      </div>
      <span className="sr-only">{goal.text}</span>
    </div>
  );
}

// ------------------------------------------------------------------------ spending rules (opened from the toolbar)
function Rules(p: {
  hurdle: number; setHurdle: (v: number) => void; holdout: number; setHoldout: (v: number) => void; families: Set<Family>; setFamilies: (v: Set<Family>) => void;
  includeDogs: boolean; setIncludeDogs: (v: boolean) => void; limitInput: LimitInput; setLimitInput: (v: LimitInput) => void; cats: string[]; advice: CategoryAdvice[];
}) {
  const toggleFamily = (f: Family) => { const n = new Set(p.families); if (n.has(f)) n.delete(f); else n.add(f); p.setFamilies(n); };
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
        <Field label={<>Minimum return<Help term="hurdle" /></>} text="Only fund offers that bring back their cost plus at least this much margin per ₹1.">
          {seg(String(p.hurdle), ['0', '0.25', '0.5', '1'].map((h) => ({ id: h, label: h === '0' ? 'Break even' : `₹${h}` })), (v) => p.setHurdle(+v))}
        </Field>
        <Field label={<>Hold back to measure<Help term="holdout" /></>} text="A random few in each group get no offer, so the real effect can be proven.">
          {seg(String(p.holdout), [0, 0.05, 0.1, 0.2].map((h) => ({ id: String(h), label: h ? pct(h) : 'None' })), (v) => p.setHoldout(+v))}
        </Field>
        <Field label="Promotion types you can run" text="Switch off any type you cannot run.">
          <div className="flex flex-wrap gap-1.5">
            {FAMILIES.map((f) => (
              <button key={f} onClick={() => toggleFamily(f)} aria-pressed={p.families.has(f)} className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${p.families.has(f) ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[var(--line)] bg-white text-[var(--ink-3)]'}`}>{FAMILY_LABEL[f]}</button>
            ))}
          </div>
        </Field>
        <label className="flex items-start gap-2 text-[12px] text-[var(--ink-2)]"><input type="checkbox" checked={p.includeDogs} onChange={(ev) => p.setIncludeDogs(ev.target.checked)} className="mt-0.5 accent-[var(--navy)]" />Also send offers to shoppers who are put off by them (not recommended)</label>
      </div>
      <Field label="Category limits (optional)" text="A minimum (for example a supplier commitment) or a maximum, in ₹.">
        <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-white">
          <table className="w-full text-[12px]">
            <thead><tr className="whitespace-nowrap text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]"><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">In plan</th><th className="px-2 py-2">Min ₹</th><th className="px-2 py-2 pr-3">Max ₹</th></tr></thead>
            <tbody>
              {p.cats.map((c) => {
                const v = p.limitInput[c] ?? { min: '', max: '' };
                const set = (k: 'min' | 'max', x: string) => p.setLimitInput({ ...p.limitInput, [c]: { ...v, [k]: x } });
                return (
                  <tr key={c} className="border-t border-[var(--line-2)]">
                    <td className="whitespace-nowrap px-3 py-1 font-medium">{c}</td>
                    <td className="num px-3 py-1 text-right text-[var(--ink-3)]">{inr(p.advice.find((a) => a.category === c)?.spend ?? 0)}</td>
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

// ------------------------------------------------------------------------ sticky summary
function Summary({ plan, budget, bau, left, reached, advice, onExport, onAudience }: {
  plan: Plan; budget: number; bau: PastPlan; left: { amount: number; text: string }; reached: number; advice: CategoryAdvice[];
  onExport: (k: 'xlsx' | 'csv') => void; onAudience: () => void;
}) {
  const funded = advice.filter((a) => a.spend > 0).length;
  const used = budget > 0 ? Math.min(1, plan.spend / budget) : 0;
  const gain = plan.incMargin - bau.incMargin;
  const pastAll = bau.rows.reduce((t, r) => t + r.pastSpend, 0);
  const pastRoi = pastAll > 0 ? bau.rows.reduce((t, r) => t + r.pastRoi * r.pastSpend, 0) / pastAll : 0;
  const none = !plan.allocations.length;
  return (
    <section className="card flex h-full flex-col overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">Recommended spend</p>
          <span title="Expected results are estimates from each customer's past behaviour, for the next offer window"><SourceChip kind="simulated" /></span>
        </div>
        <p className="mt-1.5 leading-none"><span className="num text-[28px] font-bold tracking-tight">{inr(plan.spend)}</span> <span className="text-[13px] font-semibold text-[var(--ink-3)]">of {inr(budget)}</span></p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--line-2)]"><div className="h-full rounded-full bg-[var(--navy)]" style={{ width: `${used * 100}%` }} /></div>
        <p className="mt-2 text-[12px] text-[var(--ink-2)]">{none ? 'Nothing pays off with these rules.' : `${plan.allocations.length} offer${plan.allocations.length > 1 ? 's' : ''} · ${funded} categor${funded === 1 ? 'y' : 'ies'} · ${int(reached)} customers`}</p>
        {left.amount > budget * 0.01 && !none && <p className="mt-2 rounded-lg bg-[var(--page)] px-3 py-2 text-[11.5px] leading-snug text-[var(--ink-2)]"><b>{inr(left.amount)} kept back.</b> {left.text}</p>}
        {none && <p className="mt-2 text-[11.5px] leading-snug text-[var(--ink-3)]">Try a lower minimum return in Spending rules, allow more promotion types, or pick other products.</p>}
      </div>

      {!none && (
        <>
          <div className="flex flex-1 flex-col justify-center space-y-2.5 border-t border-[var(--line)] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] text-[var(--ink-2)]">Extra sales<Help term="incRevenue" /></span>
              <span className="num text-[16px] font-bold">{inr(plan.incRevenue)}</span>
            </div>
            <div className="rounded-xl bg-[var(--green-bg)] px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-[var(--green-dark)]">Extra margin<Help term="incMargin" /></span>
                <span className="num text-[20px] font-bold text-[var(--green-dark)]">{inr(plan.incMargin)}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-[var(--green-dark)]">{per1(plan.roi)} back on top of every ₹1 spent</p>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center border-t border-[var(--line)] p-4">
            <p className="flex items-center gap-1 text-[12px] font-semibold text-[var(--ink-2)]">
              Compared with the usual way
              <span title={`The usual way: the same budget split across categories like past promotion spend, with each category's usual offer sent to every customer. Both are estimated with the same rules. Past promotions here actually returned ${per1(pastRoi)} on top of every ₹1.`}><Info className="h-3 w-3 cursor-help text-[var(--ink-3)]" /></span>
            </p>
            <div className="mt-2 space-y-1.5 text-[12px]">
              {([['Extra margin', inr(bau.incMargin), inr(plan.incMargin)], ['Back per ₹1', per1(bau.roi), per1(plan.roi)]] as const).map(([k, a, b]) => (
                <div key={k} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                  <span className="text-[var(--ink-3)]">{k}</span>
                  <span className="num text-[var(--ink-3)]">{a}</span><span className="text-[var(--ink-3)]">→</span><span className="num font-bold">{b}</span>
                </div>
              ))}
            </div>
            {gain > 0 && <p className="mt-2 text-[12px] font-semibold text-[var(--green-dark)]">+{inr(gain)} more margin</p>}
          </div>

          <div className="border-t border-[var(--line)] p-4"><DownloadMenu onExport={onExport} onAudience={onAudience} /></div>
        </>
      )}
    </section>
  );
}

function DownloadMenu({ onExport, onAudience }: { onExport: (k: 'xlsx' | 'csv') => void; onAudience: () => void }) {
  const [open, setOpen] = useState(false);
  const item = (label: string, sub: string, run: () => void) => (
    <button onClick={() => { run(); setOpen(false); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--page)]">
      <span className="block text-[12.5px] font-semibold">{label}</span><span className="block text-[11.5px] text-[var(--ink-3)]">{sub}</span>
    </button>
  );
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(!open)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--navy)] px-3 text-[12.5px] font-semibold text-white hover:opacity-95">
        <Download className="h-3.5 w-3.5" />Download the plan<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute inset-x-0 bottom-full z-20 pb-1">
          <div className="rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-lg">
            {item('Plan (Excel)', 'Budget per brand, category and product, with reasons', () => onExport('xlsx'))}
            {item('Plan (CSV)', 'The same plan as a CSV file', () => onExport('csv'))}
            {item('Customer list (CSV)', 'Who gets which offer, and who is held back', onAudience)}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------ the allocation (main focus)
function Allocation({ plan, advice, range, rows }: { plan: Plan; advice: CategoryAdvice[]; range: Sku[]; rows: SkuAllocation[] }) {
  const [view, setView] = useState<'category' | 'brand'>('category');
  const multiBrand = new Set(range.map((s) => s.brand)).size > 1;
  const issues = plan.limitIssues.filter((x) => x.kind !== 'max-binding');
  const untested = plan.allocations.filter((a) => !a.cell.history).length;
  return (
    <section className="card h-full overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-[14.5px] font-bold tracking-tight">Where the money goes</h2>
          <p className="text-[12px] text-[var(--ink-3)]">{view === 'category' ? 'Click a category to see who gets the offer and how it splits across products.' : 'Click a row to open it. Every level adds up to the plan.'}</p>
        </div>
        {multiBrand && (
          <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5">
            {(['category', 'brand'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${view === v ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>By {v}</button>
            ))}
          </div>
        )}
      </div>
      {(issues.length > 0 || untested > 0) && (
        <ul className="space-y-1.5 px-4 pb-3">
          {issues.map((x, i) => (
            <Note key={i}>{x.kind === 'mins-over-budget'
              ? `Your category minimums add up to ${inr(x.limit)}, more than the ${inr(x.possible)} budget, so they were set aside.`
              : `${x.category}: your minimum of ${inr(x.limit)} can't be reached. Only ${inr(x.possible)} of offers there pay off.`}</Note>
          ))}
          {untested > 0 && <Note>{untested} offer{untested === 1 ? ' has' : 's have'} never run in {untested === 1 ? 'its category' : 'their categories'}. The plan counts only three quarters of the expected effect; try {untested === 1 ? 'it' : 'them'} on a small group first.</Note>}
        </ul>
      )}
      {view === 'category' ? <CategoryList advice={advice} total={plan.spend} range={range} rows={rows} /> : <BrandTable range={range} rows={rows} total={plan.spend} />}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-lg bg-[#fef3c7] px-3 py-2 text-[12px] leading-snug text-[#92400e]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{children}</span>
    </li>
  );
}

/** One compact row per category: share bar, amount and the reason; open it for customer types and products */
function CategoryList({ advice, total, range, rows }: { advice: CategoryAdvice[]; total: number; range: Sku[]; rows: SkuAllocation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...advice].sort((a, b) => b.spend - a.spend || a.category.localeCompare(b.category));
  return (
    <ul className="divide-y divide-[var(--line-2)] border-t border-[var(--line)]">
      {sorted.map((a) => {
        const isOpen = open === a.category;
        const share = total ? a.spend / total : 0;
        const off = a.spend <= 0;
        return (
          <li key={a.category}>
            <button onClick={() => setOpen(isOpen ? null : a.category)} aria-expanded={isOpen}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-[var(--page)] md:grid-cols-[150px_minmax(0,1fr)_88px] ${isOpen ? 'bg-[var(--page)]' : ''}`}>
              <span className="flex min-w-0 items-center gap-2">
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--ink-3)] transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                <span className={`truncate text-[13px] font-semibold ${off ? 'text-[var(--ink-3)]' : ''}`}>{a.category}</span>
              </span>
              <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
                <span className="flex items-center gap-2.5">
                  {off ? <Chip tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Chip> : (
                    <>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--line-2)]"><span className="block h-full rounded-full bg-[var(--navy)]" style={{ width: `${Math.max(1.5, share * 100)}%` }} /></span>
                      <span className="num w-9 shrink-0 text-right text-[11.5px] text-[var(--ink-3)]">{pct(share)}</span>
                      {a.status !== 'funded' && <Chip tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Chip>}
                    </>
                  )}
                </span>
                <span className="mt-1 block text-[12px] leading-snug text-[var(--ink-2)]">{a.headline}</span>
              </span>
              <span className={`num row-start-1 text-right text-[14px] font-bold md:row-start-auto ${off ? 'text-[var(--ink-3)]' : ''}`}>{inr(a.spend)}</span>
            </button>
            {isOpen && (
              <div className="grid gap-4 bg-[var(--page)] px-4 pb-4 pl-10 lg:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Who gets an offer</p>
                  <ul className="space-y-1.5">
                    {a.types.map((t) => (
                      <li key={t.type} className="flex items-start gap-2 text-[12px] leading-snug">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_BY_ID[t.type].color, opacity: t.funded ? 1 : 0.35 }} />
                        <span><b title={TYPE_BY_ID[t.type].name} className="cursor-help font-semibold">{PLAIN_TYPE[t.type][0].toUpperCase() + PLAIN_TYPE[t.type].slice(1)}</b>: <span className="text-[var(--ink-2)]">{t.text}</span></span>
                      </li>
                    ))}
                  </ul>
                  {a.points.map((p) => <p key={p} className="mt-2.5 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[11.5px] leading-snug text-[var(--ink-2)]"><b>More buyers is not always more profit.</b> {p}</p>)}
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Products</p>
                  <SkuTable skus={range.filter((s) => s.category === a.category)} rows={rows} />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** the products of one category, sharing its money by their share of regular sales */
function SkuTable({ skus, rows }: { skus: Sku[]; rows: SkuAllocation[] }) {
  const tot = skus.reduce((t, s) => t + s.share, 0);
  const sum = (id: string, f: (r: SkuAllocation) => number) => rows.filter((r) => r.sku.productId === id).reduce((t, r) => t + f(r), 0);
  const list = [...skus].sort((a, b) => b.share - a.share);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-white">
      <table className="w-full text-[12px]">
        <thead><tr className="text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]"><th className="px-3 py-1.5 text-left">Product</th><th className="px-3 py-1.5" title="Share of the category's regular sales among the products you picked; each product gets this share of the category's money">Sales share</th><th className="px-3 py-1.5">Budget</th><th className="px-3 py-1.5">Extra margin</th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.productId} className="border-t border-[var(--line-2)] text-right">
              <td className="px-3 py-1.5 text-left font-medium">{s.product}</td>
              <td className="num px-3 py-1.5 text-[var(--ink-3)]">{pct(tot ? s.share / tot : 0)}</td>
              <td className="num px-3 py-1.5 font-semibold">{inr(sum(s.productId, (r) => r.spend))}</td>
              <td className="num px-3 py-1.5">{inr(sum(s.productId, (r) => r.incMargin))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** brand -> category -> product roll-up; every level adds up to the plan */
function BrandTable({ range, rows, total }: { range: Sku[]; rows: SkuAllocation[]; total: number }) {
  type Node = { key: string; label: string; depth: number; spend: number; margin: number; children: Node[] };
  const tree = useMemo(() => {
    const top = new Map<string, Node>();
    const mk = (key: string, label: string, depth: number): Node => ({ key, label, depth, spend: 0, margin: 0, children: [] });
    for (const s of range) {
      let b = top.get(s.brand);
      if (!b) top.set(s.brand, (b = mk(`b:${s.brand}`, s.brand, 0)));
      let c = b.children.find((x) => x.label === s.category);
      if (!c) b.children.push((c = mk(`c:${s.brand}|${s.category}`, s.category, 1)));
      const p = mk(`s:${s.productId}`, s.product, 2);
      c.children.push(p);
      for (const r of rows) if (r.sku.productId === s.productId) for (const n of [b, c, p]) { n.spend += r.spend; n.margin += r.incMargin; }
    }
    const sort = (ns: Node[]): Node[] => ns.sort((a, b) => b.spend - a.spend || a.label.localeCompare(b.label)).map((n) => ({ ...n, children: sort(n.children) }));
    return sort([...top.values()]);
  }, [range, rows]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const visible: Node[] = [];
  const walk = (ns: Node[]) => { for (const n of ns) { visible.push(n); if (open.has(n.key)) walk(n.children); } };
  walk(tree);
  const toggle = (k: string) => { const n = new Set(open); if (n.has(k)) n.delete(k); else n.add(k); setOpen(n); };
  return (
    <div className="overflow-x-auto border-t border-[var(--line)]">
      <table className="w-full min-w-[520px] text-[12.5px]">
        <thead><tr className="border-b border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
          <th className="px-4 py-2 text-left">Brand / category / product</th><th className="px-3 py-2">Share</th><th className="px-3 py-2">Budget</th><th className="px-4 py-2">Extra margin</th>
        </tr></thead>
        <tbody>
          {visible.map((n) => {
            const share = total ? n.spend / total : 0;
            return (
              <tr key={n.key} onClick={n.children.length ? () => toggle(n.key) : undefined} className={`border-b border-[var(--line-2)] text-right last:border-0 ${n.children.length ? 'cursor-pointer hover:bg-[var(--page)]' : ''}`}>
                <td className="px-4 py-2 text-left">
                  <span className="inline-flex items-center gap-1.5" style={{ paddingLeft: n.depth * 18 }}>
                    {n.children.length ? <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--ink-3)] transition-transform ${open.has(n.key) ? '' : '-rotate-90'}`} /> : <span className="w-3.5 shrink-0" />}
                    <span className={n.depth === 0 ? 'font-bold' : n.depth === 1 ? 'font-semibold' : ''}>{n.label}</span>
                  </span>
                </td>
                <td className="px-3"><span className="inline-flex items-center justify-end gap-2"><span className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--line-2)]"><span className="block h-full rounded-full bg-[var(--navy)]" style={{ width: `${share * 100}%` }} /></span><span className="num w-9">{pct(share)}</span></span></td>
                <td className="num px-3 font-semibold">{inr(n.spend)}</td>
                <td className="num px-4">{inr(n.margin)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------ more details (tabs)
function Details({ plan, bau, advice, budget, objective }: { plan: Plan; bau: PastPlan; advice: CategoryAdvice[]; budget: number; objective: Objective }) {
  const [open, setOpen] = useState('compare');
  const sections: { id: string; tab: string; icon: ReactNode; title: ReactNode; what: string; badge?: ReactNode; body: ReactNode }[] = [
    { id: 'compare', tab: 'Usual way vs plan', icon: <Scale className="h-4 w-4" />, title: 'Usual way vs recommended, by category', what: 'How the same budget would be split the usual way, and where the plan moves it.', body: <CompareByCategory plan={plan} bau={bau} advice={advice} /> },
    { id: 'types', tab: 'Who gets offers', icon: <Users className="h-4 w-4" />, title: 'Which customers get the offers', what: 'Offers go to the customers they change. Those who buy anyway, or never, get little or nothing.', body: <ByType plan={plan} /> },
    {
      id: 'frontier', tab: 'Bigger budget?', icon: <TrendingUp className="h-4 w-4" />, title: <>Is a bigger budget worth it?<Help term="frontier" /></>, what: 'The best result at every budget. Where the line flattens, more money adds little.',
      body: (
        <>
          <Frontier height={210} points={plan.frontier.map((p) => ({ x: p.budget, y: p.value }))} xFormat={(v) => inr(v, 0)} yFormat={(v) => (objective === 'buyers' ? int(v) : inr(v, 0))}
            yLabel={objective === 'margin' ? 'Extra margin' : objective === 'revenue' ? 'Extra sales' : 'Extra buyers'}
            marks={[{ x: Math.min(budget, plan.frontier[plan.frontier.length - 1]?.budget ?? budget), label: 'Your budget', color: 'var(--navy)' }, { x: plan.recommendedBudget, label: 'Returns level off', color: 'var(--green)' }]} />
          {objective === 'margin' && <p className="mt-2 text-[12px] text-[var(--ink-2)]">At your budget, another ₹1,000 would add about <b>{inr(Math.max(0, plan.nextRupee) * 1000)}</b> of extra margin.</p>}
        </>
      ),
    },
  ];
  const cur = sections.find((x) => x.id === open) ?? sections[0];
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5">
        <h2 className="text-[14.5px] font-bold tracking-tight">More details</h2>
        <span className="text-[12px] text-[var(--ink-3)]">Pick a topic</span>
      </div>
      <div role="tablist" className="grid grid-cols-1 gap-2 px-4 pb-3 pt-2 sm:grid-cols-3">
        {sections.map((x) => {
          const on = cur.id === x.id;
          return (
            <button key={x.id} role="tab" aria-selected={on} onClick={() => setOpen(x.id)}
              className={`flex h-[58px] flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center transition-colors ${on ? 'border-[var(--navy)] bg-[var(--navy)] text-white shadow-sm' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)] hover:bg-[var(--page)]'}`}>
              {x.icon}
              <span className="text-[11.5px] font-semibold leading-tight">{x.tab}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="border-t border-[var(--line)] bg-[var(--page)]/50 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold">{cur.title}</h3>
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-3)]">{cur.what}</p>
          </div>
          {cur.badge}
        </div>
        {cur.body}
      </div>
    </section>
  );
}

function CompareByCategory({ plan, bau, advice }: { plan: Plan; bau: PastPlan; advice: CategoryAdvice[] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rec = new Map(advice.map((a) => [a.category, a.spend]));
  const recOffers = (c: string) => [...new Set(plan.allocations.filter((a) => a.item.category === c).map((a) => a.cell.promo.label))].join(', ') || '–';
  const rows = bau.rows.map((r) => ({ ...r, rec: rec.get(r.category) ?? 0 })).sort((a, b) => b.rec - a.rec);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex gap-4 text-[11.5px] text-[var(--ink-3)]"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#94a3b8]" />Usual way</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[var(--navy)]" />Recommended</span></p>
        <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5">
          {(['chart', 'table'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold capitalize ${view === v ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)]'}`}>{v}</button>)}
        </div>
      </div>
      {view === 'chart'
        ? <GroupedBars height={200} format={(v) => inr(v, 0)} series={[{ label: 'Usual way', color: '#94a3b8' }, { label: 'Recommended', color: 'var(--navy)' }]} groups={rows.map((r) => ({ label: r.category, values: [r.spend, r.rec] }))} />
        : (
          <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
            <table className="w-full min-w-[600px] text-[12px]">
              <thead><tr className="bg-[var(--page)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                {['Category', 'Usual offer', 'Usual budget', 'Recommended', 'Change', 'Recommended offer'].map((h, i) => <th key={h} className={`px-3 py-2 ${i === 0 || i === 1 || i === 5 ? 'text-left' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.rec - r.spend;
                  return (
                    <tr key={r.category} className="border-t border-[var(--line-2)] text-right">
                      <td className="px-3 py-1.5 text-left font-semibold">{r.category}</td>
                      <td className="px-3 text-left text-[var(--ink-2)]" title={`Past campaigns here actually returned ${per1(r.pastRoi)} on top of every ₹1`}>{r.offer}</td>
                      <td className="num px-3">{inr(r.spend)}</td>
                      <td className="num px-3 font-semibold">{inr(r.rec)}</td>
                      <td className="num px-3 font-semibold" style={{ color: d >= 0 ? 'var(--green-dark)' : 'var(--red)' }}>{d >= 0 ? '+' : '−'}{inr(Math.abs(d))}</td>
                      <td className="max-w-[170px] truncate px-3 text-left text-[var(--ink-2)]" title={recOffers(r.category)}>{recOffers(r.category)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function ByType({ plan }: { plan: Plan }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {TYPES.map((t) => {
        const rows = plan.allocations.filter((a) => a.item.type === t.id);
        const spend = rows.reduce((s, a) => s + a.spend, 0);
        return (
          <div key={t.id} className="rounded-lg border border-[var(--line)] p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex items-center gap-2 text-[13px] font-bold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.name}</p>
              <p className="num text-[12.5px] font-bold">{inr(spend)} <span className="font-normal text-[var(--ink-3)]">· {pct(spend / (plan.spend || 1))}</span></p>
            </div>
            <p className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">{t.tagline}</p>
            {rows.length ? (
              <ul className="mt-1.5 divide-y divide-[var(--line-2)]">
                {rows.map((a) => (
                  <li key={a.item.id} className="flex items-center justify-between gap-3 py-1 text-[12px]">
                    <span className="min-w-0 truncate">{a.item.category} · <b>{a.cell.promo.label}</b></span>
                    <span className="num shrink-0 text-[var(--ink-3)]">{int(a.treated)} customers</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1.5 text-[12px] text-[var(--ink-3)]">No offer: {t.id === 'dog' ? 'offers put them off.' : t.id === 'lost' ? 'offers do not change whether they buy.' : 'other customers bring back more per ₹1.'}</p>}
          </div>
        );
      })}
    </div>
  );
}
