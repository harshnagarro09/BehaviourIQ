import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Pencil, Sparkles, X } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Btn, Card, CardTitle, Chip, Kpi, Meter, FilterSelect, Panel } from '@/components/ui';
import { HBars, Stack } from '@/components/charts';
import { PageTop } from '@/pages/Analytics';
import { dayOf } from '@/engine/data';
import { shortOffer } from '@/engine/options';
import { type Recommendation, type Scenario } from '@/engine/planner';
import { TYPES, TYPE_BY_ID } from '@/engine/segments';
import { TYPE_IDS } from '@/engine/insights';
import { inr, int, pct, shortDate } from '@/lib/fmt';
import { Lbl } from '@/components/Help';
import { WindowChip } from '@/components/ui';
import { Takeaway } from '@/components/Takeaway';
import { planningTakeaway } from '@/lib/takeaways';

const COLS = 'grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,0.65fr)_minmax(0,2.3fr)]';

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
  return { persuadable: 'Win Persuadables', sure: 'Reward loyal buyers', lost: 'Re-engage non-responders', dog: 'Protect existing sales' }[top];
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
            <p className="text-[13px] font-semibold">{r.candidate.name} <span className="font-normal text-[var(--ink-3)]">— {sc ? sc.option.label : 'No offer'}</span></p>
            <p className="text-[11.5px] font-medium text-[var(--green-dark)]">{r.candidate.category} · {sc ? `${sc.audience.targeted} of ${sc.audience.total} customers` : 'no profitable audience'}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-3)]" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={r.rationale[0]}>{r.rationale[0]}</p>
          </div>
          <div><Chip tone="navy">{objectiveOf(sc)}</Chip></div>
          <div><p className="text-[12.5px] font-medium">{windowOf(r)}</p><p className="text-[11px] text-[var(--ink-3)]">{r.candidate.days} days</p></div>
          <p className="num text-[13px] font-semibold">{sc ? inr(sc.discountCost) : '–'}</p>
          <div>
            <p className="num text-[12.5px] font-semibold">{sc ? `${Math.round(sc.incrementalBuyers)} extra buyers` : '–'}</p>
            {sc && <p className="num text-[11.5px] font-semibold" style={{ color: sc.roi < 0.3 ? 'var(--amber)' : 'var(--green-dark)' }}>ROI {sc.roi.toFixed(2)} · {inr(sc.net)}</p>}
            {sc && <p className="num text-[11px] text-[var(--ink-3)]">{pct(sc.buyers / Math.max(1, sc.audience.targeted))} response</p>}
          </div>
          <p className="num text-[13px] font-medium">{r.confidence}%</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {d?.status === 'accepted' && <Chip tone="green"><Check className="h-3 w-3" />Accepted</Chip>}
            {d?.status === 'rejected' && <Chip tone="red">Rejected</Chip>}
            {!d && (
              <>
                <Btn variant="primary" disabled={!sc} onClick={() => sc && decide(r.candidate.id, { status: 'accepted', optionKey: sc.option.key })}><Check className="h-3 w-3" />Accept</Btn>
                <Btn variant="reject" onClick={() => decide(r.candidate.id, { status: 'rejected', optionKey: '' })}><X className="h-3 w-3" />Reject</Btn>
              </>
            )}
            {d && <Btn onClick={() => decide(r.candidate.id, null)}>Undo</Btn>}
            <Btn onClick={() => setOpen(isOpen ? null : r.candidate.id)}><Pencil className="h-3 w-3" />Modify<ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></Btn>
          </div>
        </div>
        {r.flagReason && <p className="flex items-center gap-1.5 px-4 pb-3 text-[11.5px] text-[var(--warn)]"><AlertTriangle className="h-3 w-3" />{r.flagReason}</p>}
        {isOpen && <Detail r={r} onSimulate={() => go('simulation', { slot: r.candidate.id })} />}
      </div>
    );
  };

  const header = (
    <div className={`grid ${COLS} gap-3 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]`}>
      {['Campaign & offer', 'Objective', 'Week / duration', 'Budget', 'Predicted', 'Confidence', 'Actions'].map((h) => <span key={h} title={h === 'Confidence' ? 'How much past campaign history in this category the recommendation draws on' : undefined}>{h}</span>)}
    </div>
  );

  return (
    <>
      <PageTop title="Planning" sub="Recommended promotion calendar for the next quarter, built from simulated customer response" />
      <div className="space-y-4 p-6">
        <Takeaway>{planningTakeaway({ campaigns: e.recommendations.length, net: e.recommendations.reduce((s, r) => s + (r.best?.net ?? 0), 0), flagged: attention.length })}</Takeaway>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Total upcoming" value={`${e.recommendations.length} campaigns`} note={`${accepted.length} accepted`} />
          <Kpi label="Budget committed" value={inr(budget)} note="discount spend on accepted campaigns" />
          <Kpi label="Needing action" value={`${attention.length} campaigns`} tone={attention.length ? 'bad' : undefined} note="flagged for review" />
          <Kpi label="Budget at risk" value={inr(atRisk)} tone={atRisk ? 'bad' : undefined} note="in flagged campaigns" />
        </div>

        <Card pad={false}>
          <div className="flex items-center justify-between px-4 pt-4">
            <CardTitle title="Recommended Campaigns" sub={`${ready.length} campaigns recommended for the next 3 months`} />
            <div className="flex items-center gap-2"><WindowChip /><Chip tone="green"><Sparkles className="h-3 w-3" />Rule-based</Chip></div>
          </div>
          {header}
          {ready.map(row)}
          {!ready.length && <p className="border-t border-[var(--line)] p-4 text-[12.5px] text-[var(--ink-3)]">Nothing is ready without review.</p>}
        </Card>

        {attention.length > 0 && (
          <section className="overflow-hidden rounded-[10px] border border-[#f1d9a0] bg-[#fdf8e8]">
            <div className="flex items-center justify-between px-4 pt-4">
              <div className="mb-3">
                <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><AlertTriangle className="h-3.5 w-3.5 text-[var(--amber)]" />Needs Attention</h3>
                <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">These campaigns are flagged for review before committing</p>
              </div>
              <Chip tone="amber">{attention.length} campaigns</Chip>
            </div>
            {header}
            {attention.map(row)}
          </section>
        )}

        <Card>
          <CardTitle title="Calendar Gaps Detected" sub="Opportunities no planned campaign covers, " />
          <div className="space-y-2">
            {lapsed > 0 && <Gap title={`${lapsed} regular customers have gone quiet`} body="They ordered 8+ times but nothing in 45 days. No planned campaign targets win-back; consider a reactivation offer." />}
            {uncovered.map((t) => <Gap key={t} title={`${TYPE_BY_ID[t].name} customers are left out`} body={`${e.stats.find((s) => s.type === t)!.n} customers get no offer in any recommended campaign. ${TYPE_BY_ID[t].play}`} />)}
            {!lapsed && !uncovered.length && <p className="text-[12.5px] text-[var(--ink-3)]">No gaps found.</p>}
          </div>
        </Card>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel title="Who each campaign targets" what="Mix of customer types that receive the offer. Shows the targeting logic at a glance." defaultOpen={false}
            legend={TYPES.map((t) => ({ label: t.short, color: t.color, text: 'Share of the audience in this customer type.' }))}>
            <div className="space-y-3">
              {e.recommendations.map((r) => {
                const sc = chosen(r);
                return (
                  <div key={r.candidate.id}>
                    <div className="mb-1 flex justify-between text-[12px]"><span className="font-medium">{r.candidate.name}</span><span className="num text-[var(--ink-3)]">{sc ? `${sc.audience.targeted} customers` : 'no offer'}</span></div>
                    {sc ? <Stack height={10} parts={TYPES.map((t) => ({ label: t.short, value: sc.audience.byType[t.id].targeted, color: t.color }))} /> : <div className="h-[10px] rounded bg-[var(--line)]" />}
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title="Audience coverage across the six campaigns" what="Share of each customer type that receives an offer. Low coverage is deliberate for customers who would buy anyway." defaultOpen={false}>
            <HBars labelW={110} max={1} format={(v) => pct(v)}
              rows={TYPES.map((t) => { const tot = e.recommendations.reduce((a, r) => a + (r.best?.audience.byType[t.id].total ?? 0), 0) || 1; const tg = e.recommendations.reduce((a, r) => a + (r.best?.audience.byType[t.id].targeted ?? 0), 0); return { label: t.short, value: tg / tot, color: t.color }; })} />
          </Panel>
        </div>

        <Panel title="Smart Alerts" what={`${e.alerts.filter((a) => a.id !== 'lapsed').length} things the watchdog found in the last 13 campaigns`} defaultOpen={false}>
            <div className="space-y-2">
              {e.alerts.filter((a) => a.id !== 'lapsed').map((a) => (
                <div key={a.id} className="rounded-lg border border-[var(--line)] p-2.5">
                  <p className="flex items-center gap-2 text-[12.5px] font-semibold"><Chip tone={a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'neutral'}>{a.severity}</Chip>{a.title}</p>
                  <p className="mt-1 text-[12px] leading-snug text-[var(--ink-2)]">{a.detail}</p>
                </div>
              ))}
            </div>
        </Panel>
      </div>
    </>
  );
}

function Gap({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-[var(--line)] bg-[#fafbfd] p-2.5">
      <Chip tone="amber">Gap</Chip>
      <div><p className="text-[12.5px] font-semibold">{title}</p><p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-2)]">{body}</p></div>
    </div>
  );
}

function Detail({ r, onSimulate }: { r: Recommendation; onSimulate: () => void }) {
  const { decisions, decide } = useApp();
  const d = decisions[r.candidate.id];
  const [key, setKey] = useState(d?.optionKey || r.best?.option.key || r.scenarios[0].option.key);
  const sc = r.scenarios.find((s) => s.option.key === key)!;

  const maxResp = Math.max(...r.scenarios.map((s) => s.buyers / Math.max(1, s.audience.targeted)), 0.01);
  return (
    <div className="grid gap-6 border-t border-dashed border-[var(--line)] bg-[#f8fafc] px-5 py-4 lg:grid-cols-3">
      <div>
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Simulated response by promotion</p>
        <div className="space-y-1.5">
          {r.scenarios.map((s) => {
            const resp = s.buyers / Math.max(1, s.audience.targeted);
            const sel = s.option.key === key;
            return (
              <button key={s.option.key} onClick={() => setKey(s.option.key)} className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${sel ? 'bg-white ring-1 ring-[var(--navy)]' : 'hover:bg-white'}`}>
                <span className="w-[68px] shrink-0 text-[11.5px] font-medium">{shortOffer(s.option.label)}</span>
                <Meter value={resp / maxResp} color={s.net > 0 ? 'var(--navy)' : '#cbd5e1'} width={90} />
                <span className="num w-8 text-[11.5px] font-semibold">{s.audience.targeted ? pct(resp) : '–'}</span>
                <span className="num w-14 text-right text-[11.5px]" style={{ color: s.net < 0 ? 'var(--red)' : 'var(--ink-2)' }}>{inr(s.net)}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-[var(--ink-3)]">Response among the customers worth targeting, and the net profit for each offer.</p>
      </div>

      <div>
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Why this recommendation</p>
        <ul className="space-y-1.5 text-[12px] leading-snug text-[var(--ink-2)]">{r.rationale.map((t, i) => <li key={i}>• {t}</li>)}</ul>
      </div>

      <div>
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Audience for {sc.option.label}</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TYPES.map((t) => <span key={t.id} className="flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-[var(--line)]"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.short} {sc.audience.byType[t.id].targeted}/{sc.audience.byType[t.id].total}</span>)}
        </div>
        <dl className="mb-3 grid grid-cols-3 gap-2 text-[11.5px]">
          {[['Customers', int(sc.audience.targeted)], ['Net profit', inr(sc.net)], ['ROI', sc.roi.toFixed(2)], ['Discount', inr(sc.discountCost)], ['Subsidy', inr(sc.leakage)], ['If sent to all', inr(sc.blanket.net)]].map(([l, v]) => <div key={l}><dt className="text-[var(--ink-3)]"><Lbl t={l} /></dt><dd className="num text-[13px] font-semibold">{v}</dd></div>)}
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
