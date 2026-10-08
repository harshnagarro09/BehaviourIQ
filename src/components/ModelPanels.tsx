import { useState } from 'react';
import { Panel, Toggle, WindowChip } from '@/components/ui';
import { DivergingBars, HBars } from '@/components/charts';
import { signalLabel } from '@/lib/signalLabels';
import { signalsTakeaway } from '@/lib/takeaways';
import { pct } from '@/lib/fmt';
import { useEngine } from '@/state';

/**
 * "How customer behaviour is used for promotion prediction": which behaviours drive the prediction.
 * It is the second tab of the Customer Prediction page.
 */
export function ModelSection() {
  const e = useEngine();
  const [drvView, setDrvView] = useState<'group' | 'signal'>('group');

  return (
    <section className="space-y-4">
      <Panel title="Which behaviours predict promotion response" what={`Behaviour themes group the ${e.model.importance.length} signals the model reads into ${e.model.groupImportance.length} kinds; individual signals show each one. In the signals view, green raises the chance of responding and orange lowers it.`}
        right={<><WindowChip /><Toggle value={drvView} onChange={setDrvView} options={[{ id: 'group', label: `Behaviour themes (${e.model.groupImportance.length})` }, { id: 'signal', label: `Individual signals (${e.model.importance.length})` }]} /></>}
        legend={drvView === 'group'
          ? [{ label: 'Bar', text: "share of the model's weight" }, { label: 'Purchasing', text: 'frequency, recency, quantity' }, { label: 'Price', text: 'discount taken' }, { label: 'Promotion', text: 'past response' }, { label: 'Brand', text: 'loyalty vs competitors' }, { label: 'Basket', text: 'items, category mix' }, { label: 'Timing', text: 'purchase rhythm' }]
          : [{ label: 'Green', color: 'var(--green)', text: 'raises the chance of responding' }, { label: 'Orange', color: 'var(--amber)', text: 'lowers it' }, { label: 'Length', text: 'strength of the effect' }]}>
        <p className="mb-3 text-[12.5px] font-medium text-[var(--ink)]">{signalsTakeaway(e.model.importance)}</p>
        {drvView === 'group'
          ? <HBars labelW={100} max={Math.max(...e.model.groupImportance.map((g) => g.share))} format={(v) => pct(v)} rows={e.model.groupImportance.map((g) => ({ label: g.group, value: g.share, color: 'var(--navy)' }))} />
          : <DivergingBars labelW={360} format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} rows={e.model.importance.map((i) => ({ label: signalLabel(i.key, i.label), value: i.weight, color: i.weight >= 0 ? 'var(--green)' : 'var(--amber)' }))} />}
      </Panel>
    </section>
  );
}
