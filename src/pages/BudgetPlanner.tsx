// Planning > Build the plan: who to target (customer groups, with why), what to promote and the discount, the budget;
// then your plan next to the recommended plan, with the budget split, the discount options and the product table.
// Customer behaviour decides who responds; the category demand curve (price elasticity from past price offers) shapes how deep
// the discount should be; the optimiser (engine/optimizer.ts, exact knapsack) decides where the money goes. Decisions are per
// customer type x category, scaled to the products picked and split to SKUs by regular-sales share (engine/budgetScope.ts).

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Info, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { FinaliseBox } from '@/components/Finalise';
import { useProductFilter } from '@/components/ProductScope';
import { MAX_SUBSIDY } from '@/engine/targeting';
import { TypeId } from '@/engine/behaviour';
import type { ShiftFrom } from '@/engine/shifts';
import { type SpendLimit } from '@/engine/optimizer';
import { skuCatalog } from '@/engine/products';
import { elasticityOf } from '@/lib/targeting';
import { computePlan, GROUP_IDS, productLabel, type ActivityPick, type PlanConfig } from '@/lib/plan';
import { int, money } from '@/lib/fmt';
import { list, type LimitInput, num, LABEL } from '@/components/plan/shared';
import { Seg, GroupCard, Exceptions } from '@/components/plan/Targeting';
import { Results } from '@/components/plan/Results';
import { BudgetField, AimField, Rules } from '@/components/plan/Controls';

/**
 * Planning > Build the plan: one guided flow on one page.
 *   Step 1  who to target     the four customer groups, each with why it should or should not get offers (past behaviour and
 *                             the model's estimate for the products picked); the recommended groups are ticked to start with
 *   Step 2  what to promote   products and the discount (the best one per group, or one offer for everyone)
 *   Step 3  budget and goal   starts at the recommended budget
 *   Step 4  review            your plan next to the recommended plan, where the money goes, the discount options
 *   then    simulate it (Simulation > Test the plan, seeded with this plan) and finalise it
 * The plan lives in the app state, so Simulation can test it and apply a scenario back to it.
 */
export function PlanBuilder({ onSimulate }: { onSimulate: () => void }) {
  const e = useEngine();
  const { plan: cfg, setPlan, planFrom, undoPlan } = useApp();
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const set = (patch: Partial<PlanConfig>) => setPlan({ ...cfg, ...patch });
  const products = useProductFilter(catalog, { value: cfg.products, onChange: (v) => set({ products: v }) });
  const r = useMemo(() => computePlan(e, catalog, cfg), [e, catalog, cfg]);
  const model = useMemo(() => elasticityOf(e), [e]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [limitInput, setLimitInput] = useState<LimitInput>(() => Object.fromEntries(Object.entries(cfg.limits).map(([c, l]) => [c, { min: l.min != null ? String(l.min) : '', max: l.max != null ? String(l.max) : '' }])));
  const putLimits = (li: LimitInput) => {
    setLimitInput(li);
    const out: Record<string, SpendLimit> = {};
    for (const [c, l] of Object.entries(li)) { const min = num(l.min), max = num(l.max); if (min || max != null) out[c] = { min, max }; }
    set({ limits: out });
  };
  const changedRules = (cfg.maxSubsidy !== MAX_SUBSIDY ? 1 : 0) + (cfg.hurdle !== 0.25 ? 1 : 0) + Object.keys(cfg.limits).length + (cfg.maxDepth != null ? 1 : 0) + (cfg.testedOnly ? 1 : 0) + (cfg.maxCoverage < 1 ? 1 : 0);
  // Persuadables and Sure Things are always shown, one card each; "Start from" chooses which customers are in them.
  const SHOWN: TypeId[] = ['persuadable', 'sure'];
  const cards = r.insights.filter((g) => SHOWN.includes(g.type));
  const toggleGroup = (t: TypeId) => { const s = new Set(r.groups); if (s.has(t)) s.delete(t); else s.add(t); set({ groups: GROUP_IDS.filter((x) => s.has(x)) }); };
  const toggleLeaveOut = (k: string) => set({ leaveOut: cfg.leaveOut.includes(k) ? cfg.leaveOut.filter((x) => x !== k) : [...cfg.leaveOut, k] });
  const toggleWake = (f: ShiftFrom) => set({ wakeUp: cfg.wakeUp.includes(f) ? cfg.wakeUp.filter((x) => x !== f) : [...cfg.wakeUp, f] });
  const changedTargeting = !!cfg.groups || cfg.wakeUp.length > 0 || r.alerts.some((a) => a.leftOut) || cfg.activity !== 'all' || cfg.alertPeriod !== '6m';
  const recBudget = r.rec?.settings.budget ?? null;
  const productText = productLabel(catalog, cfg.products);

  return (
    <div className="space-y-4">
      {planFrom && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#a7e8c8] bg-[#f0fdf7] px-4 py-2.5 text-[12.5px]">
          <span><b className="font-semibold">Plan updated from {planFrom}.</b> The numbers below are for the updated plan.</span>
          {undoPlan && <button onClick={undoPlan} className="inline-flex items-center gap-1 font-semibold text-[var(--navy)] hover:underline"><RotateCcw className="h-3 w-3" />Undo: go back to the previous plan</button>}
        </div>
      )}

      {/* ------------------------------------------------------------ who to target: the groups and segments, the exceptions */}
      <section className="card p-4">
        <StepHead title="Who to target" sub={`A discount only pays when it changes what customers buy, at a profit, without mostly paying for sales that would happen anyway. Each customer group is shown with how an offer on ${productText.toLowerCase() === 'all products' ? 'these products' : productText} works for it. Use Start from to look at active customers, slowing / inactive ones (win-back) or all of them.`}
          right={changedTargeting ? <button onClick={() => set({ groups: null, leaveOut: [], wakeUp: [], activity: 'all', alertPeriod: '6m' })} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--navy)] hover:underline"><RotateCcw className="h-3 w-3" />Back to the recommendation</button> : undefined} />
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Seg label="Start from" value={cfg.activity} onChange={(v) => set({ activity: v as ActivityPick })} options={[['all', 'All customers'], ['active', 'Active only'], ['lapsing', 'Slowing or inactive only']]} />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {cards.map((g) => <GroupCard key={g.type} g={g} on={r.groups.has(g.type)} onToggle={() => toggleGroup(g.type)} hurdle={cfg.hurdle} maxSubsidy={cfg.maxSubsidy} />)}
        </div>

        <Exceptions alerts={r.alerts} shifts={r.shifts} onToggleWake={toggleWake} period={cfg.alertPeriod} onPeriod={(p) => set({ alertPeriod: p })} onToggle={toggleLeaveOut} onLeaveSuggested={(keys) => set({ leaveOut: [...new Set([...cfg.leaveOut, ...keys])] })} />
      </section>

      <div className="grid items-stretch gap-4 xl:grid-cols-2">
      {/* ------------------------------------------------------------ step 2: what to promote */}
      <section className="card p-4">
        <StepHead title="What to promote" sub="The products on offer and the discount. The best discount is chosen for each customer group unless you pick one offer for everyone." />
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-2">
          {products.pickers[0]}{products.pickers[1]}{products.pickers[2]}
          <label className="block min-w-0">
            <span className={LABEL}>Discount</span>
            <select value={cfg.discount} onChange={(ev) => set({ discount: ev.target.value })} aria-label="Discount"
              className="h-10 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] font-semibold outline-none focus:border-[var(--navy)]">
              <option value="best">Best for each group</option>
              {r.offers.map((o) => <option key={o.key} value={o.key}>{o.label} for everyone</option>)}
            </select>
          </label>
        </div>
        {!r.range.length && <p className="mt-2 text-[12px] text-[var(--red)]">These products have no regular sales in the data, so their share of a promotion can't be estimated. Pick other products.</p>}
        <Evidence ids={r.ids} cats={r.categories} fromCategory={null} />
      </section>

      {/* ------------------------------------------------------------ step 3: budget and goal */}
      <section className="card p-4">
        <StepHead title="Manage the budget" sub={recBudget != null ? `Recommended budget: ${money(recBudget)}. Beyond it, more money earns less than it costs for these customers and products.` : 'Set how much to spend and what to aim for.'}
          right={cfg.budget != null && recBudget != null && cfg.budget !== recBudget ? <button onClick={() => set({ budget: null })} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--navy)] hover:underline"><RotateCcw className="h-3 w-3" />Use the recommended {money(recBudget)}</button> : undefined} />
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="sm:col-span-2"><BudgetField value={r.settings.budget} onChange={(v) => set({ budget: v })} max={Math.max(60000, Math.ceil(r.settings.budget * 1.5 / 5000) * 5000)} /></div>
          <AimField value={cfg.objective} onChange={(v) => set({ objective: v })} />
          <button onClick={() => setRulesOpen(!rulesOpen)} aria-expanded={rulesOpen}
            className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold ${rulesOpen ? 'border-[var(--navy)] bg-[#eef3fa] text-[var(--navy)]' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />Advanced settings
            {changedRules > 0 && <span className="rounded-full bg-[var(--navy)] px-1.5 text-[10.5px] text-white">{changedRules}</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rulesOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </section>
      </div>
      {rulesOpen && <Rules hurdle={cfg.hurdle} setHurdle={(h) => set({ hurdle: h })} limitInput={limitInput} setLimitInput={putLimits} cats={r.categories}
        maxDepth={cfg.maxDepth} setMaxDepth={(v) => set({ maxDepth: v })} testedOnly={cfg.testedOnly} setTestedOnly={(v) => set({ testedOnly: v })}
        maxCoverage={cfg.maxCoverage} setMaxCoverage={(v) => set({ maxCoverage: v })} maxSubsidy={cfg.maxSubsidy} setMaxSubsidy={(v) => set({ maxSubsidy: v })}
        onReset={changedRules ? () => { setLimitInput({}); set({ hurdle: 0.25, limits: {}, maxDepth: null, testedOnly: false, maxCoverage: 1, maxSubsidy: MAX_SUBSIDY }); } : undefined} />}

      {/* ------------------------------------------------------------ step 4: your plan next to the recommended plan */}
      <div>
        <StepHead title="Your plan vs the recommended plan" sub="Both are estimates from the same data. The recommendation uses every customer group (active and slowing / inactive apart) whose offer changes what they buy, pays back and mostly buys new sales, never Sleeping Dogs, at the recommended budget. Your choices are not changed." />
        <div className="mt-3">
          {r.ids.length && r.range.length
            ? <Results r={r} model={model} label={productText} />
            : <div className="card px-4 py-8 text-center text-[13px] text-[var(--ink-2)]">Tick at least one customer group and pick products with regular sales to see the plan.</div>}
        </div>
      </div>

      {/* ------------------------------------------------------------ simulate, then finalise and schedule */}
      <FinaliseBox r={r} catalog={catalog} extra={
        <button onClick={onSimulate} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--navy)] bg-white px-4 text-[12.5px] font-semibold text-[var(--navy)] hover:bg-[#eef3fa]"><SlidersHorizontal className="h-3.5 w-3.5" />Simulate this plan</button>
      } />
    </div>
  );
}

function StepHead({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-bold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-3)]">{sub}</p>
      </div>
      {right}
    </div>
  );
}

/**
 * Is the audience a fair basis for the products picked? The estimates read each customer's own buying in each category, so
 * an audience built for one category can be planned for another; what matters is how many of them buy it at all.
 */
function Evidence({ ids, cats, fromCategory }: { ids: string[]; cats: string[]; fromCategory: string | null }) {
  const e = useEngine();
  if (!ids.length || !cats.length) return null;
  const shown = cats.filter((c) => c !== fromCategory);
  if (!shown.length) return null;
  const rows = shown.map((c) => ({ c, n: ids.filter((cid) => (e.recById.get(cid)!.b.catShare[c] ?? 0) > 0).length }));
  const weak = rows.filter((r) => r.n / ids.length < 0.3);
  if (!fromCategory && !weak.length) return null;
  return (
    <p className="flex items-start gap-1.5 border-t border-[var(--line-2)] px-4 py-2 text-[11.5px] text-[var(--ink-3)]">
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      <span>
        {fromCategory && <>Audience built for {fromCategory}; estimates for {list(shown.slice(0, 3))}{shown.length > 3 ? ' and more' : ''} use each customer's own buying there. </>}
        {rows.length <= 3 && rows.map((r) => `${int(r.n)} of ${int(ids.length)} have bought ${r.c}`).join(' · ')}
        {weak.length > 0 && <span className="text-[#92400e]"> · Few of them buy {list(weak.map((r) => r.c))}, so expect little effect there.</span>}
      </span>
    </p>
  );
}
