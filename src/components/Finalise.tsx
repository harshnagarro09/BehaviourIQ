// Finalise the plan: name it, pick its dates, and it is scheduled on Live campaigns. Used on Planning and on Simulation.
import { useState, type ReactNode } from 'react';
import { ArrowRight, CalendarCheck, Check, RotateCcw } from 'lucide-react';
import { useApp } from '@/state';
import { describeOffer, groupText, productLabel, sameConfig, type PlanResult } from '@/lib/plan';
import { endOf, lengthFactor, statusOf, todayIso, type LiveCampaign } from '@/lib/live';
import type { Sku } from '@/engine/products';
import { dateLabel, int, money } from '@/lib/fmt';
import { SIM_WINDOW_DAYS } from '@/engine/simulation';
import { useEngine } from '@/state';
import { reliabilityFor } from '@/lib/targeting';
import { likelyRange } from '@/engine/reliability';

const LENGTHS = [7, 14, 21, 28];
const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-[#e8eef7] text-[var(--navy)]' },
  running: { label: 'Running now', cls: 'bg-[#d1fae5] text-[#065f46]' },
  ended: { label: 'Ended', cls: 'bg-[var(--page)] text-[var(--ink-2)]' },
};

const rangeText = (v: number, band: number) => { const r = likelyRange(v, band); return `${money(r.low)} – ${money(r.high)}`; };

export function FinaliseBox({ r, catalog, extra }: { r: PlanResult; catalog: Sku[]; extra?: ReactNode }) {
  const { plan, campaigns, setCampaigns, go, campaignName: name, setCampaignName: setName } = useApp();
  const e = useEngine();
  const band = reliabilityFor(e).band;
  const products = productLabel(catalog, plan.products);
  const [start, setStart] = useState(todayIso());
  const [days, setDays] = useState(14);
  // the campaign this exact plan was finalised as (if any)
  const latest = [...campaigns].reverse().find((c) => sameConfig(c.cfg, plan)) ?? null;
  // a campaign that has ended does not block scheduling the same plan again
  const live = latest && statusOf(latest) !== 'ended' ? latest : null;
  const status = live ? statusOf(live) : null;
  // the model estimates one ${SIM_WINDOW_DAYS}-day window; the campaign's length scales the money figures
  const k = lengthFactor(days);
  const scaled = { spend: r.plan.spend * k, incMargin: r.plan.incMargin * k, incRevenue: r.plan.incRevenue * k, incBuyers: r.plan.incBuyers * k };
  const overBudget = scaled.spend > r.settings.budget * 1.0001;

  const finalise = () => {
    const c: LiveCampaign = {
      id: `${Date.now()}`, name: name.trim() || `${products} · ${groupText(r)}`, cfg: plan, finalisedAt: new Date().toISOString(), start, days,
      summary: `${groupText(r)} · ${products} · ${describeOffer(r)}`,
      spend: scaled.spend, budget: r.settings.budget, incMargin: scaled.incMargin, incRevenue: scaled.incRevenue, incBuyers: scaled.incBuyers, roi: r.plan.roi, customers: r.reached,
    };
    setCampaigns([...campaigns, c]);
    setName('');
  };
  // reopening a campaign that has not started takes it off the schedule; one that is running or ended stays on record
  const reopen = () => live && status === 'scheduled' && setCampaigns(campaigns.filter((c) => c.id !== live.id));

  if (live && status) {
    const s = STATUS[status];
    return (
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold">This plan is finalised<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span></p>
          <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">
            “{live.name}”, {dateLabel(live.start)} – {dateLabel(endOf(live))}: {money(live.spend)} on {int(live.customers)} customers for an expected {money(live.incMargin)} extra profit (likely {rangeText(live.incMargin, band)}).
            {status === 'scheduled' ? ' Reopen it to take it off the schedule and change it.' : ' Any change you make now becomes a new plan; this campaign keeps its settings.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          {status === 'scheduled' && (
            <button onClick={reopen} title="Take this campaign off the schedule so the plan can be changed and finalised again"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-4 text-[12.5px] font-semibold text-[var(--ink-2)] hover:border-[var(--ink-3)]"><RotateCcw className="h-3.5 w-3.5" />Reopen the plan</button>
          )}
          <button onClick={() => go('live')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--navy)] px-4 text-[12.5px] font-semibold text-white hover:opacity-95">Live campaigns<ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold">Finalise and schedule the campaign</p>
          {latest && !live && <p className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">This plan already ran as “{latest.name}” ({dateLabel(latest.start)} – {dateLabel(endOf(latest))}). Schedule it again below.</p>}
          <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">{groupText(r)} · {products} · {money(scaled.spend)} over {days} days for an expected {money(scaled.incMargin)} extra profit (likely {rangeText(scaled.incMargin, band)}). Once finalised it shows on Live campaigns.</p>
        </div>
        {extra && <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">{extra}</div>}
      </div>
      <div className="mt-3 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="block min-w-0">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">Campaign name</span>
          <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder={`${products} · ${groupText(r)}`}
            className="h-10 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] outline-none focus:border-[var(--navy)]" />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">Starts on</span>
          <input type="date" value={start} onChange={(ev) => ev.target.value && setStart(ev.target.value)}
            className="h-10 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] outline-none focus:border-[var(--navy)]" />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]">Runs for</span>
          <select value={days} onChange={(ev) => setDays(+ev.target.value)} className="h-10 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] font-semibold outline-none focus:border-[var(--navy)]">
            {LENGTHS.map((d) => <option key={d} value={d}>{d} days{d === SIM_WINDOW_DAYS ? ' (as estimated)' : ''}</option>)}
          </select>
        </label>
        <button onClick={finalise} disabled={!r.plan.allocations.length}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--navy)] px-4 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-40">
          <CalendarCheck className="h-3.5 w-3.5" />Finalise and schedule
        </button>
      </div>
      {overBudget && <p className="mt-2 rounded-md bg-[#fff8ee] px-3 py-2 text-[12px] leading-snug text-[#92400e]">At {days} days the offer would cost about {money(scaled.spend)}, more than the {money(r.settings.budget)} budget. Shorten the campaign, or raise the budget in Planning.</p>}
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-[var(--ink-3)]"><Check className="mt-0.5 h-3 w-3 shrink-0" />The model estimates a {SIM_WINDOW_DAYS}-day offer window; for {days} days the money figures are scaled in proportion, assuming buying continues at the same pace. The likely range comes from how far the model was off on recent campaigns. The campaign keeps the plan exactly as it is now.</p>
    </section>
  );
}
