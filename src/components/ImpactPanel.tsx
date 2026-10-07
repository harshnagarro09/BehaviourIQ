import { useMemo } from 'react';
import { Chip, Panel } from '@/components/ui';
import { GroupedBars, Legend } from '@/components/charts';
import { inr, int, pct } from '@/lib/fmt';
import { useEngine } from '@/state';

/** Behaviour-based vs traditional (20% to everyone) for the six planned campaigns: the closing view of the story. */
export function ImpactPanel() {
  const e = useEngine();
  const impact = useMemo(() => {
    const z = () => ({ contacts: 0, cost: 0, net: 0, inc: 0, leak: 0 });
    const trad = z(); const beh = z();
    for (const r of e.recommendations) {
      const p20 = r.scenarios.find((s) => s.option.key === 'pct20')!;
      trad.contacts += p20.blanket.customers; trad.cost += p20.blanket.discountCost; trad.net += p20.blanket.net; trad.inc += p20.blanket.incBuyers; trad.leak += p20.blanket.leakage;
      if (r.best) { beh.contacts += r.best.audience.targeted; beh.cost += r.best.discountCost; beh.net += r.best.net; beh.inc += r.best.incrementalBuyers; beh.leak += r.best.leakage; }
    }
    return { trad, beh };
  }, [e]);
  const smart = e.strategies.find((s) => s.name.startsWith('Target persuadable'))!;
  const broad = e.strategies[0];
  return (
    <>
            <Panel title="Business impact: traditional vs behaviour-based" what={`Forecast for the six planned campaigns, behaviour-based vs the same 20% offer to everyone: ${pct(1 - impact.beh.cost / impact.trad.cost)} less discount, ${inr(impact.beh.net - impact.trad.net)} more profit.`} defaultOpen={false}
              right={<Chip tone="green">{pct(1 - impact.beh.cost / impact.trad.cost)} less discount · {inr(impact.beh.net - impact.trad.net)} more profit</Chip>}
              legend={[{ label: 'Grey', color: '#94a3b8', text: 'traditional: 20% Discount to every recently active customer' }, { label: 'Navy', color: '#0b1c2f', text: 'behaviour-based: best promotion, only where it pays off' }, { label: 'Leakage', text: 'discount given to sales that would have happened anyway' }]}>
              <GroupedBars height={230} format={(v) => inr(v, 0)} series={[{ label: 'Traditional', color: '#94a3b8' }, { label: 'Behaviour-based', color: '#0b1c2f' }]}
                groups={[
                  { label: 'Promotion cost', values: [impact.trad.cost, impact.beh.cost] },
                  { label: 'Discount leakage', values: [impact.trad.leak, impact.beh.leak] },
                  { label: 'Net profit', values: [Math.max(0, impact.trad.net), Math.max(0, impact.beh.net)] },
                ]} />
              <div className="mt-1"><Legend items={[{ label: 'Traditional (20% Discount to all)', color: '#94a3b8' }, { label: 'Behaviour-based', color: '#0b1c2f' }]} /></div>
              <div className="mt-4 grid gap-3 text-[11.5px] sm:grid-cols-3">
                {([
                  ['Customers contacted', int(impact.trad.contacts), int(impact.beh.contacts)],
                  ['ROI', (impact.trad.net / impact.trad.cost).toFixed(2), (impact.beh.net / impact.beh.cost).toFixed(2)],
                  ['Extra buyers caused', int(impact.trad.inc), int(impact.beh.inc)],
                ] as [string, string, string][]).map(([l, a, b]) => (
                  <div key={l} className="rounded-lg bg-[var(--page)] p-3"><p className="text-[10px] text-[var(--ink-3)]">{l}</p><p className="num mt-0.5"><span className="text-[var(--ink-3)]">{a}</span> → <b className="text-[14px]">{b}</b></p></div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-[var(--ink-2)]">
                Also proven on past campaigns: replaying the last {e.model.testCampaigns.length} with the model choosing who to contact returned ROI <b>{smart.roi.toFixed(2)}</b> vs <b>{broad.roi.toFixed(2)}</b> for discounting everyone, with {pct(1 - smart.discountCost / broad.discountCost)} less discount.
              </p>
            </Panel>
    </>
  );
}
