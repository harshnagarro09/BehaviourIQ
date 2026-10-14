// Planning > Who to target: the customer group cards, and the behaviour alerts as keep / leave-out decisions.

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useApp } from '@/state';
import { alertText, shiftText } from '@/lib/alerts';
import { TYPE_BY_ID } from '@/engine/segments';
import { MIN_SEG_UPLIFT } from '@/engine/targeting';
import type { TypeId } from '@/engine/behaviour';
import type { ShiftFrom } from '@/engine/shifts';
import { type GroupInsight, type PlanAlertView, type PlanShiftView, type SegmentInsight, type AlertPeriod, ALERT_PERIODS } from '@/lib/plan';
import { SIM_WINDOW_DAYS } from '@/engine/simulation';
import { roiColor } from '@/lib/colors';
import { int, pct } from '@/lib/fmt';
import { per1 } from './shared';

export function Seg({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] font-semibold text-[var(--ink-3)]">{label}</span>
      <div className="inline-flex rounded-lg border border-[var(--line)] bg-white p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${value === v ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

/** Why one segment of a customer group is, or is not, worth an offer: the same three tests the plan applies */
function segmentWhy(t: TypeId, s: SegmentInsight, hurdle: number, maxSubsidy: number | null): string {
  const pts = Math.round((s.p1 - s.p0) * 100);
  const sub = s.subsidy != null ? Math.round(s.subsidy * 100) : null;
  const who = s.segment === 'lapsing' ? 'These slowing or inactive customers' : 'They';
  if (t === 'dog') return 'They buy less when offers run. Leave them out to protect the sales they already bring.';
  if (s.roi == null) return 'No offer for these products moves them enough to pay back.';
  if (s.recommended) {
    return `${s.segment === 'lapsing' ? 'Worth a win-back offer: ' : 'An offer changes whether they buy: '}about ${Math.max(0, pts)} more buyers in every 100, each ₹1 returns ${per1(s.roi)} in extra profit${sub != null ? `, and only ${sub}% of the discount pays for sales that would happen anyway` : ''}.`;
  }
  if (pts < MIN_SEG_UPLIFT * 100) return `${who} barely react: even the best offer moves their buying chance only from ${pct(s.p0)} to ${pct(s.p1)}, fewer than ${MIN_SEG_UPLIFT * 100} more buyers in 100.`;
  if (maxSubsidy != null && sub != null && s.subsidy! > maxSubsidy) return `${who} mostly buy anyway: ${sub}% of the discount would pay for purchases they make regardless (your limit is ${Math.round(maxSubsidy * 100)}%), so the money buys little new.`;
  if (s.roi < hurdle) return `The best offer returns ${per1(s.roi)} per ₹1, below your minimum of ${per1(hurdle)}.`;
  return 'No offer for these products pays back for them.';
}

/** A customer group: how an offer works for it (all the customers chosen under "Start from"), the verdict, and a tick to have it in the plan */
export function GroupCard({ g, on, onToggle, hurdle, maxSubsidy }: { g: GroupInsight; on: boolean; onToggle: () => void; hurdle: number; maxSubsidy: number | null }) {
  const t = TYPE_BY_ID[g.type];
  const win = g.segments.find((s) => s.segment === 'lapsing' && s.recommended);
  const verdict = g.type === 'dog' ? { label: 'Do not target', cls: 'bg-[#fdeeee] text-[#b91c1c]' } : g.recommended ? { label: 'Recommended', cls: 'bg-[#d1fae5] text-[#065f46]' } : { label: 'Not recommended', cls: 'bg-[var(--page)] text-[var(--ink-2)]' };
  const asSegment: SegmentInsight = { segment: 'active', customers: g.customers, recommended: g.recommended, p0: g.p0, p1: g.p1, roi: g.roi, subsidy: g.subsidy, incMargin: g.incMargin, cost: g.cost, offer: g.offer };
  return (
    <div className={`rounded-lg border p-3 ${on ? 'border-[var(--navy)] bg-[#f7f9fc] shadow-[inset_0_0_0_1px_var(--navy)]' : 'border-[var(--line)] bg-white'}`}>
      <div className="flex items-start gap-2.5">
        <button onClick={onToggle} disabled={!g.customers} aria-pressed={on} aria-label={`${on ? 'Leave out' : 'Include'} ${t.name}`} title={on ? 'In the plan: click to leave out' : 'Not in the plan: click to include'}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border disabled:opacity-40 ${on ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[#c9d2de] bg-white'}`}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</button>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-bold">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />{t.name}
            <span className={`rounded-full px-1.5 py-px text-[10.5px] font-semibold ${verdict.cls}`}>{verdict.label}</span>
            <span className="num text-[12px] font-normal text-[var(--ink-3)]">{int(g.customers)} customers</span>
          </p>
          <p className="text-[11.5px] text-[var(--ink-3)]">{t.tagline}</p>
          {g.customers > 0 ? (
            <>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
                <div><dt className="text-[var(--ink-3)]" title={`Estimate: chance of buying in the next ${SIM_WINDOW_DAYS} days, without and with the best offer${g.offer ? ` (${g.offer})` : ''}`}>Buying chance</dt><dd className="num text-[13px] font-bold">{pct(g.p0)} → {pct(g.p1)}</dd></div>
                <div><dt className="text-[var(--ink-3)]" title="Estimate: extra profit for every ₹1 the best offer costs">Return per ₹1</dt><dd className="num text-[13px] font-bold" style={{ color: g.roi != null ? roiColor(g.roi) : undefined }}>{g.roi != null ? per1(g.roi) : '–'}</dd></div>
                <div><dt className="text-[var(--ink-3)]" title="Estimate: share of the offer's cost that pays for purchases they would make anyway">Pays for sales anyway</dt><dd className="num text-[13px] font-bold">{g.subsidy != null ? pct(g.subsidy) : '–'}</dd></div>
              </dl>
              <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-2)]">{segmentWhy(g.type, asSegment, hurdle, maxSubsidy)}</p>
              {win && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-2)]">Includes a win-back offer for {int(win.customers)} slowing or inactive customers: {pct(win.p0)} → {pct(win.p1)} buying chance, {win.roi != null ? per1(win.roi) : '–'} back per ₹1.</p>}
              {on && !g.recommended && g.type !== 'dog' && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-2)]">Ticked, but under your current rules no offer qualifies for them, so they get no money. Loosen the rules under Advanced settings to fund them.</p>}
            </>
          ) : <p className="mt-2 text-[11.5px] text-[var(--ink-2)]">No customers of this group match the "Start from" choice.</p>}
        </div>
      </div>
    </div>
  );
}

/** Behaviour alerts as plan decisions: what is different, how an offer works for those customers compared with the rest of
 * their group, and a keep / leave out choice. Plain rows in the page's own style. */
export function Exceptions({ alerts, shifts, period, onPeriod, onToggle, onToggleWake, onLeaveSuggested }: {
  alerts: PlanAlertView[]; shifts: PlanShiftView[]; period: AlertPeriod; onPeriod: (p: AlertPeriod) => void; onToggle: (key: string) => void; onToggleWake: (from: ShiftFrom) => void; onLeaveSuggested: (keys: string[]) => void;
}) {
  const { go } = useApp();
  const [filter, setFilter] = useState<'all' | TypeId>('all');
  const types = [...new Set(alerts.map((a) => a.alert.type))];
  const shown = alerts.filter((a) => filter === 'all' || a.alert.type === filter);
  const inPlan = alerts.filter((a) => a.inPlan);
  const toLeave = inPlan.filter((a) => a.suggest === 'leave' && !a.leftOut).map((a) => a.key);
  return (
    <div className="mt-4 border-t border-[var(--line-2)] pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold">Customers who behave differently</p>
          <p className="mt-0.5 max-w-[760px] text-[11.5px] text-[var(--ink-3)]">
            {!alerts.length && !shifts.length ? 'In this period every group behaves consistently, so nobody needs separate treatment.'
              : [shifts.length ? 'Customers who have started reacting to offers lately can be added to the plan.' : '', alerts.length ? `The behaviour alerts from Behaviour Analytics: ${inPlan.length ? `${inPlan.length} of ${alerts.length} ${inPlan.length === 1 ? 'is' : 'are'} about groups in your plan, so choose to keep those customers in or leave them out.` : 'none is about a group in your plan, so there is nothing to decide.'}` : ''].filter(Boolean).join(' ')}
          </p>
        </div>
        <Seg label="Last" value={period} onChange={(v) => onPeriod(v as AlertPeriod)} options={ALERT_PERIODS.map((x) => [x.id, x.label] as [string, string])} />
      </div>
      {shifts.length > 0 && (
        <ul className="mt-2.5 divide-y divide-[var(--line-2)] rounded-lg border border-[var(--line)] bg-white">
          {shifts.map((x, i) => <ShiftRow key={x.shift.from} n={i + 1} s={x} onToggle={() => onToggleWake(x.shift.from)} onSee={() => go('analytics')} />)}
        </ul>
      )}
      {(types.length > 1 || toLeave.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {types.length > 1 && (['all', ...types] as const).map((tp) => (
            <button key={tp} onClick={() => setFilter(tp)} aria-pressed={filter === tp}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${filter === tp ? 'border-[var(--navy)] bg-[#eef3fa] text-[var(--navy)]' : 'border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'}`}>
              {tp === 'all' ? 'All' : TYPE_BY_ID[tp].name} <span className="num font-normal text-[var(--ink-3)]">{tp === 'all' ? alerts.length : alerts.filter((a) => a.alert.type === tp).length}</span>
            </button>
          ))}
          {toLeave.length > 0 && <button onClick={() => onLeaveSuggested(toLeave)} className="ml-auto text-[12px] font-semibold text-[var(--navy)] hover:underline">Leave out the {toLeave.length} we suggest</button>}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="mt-2.5 divide-y divide-[var(--line-2)] rounded-lg border border-[var(--line)] bg-white">
          {shown.map((a, i) => <AlertRow key={a.key} n={shifts.length + i + 1} a={a} onToggle={() => onToggle(a.key)} onSee={() => go('analytics')} />)}
        </ul>
      )}
    </div>
  );
}

/** Lost Causes / Sleeping Dogs who have started buying on promotion: an offer for them is an opportunity, so the decision is to add them */
function ShiftRow({ n, s, onToggle, onSee }: { n: number; s: PlanShiftView; onToggle: () => void; onSee: () => void }) {
  const x = shiftText(s.shift);
  const t = TYPE_BY_ID[s.shift.from];
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);
  return (
    <li>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 px-3.5 py-3 text-left">
        <span className="num mt-px w-4 shrink-0 text-[12.5px] font-semibold text-[var(--ink-3)]">{n}.</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold leading-snug">{x.title}</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--ink-3)]">{x.data}</span>
        </span>
        {s.added && <span className="mt-0.5 shrink-0 text-[11.5px] font-semibold text-[var(--ink-3)]">Added</span>}
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-3 px-3.5 pb-3 pl-[42px] md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="min-w-0">
            {s.them && s.rest ? (
              <p className="text-[12px] leading-snug text-[var(--ink-2)]">
                With their best offer on {s.scope}, <b className="num font-semibold text-[var(--ink)]">{pct(s.them.p0)} → {pct(s.them.p1)}</b> of these customers would buy, against <b className="num font-semibold text-[var(--ink)]">{pct(s.rest.p0)} → {pct(s.rest.p1)}</b> for the other {t.name}. An offer is worth it for {pct(s.them.passing)} of them and {pct(s.rest.passing)} of the others.
              </p>
            ) : <p className="text-[12px] text-[var(--ink-3)]">Not enough purchases in {s.scope} to compare how an offer works for them.</p>}
            <p className="mt-1 text-[12px] leading-snug text-[var(--ink-2)]">
              {!s.inPlan ? 'Persuadables are not in this plan, so there is nothing to decide.'
                : s.added ? 'Added: they are planned as Persuadables, with an offer worked out from their own buying, and are counted in the budget, the customer list and the results.'
                : s.suggest === 'add' ? <><b className="font-semibold">Suggestion:</b> add them, an offer is worth it for most of them.</>
                : <><b className="font-semibold">Suggestion:</b> {s.shift.from === 'dog' ? 'leave them out: Sleeping Dogs were put off by offers, so wait for more evidence.' : 'an offer is worth it for under half of them, so add them only if you want to test it.'}</>}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11.5px]">
              <button onClick={() => setWhy(!why)} aria-expanded={why} className="font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]">{why ? 'Hide the reason' : 'Why is this flagged?'}</button>
              <button onClick={onSee} className="font-semibold text-[var(--navy)] hover:underline">See them in Behaviour Analytics</button>
            </div>
            {why && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-3)]">{x.why}</p>}
          </div>
          {s.inPlan && (
            <div className="inline-flex shrink-0 rounded-lg border border-[var(--line)] bg-white p-0.5" role="radiogroup" aria-label="Add or leave out">
              {([[true, 'Add to plan'], [false, 'Leave out']] as const).map(([v, l]) => (
                <button key={l} role="radio" aria-checked={s.added === v} onClick={() => s.added !== v && onToggle()}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${s.added === v ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{l}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function AlertRow({ n, a, onToggle, onSee }: { n: number; a: PlanAlertView; onToggle: () => void; onSee: () => void }) {
  const x = alertText(a.alert);
  const t = TYPE_BY_ID[a.alert.type];
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);
  const where = a.scope;
  return (
    <li>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 px-3.5 py-3 text-left">
        <span className="num mt-px w-4 shrink-0 text-[12.5px] font-semibold text-[var(--ink-3)]">{n}.</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold leading-snug">{x.title}</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--ink-3)]">{x.data}</span>
        </span>
        {a.leftOut && <span className="mt-0.5 shrink-0 text-[11.5px] font-semibold text-[var(--ink-3)]">Left out</span>}
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-3 px-3.5 pb-3 pl-[42px] md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="min-w-0">
            {a.them && a.rest ? (
              <p className="text-[12px] leading-snug text-[var(--ink-2)]">
                With their best offer on {where}, <b className="num font-semibold text-[var(--ink)]">{pct(a.them.p0)} → {pct(a.them.p1)}</b> of these customers would buy, against <b className="num font-semibold text-[var(--ink)]">{pct(a.rest.p0)} → {pct(a.rest.p1)}</b> for the rest of {t.name}. An offer is worth it for {pct(a.them.passing)} of them and {pct(a.rest.passing)} of the rest.
              </p>
            ) : <p className="text-[12px] text-[var(--ink-3)]">Not enough purchases in {where} to compare how an offer works for them.</p>}
            <p className="mt-1 text-[12px] leading-snug text-[var(--ink-2)]">
              {!a.inPlan ? `${t.name} get no discount in this plan, so there is nothing to decide.`
                : a.leftOut ? 'Left out: these customers get no offer and are not counted in the budget, the customer list or the results.'
                : a.suggest === 'leave' ? <><b className="font-semibold">Suggestion:</b> leave them out, an offer pays off for clearly fewer of them than for the rest of the group.</>
                : <><b className="font-semibold">Suggestion:</b> keep them in, an offer works for them about as well as for the rest of the group.</>}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11.5px]">
              <button onClick={() => setWhy(!why)} aria-expanded={why} className="font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]">{why ? 'Hide the reason' : 'Why is this flagged?'}</button>
              <button onClick={onSee} className="font-semibold text-[var(--navy)] hover:underline">See them in Behaviour Analytics</button>
            </div>
            {why && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-3)]">{x.why} “Worth it” means some offer changes what the customer buys, pays back and does not mostly pay for sales that would happen anyway.</p>}
          </div>
          {a.inPlan && (
            <div className="inline-flex shrink-0 rounded-lg border border-[var(--line)] bg-white p-0.5" role="radiogroup" aria-label="Keep or leave out">
              {([[false, 'Keep in plan'], [true, 'Leave out']] as const).map(([v, l]) => (
                <button key={l} role="radio" aria-checked={a.leftOut === v} onClick={() => a.leftOut !== v && onToggle()}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${a.leftOut === v ? 'bg-[var(--navy)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--page)]'}`}>{l}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
