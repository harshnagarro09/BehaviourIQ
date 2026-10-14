// Simulation > Test the plan: the plan from Planning, side by side with up to three what-if scenarios. Every column is built by
// the same code as Planning (lib/plan.ts), so the numbers agree. A scenario never changes the plan; "Use as my plan"
// applies it (and can be undone on either page). The plan can be finalised here or on Planning.
import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useApp, useEngine, type Scenario } from '@/state';
import { Card, SourceChip } from '@/components/ui';
import { useProductFilter } from '@/components/ProductScope';
import { skuCatalog } from '@/engine/products';
import { TYPE_BY_ID } from '@/engine/segments';
import type { TypeId } from '@/engine/behaviour';
import { computePlan, describeOffer, GROUP_IDS, segName, groupText, productLabel, sameConfig, type ActivityPick, type PlanConfig, type PlanResult } from '@/lib/plan';
import { int, money, moneyDelta } from '@/lib/fmt';
import { AimField, BudgetField } from '@/components/plan/Controls';
import { FinaliseBox } from '@/components/Finalise';
import { reliabilityFor } from '@/lib/targeting';
import { likelyRange } from '@/engine/reliability';

const MAX = 3;
const per1 = (roi: number) => `${roi < 0 ? '−' : ''}₹${Math.abs(roi).toFixed(2)}`;
const NAMES = ['Scenario A', 'Scenario B', 'Scenario C'];
const GOAL: Record<string, string> = { margin: 'Most profit', revenue: 'Most sales', buyers: 'Most buyers' };
const ACTIVITY: Record<ActivityPick, string> = { active: 'Active customers', all: 'All customers', lapsing: 'Slowing or inactive' };

export function ScenarioLab() {
  const e = useEngine();
  const { plan, setPlan, planFrom, undoPlan, scenarios, setScenarios, campaignName, campaigns } = useApp();
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const mine = useMemo(() => computePlan(e, catalog, plan), [e, catalog, plan]);
  const results = useMemo(() => scenarios.map((s) => computePlan(e, catalog, s.cfg)), [e, catalog, scenarios]);
  // the name given in "Finalise and schedule", or the name this exact plan was finalised under
  const planName = campaignName.trim() || [...campaigns].reverse().find((c) => sameConfig(c.cfg, plan))?.name || '';
  const [applied, setApplied] = useState<string | null>(null);
  const band = reliabilityFor(e).band;
  const rng = (v: number) => { const x = likelyRange(v, band); return `${money(x.low)} – ${money(x.high)}`; };

  const freeName = NAMES.find((n) => !scenarios.some((s) => s.name === n)) ?? `Scenario ${scenarios.length + 1}`;
  const add = (cfg: PlanConfig) => scenarios.length < MAX && setScenarios([...scenarios, { id: `${Date.now()}`, name: freeName, cfg }]);
  const update = (id: string, cfg: PlanConfig) => setScenarios(scenarios.map((s) => (s.id === id ? { ...s, cfg } : s)));
  const remove = (id: string) => setScenarios(scenarios.filter((s) => s.id !== id));
  const apply = (s: Scenario) => { setPlan(s.cfg, `Simulation (${s.name})`); setApplied(s.name); };
  // the recommendation as a scenario: recommended groups, the best discount per group, the recommended budget
  const recCfg: PlanConfig = { ...plan, groups: null, discount: 'best', budget: null };

  const bestProfit = Math.max(mine.plan.incMargin, ...results.map((r) => r.plan.incMargin));

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ the plan being tested */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold">Your plan, from Planning{planName && <span className="font-semibold text-[var(--ink-2)]"> · “{planName}”</span>}</p>
            <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">Try other customer groups, products, discounts or budgets as scenarios below. Your plan does not change unless you choose “Use as my plan”.</p>
          </div>
          <SourceChip kind="simulated" />
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3 xl:grid-cols-6">
          <Fact k="Customer groups" v={groupText(mine)} />
          <Fact k="Customers" v={ACTIVITY[plan.activity]} />
          <Fact k="Products" v={productLabel(catalog, plan.products)} />
          <Fact k="Discount" v={plan.discount === 'best' ? 'Best for each group' : describeOffer(mine)} />
          <Fact k="Budget" v={money(mine.settings.budget)} />
          <Fact k="Goal" v={GOAL[plan.objective]} />
        </dl>
        {planFrom && (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-[#f0fdf4] px-3 py-2 text-[12px] text-[#065f46]">
            <span><Check className="mr-1 inline h-3.5 w-3.5" />Your plan now uses {applied ?? planFrom.replace('Simulation (', '').replace(')', '')}. Planning shows the same numbers.</span>
            {undoPlan && <button onClick={() => { undoPlan(); setApplied(null); }} className="inline-flex items-center gap-1 font-semibold text-[var(--navy)] hover:underline"><RotateCcw className="h-3 w-3" />Undo</button>}
          </p>
        )}
      </Card>

      {/* ------------------------------------------------------------ scenarios */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Scenarios</h2>
          <p className="text-[12px] text-[var(--ink-3)]">Up to {MAX}. Each starts as a copy and is calculated the same way as your plan.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AddBtn disabled={scenarios.length >= MAX} onClick={() => add(plan)} icon={<Copy className="h-3.5 w-3.5" />}>Copy my plan</AddBtn>
          <AddBtn disabled={scenarios.length >= MAX || sameConfig(recCfg, plan)} onClick={() => add(recCfg)} icon={<Sparkles className="h-3.5 w-3.5" />}>Recommended plan</AddBtn>
          <AddBtn disabled={scenarios.length >= MAX} onClick={() => add({ ...plan, budget: Math.round(mine.settings.budget * 1.25 / 500) * 500 })} icon={<Plus className="h-3.5 w-3.5" />}>25% more budget</AddBtn>
        </div>
      </div>
      {scenarios.length ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {scenarios.map((s, i) => <ScenarioEditor key={s.id} s={s} r={results[i]} onChange={(cfg) => update(s.id, cfg)} onRemove={() => remove(s.id)} />)}
        </div>
      ) : (
        <Card><p className="py-4 text-center text-[12.5px] text-[var(--ink-3)]">No scenario yet. Start with a copy of your plan and change one thing, for example the discount or the budget.</p></Card>
      )}

      {/* ------------------------------------------------------------ side by side */}
      <section className="card overflow-x-auto p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-bold tracking-tight">Compare outcomes</h2>
            <p className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">Estimated for the next offer window. Differences are against your plan; the most extra profit is highlighted.</p>
          </div>
          <SourceChip kind="simulated" />
        </div>
        <table className={`mt-3 text-[12.5px] ${scenarios.length ? 'w-full min-w-[640px]' : 'w-full max-w-[640px]'}`}>
          <thead>
            <tr className="border-b border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">
              <th className="py-2 text-left" />
              <th className="px-3 py-2">Your plan</th>
              {scenarios.map((s) => <th key={s.id} className="px-3 py-2">{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row k="Customer groups" mine={groupText(mine)} rs={results.map((r) => groupText(r))} text />
            <Row k="Products" mine={productLabel(catalog, mine.cfg.products)} rs={results.map((r) => productLabel(catalog, r.cfg.products))} text />
            <Row k="Discount" mine={describeOffer(mine)} rs={results.map((r) => describeOffer(r))} text />
            <Row k="Budget used" mine={`${money(mine.plan.spend)} of ${money(mine.settings.budget)}`} rs={results.map((r) => `${money(r.plan.spend)} of ${money(r.settings.budget)}`)} d={results.map((r) => r.plan.spend - mine.plan.spend)} />
            <Row k="Customers with an offer" mine={int(mine.reached)} rs={results.map((r) => int(r.reached))} d={results.map((r) => r.reached - mine.reached)} count />
            <Row k="Extra units" mine={int(mine.plan.incUnits)} rs={results.map((r) => int(r.plan.incUnits))} d={results.map((r) => r.plan.incUnits - mine.plan.incUnits)} count />
            <Row k="Extra sales" mine={money(mine.plan.incRevenue)} rs={results.map((r) => money(r.plan.incRevenue))} d={results.map((r) => r.plan.incRevenue - mine.plan.incRevenue)} />
            <Row k="Extra profit" mine={money(mine.plan.incMargin)} rs={results.map((r) => money(r.plan.incMargin))} d={results.map((r) => r.plan.incMargin - mine.plan.incMargin)}
              best={[mine, ...results].map((r) => r.plan.incMargin > 0 && Math.abs(r.plan.incMargin - bestProfit) < 1)} />
            <Row k="Extra profit, likely range" mine={rng(mine.plan.incMargin)} rs={results.map((r) => rng(r.plan.incMargin))} text />
            <Row k="Return per ₹1 (ROI)" mine={mine.plan.spend ? per1(mine.plan.roi) : '–'} rs={results.map((r) => (r.plan.spend ? per1(r.plan.roi) : '–'))} text />
            {scenarios.length > 0 && (
              <tr>
                <td />
                <td className="px-3 pt-3 text-right text-[11.5px] text-[var(--ink-3)]">Current plan</td>
                {scenarios.map((s, i) => (
                  <td key={s.id} className="px-3 pt-3 text-right">
                    {sameConfig(s.cfg, plan)
                      ? <span className="text-[11.5px] font-semibold text-[#065f46]">Same as your plan</span>
                      : <button onClick={() => apply(s)} disabled={!results[i].plan.allocations.length}
                          className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md bg-[var(--navy)] px-3 text-[12px] font-semibold text-white hover:opacity-95 disabled:opacity-40">Use as my plan</button>}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        <WhereMoneyGoes cols={[{ name: 'Your plan', r: mine }, ...scenarios.map((s, i) => ({ name: s.name, r: results[i] }))]} />
      </section>

      {/* ------------------------------------------------------------ finalise and schedule */}
      <FinaliseBox r={mine} catalog={catalog} />
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div className="min-w-0"><dt className="text-[11px] text-[var(--ink-3)]">{k}</dt><dd className="font-semibold leading-snug">{v}</dd></div>;
}

function AddBtn({ children, onClick, disabled, icon }: { children: ReactNode; onClick: () => void; disabled?: boolean; icon: ReactNode }) {
  return <button onClick={onClick} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-3 text-[12px] font-semibold text-[var(--ink-2)] hover:border-[var(--ink-3)] disabled:opacity-40">{icon}{children}</button>;
}

function Row({ k, mine, rs, d, text, count, best }: { k: string; mine: string; rs: string[]; d?: number[]; text?: boolean; count?: boolean; best?: boolean[] }) {
  return (
    <tr className="border-b border-[var(--line-2)] text-right align-top">
      <td className="min-w-[150px] py-2 pr-3 text-left text-[var(--ink-2)]">{k}</td>
      <td className={`px-3 py-2 ${text ? 'text-[12px]' : 'num font-semibold'} ${best?.[0] ? 'bg-[#f0fdf4] font-bold text-[#065f46]' : ''}`}>{mine}</td>
      {rs.map((v, i) => (
        <td key={i} className={`px-3 py-2 ${text ? 'text-[12px]' : 'num font-semibold'} ${best?.[i + 1] ? 'bg-[#f0fdf4] font-bold text-[#065f46]' : ''}`}>
          {v}
          {d && Math.abs(d[i]) >= 1 && <span className="block text-[11px] font-semibold" style={{ color: d[i] > 0 ? 'var(--green-dark)' : 'var(--red)' }}>{count ? `${d[i] > 0 ? '+' : '−'}${int(Math.abs(d[i]))}` : moneyDelta(d[i])}</span>}
        </td>
      ))}
    </tr>
  );
}

/** where each column puts its money: customer group x category, the offer and the expected extra profit */
function WhereMoneyGoes({ cols }: { cols: { name: string; r: PlanResult }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-[var(--line-2)] pt-3">
      <button onClick={() => setOpen(!open)} className="text-[12.5px] font-semibold text-[var(--navy)] hover:underline">{open ? 'Hide' : 'Show'} where the money goes in each</button>
      {open && (
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cols.map(({ name, r }) => (
            <div key={name} className="min-w-0">
              <p className="text-[12px] font-bold">{name}</p>
              {r.plan.allocations.length ? (
                <ul className="mt-1.5 space-y-1.5">
                  {r.plan.allocations.map((a) => (
                    <li key={a.item.id} className="text-[11.5px] leading-snug">
                      <span className="flex items-center gap-1.5 font-semibold"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_BY_ID[a.item.type].color }} />{a.item.category} · {segName(a.item)}</span>
                      <span className="block text-[var(--ink-3)]">{a.cell.promo.label} · {int(a.treated)} customers · <span className="num">{money(a.spend)}</span> → <span className="num text-[var(--green-dark)]">{moneyDelta(a.incMargin)}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1.5 text-[11.5px] text-[var(--ink-3)]">No offer pays back.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** one scenario's choices: the same controls as Planning, kept compact */
function ScenarioEditor({ s, r, onChange, onRemove }: { s: Scenario; r: PlanResult; onChange: (cfg: PlanConfig) => void; onRemove: () => void }) {
  const e = useEngine();
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const cfg = s.cfg;
  const set = (patch: Partial<PlanConfig>) => onChange({ ...cfg, ...patch });
  const products = useProductFilter(catalog, { value: cfg.products, onChange: (v) => set({ products: v }) });
  const toggle = (t: TypeId) => { const g = new Set(r.groups); if (g.has(t)) g.delete(t); else g.add(t); set({ groups: GROUP_IDS.filter((x) => g.has(x)) }); };
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] font-bold">{s.name}</p>
        <button onClick={onRemove} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ink-3)] hover:text-[var(--red)]"><Trash2 className="h-3.5 w-3.5" />Remove</button>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">Customer groups</p>
        <div className="flex flex-wrap gap-1.5">
          {r.insights.map((g) => {
            const on = r.groups.has(g.type);
            return (
              <button key={g.type} onClick={() => toggle(g.type)} aria-pressed={on} disabled={!g.customers} title={g.recommended ? 'Recommended' : g.type === 'dog' ? 'Do not target: they buy less when offers run' : 'Not recommended for these products'}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40 ${on ? 'border-[var(--navy)] bg-[#eef3fa] text-[var(--navy)]' : 'border-[var(--line)] bg-white text-[var(--ink-3)]'}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_BY_ID[g.type].color }} />{TYPE_BY_ID[g.type].name}<span className="num font-normal">{int(g.customers)}</span>
              </button>
            );
          })}
        </div>
        <select value={cfg.activity} onChange={(ev) => set({ activity: ev.target.value as ActivityPick })} aria-label="Customers to start from"
          className="mt-2 h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] font-medium">
          {(Object.keys(ACTIVITY) as ActivityPick[]).map((a) => <option key={a} value={a}>{ACTIVITY[a]}</option>)}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">{products.pickers[0]}{products.pickers[1]}{products.pickers[2]}</div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">Discount</span>
        <select value={cfg.discount} onChange={(ev) => set({ discount: ev.target.value })} className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2.5 text-[12.5px] font-semibold">
          <option value="best">Best discount for each group</option>
          {r.offers.map((o) => <option key={o.key} value={o.key}>{o.label} for everyone</option>)}
        </select>
      </label>
      <BudgetField value={r.settings.budget} onChange={(v) => set({ budget: v })} max={Math.max(60000, Math.ceil(r.settings.budget * 1.5 / 5000) * 5000)} />
      <AimField value={cfg.objective} onChange={(v) => set({ objective: v })} />
      <p className="rounded-md bg-[var(--page)] px-3 py-2 text-[12px] text-[var(--ink-2)]">
        {r.plan.allocations.length
          ? <>Spends <b className="num">{money(r.plan.spend)}</b> on {int(r.reached)} customers for an expected <b className="num text-[var(--green-dark)]">{money(r.plan.incMargin)}</b> extra profit.</>
          : 'No offer pays back with these choices.'}
      </p>
    </section>
  );
}
