import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Btn, Card, CardTitle, Chip, Panel, ViewToggle } from '@/components/ui';
import { PageTop } from '@/pages/Analytics';
import { BarChart, LineChart } from '@/components/charts';
import { TYPES } from '@/engine/segments';
import { TYPE_IDS } from '@/engine/insights';
import type { TypeId } from '@/engine/behaviour';
import { activeAt, buildCtxs, CANDIDATES } from '@/engine/planner';
import { catalogue, type PromoDef } from '@/engine/promotions';
import { aggregateGroup, MIN_SEG_UPLIFT, TARGET_UPLIFT, type SegPromo } from '@/engine/targeting';
import type { Ctx } from '@/engine/simulation';
import { inr, int, pct, shortDate } from '@/lib/fmt';
import { Lbl } from '@/components/Help';
import { WindowChip } from '@/components/ui';
import { Takeaway } from '@/components/Takeaway';
import { ImpactPanel } from '@/components/ImpactPanel';
import { simulationTakeaway } from '@/lib/takeaways';

type Objective = 'margin' | 'buyers' | 'basket' | 'reactivate';
const OBJECTIVES: { id: Objective; label: string; hint: string }[] = [
  { id: 'margin', label: 'Maximise incremental margin', hint: 'Only customer types where the offer lifts purchase probability by 15+ points and pays back' },
  { id: 'buyers', label: 'Maximise incremental buyers', hint: 'Customer types whose purchase probability rises by 5+ points' },
  { id: 'basket', label: 'Grow basket size', hint: 'Customer types that buy 1.4x or more of their usual quantity on promotion' },
  { id: 'reactivate', label: 'Reactivate quiet customers', hint: 'Customer types whose average time since the last order is over 30 days' },
];

interface Group { ctxs: Ctx[]; qty: number; recency: number }
interface Sim {
  targeted: number; total: number; buyers: number; inc: number; units: number; revenue: number; incRevenue: number; margin: number;
  cost: number; leak: number; incMargin: number; roi: number; byType: Record<TypeId, number>;
}
interface Row { key: string; label: string; short: string }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : 0);
const passes = (c: SegPromo, g: Record<TypeId, Group>, o: Objective) =>
  o === 'margin' ? c.uplift >= TARGET_UPLIFT && c.incMargin > 0
    : o === 'buyers' ? c.uplift >= MIN_SEG_UPLIFT
      : o === 'basket' ? g[c.seg].qty >= 1.4 && c.uplift > 0
        : g[c.seg].recency > 30 && c.uplift > 0;

/** Combine the four customer-type predictions of one promotion. A type is included whole; a budget cap funds the best-ROI types first. */
function simulate(cells: SegPromo[], groups: Record<TypeId, Group>, objective: Objective, types: Set<TypeId>, budget: number | null): Sim {
  const o: Sim = { targeted: 0, total: cells.reduce((a, c) => a + c.members, 0), buyers: 0, inc: 0, units: 0, revenue: 0, incRevenue: 0, margin: 0, cost: 0, leak: 0, incMargin: 0, roi: 0, byType: { persuadable: 0, sure: 0, lost: 0, dog: 0 } };
  const pool = cells.filter((c) => types.has(c.seg) && c.eligible.ok && c.members > 0 && passes(c, groups, objective)).sort((a, b) => b.roi - a.roi);
  for (const c of pool) {
    let share = 1;
    if (budget !== null && c.investment > 0) {
      const room = budget - o.cost;
      if (room <= 0) break;
      share = Math.min(1, room / c.investment);
    }
    const n = Math.round(c.members * share);
    o.targeted += n;
    o.byType[c.seg] = n;
    o.buyers += c.p1 * c.members * share;
    o.inc += c.incBuyers * share;
    o.units += c.units * share;
    o.revenue += c.revenue * share;
    o.incRevenue += c.incRevenue * share;
    o.margin += c.margin * share;
    o.cost += c.investment * share;
    o.leak += c.subsidy * share;
    o.incMargin += c.incMargin * share;
  }
  o.roi = o.cost ? o.incMargin / o.cost : 0;
  return o;
}

/** the percentage-discount entry of the dropdown stands for the 10/15/20/25% catalogue items, set by the depth slider */
const PCT = 'pct';
const toControls = (p: PromoDef) => (p.family === 'price' ? { mech: PCT, depth: p.depth } : { mech: p.key, depth: 15 });

export function Simulation() {
  const e = useEngine();
  const { params, decisions, go } = useApp();
  const slot = params.slot && CANDIDATES.some((c) => c.id === params.slot) ? params.slot : CANDIDATES[1].id;
  const rec = e.recommendations.find((r) => r.candidate.id === slot)!;
  const cand = rec.candidate;
  const best = rec.best;

  const [objective, setObjective] = useState<Objective>('margin');
  const [mech, setMech] = useState(best ? toControls(best.option).mech : PCT);
  const [depth, setDepth] = useState(best ? toControls(best.option).depth : 15);
  const [types, setTypes] = useState<Set<TypeId>>(new Set(TYPE_IDS));
  const [budgetOn, setBudgetOn] = useState(false);
  const [budgetK, setBudgetK] = useState(5);
  const [guard, setGuard] = useState(0.3);
  const [cmpView, setCmpView] = useState<'chart' | 'table'>('chart');
  const [lastSlot, setLastSlot] = useState(slot);
  if (lastSlot !== slot) {
    setLastSlot(slot);
    if (best) { const c = toControls(best.option); setMech(c.mech); setDepth(c.depth); }
  }
  const budget = budgetOn ? budgetK * 1000 : null;

  const catalog = useMemo(() => catalogue(e.ds, cand.category), [e, cand.category]);
  const ctxs = useMemo(() => buildCtxs(e.ds, activeAt(e.ds, e.asOf), cand.category, e.asOf), [e, cand.category]);
  const groups = useMemo(() => {
    const g = {} as Record<TypeId, Group>;
    for (const t of TYPE_IDS) {
      const cs = ctxs.filter((c) => e.typeOf.get(c.cid) === t);
      g[t] = { ctxs: cs, qty: avg(cs.map((c) => c.b.qtyRatio)), recency: avg(cs.map((c) => c.b.recencyDays)) };
    }
    return g;
  }, [ctxs, e]);
  const cellsFor = useCallback((def: PromoDef) => TYPE_IDS.map((t) => aggregateGroup(e.ds, groups[t].ctxs, t, cand.category, def, e.resp, e.assumptions)), [e, groups, cand.category]);
  const pctBase = catalog.find((p) => p.key === 'pct10')!;
  const pctDef = useCallback((d: number): PromoDef => ({ ...pctBase, key: `pct${d}`, label: `${d}% Off`, short: `${d}%`, depth: d }), [pctBase]);
  const def = mech === PCT ? pctDef(depth) : catalog.find((p) => p.key === mech) ?? pctDef(depth);

  const cells = useMemo(() => cellsFor(def), [cellsFor, def]);
  const sim = useMemo(() => simulate(cells, groups, objective, types, budget), [cells, groups, objective, types, budget]);
  const table = useMemo(() => {
    const none: Row = { key: 'none', label: 'No Promotion', short: 'None' };
    const all = TYPE_IDS.reduce((a, t) => a + groups[t].ctxs.length, 0) || 1;
    const p0 = ctxs.reduce((s, c) => s + c.p0, 0);
    return [
      { o: none, none: true, blocked: false, s: null as Sim | null, resp: p0 / all, orders: p0 },
      ...catalog.map((o) => {
        const cs = cellsFor(o);
        const s = simulate(cs, groups, objective, types, budget);
        return { o: { key: o.key, label: o.label, short: o.short } as Row, none: false, blocked: !cs[0].eligible.ok, s: s as Sim | null, resp: s.targeted ? s.buyers / s.targeted : 0, orders: s.buyers };
      }),
    ];
  }, [catalog, cellsFor, groups, ctxs, objective, types, budget]);
  const bestRow = table.filter((r) => !r.none && r.s && r.s.incMargin > 0).sort((a, b) => b.s!.incMargin - a.s!.incMargin)[0];

  // depth curves ignore the margin-floor guardrail so the shape of the response is visible; the guardrail still applies to the scenario
  const depths = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const curves = useMemo(() => depths.map((d) => {
    const cs = cellsFor(pctDef(d));
    const open = cs.map((c) => ({ ...c, eligible: { ok: true } }));
    const byType = {} as Record<TypeId, number>;
    cs.forEach((c) => { byType[c.seg] = c.p1; });
    return { d, margin: simulate(open, groups, objective, types, budget).incMargin, byType };
  }), [cellsFor, pctDef, groups, objective, types, budget]); // eslint-disable-line react-hooks/exhaustive-deps

  const violations: string[] = [];
  if (!cells[0].eligible.ok) violations.push(`${def.label} is not allowed here: ${cells[0].eligible.reason}`);
  else if (sim.targeted === 0) violations.push('No customer type meets the chosen objective and audience (no positive uplift).');
  else {
    if (sim.roi < guard) violations.push(`Predicted ROI ${sim.roi.toFixed(2)} is below the guardrail of ${guard.toFixed(2)}.`);
    if (sim.incMargin < 0) violations.push(`Incremental margin is negative (${inr(sim.incMargin)}).`);
  }
  const applyAi = () => { if (best) { const c = toControls(best.option); setMech(c.mech); setDepth(c.depth); setObjective('margin'); setTypes(new Set(TYPE_IDS)); setBudgetOn(false); } };
  const toggle = (t: TypeId) => { const n = new Set(types); if (n.has(t)) n.delete(t); else n.add(t); setTypes(n); };
  const status = (id: string) => decisions[id]?.status === 'accepted' ? <Chip tone="navy">Accepted</Chip> : decisions[id]?.status === 'rejected' ? <Chip tone="red">Rejected</Chip> : e.recommendations.find((r) => r.candidate.id === id)!.flag === 'attention' ? <Chip tone="amber">Needs attention</Chip> : <Chip tone="green">Recommended</Chip>;
  const subsidy = (cost: number, leak: number) => pct(cost ? leak / cost : 0);

  const Metric = ({ l, v, tone }: { l: string; v: string; tone?: 'bad' | 'good' }) => (
    <div><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-3)]"><Lbl t={l} /></p><p className="num mt-0.5 text-[15px] font-bold" style={{ color: tone === 'bad' ? 'var(--red)' : tone === 'good' ? 'var(--green-dark)' : undefined }}>{v}</p></div>
  );

  return (
    <>
      <PageTop title="Simulation" sub="Model campaign scenarios and see the predicted uplift by customer type before spending" />
      <div className="px-6 pt-4"><Takeaway>{simulationTakeaway({ targeted: sim.targeted, total: sim.total, margin: sim.incMargin, roi: sim.roi })}</Takeaway></div>
      <div className="grid gap-4 p-6 pt-4 lg:grid-cols-[250px_1fr]">
        <aside className="card h-fit overflow-hidden">
          <p className="border-b border-[var(--line)] px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Campaigns ({CANDIDATES.length})</p>
          {CANDIDATES.map((c) => {
            const r = e.recommendations.find((x) => x.candidate.id === c.id)!;
            const on = c.id === slot;
            return (
              <button key={c.id} onClick={() => go('simulation', { slot: c.id })} className={`block w-full border-b border-[var(--line-2)] px-3.5 py-2.5 text-left last:border-0 ${on ? 'bg-[var(--navy)] text-white' : 'hover:bg-[var(--page)]'}`}>
                <span className="flex items-start justify-between gap-2"><span className="text-[12.5px] font-semibold leading-snug">{c.name}</span>{on ? <Chip tone="neutral">{decisions[c.id]?.status === 'accepted' ? 'Accepted' : 'Selected'}</Chip> : status(c.id)}</span>
                <span className={`mt-0.5 block text-[11px] ${on ? 'text-white/60' : 'text-[var(--ink-3)]'}`}>{c.category} · {r.best ? `ROI ${r.best.roi.toFixed(2)}` : 'no promotion pays back'}</span>
              </button>
            );
          })}
          <div className="space-y-2.5 border-t border-[var(--line)] p-3.5 text-[12px]">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Selected campaign</p>
            {([
              ['Window', `${shortDate(cand.start)} · ${cand.days} days`], ['Theme', cand.theme], ['Confidence', `${rec.confidence}%`],
            ] as [string, string][]).map(([l, v]) => <div key={l} className="flex justify-between gap-3"><span className="text-[var(--ink-3)]">{l}</span><span className="text-right font-semibold">{v}</span></div>)}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <p className="text-[11.5px] text-[var(--ink-3)]"><button className="hover:underline" onClick={() => go('planning')}>Planning</button> / <b className="text-[var(--ink)]">Simulation: {cand.name}</b></p>
          <Card>
            <CardTitle title="Simulation Controls" />
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Business objective</p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {OBJECTIVES.map((o) => <button key={o.id} title={o.hint} onClick={() => setObjective(o.id)} className={`rounded-full border px-3 py-1 text-[12px] font-medium ${objective === o.id ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{o.label}</button>)}
            </div>
            <div className="grid gap-5 md:grid-cols-4">
              <div>
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Promotion type</p>
                <select value={mech} onChange={(ev) => setMech(ev.target.value)} className="h-8 w-full rounded-md border border-[var(--line)] bg-white px-2 text-[12.5px]">
                  <option value={PCT}>Percentage discount</option>
                  {catalog.filter((p) => p.family !== 'price').map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                <p className="mt-2 text-[11.5px] text-[var(--ink-3)]">Category: <b className="text-[var(--ink)]">{cand.category}</b></p>
              </div>
              <Slider label={def.family === 'threshold' ? `₹${def.flat} off, min spend ₹${def.minSpend}` : mech === PCT ? 'Incentive depth' : 'Effective depth'} value={`${def.depth}%`} disabled={mech !== PCT} min={5} max={50} step={5} v={def.depth} on={setDepth} lo="5%" hi="50%" />
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold"><input type="checkbox" checked={budgetOn} onChange={(ev) => setBudgetOn(ev.target.checked)} />Cap promo investment</label>
                <Slider label="Budget" value={inr(budgetK * 1000)} disabled={!budgetOn} min={1} max={40} step={1} v={budgetK} on={setBudgetK} lo="₹1K" hi="₹40K" />
              </div>
              <Slider label="Min ROI guardrail" value={guard.toFixed(2)} min={0} max={1.5} step={0.05} v={guard} on={setGuard} lo="0" hi="1.5" />
            </div>
            <p className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Audience (customer types)</p>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => <button key={t.id} onClick={() => toggle(t.id)} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${types.has(t.id) ? 'border-[var(--navy)] bg-white' : 'border-[var(--line)] bg-[var(--page)] text-[var(--ink-3)]'}`}><span className="h-2 w-2 rounded-full" style={{ background: types.has(t.id) ? t.color : '#cbd5e1' }} />{t.short}</button>)}
            </div>
          </Card>

          {violations.length > 0 && (
            <div className="flex items-start justify-between gap-4 rounded-[10px] border border-[#f3b4b4] bg-[#fdeeee] px-4 py-3">
              <div className="flex gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" />
                <div><p className="text-[13px] font-semibold text-[#b91c1c]">Guardrail Violated — Simulated Scenario Cannot Be Applied</p><ul className="mt-0.5 text-[12.5px] text-[#b91c1c]">{violations.map((v) => <li key={v}>• {v}</li>)}</ul></div>
              </div>
              {best && <Btn variant="ai" onClick={applyAi}><Sparkles className="h-3 w-3" />Use recommended instead</Btn>}
            </div>
          )}

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-2"><CardTitle title="Scenario Comparison" sub="Recommended promotion vs your adjusted simulation" /><WindowChip /></div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-[#a7e8c8] bg-[#f0fdf7] p-4">
                <Chip tone="green"><Sparkles className="h-3 w-3" />Recommended</Chip>
                <p className="mb-3 mt-1.5 text-[11.5px] text-[var(--ink-3)]">{best ? `${best.option.label} · ${cand.days} days · ${inr(best.discountCost)} investment${best.tested ? '' : ' · test first'}` : 'No promotion pays back for this slot'}</p>
                {best ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Metric l="Customers" v={`${best.audience.targeted}/${best.audience.total}`} /><Metric l="Incremental buyers" v={int(best.incrementalBuyers)} /><Metric l="Revenue" v={inr(best.revenue)} />
                    <Metric l="ROI" v={best.roi.toFixed(2)} tone="good" /><Metric l="Incremental margin" v={inr(best.incMargin)} /><Metric l="Subsidy rate" v={subsidy(best.discountCost, best.leakage)} />
                  </div>
                ) : <p className="text-[12.5px] text-[var(--ink-2)]">No promotion has a positive uplift that pays back for this audience.</p>}
                <Btn className="mt-4 w-full" onClick={applyAi} disabled={!best}>Load recommended settings</Btn>
              </div>
              <div className="rounded-lg border border-[var(--line)] p-4">
                <Chip tone="navy">Simulated</Chip>
                <p className="mb-3 mt-1.5 text-[11.5px] text-[var(--ink-3)]">{def.label} · {inr(sim.cost)} investment</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Metric l="Customers" v={`${sim.targeted}/${sim.total}`} /><Metric l="Incremental buyers" v={int(sim.inc)} /><Metric l="Revenue" v={inr(sim.revenue)} />
                  <Metric l="ROI" v={sim.roi.toFixed(2)} tone={sim.roi < guard ? 'bad' : 'good'} /><Metric l="Incremental margin" v={inr(sim.incMargin)} tone={sim.incMargin < 0 ? 'bad' : undefined} /><Metric l="Subsidy rate" v={subsidy(sim.cost, sim.leak)} />
                </div>
                <Btn variant="navy" className="mt-4 w-full" disabled={violations.length > 0} onClick={() => undefined}>Apply Simulated</Btn>
              </div>
            </div>
          </Card>

          <Panel flush title="Compare promotion options" what={`Same objective and audience, every promotion type for ${cand.category}. Highest purchase probability is rarely the best decision.`}
            right={<ViewToggle value={cmpView} onChange={setCmpView} />}
            legend={[
              { label: 'Grey bar', color: '#94a3b8', text: 'No Promotion: what these customers do anyway (baseline).' },
              { label: 'Green bar', color: 'var(--green)', text: 'Promotion with the highest incremental margin.' },
              { label: 'Purchase probability', text: 'Average chance of buying among the customer types selected by your objective and audience.' },
              { label: 'Incremental revenue', text: 'Revenue above what would have sold anyway (uplift).' },
              { label: 'Incremental margin', text: 'Margin after the promo investment, minus the baseline margin. Red means the promotion does not pay back.' },
            ]}>
            {(() => {
              const rs = table.filter((r) => !r.none && r.s && r.s.targeted > 0);
              const hrRow = rs.reduce<(typeof rs)[number] | null>((a, r) => (!a || r.resp > a.resp ? r : a), null);
              if (!hrRow || !bestRow || hrRow.o.key === bestRow.o.key) return null;
              return (
                <p className="mx-4 mb-2 rounded-md border border-[#f3d9b4] bg-[#fff8ee] px-3 py-2 text-[12px] text-[var(--ink-2)]">
                  <b>Purchase probability vs decision.</b> Highest purchase probability: {hrRow.o.short} ({pct(hrRow.resp)}), but its incremental margin is {inr(hrRow.s!.incMargin, 0)}. Highest incremental margin: {bestRow.o.short} ({pct(bestRow.resp)}), at {inr(bestRow.s!.incMargin, 0)}.
                </p>
              );
            })()}
            {cmpView === 'chart' ? (
              <div className="grid gap-5 px-4 pb-4 pt-1">
                <div><p className="mb-1 text-[11.5px] font-semibold">Purchase probability</p>
                  <BarChart height={200} format={(v) => pct(v)} showValues color="var(--navy)" data={table.filter((r) => !r.blocked).map((r) => ({ label: r.o.short, value: r.resp, color: r.none ? '#94a3b8' : bestRow?.o.key === r.o.key ? 'var(--green)' : 'var(--navy)' }))} /></div>
                <div><p className="mb-1 text-[11.5px] font-semibold">Incremental revenue</p>
                  <BarChart height={200} format={(v) => inr(v, 0)} showValues posColor="var(--navy)" negColor="var(--red)" data={table.filter((r) => r.s && !r.blocked).map((r) => ({ label: r.o.short, value: r.s!.incRevenue, color: bestRow?.o.key === r.o.key ? 'var(--green)' : undefined }))} /></div>
                <div><p className="mb-1 text-[11.5px] font-semibold">Incremental margin</p>
                  <BarChart height={200} format={(v) => inr(v, 0)} showValues posColor="var(--navy)" negColor="var(--red)" data={table.filter((r) => r.s && !r.blocked).map((r) => ({ label: r.o.short, value: r.s!.incMargin, color: bestRow?.o.key === r.o.key ? 'var(--green)' : undefined }))} /></div>
              </div>
            ) : (<div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12.5px]">
                <thead><tr className="border-y border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                  <th className="px-4 py-2 text-left">Promotion</th>{['Purchase probability', 'Expected buyers', 'Revenue', 'Incremental revenue', 'Promo investment', 'Incremental margin', 'ROI'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody>
                  {table.map((r) => {
                    const s = r.s;
                    const topResp = !r.none && !r.blocked && table.filter((x) => !x.none && !x.blocked && x.s!.targeted >= Math.max(10, 0.05 * x.s!.total)).reduce<(typeof table)[number] | null>((a, b) => (!a || b.resp > a.resp ? b : a), null)?.o.key === r.o.key;
                    const isBest = bestRow?.o.key === r.o.key;
                    return (
                      <tr key={r.o.key} className={`border-b border-[var(--line-2)] text-right last:border-0 ${isBest ? 'bg-[#f0fdf7]' : ''} ${r.blocked ? 'text-[var(--ink-3)]' : ''}`}>
                        <td className="px-4 py-2.5 text-left"><span className="font-semibold">{r.o.label}</span> <span className="ml-1 inline-flex gap-1">{isBest && <Chip tone="green">Highest margin</Chip>}{topResp && <Chip tone="amber">Highest probability</Chip>}{r.blocked && <Chip tone="red">Not allowed</Chip>}</span></td>
                        <td className="num px-3 font-semibold">{r.blocked || (s && s.targeted === 0) ? '–' : pct(r.resp)}</td>
                        <td className="num px-3">{r.blocked ? '–' : int(r.orders)}</td>
                        <td className="num px-3">{s && !r.blocked ? inr(s.revenue) : '–'}</td>
                        <td className="num px-3">{s && !r.blocked ? inr(s.incRevenue) : '–'}</td>
                        <td className="num px-3">{s && !r.blocked ? inr(s.cost) : '–'}</td>
                        <td className="num px-3 font-semibold" style={{ color: s && s.incMargin < 0 ? 'var(--red)' : undefined }}>{s && !r.blocked ? inr(s.incMargin) : '–'}</td>
                        <td className="num px-3 font-semibold" style={{ color: s && s.roi < 0 ? 'var(--red)' : undefined }}>{s && !r.blocked ? s.roi.toFixed(2) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>)}
          </Panel>

          <Panel title="Discount depth: uplift and return" what="As the percentage discount deepens, purchase probability rises while incremental margin peaks and then falls." defaultOpen={false}
            legend={[...TYPES.map((t) => ({ label: t.short, color: t.color, text: 'Average predicted purchase probability among all recently active customers of this type.' })), { label: 'Reading the lines', text: 'A steep line means customers can be persuaded by depth (high uplift); a high flat line means they buy anyway; a low flat line means discounts do not move them.' }, { label: 'Bars', text: 'Incremental margin at each depth; green is the depth selected in the controls, red does not pay back.' }]}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div><p className="mb-1 text-[11.5px] font-semibold">Purchase probability by customer type</p>
                <LineChart height={210} yMax={1} xFormat={(v) => `${v}%`} yFormat={(v) => pct(v)} xTicks={[5, 15, 25, 35, 50]} markers={false}
                  series={TYPES.map((t) => ({ name: t.short, color: t.color, points: curves.map((c) => ({ x: c.d, y: c.byType[t.id] })) }))} />
              </div>
              <div><p className="mb-1 text-[11.5px] font-semibold">Incremental margin by discount depth</p>
                <BarChart height={200} format={(v) => inr(v, 1)} posColor="var(--navy)" negColor="var(--red)" data={curves.map((c) => ({ label: `${c.d}%`, value: c.margin, color: c.d === def.depth && mech === PCT ? 'var(--green)' : undefined }))} />
              </div>
            </div>
          </Panel>
          <ImpactPanel />
        </div>
      </div>
    </>
  );
}

function Slider({ label, value, v, on, min, max, step, lo, hi, disabled }: { label: string; value: string; v: number; on: (n: number) => void; min: number; max: number; step: number; lo: string; hi: string; disabled?: boolean }) {
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <div className="flex justify-between text-[11.5px]"><span className="font-semibold">{label}</span><span className="num font-bold">{value}</span></div>
      <input type="range" min={min} max={max} step={step} value={v} disabled={disabled} onChange={(ev) => on(+ev.target.value)} className="w-full" />
      <div className="flex justify-between text-[10px] text-[var(--ink-3)]"><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
}
