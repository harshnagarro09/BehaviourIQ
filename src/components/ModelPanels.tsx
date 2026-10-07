import { useMemo, useState } from 'react';
import { Takeaway } from '@/components/Takeaway';
import { Help } from '@/components/Help';
import { Chip, FilterSelect, Panel, Toggle, WindowChip } from '@/components/ui';
import { BarChart, DivergingBars, GroupedBars, HBars, Heat, LineChart } from '@/components/charts';
import { PREDICTION_WINDOW_DAYS } from '@/engine/model';
import { TYPES } from '@/engine/segments';
import { activeAt, buildCtxs } from '@/engine/planner';
import { compareOptions, promoOptions, shortOffer } from '@/engine/options';
import { signalLabel } from '@/lib/signalLabels';
import { predictionTakeaway, proofTakeaway, signalsTakeaway } from '@/lib/takeaways';
import { inr, int, pct } from '@/lib/fmt';
import { useEngine } from '@/state';

type ValView = 'profit' | 'predicted' | 'accuracy' | 'skipped';

/**
 * "How the model predicts, and does it work": which behaviours drive the prediction, who responds to what,
 * and the held-out backtest. It is the second tab of the Customer Prediction page.
 */
export function ModelSection() {
  const e = useEngine();
  const [predCat, setPredCat] = useState('Beverages');
  const [valView, setValView] = useState<ValView>('profit');
  const [drvView, setDrvView] = useState<'group' | 'signal'>('group');
  const cats = e.ds.categories;

  const V = e.validation;
  const vt = useMemo(() => {
    const s = (fn: (v: (typeof V)[number]) => number) => V.reduce((a, v) => a + fn(v), 0);
    const real = s((v) => v.realNet), cost = s((v) => v.cost);
    return { real, cost, roi: cost ? real / cost : 0, skipped: s((v) => v.skippedNet), broad: s((v) => v.broadNet), broadCost: s((v) => v.broadCost), reached: s((v) => v.reached), tgt: s((v) => v.targeted) };
  }, [V]);
  const broadRoi = vt.broadCost ? vt.broad / vt.broadCost : 0;
  const makesMoney = vt.real > 0;
  const vLabel = (v: (typeof V)[number]) => v.campaign.name.split(' ').slice(0, 2).join(' ').slice(0, 13);

  const pred = useMemo(() => {
    const ctxs = buildCtxs(e.ds, activeAt(e.ds, e.asOf), predCat, e.asOf);
    const options = promoOptions(e.ds, predCat);
    const cmp = compareOptions(e.ds, e.model, ctxs, predCat, options);
    const gs = TYPES.map((t) => ({ name: t.name, ids: ctxs.filter((c) => e.recById.get(c.cid)!.type === t.id).map((c) => c.cid) })).filter((g) => g.ids.length > 0);
    const val = (g: (typeof gs)[number], key: string) => g.ids.reduce((s, id) => s + cmp.exps.get(key)!.get(id)!.p1, 0) / g.ids.length;
    return { options, gs, val, n: ctxs.length };
  }, [e, predCat]);

  return (
    <section className="space-y-4">
      <>
          <Takeaway>{predictionTakeaway({ groups: e.model.groupImportance, auc: e.model.aucTest, testCampaigns: e.model.testCampaigns.length })}</Takeaway>
          <Takeaway>{proofTakeaway({ roi: vt.roi, broadRoi, campaigns: V.length })}</Takeaway>
            <Panel title="Which behaviours predict promotion response" what={`Behaviour themes group the ${e.model.importance.length} signals the model reads into ${e.model.groupImportance.length} kinds; individual signals show each one. In the signals view, green raises the chance of responding and orange lowers it.`}
              right={<><WindowChip /><Toggle value={drvView} onChange={setDrvView} options={[{ id: 'group', label: `Behaviour themes (${e.model.groupImportance.length})` }, { id: 'signal', label: `Individual signals (${e.model.importance.length})` }]} /></>}
              legend={drvView === 'group'
                ? [{ label: 'Bar', text: "share of the model's weight" }, { label: 'Purchasing', text: 'frequency, recency, quantity' }, { label: 'Price', text: 'discount taken' }, { label: 'Promotion', text: 'past response' }, { label: 'Brand', text: 'loyalty vs competitors' }, { label: 'Basket', text: 'items, category mix' }, { label: 'Timing', text: 'purchase rhythm' }]
                : [{ label: 'Green', color: 'var(--green)', text: 'raises the chance of responding' }, { label: 'Orange', color: 'var(--amber)', text: 'lowers it' }, { label: 'Length', text: 'strength of the effect' }]}>
              <p className="mb-3 text-[11.5px] font-medium text-[var(--ink)]">{signalsTakeaway(e.model.importance)}</p>
              {drvView === 'group'
                ? <HBars labelW={100} max={Math.max(...e.model.groupImportance.map((g) => g.share))} format={(v) => pct(v)} rows={e.model.groupImportance.map((g) => ({ label: g.group, value: g.share, color: 'var(--navy)' }))} />
                : <DivergingBars labelW={360} format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} rows={e.model.importance.map((i) => ({ label: signalLabel(i.key, i.label), value: i.weight, color: i.weight >= 0 ? 'var(--green)' : 'var(--amber)' }))} />}
            </Panel>

            <Panel title="Who responds to what" what={`Predicted chance of buying in the next ${PREDICTION_WINDOW_DAYS} days, ${int(pred.n)} recently active customers.`}
              right={<><WindowChip /><FilterSelect value={predCat} onChange={setPredCat} options={cats.map((c) => ({ value: c, label: c }))} /></>}
              legend={[{ label: 'Rows', text: 'customer types' }, { label: 'Columns', text: 'promotion types; No Promotion is what they do anyway' }, { label: 'Cell', text: 'average chance of buying; darker green is higher. The gap to No Promotion is the lift.' }]}>
              <Heat rows={pred.gs.map((g) => g.name)} cols={pred.options.map((o) => shortOffer(o.label))} cell={96} rowW={150}
                value={(r, c) => pred.val(pred.gs[r], pred.options[c].key)}
                color={(v) => (v < 0.2 ? '#e2e8f0' : v < 0.4 ? '#a7f3d0' : v < 0.6 ? '#34d399' : v < 0.8 ? '#10b981' : '#047857')}
                label={(v) => `${Math.round(v * 100)}%`}
                tip={(r, c) => <>{pred.gs[r].name} · {pred.options[c].label}<br />{pct(pred.val(pred.gs[r], pred.options[c].key))} chance of buying ({pred.gs[r].ids.length} customers)</>} />
            </Panel>

            <Panel title={<>Is the prediction accurate, and does acting on it make money?<Help term="auc" /></>}
              what={`Tested on ${V.length} campaigns held back from training: the model chose who to target using only earlier data.`}
              right={<><WindowChip /><FilterSelect value={valView} onChange={(v) => setValView(v as ValView)} options={[
                { value: 'profit', label: 'Does acting on it make money?' }, { value: 'predicted', label: 'Predicted vs actual profit' },
                { value: 'accuracy', label: 'Is the prediction accurate?' }, { value: 'skipped', label: 'What the model avoided' },
              ]} /></>}
              legend={valView === 'profit' ? [
                { label: 'Grey', color: '#94a3b8', text: 'profit if everyone is offered' }, { label: 'Navy', color: '#0b1c2f', text: 'profit offering only the customers the model picked' },
              ] : valView === 'predicted' ? [
                { label: 'Grey', color: '#94a3b8', text: 'profit / buyers the model expected' }, { label: 'Navy', color: '#0b1c2f', text: 'what actually happened' }, { label: 'Navy above grey', text: 'the model was cautious' },
              ] : valView === 'accuracy' ? [
                { label: 'Left', text: 'customers split into 5 equal groups, most to least likely; matching bars mean honest probabilities' }, { label: 'Right', text: 'share of real buyers captured when contacting best-ranked first; above the dashed line is better' },
              ] : [
                { label: 'Contacted', text: 'actual profit from customers the model chose' }, { label: 'Skipped', text: 'profit (a loss) those left out would have made if offered' }, { label: 'Offer everyone', text: 'total if the offer went to all' },
              ]}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip tone={makesMoney ? 'green' : 'red'}>{makesMoney ? 'Profit-making' : 'Loss-making'}: {inr(vt.real)}, ROI {vt.roi.toFixed(2)}</Chip>
                <Chip tone="neutral">Offering everyone: {inr(vt.broad)}, ROI {broadRoi.toFixed(2)}</Chip>
              </div>
              {valView === 'profit' && (
                <GroupedBars height={220} format={(v) => inr(v, 0)} series={[{ label: 'Offer everyone', color: '#94a3b8' }, { label: 'Behaviour-targeted', color: '#0b1c2f' }]}
                  groups={V.map((v) => ({ label: vLabel(v), values: [v.broadNet, v.realNet] }))} />
              )}
              {valView === 'predicted' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div><p className="mb-1 text-[10.5px] font-semibold">Net profit of the targeted customers</p>
                    <GroupedBars height={200} format={(v) => inr(v, 0)} series={[{ label: 'Predicted', color: '#94a3b8' }, { label: 'Actual', color: '#0b1c2f' }]} groups={V.filter((v) => v.targeted > 0).map((v) => ({ label: vLabel(v), values: [v.predNet, v.realNet] }))} /></div>
                  <div><p className="mb-1 text-[10.5px] font-semibold">Customers who bought</p>
                    <GroupedBars height={200} format={(v) => int(v)} series={[{ label: 'Predicted', color: '#94a3b8' }, { label: 'Actual', color: '#0b1c2f' }]} groups={V.filter((v) => v.targeted > 0).map((v) => ({ label: vLabel(v), values: [v.predBuyers, v.realBuyers] }))} /></div>
                </div>
              )}
              {valView === 'accuracy' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div><p className="mb-1 text-[10.5px] font-semibold">Predicted vs actual chance of buying<Help term="calibration" /></p>
                    <GroupedBars height={200} format={(v) => pct(v)} series={[{ label: 'Predicted', color: '#94a3b8' }, { label: 'Actual', color: '#0b1c2f' }]}
                      groups={e.model.calibration.map((c, i) => ({ label: i === 0 ? 'Most likely' : i === e.model.calibration.length - 1 ? 'Least likely' : `Group ${i + 1}`, values: [c.predicted, c.actual] }))} /></div>
                  <div><p className="mb-1 text-[10.5px] font-semibold">Buyers captured, best-ranked first</p>
                    <LineChart height={200} markers={false} yMax={1} xFormat={(v) => pct(v)} yFormat={(v) => pct(v)} xTicks={[0, 0.25, 0.5, 0.75, 1]} xLabel="Share of customers contacted"
                      series={[{ name: 'Model', color: '#0b1c2f', points: e.model.gains.map((g) => ({ x: g.pctCustomers, y: g.pctResponders })) }, { name: 'Random', color: '#94a3b8', dashed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]} /></div>
                </div>
              )}
              {valView === 'skipped' && (
                <BarChart height={210} posColor="var(--navy)" negColor="var(--red)" format={(v) => inr(v, 0)} showValues
                  data={[
                    { label: 'Contacted', sub: `${int(vt.tgt)} offers`, value: vt.real, color: 'var(--green)' },
                    { label: 'Skipped', sub: 'if they had been offered', value: vt.skipped },
                    { label: 'Offer everyone', sub: `${int(vt.reached)} offers`, value: vt.broad, color: '#94a3b8' },
                  ]} />
              )}
            </Panel>
      </>
    </section>
  );
}
