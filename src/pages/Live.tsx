// Live campaigns: every finalised plan as a dated campaign, grouped by where it is today (running now, scheduled, ended).
// Numbers are the plan's estimates at finalising. Once the loaded data covers the campaign dates, the real result is measured by
// comparing the customers who got the offer with the customers held back (engine/measure.ts).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarClock, ChevronDown, Download, Info, Square, Trash2, Upload } from 'lucide-react';
import { useApp, useEngine } from '@/state';
import { Kpi, SourceChip } from '@/components/ui';
import { PageTop } from '@/pages/Analytics';
import { skuCatalog } from '@/engine/products';
import { activation } from '@/engine/optimizer';
import { TYPE_BY_ID } from '@/engine/segments';
import { computePlan, productLabel } from '@/lib/plan';
import { demoSales } from '@/lib/liveDemo';
import { endOf, progressOf, statusOf, todayIso, type LiveCampaign, type LiveStatus } from '@/lib/live';
import { saveFile, toCsv } from '@/lib/download';
import { dateLabel, int, money, pct } from '@/lib/fmt';
import { dayOf } from '@/engine/data';
import { measureCampaign, salesSoFar } from '@/engine/measure';
import { reliabilityFor } from '@/lib/targeting';
import { likelyRange } from '@/engine/reliability';
import { makeBackup, parseBackup } from '@/lib/store';

const SECTIONS: { status: LiveStatus; title: string; sub: string }[] = [
  { status: 'running', title: 'Running now', sub: 'Campaigns live today' },
  { status: 'scheduled', title: 'Scheduled', sub: 'Finalised, starting on a later date' },
  { status: 'ended', title: 'Ended', sub: 'Finished or stopped early' },
];

export function Live() {
  const { campaigns, setCampaigns, go, plan, scenarios, restore } = useApp();
  const today = todayIso();
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const exportBackup = () => saveFile('behaviouriq_backup.json', JSON.stringify(makeBackup(plan, scenarios, campaigns), null, 2), 'application/json');
  const importBackup = async (f: File | undefined) => {
    if (!f) return;
    const b = parseBackup(await f.text());
    if (!b) { setNote('That file is not a BehaviourIQ backup.'); return; }
    restore(b);
    setNote(`Restored ${b.campaigns.length} campaign${b.campaigns.length === 1 ? '' : 's'}, ${b.scenarios.length} scenario${b.scenarios.length === 1 ? '' : 's'} and the plan from the backup.`);
  };
  const by = (s: LiveStatus) => campaigns.filter((c) => statusOf(c, today) === s).sort((a, b) => a.start.localeCompare(b.start));
  const running = by('running');
  const scheduled = by('scheduled');
  const stop = (c: LiveCampaign) => setCampaigns(campaigns.map((x) => (x.id === c.id ? { ...x, stoppedOn: today } : x)));
  const remove = (c: LiveCampaign) => setCampaigns(campaigns.filter((x) => x.id !== c.id));

  return (
    <>
      <PageTop title="Live campaigns" sub={`The plans you finalised, as campaigns: what is running today (${dateLabel(today)}), what is scheduled and what has ended`} />
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
          {note && <span className="mr-auto text-[var(--ink-2)]">{note}</span>}
          <span className="text-[var(--ink-3)]">Saved in this browser only.</span>
          <button onClick={exportBackup} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-3 font-semibold text-[var(--ink-2)] hover:border-[var(--ink-3)]"><Download className="h-3.5 w-3.5" />Export a backup</button>
          <button onClick={() => file.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-3 font-semibold text-[var(--ink-2)] hover:border-[var(--ink-3)]"><Upload className="h-3.5 w-3.5" />Import a backup</button>
          <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(ev) => { void importBackup(ev.target.files?.[0]); ev.target.value = ''; }} />
        </div>
        {!campaigns.length ? (
          <div className="card flex flex-col items-center gap-2 px-4 py-12 text-center">
            <CalendarClock className="h-6 w-6 text-[var(--ink-3)]" />
            <p className="text-[14px] font-bold">No campaign yet</p>
            <p className="max-w-[520px] text-[12.5px] text-[var(--ink-3)]">Build a plan on Planning, test it in Simulation, then choose “Finalise and schedule”. It shows here with its dates and status.</p>
            <button onClick={() => go('planning')} className="mt-2 inline-flex h-9 items-center rounded-lg bg-[var(--navy)] px-4 text-[12.5px] font-semibold text-white">Go to Planning</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Running now" value={int(running.length)} note={running.length ? `${int(running.reduce((s, c) => s + c.customers, 0))} customers with an offer` : 'nothing live today'} />
              <Kpi label="Budget live now" value={money(running.reduce((s, c) => s + c.spend, 0))} note="promotion cost of the running campaigns" />
              <Kpi label="Expected extra profit" value={money(running.reduce((s, c) => s + c.incMargin, 0))} note="estimate for the running campaigns" />
              <Kpi label="Scheduled" value={int(scheduled.length)} note={scheduled.length ? `next starts ${dateLabel(scheduled[0].start)}` : 'nothing waiting'} />
            </div>
            <p className="flex items-start gap-1.5 text-[11.5px] text-[var(--ink-3)]">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Budgets and expected results are the plan's estimates at finalising, with a likely range. When the loaded data covers a campaign's dates, its real result appears on its card: customers who got the offer against those held back. To see that, load a newer CSV.
            </p>
            {SECTIONS.map((sec) => {
              const list = by(sec.status);
              if (!list.length) return null;
              return (
                <section key={sec.status}>
                  <div className="mb-2.5 flex items-baseline gap-2">
                    <h2 className="text-[15px] font-bold tracking-tight">{sec.title}</h2>
                    <span className="text-[12px] text-[var(--ink-3)]">{list.length} · {sec.sub}</span>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {list.map((c) => <CampaignCard key={c.id} c={c} status={sec.status} today={today} onStop={() => stop(c)} onRemove={() => remove(c)} />)}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

function CampaignCard({ c, status, today, onStop, onRemove }: { c: LiveCampaign; status: LiveStatus; today: string; onStop: () => void; onRemove: () => void }) {
  const e = useEngine();
  const catalog = useMemo(() => skuCatalog(e.ds), [e]);
  const [confirm, setConfirm] = useState(false);
  const p = progressOf(c, today);
  const range = likelyRange(c.incMargin, reliabilityFor(e).band);
  // real result: only when the loaded data reaches the campaign's first day
  const measured = useMemo(() => {
    if (e.ds.maxDay < dayOf(c.start)) return null;
    return measureCampaign(e.ds, activation(computePlan(e, catalog, c.cfg).plan), c.start, c.days);
  }, [e, catalog, c]);
  // actual sales so far, from the loaded data (a small dropdown on the card)
  const sales = useMemo(() => {
    if (e.ds.maxDay < dayOf(c.start)) return null;
    return salesSoFar(e.ds, activation(computePlan(e, catalog, c.cfg).plan), c.start, c.days);
  }, [e, catalog, c]);
  // demo: no real data for these dates yet, so show what the plan expected for the days gone, labelled as simulated
  const elapsed = c.stoppedOn ? Math.max(0, Math.min(c.days, dayOf(c.stoppedOn) - dayOf(c.start) + 1)) : p.day;
  const demo = useMemo(() => (sales || status === 'scheduled' ? null : demoSales(computePlan(e, catalog, c.cfg).plan, c, elapsed)), [e, catalog, c, sales, status, elapsed]);
  const [showSales, setShowSales] = useState(false);
  const expectedSoFar = measured && c.incBuyers != null ? c.incBuyers * (measured.days / c.days) : null;
  const chip = status === 'running' ? 'bg-[#d1fae5] text-[#065f46]' : status === 'scheduled' ? 'bg-[#e8eef7] text-[var(--navy)]' : 'bg-[var(--page)] text-[var(--ink-2)]';
  // the customer list is rebuilt from the plan's own choices, with the same calculation as when it was finalised
  const download = () => {
    const r = computePlan(e, catalog, c.cfg);
    const rows = activation(r.plan).map((x) => [x.cid, TYPE_BY_ID[x.type].name, x.category, x.offer, x.group === 'treatment' ? 'gets the offer' : 'held back to measure']);
    saveFile(`${c.name.replace(/[^\w]+/g, '_').toLowerCase()}_customers.csv`, toCsv(['customer_id', 'customer_group', 'category', 'offer', 'group'], rows), 'text/csv;charset=utf-8');
  };
  return (
    <article className="card flex flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold" title={c.name}>{c.name}</p>
          <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">{dateLabel(c.start)} – {dateLabel(endOf(c))} · {c.days} days{c.stoppedOn ? ' · stopped early' : ''}</p>
        </div>
        <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip}`}>{status === 'running' ? `Day ${p.day} of ${c.days}` : status === 'scheduled' ? 'Scheduled' : 'Ended'}</span><SourceChip kind="simulated" /></div>
      </div>
      {status === 'running' && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full rounded-full bg-[var(--green)]" style={{ width: `${Math.max(3, p.share * 100)}%` }} /></div>
          <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">{p.left ? `${p.left} day${p.left === 1 ? '' : 's'} left` : 'Last day'}</p>
        </div>
      )}
      <p className="mt-3 text-[12.5px] text-[var(--ink-2)]">{c.summary}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-[var(--line-2)] pt-3 text-[12px] sm:grid-cols-4">
        <Fact k="Budget" v={money(c.spend)} sub={`of ${money(c.budget)}`} />
        <Fact k="Customers" v={int(c.customers)} sub="with an offer" />
        <Fact k="Expected extra profit" v={money(c.incMargin)} sub={`likely ${money(range.low)} – ${money(range.high)}`} />
        <Fact k="Return per ₹1" v={c.spend ? `₹${c.roi.toFixed(2)}` : '–'} sub="estimate" />
      </dl>
      {(sales || demo) && (() => {
        const v = sales ?? demo!;
        const to = sales ? sales.to : demo!.to;
        return (
          <div className="mt-3">
            <button onClick={() => setShowSales(!showSales)} aria-expanded={showSales} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--navy)] hover:underline">
              Sales so far: {money(v.sales)}{demo && <span className="font-normal text-[var(--ink-3)]"> (simulated)</span>}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSales ? 'rotate-180' : ''}`} />
            </button>
            {showSales && (
              <div className="mt-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-[12px] leading-snug">
                <p className="flex flex-wrap items-center gap-2 font-semibold">{sales ? 'Actual sales' : 'Sales'}, {dateLabel(c.start)} – {dateLabel(to)} ({v.days} of {c.days} days){demo && <SourceChip kind="simulated" />}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
                  <Fact k="Total sales" v={money(v.sales)} sub={`${money(v.sales / v.days)} a day`} />
                  <Fact k="Customers who bought" v={int(v.buyers)} sub={`of ${int(v.customers)} with an offer`} />
                  <Fact k="Orders" v={int(v.orders)} sub={`${int(v.units)} units`} />
                  <Fact k="Bought on the offer" v={money(v.onOffer)} sub={`${money(v.discountGiven)} discount given`} />
                </dl>
                {demo && demo.latest.length > 0 && (
                  <div className="mt-2.5 border-t border-[var(--line-2)] pt-2">
                    <p className="text-[11.5px] font-semibold text-[var(--ink-2)]">Latest purchases by customers who got the offer</p>
                    <ul className="mt-1 space-y-0.5">
                      {demo.latest.map((x) => <li key={x.cid} className="flex justify-between gap-3 text-[11.5px] text-[var(--ink-2)]"><span>{x.cid} · {x.category}</span><span className="num text-[var(--ink-3)]">{dateLabel(x.day)} · {money(x.amount)}</span></li>)}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-[var(--ink-3)]">
                  {sales
                    ? `Sales of the categories in this plan by the customers who got the offer, up to ${dateLabel(sales.to)}, the last day in the loaded data.${sales.perHeldBack != null ? ` Per customer: ${money(sales.perCustomer)}, against ${money(sales.perHeldBack)} for the customers held back.` : ''}`
                    : 'Demo figures: the loaded data does not reach this campaign yet, so this is what its plan expected for the days gone. Real sales replace it once the data covers these dates.'}
                </p>
              </div>
            )}
          </div>
        );
      })()}
      {measured && (
        <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2.5 text-[12px] leading-snug">
          <p className="font-semibold">Measured result, first {measured.days} of {c.days} days</p>
          <p className="mt-0.5 text-[var(--ink-2)]">
            {pct(measured.rateTreated, 1)} of the {int(measured.treated.n)} customers who got the offer bought, against {pct(measured.rateHeld, 1)} of the {int(measured.held.n)} held back: <b className="font-semibold text-[var(--ink)]">{measured.lift >= 0 ? '+' : '−'}{Math.abs(measured.lift * 100).toFixed(1)} points</b>, about <b className="num font-semibold text-[var(--ink)]">{int(Math.max(0, measured.extraBuyers))} extra buyers</b>
            {expectedSoFar != null ? <> (expected {int(expectedSoFar)} over the same days)</> : null}.
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">The held-back customers are a small control group, so this is a rough read, and it counts anyone who bought the category, not only on the offer.</p>
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <Action onClick={download} icon={<Download className="h-3.5 w-3.5" />}>Customer list</Action>
        {status === 'running' && (confirm
          ? <><span className="text-[12px] text-[var(--ink-2)]">Stop it today?</span><Action onClick={onStop} danger icon={<Square className="h-3.5 w-3.5" />}>Yes, stop</Action><Action onClick={() => setConfirm(false)}>Keep running</Action></>
          : <Action onClick={() => setConfirm(true)} icon={<Square className="h-3.5 w-3.5" />}>Stop early</Action>)}
        {status !== 'running' && <Action onClick={onRemove} icon={<Trash2 className="h-3.5 w-3.5" />}>{status === 'scheduled' ? 'Cancel' : 'Remove'}</Action>}
        <span className="ml-auto text-[11px] text-[var(--ink-3)]">Finalised {dateLabel(c.finalisedAt.slice(0, 10))} · {productLabel(catalog, c.cfg.products)}</span>
      </div>
    </article>
  );
}

function Fact({ k, v, sub }: { k: string; v: string; sub: string }) {
  return <div><dt className="text-[11px] text-[var(--ink-3)]">{k}</dt><dd className="num text-[14px] font-bold">{v}</dd><dd className="text-[11px] text-[var(--ink-3)]">{sub}</dd></div>;
}

function Action({ children, onClick, icon, danger }: { children: ReactNode; onClick: () => void; icon?: ReactNode; danger?: boolean }) {
  return <button onClick={onClick} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold ${danger ? 'border-[#f3b4b4] bg-[#fdeeee] text-[#b91c1c]' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'}`}>{icon}{children}</button>;
}
