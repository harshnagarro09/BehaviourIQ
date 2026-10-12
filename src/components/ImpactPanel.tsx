import { useMemo } from 'react';
import { Chip, Panel } from '@/components/ui';
import { GroupedBars, Legend } from '@/components/charts';
import { inr, int, pct } from '@/lib/fmt';
import { useEngine } from '@/state';

/** Behaviour-based vs traditional (20% to everyone) for the six planned campaigns: the closing view of the story. */
export function ImpactPanel() {
  const e = useEngine();
  const impact = useMemo(() => {
    const z = () => ({ contacts: 0, cost: 0, margin: 0, inc: 0, leak: 0 });
    const trad = z(); const beh = z();
    for (const r of e.recommendations) {
      const p20 = r.scenarios.find((s) => s.option.key === 'pct20');
      if (!p20) continue;
      trad.contacts += p20.blanket.customers; trad.cost += p20.blanket.discountCost; trad.margin += p20.blanket.incMargin; trad.inc += p20.blanket.incBuyers; trad.leak += p20.blanket.leakage;
      if (r.best) { beh.contacts += r.best.audience.targeted; beh.cost += r.best.discountCost; beh.margin += r.best.incMargin; beh.inc += r.best.incrementalBuyers; beh.leak += r.best.leakage; }
    }
    return { trad, beh };
  }, [e]);
  const smart = e.strategies[e.strategies.length - 1];
  const broad = e.strategies[0];
  return (
    <>
            <Panel title="Business impact: traditional vs behaviour-based" what={`Forecast for the six planned campaigns, behaviour-based vs the same 20% offer to everyone: ${pct(Math.abs(1 - impact.beh.cost / impact.trad.cost))} ${impact.beh.cost <= impact.trad.cost ? 'less' : 'more'} promo investment, ${inr(impact.beh.margin - impact.trad.margin)} more incremental margin.`} defaultOpen={false}
              right={<Chip tone="green">{pct(Math.abs(1 - impact.beh.cost / impact.trad.cost))} {impact.beh.cost <= impact.trad.cost ? 'less' : 'more'} investment · {inr(impact.beh.margin - impact.trad.margin)} more incremental margin</Chip>}
              legend={[{ label: 'Grey', color: '#94a3b8', text: 'traditional: 20% Discount to every recently active customer' }, { label: 'Navy', color: '#0b1c2f', text: 'behaviour-based: best promotion, only for the customer types with a positive uplift' }, { label: 'Subsidy', text: 'promo investment on baseline sales that would have happened anyway' }]}>
              <GroupedBars height={230} format={(v) => inr(v, 0)} series={[{ label: 'Traditional', color: '#94a3b8' }, { label: 'Behaviour-based', color: '#0b1c2f' }]}
                groups={[
                  { label: 'Promo investment', values: [impact.trad.cost, impact.beh.cost] },
                  { label: 'Subsidy', values: [impact.trad.leak, impact.beh.leak] },
                  { label: 'Incremental margin', values: [Math.max(0, impact.trad.margin), Math.max(0, impact.beh.margin)] },
                ]} />
              <div className="mt-1"><Legend items={[{ label: 'Traditional (20% Discount to all)', color: '#94a3b8' }, { label: 'Behaviour-based', color: '#0b1c2f' }]} /></div>
              <div className="mt-4 grid gap-3 text-[12.5px] sm:grid-cols-3">
                {([
                  ['Customers contacted', int(impact.trad.contacts), int(impact.beh.contacts)],
                  ['ROI', (impact.trad.margin / impact.trad.cost).toFixed(2), (impact.beh.margin / impact.beh.cost).toFixed(2)],
                  ['Incremental buyers (uplift)', int(impact.trad.inc), int(impact.beh.inc)],
                ] as [string, string, string][]).map(([l, a, b]) => (
                  <div key={l} className="rounded-lg bg-[var(--page)] p-3"><p className="text-[11px] text-[var(--ink-3)]">{l}</p><p className="num mt-0.5"><span className="text-[var(--ink-3)]">{a}</span> → <b className="text-[14px]">{b}</b></p></div>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-[var(--ink-2)]">
                On the {e.results.length} past campaigns (actual results), contacting only Persuadables returned ROI <b>{smart.roi.toFixed(2)}</b> vs <b>{broad.roi.toFixed(2)}</b> for discounting everyone, with {pct(1 - smart.discountCost / broad.discountCost)} less promo investment.
              </p>
            </Panel>
    </>
  );
}
