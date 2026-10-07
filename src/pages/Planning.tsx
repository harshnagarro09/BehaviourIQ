import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Pencil, Sparkles, X } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Btn, Card, CardTitle, Chip, Kpi, Meter, FilterSelect, Panel } from '@/components/ui';
import { BarChart, HBars, Stack } from '@/components/charts';
import { PageTop } from '@/pages/Analytics';
import { dayOf } from '@/engine/data';
import { explain, FACTOR_ORDER, shortOffer } from '@/engine/options';
import { buildCtxs, activeAt, type Recommendation, type Scenario } from '@/engine/planner';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import { TYPE_IDS } from '@/engine/insights';
import { inr, int, pct, shortDate } from '@/lib/fmt';

const COLS = 'grid-cols-[minmax(0,2.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1.7fr)]';

function windowOf(r: Recommendation) {
  const end = new Date((dayOf(r.candidate.start) + r.candidate.days - 1) * 864e5).toISOString().slice(0, 10);
  return `${shortDate(r.candidate.start)} – ${shortDate(end)}`;
}

function objectiveOf(s: Scenario | null): string {
  if (!s) return 'Protect margin';
  const bt = s.audience.byType;
  // the type that is most over-represented in the audience compared with the whole base
  const lift = (t: (typeof TYPE_IDS)[number]) => (bt[t].targeted / Math.max(1, s.audience.targeted)) / (bt[t].total / Math.max(1, s.audience.total) || 1);
  const top = TYPE_IDS.reduce((a, b) => (lift(b) > lift(a) ? b : a));
  return { deal: 'Convert deal seekers', stockup: 'Grow basket size', switcher: 'Win competitor buyers', anyways: 'Reward loyal buyers', ignores: 'Re-engage non-responders' }[top];
}

export function Planning() {
  const e = useEngine();
  const { decisions, decide, go } = useApp();
  const [open, setOpen] = useState<string | null>(null);

  const chosen = (r: Recommendation): Scenario | null => {
    const d = decisions[r.candidate.id];
    return d?.status === 'accepted' ? r.scenarios.find((s) => s.option.key === d.optionKey) ?? r.best : r.best;
  };
  const accepted = e.recommendations.filter((r) => decisions[r.candidate.id]?.status === 'accepted');
  const budget = accepted.reduce((s, r) => s + (chosen(r)?.discountCost ?? 0), 0);
  const ready = e.recommendations.filter((r) => r.flag === 'ready');
  const attention = e.recommendations.filter((r) => r.flag === 'attention');
  const atRisk = attention.reduce((s, r) => s + (chosen(r)?.discountCost ?? 0), 0);
  const lapsed = e.records.filter((r) => r.b.recencyDays > 45 && r.b.nOrders >= 8).length;
  const uncovered = TYPE_IDS.filter((t) => e.recommendations.every((r) => !r.best || r.best.audience.byType[t].targeted === 0));

  const row = (r: Recommendation) => {
    const sc = chosen(r);
    const d = decisions[r.candidate.id];
    const isOpen = open === r.candidate.id;
    return (
      <div key={r.candidate.id} className="border-t border-[var(--line)]">
        <div className={`grid ${COLS} items-center gap-3 px-4 py-3.5`}>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{r.candidate.name} <span className="font-normal text-[var(--ink-3)]">— {sc ? sc.option.label : 'No offer'}</span></p>
            <p className="text-[10.5px] font-medium text-[var(--green-dark)]">{r.candidate.category} · {sc ? `${sc.audience.targeted} of ${sc.audience.total} customers` : 'no profitable audience'}</p>
            <p className="mt-0.5 truncate text-[10.5px] text-[var(--ink-3)]">{r.rationale[0]}</p>
          </div>
          <div><Chip tone="navy">{objectiveOf(sc)}</Chip></div>
          <div><p className="text-[11.5px] font-medium">{windowOf(r)}</p><p className="text-[10px] text-[var(--ink-3)]">{r.candidate.days} days</p></div>
          <p className="num text-[12px] font-semibold">{sc ? inr(sc.discountCost) : '–'}</p>
          <div>
            <p className="num text-[11.5px] font-semibold">{sc ? `${Math.round(sc.incrementalBuyers)} extra buyers` : '–'}</p>
            {sc && <p className="num text-[10.5px] font-semibold" style={{ color: sc.roi < 0.3 ? 'var(--amber)' : 'var(--green-dark)' }}>ROI {sc.roi.toFixed(2)} · {inr(sc.net)}</p>}
            {sc && <p className="num text-[10px] text-[var(--ink-3)]">{pct(sc.buyers / Math.max(1, sc.audience.targeted))} response</p>}
          </div>
          <p className="num text-[12px] font-medium">{r.confidence}%</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {d?.status === 'accepted' && <Chip tone="green"><Check className="h-3 w-3" />Accepted</Chip>}
            {d?.status === 'rejected' && <Chip tone="red">Rejected</Chip>}
            {!d && (
              <>
                <Btn variant="accept" disabled={!sc} onClick={() => sc && decide(r.candidate.id, { status: 'accepted', optionKey: sc.option.key })}><Check className="h-3 w-3" />Accept</Btn>
                <Btn variant="reject" onClick={() => decide(r.candidate.id, { status: 'rejected', optionKey: '' })}><X className="h-3 w-3" />Reject</Btn>
              </>
            )}
            {d && <Btn onClick={() => decide(r.candidate.id, null)}>Undo</Btn>}
            <Btn onClick={() => setOpen(isOpen ? null : r.candidate.id)}><Pencil className="h-3 w-3" />Modify<ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></Btn>
          </div>
        </div>
        {r.flagReason && <p className="flex items-center gap-1.5 px-4 pb-3 text-[10.5px] text-[var(--warn)]"><AlertTriangle className="h-3 w-3" />{r.flagReason}</p>}
        {isOpen && <Detail r={r} onSimulate={() => go('simulation', { slot: r.candidate.id })} />}
      </div>
    );
  };

  const header = (
    <div className={`grid ${COLS} gap-3 px-4 py-2 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]`}>
      {['Campaign & offer', 'Objective', 'Week / duration', 'Budget', 'Predicted', 'Confidence', 'Actions'].map((h) => <span key={h} title={h === 'Confidence' ? 'How well the model picks performed in tests on campaigns it had not seen, for this category' : undefined}>{h}</span>)}
    </div>
  );

  return (
    <>
      <PageTop title="Planning" sub="AI-recommended promotion calendar for the next quarter, built from predicted customer response" />
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Total upcoming" value={`${e.recommendations.length} campaigns`} note={`${accepted.length} accepted`} />
          <Kpi label="Budget committed" value={inr(budget)} note="discount spend on accepted campaigns" />
          <Kpi label="Needing action" value={`${attention.length} campaigns`} tone={attention.length ? 'bad' : undefined} note="flagged for review" />
          <Kpi label="Budget at risk" value={inr(atRisk)} tone={atRisk ? 'bad' : undefined} note="in flagged campaigns" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Expected net profit by campaign" what="What the best promotion for each planned campaign is expected to earn, after discount cost."
            legend={[{ label: 'Bar height', text: 'Expected net profit over the campaign window: margin on promoted sales, minus the margin customers would have earned anyway, minus stock borrowed from later weeks.' }, { label: 'Green bar', color: 'var(--green)', text: 'Campaign you have accepted.' }, { label: 'Navy bar', color: 'var(--navy)', text: 'Still to be decided.' }, { label: 'Label under the bar', text: 'The promotion chosen for that campaign.' }]}>
            <BarChart height={210} posColor="var(--navy)" negColor="var(--red)" format={(v) => inr(v, 0)} showValues
              data={e.recommendations.map((r) => { const sc = chosen(r); return { label: r.candidate.name.split(' ')[0].slice(0, 8), sub: sc ? shortOffer(sc.option.label) : 'none', value: sc?.net ?? 0, color: decisions[r.candidate.id]?.status === 'accepted' ? 'var(--green)' : undefined, tip: <><b>{r.candidate.name}</b><br />{sc ? sc.option.label : 'No profitable offer'} · {sc ? inr(sc.net) : '–'}</> }; })} />
          </Panel>
          <Panel title="Who each campaign targets" what="Mix of customer types that receive the offer. Shows the targeting logic at a glance." defaultOpen={false}
            legend={TYPES.map((t) => ({ label: t.short, color: t.color, text: 'Share of the audience in this customer type.' }))}>
            <div className="space-y-3">
              {e.recommendations.map((r) => {
                const sc = chosen(r);
                return (
                  <div key={r.candidate.id}>
                    <div className="mb-1 flex justify-between text-[11px]"><span className="font-medium">{r.candidate.name}</span><span className="num text-[var(--ink-3)]">{sc ? `${sc.audience.targeted} customers` : 'no offer'}</span></div>
                    {sc ? <Stack height={10} parts={TYPES.map((t) => ({ label: t.short, value: sc.audience.byType[t.id].targeted, color: t.color }))} /> : <div className="h-[10px] rounded bg-[var(--line)]" />}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        <Card pad={false}>
          <div className="flex items-center justify-between px-4 pt-4">
            <CardTitle title="AI Recommended Campaigns" sub={`${ready.length} campaigns recommended for the next 3 months`} />
            <Chip tone="green"><Sparkles className="h-3 w-3" />AI Generated</Chip>
          </div>
          {header}
          {ready.map(row)}
          {!ready.length && <p className="border-t border-[var(--line)] p-4 text-[11.5px] text-[var(--ink-3)]">Nothing is ready without review.</p>}
        </Card>

        {attention.length > 0 && (
          <section className="overflow-hidden rounded-[10px] border border-[#f1d9a0] bg-[#fdf8e8]">
            <div className="flex items-center justify-between px-4 pt-4">
              <div className="mb-3">
                <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><AlertTriangle className="h-3.5 w-3.5 text-[var(--amber)]" />Needs Attention</h3>
                <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">AI has flagged these campaigns for review before committing</p>
              </div>
              <Chip tone="amber">{attention.length} campaigns</Chip>
            </div>
            {header}
            {attention.map(row)}
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle title="Calendar Gaps Detected" sub="Opportunities no planned campaign covers, identified by AI" />
            <div className="space-y-2">
              {lapsed > 0 && <Gap title={`${lapsed} regular customers have gone quiet`} body="They ordered 8+ times but nothing in 45 days. No planned campaign targets win-back; consider a reactivation offer." />}
              {uncovered.map((t) => <Gap key={t} title={`${TYPE_BY_ID[t].name} customers are left out`} body={`${e.stats.find((s) => s.type === t)!.n} customers get no offer in any recommended campaign. ${TYPE_BY_ID[t].play}`} />)}
              {!lapsed && !uncovered.length && <p className="text-[11.5px] text-[var(--ink-3)]">No gaps found.</p>}
            </div>
            <p className="mb-0.5 mt-5 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Audience coverage across the six campaigns</p>
            <p className="mb-2 text-[10.5px] text-[var(--ink-3)]">Bar = share of each customer type that receives an offer.</p>
            <HBars labelW={110} max={1} format={(v) => pct(v)}
              rows={TYPES.map((t) => { const tot = e.recommendations.reduce((a, r) => a + (r.best?.audience.byType[t.id].total ?? 0), 0) || 1; const tg = e.recommendations.reduce((a, r) => a + (r.best?.audience.byType[t.id].targeted ?? 0), 0); return { label: t.short, value: tg / tot, color: t.color }; })} />
            <p className="mt-2 text-[10.5px] text-[var(--ink-3)]">Share of each customer type that receives an offer. Low coverage is deliberate for customers who would buy anyway.</p>
          </Card>
          <Card>
            <CardTitle title="Smart Alerts" sub="What the watchdog found in the last 13 campaigns" />
            <div className="space-y-2">
              {e.alerts.filter((a) => a.id !== 'lapsed').map((a) => (
                <div key={a.id} className="rounded-lg border border-[var(--line)] p-2.5">
                  <p className="flex items-center gap-2 text-[11.5px] font-semibold"><Chip tone={a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'neutral'}>{a.severity}</Chip>{a.title}</p>
                  <p className="mt-1 text-[11px] leading-snug text-[var(--ink-2)]">{a.detail}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Gap({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-[var(--line)] bg-[#fafbfd] p-2.5">
      <Chip tone="amber">Gap</Chip>
      <div><p className="text-[11.5px] font-semibold">{title}</p><p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-2)]">{body}</p></div>
    </div>
  );
}

function Detail({ r, onSimulate }: { r: Recommendation; onSimulate: () => void }) {
  const e = useEngine();
  const { decisions, decide } = useApp();
  const d = decisions[r.candidate.id];
  const [key, setKey] = useState(d?.optionKey || r.best?.option.key || r.scenarios[0].option.key);
  const sc = r.scenarios.find((s) => s.option.key === key)!;

  // which behaviours drive the prediction for this campaign's audience
  const drivers = useMemo(() => {
    const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), r.candidate.category, e.asOf);
    const target = ctxs.filter((c) => (r.expectations.get(c.cid)?.net ?? -1) > 0);
    const pool = target.length ? target : ctxs;
    const sums = new Map<string, number>();
    const dir = new Map<string, number>();
    for (const c of pool) {
      for (const f of explain(e.model, c, sc.option.depth, sc.option.mechanic, r.candidate.category)) {
        sums.set(f.factor, (sums.get(f.factor) ?? 0) + Math.abs(f.effect));
        dir.set(f.factor, (dir.get(f.factor) ?? 0) + f.effect);
      }
    }
    const tot = [...sums.values()].reduce((a, b) => a + b, 0) || 1;
    return FACTOR_ORDER.map((f) => ({ f, share: (sums.get(f) ?? 0) / tot, up: (dir.get(f) ?? 0) >= 0 })).sort((a, b) => b.share - a.share).slice(0, 5);
  }, [e, r, sc]);

  const maxResp = Math.max(...r.scenarios.map((s) => s.buyers / Math.max(1, s.audience.targeted)), 0.01);
  return (
    <div className="grid gap-6 border-t border-dashed border-[var(--line)] bg-[#f8fafc] px-5 py-4 lg:grid-cols-3">
      <div>
        <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Predicted response by promotion</p>
        <div className="space-y-1.5">
          {r.scenarios.map((s) => {
            const resp = s.buyers / Math.max(1, s.audience.targeted);
            const sel = s.option.key === key;
            return (
              <button key={s.option.key} onClick={() => setKey(s.option.key)} className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${sel ? 'bg-white ring-1 ring-[var(--navy)]' : 'hover:bg-white'}`}>
                <span className="w-[68px] shrink-0 text-[10.5px] font-medium">{shortOffer(s.option.label)}</span>
                <Meter value={resp / maxResp} color={s.net > 0 ? 'var(--navy)' : '#cbd5e1'} width={90} />
                <span className="num w-8 text-[10.5px] font-semibold">{s.audience.targeted ? pct(resp) : '–'}</span>
                <span className="num w-14 text-right text-[10.5px]" style={{ color: s.net < 0 ? 'var(--red)' : 'var(--ink-2)' }}>{inr(s.net)}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-[var(--ink-3)]">Response among the customers worth targeting, and the net profit for each offer.</p>
      </div>

      <div>
        <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Behaviours behind the prediction</p>
        <div className="space-y-2">
          {drivers.map((x) => (
            <div key={x.f} className="flex items-center gap-2 text-[11px]">
              <span className="w-[150px] shrink-0 truncate">{x.f}</span>
              <Meter value={x.share / drivers[0].share} color={x.up ? 'var(--green)' : 'var(--amber)'} width={70} />
              <span className="num text-[10.5px] text-[var(--ink-3)]">{pct(x.share)}</span>
            </div>
          ))}
        </div>
        <ul className="mt-3 space-y-1 text-[11px] leading-snug text-[var(--ink-2)]">{r.rationale.slice(0, 3).map((t, i) => <li key={i}>• {t}</li>)}</ul>
      </div>

      <div>
        <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Audience for {sc.option.label}</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TYPES.map((t) => <span key={t.id} className="flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-[var(--line)]"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.short} {sc.audience.byType[t.id].targeted}/{sc.audience.byType[t.id].total}</span>)}
        </div>
        <dl className="mb-3 grid grid-cols-3 gap-2 text-[10.5px]">
          {[['Customers', int(sc.audience.targeted)], ['Net profit', inr(sc.net)], ['ROI', sc.roi.toFixed(2)], ['Discount', inr(sc.discountCost)], ['Leakage', inr(sc.leakage)], ['If sent to all', inr(sc.blanket.net)]].map(([l, v]) => <div key={l}><dt className="text-[var(--ink-3)]">{l}</dt><dd className="num text-[12px] font-semibold">{v}</dd></div>)}
        </dl>
        <div className="flex gap-2">
          <Btn variant="navy" disabled={!sc.audience.targeted} onClick={() => decide(r.candidate.id, { status: 'accepted', optionKey: key })}>Accept this version</Btn>
          <Btn onClick={onSimulate}>Open in Simulation</Btn>
        </div>
      </div>
    </div>
  );
}
void FilterSelect;
