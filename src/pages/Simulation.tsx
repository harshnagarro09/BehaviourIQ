import { useMemo, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Btn, Card, CardTitle, Chip, Panel, ViewToggle } from '@/components/ui';
import { PageTop } from '@/pages/Analytics';
import { BarChart, LineChart } from '@/components/charts';
import { TYPES } from '@/engine/segments';
import { TYPE_IDS } from '@/engine/insights';
import type { TypeId } from '@/engine/behaviour';
import { expect, type Expectation } from '@/engine/economics';
import { activeAt, buildCtxs, CANDIDATES } from '@/engine/planner';
import { promoOptions, shortOffer } from '@/engine/options';
import { inr, int, pct, shortDate } from '@/lib/fmt';
import { Lbl } from '@/components/Help';
import { WindowChip } from '@/components/ui';
import { Takeaway } from '@/components/Takeaway';
import { ImpactPanel } from '@/components/ImpactPanel';
import { simulationTakeaway } from '@/lib/takeaways';

type Objective = 'profit' | 'volume' | 'conquest' | 'reactivate';
const OBJECTIVES: { id: Objective; label: string; hint: string }[] = [
  { id: 'profit', label: 'Maximise profit', hint: 'Only customers where the offer earns more than it costs' },
  { id: 'volume', label: 'Maximise extra buyers', hint: 'Anyone whose chance of buying rises by 5+ points' },
  { id: 'conquest', label: 'Win competitor customers', hint: 'Customers who mostly buy competitor brands' },
  { id: 'reactivate', label: 'Reactivate quiet customers', hint: 'Customers with no order in the last 30 days' },
];
const MECH = [
  { id: 'PCT_OFF', label: 'Percentage Discount' },
  { id: 'FLAT_OFF', label: '₹ Off on Minimum Spend' },
  { id: 'BOGO', label: 'BOGO' },
  { id: 'MULTIBUY_3FOR2', label: 'Bundle / Combo Offer' },
];

interface Item { type: TypeId; recency: number; ourShare: number; e: Expectation }
interface Sim {
  targeted: number; total: number; buyers: number; inc: number; units: number; revenue: number; incRevenue: number; margin: number;
  cost: number; leak: number; net: number; roi: number; byType: Record<TypeId, number>;
}

function simulate(items: Item[], L: number, objective: Objective, types: Set<TypeId>, budget: number | null): Sim {
  let pool = items.filter((x) => types.has(x.type));
  if (objective === 'profit') pool = pool.filter((x) => x.e.net > 0 && x.e.uplift >= 0.03);
  if (objective === 'volume') pool = pool.filter((x) => x.e.uplift >= 0.05);
  if (objective === 'conquest') pool = pool.filter((x) => x.ourShare < 0.3);
  if (objective === 'reactivate') pool = pool.filter((x) => x.recency > 30);
  pool = [...pool].sort((a, b) => b.e.net / Math.max(1, b.e.discountCost) - a.e.net / Math.max(1, a.e.discountCost));
  const o: Sim = { targeted: 0, total: items.length, buyers: 0, inc: 0, units: 0, revenue: 0, incRevenue: 0, margin: 0, cost: 0, leak: 0, net: 0, roi: 0, byType: { anyways: 0, deal: 0, stockup: 0, switcher: 0, ignores: 0 } };
  for (const x of pool) {
    if (budget !== null && o.cost + x.e.discountCost > budget) continue;
    o.targeted++;
    o.buyers += x.e.p1;
    o.inc += x.e.uplift;
    o.units += x.e.units;
    o.revenue += x.e.revenue;
    o.incRevenue += x.e.revenue - x.e.baseUnits * L;
    o.margin += x.e.profitOffer;
    o.cost += x.e.discountCost;
    o.leak += x.e.leakage;
    o.net += x.e.net;
    o.byType[x.type]++;
  }
  o.roi = o.cost ? o.net / o.cost : 0;
  return o;
}

export function Simulation() {
  const e = useEngine();
  const { params, decisions, go } = useApp();
  const slot = params.slot && CANDIDATES.some((c) => c.id === params.slot) ? params.slot : CANDIDATES[1].id;
  const rec = e.recommendations.find((r) => r.candidate.id === slot)!;
  const cand = rec.candidate;
  const best = rec.best;
  const L = e.ds.ourEcon[cand.category].list;

  const [objective, setObjective] = useState<Objective>('profit');
  const [mech, setMech] = useState('PCT_OFF');
  const [depth, setDepth] = useState(best?.option.depth ?? 15);
  const [types, setTypes] = useState<Set<TypeId>>(new Set(TYPE_IDS));
  const [budgetOn, setBudgetOn] = useState(false);
  const [budgetK, setBudgetK] = useState(5);
  const [guard, setGuard] = useState(0.3);
  const [cmpView, setCmpView] = useState<'chart' | 'table'>('chart');
  const [lastSlot, setLastSlot] = useState(slot);
  if (lastSlot !== slot) {
    setLastSlot(slot);
    if (best) { setMech(best.option.mechanic); setDepth(best.option.depth); }
  }
  const fixedOpt = promoOptions(e.ds, cand.category).find((o) => o.family === 'fixed')!;
  const depthEff = mech === 'BOGO' ? 50 : mech === 'MULTIBUY_3FOR2' ? 33 : mech === 'FLAT_OFF' ? fixedOpt.depth : depth;
  const budget = budgetOn ? budgetK * 1000 : null;

  const ctxs = useMemo(() => buildCtxs(e.ds, activeAt(e.ds, e.asOf), cand.category, e.asOf), [e, cand.category]);
  const build = (d: number, m: string, minSpend?: number): Item[] => ctxs.map((ctx) => {
    const r = e.recById.get(ctx.cid)!;
    return { type: r.type, recency: r.b.recencyDays, ourShare: r.b.ourShareFull, e: expect(e.ds, e.model, ctx, { category: cand.category, depth: d, mechanic: m, minSpend: m === 'FLAT_OFF' ? (minSpend ?? fixedOpt.minSpend) : undefined }) };
  });
  const sim = useMemo(() => simulate(build(depthEff, mech, fixedOpt.minSpend), L, objective, types, budget), [e, ctxs, depthEff, mech, objective, types, budget]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => promoOptions(e.ds, cand.category), [e, cand.category]);
  const table = useMemo(() => options.map((o) => {
    if (o.family === 'none') {
      const its = build(10, 'PCT_OFF');
      return { o, none: true, s: null as Sim | null, resp: its.reduce((s, x) => s + x.e.p0, 0) / Math.max(1, its.length), orders: its.reduce((s, x) => s + x.e.p0, 0) };
    }
    const s = simulate(build(o.depth, o.mechanic, o.minSpend), L, objective, types, budget);
    return { o, none: false, s, resp: s.targeted ? s.buyers / s.targeted : 0, orders: s.buyers };
  }), [e, ctxs, options, objective, types, budget]); // eslint-disable-line react-hooks/exhaustive-deps
  const bestRow = table.filter((r) => !r.none && r.s && r.s.net > 0).sort((a, b) => b.s!.net - a.s!.net)[0];

  const curve = useMemo(() => [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((d) => ({ d, net: simulate(build(d, 'PCT_OFF'), L, objective, types, budget).net })), [e, ctxs, objective, types, budget]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeCurve = useMemo(() => [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((d) => {
    const its = build(d, 'PCT_OFF');
    const byType = {} as Record<TypeId, number>;
    for (const t of TYPE_IDS) { const g = its.filter((x) => x.type === t); byType[t] = g.length ? g.reduce((a, x) => a + x.e.p1, 0) / g.length : 0; }
    return { d, byType };
  }), [e, ctxs]); // eslint-disable-line react-hooks/exhaustive-deps
  const violations: string[] = [];
  if (sim.targeted === 0) violations.push('No customer meets the chosen objective and audience.');
  else {
    if (sim.roi < guard) violations.push(`Predicted ROI ${sim.roi.toFixed(2)} is below the guardrail of ${guard.toFixed(2)}.`);
    if (sim.net < 0) violations.push(`Expected net profit is negative (${inr(sim.net)}).`);
  }
  const applyAi = () => { if (best) { setMech(best.option.mechanic); setDepth(best.option.depth); setObjective('profit'); setTypes(new Set(TYPE_IDS)); setBudgetOn(false); } };
  const toggle = (t: TypeId) => { const n = new Set(types); if (n.has(t)) n.delete(t); else n.add(t); setTypes(n); };
  const status = (id: string) => decisions[id]?.status === 'accepted' ? <Chip tone="navy">Accepted</Chip> : decisions[id]?.status === 'rejected' ? <Chip tone="red">Rejected</Chip> : e.recommendations.find((r) => r.candidate.id === id)!.flag === 'attention' ? <Chip tone="amber">Needs attention</Chip> : <Chip tone="green">Recommended</Chip>;

  const Metric = ({ l, v, tone }: { l: string; v: string; tone?: 'bad' | 'good' }) => (
    <div><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-3)]"><Lbl t={l} /></p><p className="num mt-0.5 text-[15px] font-bold" style={{ color: tone === 'bad' ? 'var(--red)' : tone === 'good' ? 'var(--green-dark)' : undefined }}>{v}</p></div>
  );

  return (
    <>
      <PageTop title="Simulation" sub="Model campaign scenarios and see the predicted customer response before spending" />
      <div className="px-6 pt-4"><Takeaway>{simulationTakeaway({ targeted: sim.targeted, total: sim.total, net: sim.net, roi: sim.roi })}</Takeaway></div>
      <div className="grid gap-4 p-6 pt-4 lg:grid-cols-[250px_1fr]">
        <aside className="card h-fit overflow-hidden">
          <p className="border-b border-[var(--line)] px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Campaigns ({CANDIDATES.length})</p>
          {CANDIDATES.map((c) => {
            const r = e.recommendations.find((x) => x.candidate.id === c.id)!;
            const on = c.id === slot;
            return (
              <button key={c.id} onClick={() => go('simulation', { slot: c.id })} className={`block w-full border-b border-[var(--line-2)] px-3.5 py-2.5 text-left last:border-0 ${on ? 'bg-[var(--navy)] text-white' : 'hover:bg-[var(--page)]'}`}>
                <span className="flex items-start justify-between gap-2"><span className="text-[12.5px] font-semibold leading-snug">{c.name}</span>{on ? <Chip tone="neutral">{decisions[c.id]?.status === 'accepted' ? 'Accepted' : 'Selected'}</Chip> : status(c.id)}</span>
                <span className={`mt-0.5 block text-[11px] ${on ? 'text-white/60' : 'text-[var(--ink-3)]'}`}>{c.category} · {r.best ? `ROI ${r.best.roi.toFixed(2)}` : 'no profitable offer'}</span>
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
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Mechanic</p>
                <select value={mech} onChange={(ev) => setMech(ev.target.value)} className="h-8 w-full rounded-md border border-[var(--line)] bg-white px-2 text-[12.5px]">
                  {MECH.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <p className="mt-2 text-[11.5px] text-[var(--ink-3)]">Category: <b className="text-[var(--ink)]">{cand.category}</b></p>
              </div>
              <Slider label={mech === 'FLAT_OFF' ? `₹${Math.round(fixedOpt.depth * L / 100)} off, min spend ₹${fixedOpt.minSpend}` : 'Incentive depth'} value={`${depthEff}%`} disabled={mech !== 'PCT_OFF'} min={5} max={50} step={5} v={depthEff} on={setDepth} lo="5%" hi="50%" />
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold"><input type="checkbox" checked={budgetOn} onChange={(ev) => setBudgetOn(ev.target.checked)} />Cap discount budget</label>
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
              {best && <Btn variant="ai" onClick={applyAi}><Sparkles className="h-3 w-3" />Get AI Alternative</Btn>}
            </div>
          )}

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-2"><CardTitle title="Scenario Comparison" sub="AI recommended baseline vs your adjusted simulation" /><WindowChip /></div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-[#a7e8c8] bg-[#f0fdf7] p-4">
                <Chip tone="green"><Sparkles className="h-3 w-3" />AI Recommended</Chip>
                <p className="mb-3 mt-1.5 text-[11.5px] text-[var(--ink-3)]">{best ? `${best.option.label} · ${cand.days} days · ${inr(best.discountCost)} budget` : 'No profitable offer for this slot'}</p>
                {best ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Metric l="Customers" v={`${best.audience.targeted}/${best.audience.total}`} /><Metric l="Extra buyers" v={int(best.incrementalBuyers)} /><Metric l="Revenue" v={inr(best.revenue)} />
                    <Metric l="ROI" v={best.roi.toFixed(2)} tone="good" /><Metric l="Net profit" v={inr(best.net)} /><Metric l="Leakage" v={inr(best.leakage)} />
                  </div>
                ) : <p className="text-[12.5px] text-[var(--ink-2)]">Every offer loses money for this audience.</p>}
                <Btn className="mt-4 w-full" onClick={applyAi} disabled={!best}>Apply AI Recommended</Btn>
              </div>
              <div className="rounded-lg border border-[var(--line)] p-4">
                <Chip tone="navy">Simulated</Chip>
                <p className="mb-3 mt-1.5 text-[11.5px] text-[var(--ink-3)]">{mech === 'PCT_OFF' ? `${depthEff}% Discount` : MECH.find((m) => m.id === mech)!.label} · {inr(sim.cost)} budget</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Metric l="Customers" v={`${sim.targeted}/${sim.total}`} /><Metric l="Extra buyers" v={int(sim.inc)} /><Metric l="Revenue" v={inr(sim.revenue)} />
                  <Metric l="ROI" v={sim.roi.toFixed(2)} tone={sim.roi < guard ? 'bad' : 'good'} /><Metric l="Net profit" v={inr(sim.net)} tone={sim.net < 0 ? 'bad' : undefined} /><Metric l="Leakage" v={inr(sim.leak)} />
                </div>
                <Btn variant="navy" className="mt-4 w-full" disabled={violations.length > 0} onClick={() => undefined}>Apply Simulated</Btn>
              </div>
            </div>
          </Card>

          <Panel flush title="Compare promotion options" what={`Same objective and audience, every promotion type for ${cand.category}. Highest response is rarely the best decision.`}
            right={<ViewToggle value={cmpView} onChange={setCmpView} />}
            legend={[
              { label: 'Grey bar', color: '#94a3b8', text: 'No Promotion: what these customers do anyway.' },
              { label: 'Green bar', color: 'var(--green)', text: 'Promotion with the highest profit.' },
              { label: 'Predicted response', text: 'Average chance of buying among the customers selected by your objective and audience.' },
              { label: 'Incremental revenue', text: 'Revenue above what would have sold anyway.' },
              { label: 'Net profit', text: 'After discount cost and stock borrowed from later weeks. Red is a loss.' },
            ]}>
            {(() => {
              const rs = table.filter((r) => !r.none && r.s);
              const hrRow = rs.reduce<(typeof rs)[number] | null>((a, r) => (!a || r.resp > a.resp ? r : a), null);
              if (!hrRow || !bestRow || hrRow.o.key === bestRow.o.key) return null;
              return (
                <p className="mx-4 mb-2 rounded-md border border-[#f3d9b4] bg-[#fff8ee] px-3 py-2 text-[12px] text-[var(--ink-2)]">
                  <b>Prediction vs decision.</b> Highest predicted response: {shortOffer(hrRow.o.label)} ({pct(hrRow.resp)}), but it earns {inr(hrRow.s!.net, 0)}. Most profitable: {shortOffer(bestRow.o.label)} ({pct(bestRow.resp)}), earning {inr(bestRow.s!.net, 0)}.
                </p>
              );
            })()}
            {cmpView === 'chart' ? (
              <div className="grid gap-4 px-4 pb-4 pt-1 md:grid-cols-3">
                <div><p className="mb-1 text-[11.5px] font-semibold">Predicted response</p>
                  <BarChart height={200} format={(v) => pct(v)} showValues color="var(--navy)" data={table.map((r) => ({ label: shortOffer(r.o.label), value: r.resp, color: r.none ? '#94a3b8' : bestRow?.o.key === r.o.key ? 'var(--green)' : 'var(--navy)' }))} /></div>
                <div><p className="mb-1 text-[11.5px] font-semibold">Incremental revenue</p>
                  <BarChart height={200} format={(v) => inr(v, 0)} showValues posColor="var(--navy)" negColor="var(--red)" data={table.filter((r) => r.s).map((r) => ({ label: shortOffer(r.o.label), value: r.s!.incRevenue, color: bestRow?.o.key === r.o.key ? 'var(--green)' : undefined }))} /></div>
                <div><p className="mb-1 text-[11.5px] font-semibold">Net profit</p>
                  <BarChart height={200} format={(v) => inr(v, 0)} showValues posColor="var(--navy)" negColor="var(--red)" data={table.filter((r) => r.s).map((r) => ({ label: shortOffer(r.o.label), value: r.s!.net, color: bestRow?.o.key === r.o.key ? 'var(--green)' : undefined }))} /></div>
              </div>
            ) : (<div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead><tr className="border-y border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                  <th className="px-4 py-2 text-left">Promotion</th>{['Response', 'Expected orders', 'Revenue', 'Incremental revenue', 'Margin', 'Promotion cost', 'Net profit', 'ROI'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody>
                  {table.map((r) => {
                    const s = r.s;
                    const topResp = !r.none && table.filter((x) => !x.none && x.s!.targeted >= Math.max(10, 0.05 * x.s!.total)).reduce((a, b) => (b.resp > a.resp ? b : a)).o.key === r.o.key;
                    const isBest = bestRow?.o.key === r.o.key;
                    return (
                      <tr key={r.o.key} className={`border-b border-[var(--line-2)] text-right last:border-0 ${isBest ? 'bg-[#f0fdf7]' : ''}`}>
                        <td className="px-4 py-2.5 text-left"><span className="font-semibold">{r.o.label}</span> <span className="ml-1 inline-flex gap-1">{isBest && <Chip tone="green">Highest profit</Chip>}{topResp && <Chip tone="amber">Highest response</Chip>}</span></td>
                        <td className="num px-3 font-semibold">{s && s.targeted === 0 ? '–' : pct(r.resp)}</td>
                        <td className="num px-3">{int(r.orders)}</td>
                        <td className="num px-3">{s ? inr(s.revenue) : '–'}</td>
                        <td className="num px-3">{s ? inr(s.incRevenue) : '–'}</td>
                        <td className="num px-3" style={{ color: s && s.margin < 0 ? 'var(--red)' : undefined }}>{s ? inr(s.margin) : '–'}</td>
                        <td className="num px-3">{s ? inr(s.cost) : '–'}</td>
                        <td className="num px-3 font-semibold" style={{ color: s && s.net < 0 ? 'var(--red)' : undefined }}>{s ? inr(s.net) : '–'}</td>
                        <td className="num px-3 font-semibold" style={{ color: s && s.roi < 0 ? 'var(--red)' : undefined }}>{s ? s.roi.toFixed(2) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>)}
          </Panel>

          <Panel title="Discount depth: response and profit" what="As the percentage discount deepens, predicted response rises while net profit peaks and then falls." defaultOpen={false}
            legend={[...TYPES.map((t) => ({ label: t.short, color: t.color, text: 'Average predicted chance of buying among all recently active customers of this type.' })), { label: 'Reading the lines', text: 'A steep line means customers can be persuaded by depth; a high flat line means they buy anyway; a low flat line means discounts do not move them.' }, { label: 'Bars', text: 'Expected net profit at each depth; green is the depth selected in the controls, red a loss.' }]}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div><p className="mb-1 text-[11.5px] font-semibold">Response by customer type</p>
                <LineChart height={210} yMax={1} xFormat={(v) => `${v}%`} yFormat={(v) => pct(v)} xTicks={[5, 15, 25, 35, 50]} markers={false}
                  series={TYPES.map((t) => ({ name: t.short, color: t.color, points: typeCurve.map((c) => ({ x: c.d, y: c.byType[t.id] })) }))} />
              </div>
              <div><p className="mb-1 text-[11.5px] font-semibold">Net profit by discount depth</p>
                <BarChart height={200} format={(v) => inr(v, 1)} posColor="var(--navy)" negColor="var(--red)" data={curve.map((c) => ({ label: `${c.d}%`, value: c.net, color: c.d === depthEff && mech === 'PCT_OFF' ? 'var(--green)' : undefined }))} />
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
