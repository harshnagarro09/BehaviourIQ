// Plan the budget > More details > How discounts are estimated: the demand curve behind the discount depths.
//   Customer behaviour  -> who should get the offer   (customer types, each customer's own past response)
//   Price elasticity    -> how deep the discount should be (category demand curve from actual past price offers)
//   Budget optimiser    -> where the money goes        (exact knapsack, engine/optimizer.ts)
import { Info } from 'lucide-react';
import { Chip, SourceChip } from '@/components/ui';
import { TYPE_BY_ID } from '@/engine/segments';
import type { TypeId } from '@/engine/behaviour';
import { demandLift, inRange, type ElasticityModel } from '@/engine/elasticity';
import { minDetectableUplift, qualifies, type OptItem, type OptSettings, type Plan } from '@/engine/optimizer';
import { objectiveValue } from '@/engine/targeting';
import { PLAIN_TYPE } from '@/engine/budgetScope';
import { int } from '@/lib/fmt';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ------------------------------------------------------------------------ discount depth (elasticity) tab
const CAT_COLORS = ['#0b1c2f', '#2a78d6', '#1baf7a', '#e0a526', '#d64545', '#8b5cf6'];

export function DepthTab({ model, items, settings, plan, cats }: { model: ElasticityModel; items: OptItem[]; settings: OptSettings; plan: Plan; cats: string[] }) {
  const ces = cats.map((c) => model.byCategory.get(c)).filter((x): x is NonNullable<typeof x> => !!x);
  const maxTested = Math.max(0, ...ces.map((c) => c.maxDepth));
  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-[var(--page)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
        From {model.pooled.n} past price offers (% off, ₹ off, buy-2-save), each extra 1% off raised the units sold by about <b>{Math.abs(model.pooled.beta).toFixed(1)}%</b> (price elasticity <b>{model.pooled.beta.toFixed(1)}</b>, ±{(1.96 * model.pooled.se).toFixed(1)}).
        {model.tau2 <= 0 ? ' The categories respond so alike that they share one curve.' : ' Each category has its own curve, pulled towards the average where its own data is thin.'}
        {' '}{model.excluded} other campaigns (multi-buys, BOGO, combos, points) are left out: they move volume through the mechanic, not just the price.
      </p>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold">Demand curve <SourceChip kind="actual" /><span className="text-[11px] font-normal text-[var(--ink-3)]">dots · fitted line is an estimate</span></p>
          <DemandCurve model={model} cats={ces.map((c) => c.category)} maxTested={maxTested} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-[12px]">
            <thead><tr className="whitespace-nowrap border-b border-[var(--line)] text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              <th className="py-2 text-left">Category</th><th className="px-2 py-2" title="Used in the plan">Elasticity</th><th className="px-2 py-2" title="This category's own estimate, ± 95% range">Own estimate</th><th className="px-2 py-2">Depths run</th><th className="py-2 pl-2" title="Leave one campaign out: average error when predicting each past campaign's lift from the others">Past accuracy</th>
            </tr></thead>
            <tbody>
              {ces.map((c, i) => (
                <tr key={c.category} className="border-b border-[var(--line-2)] text-right last:border-0" title={c.note}>
                  <td className="py-1.5 text-left font-semibold"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{c.category}</td>
                  <td className="num px-2 font-bold">{c.beta.toFixed(1)}</td>
                  <td className="num px-2 text-[var(--ink-3)]">{c.raw ? `${c.raw.beta.toFixed(1)} ± ${(1.96 * c.raw.se).toFixed(1)}` : '–'}</td>
                  <td className="num px-2 text-[var(--ink-3)]">{c.points.length ? `${c.minDepth}–${c.maxDepth}% (${c.points.length})` : '–'}</td>
                  <td className="py-1.5 pl-2">{c.looError === null ? '–' : <Chip tone={c.looError <= 0.15 ? 'green' : c.looError <= 0.3 ? 'amber' : 'red'}>±{Math.round(c.looError * 100)}%</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-[var(--ink-3)]">Past accuracy: each past price offer's lift predicted from the other offers only, then compared with what actually happened.</p>
        </div>
      </div>

      <TypeSensitivity model={model} />
      <RecommendedDepths items={items} settings={settings} cats={cats} model={model} />
      <DepthTest plan={plan} items={items} />

      <p className="flex items-start gap-2 text-[11.5px] leading-snug text-[var(--ink-3)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Limits: past campaigns had no control group and only a few depths per category (mostly 10% and 20%), and timing or season is not separated out. The curve is only used from 5 points below the shallowest discount run up to the deepest one run{maxTested ? ` (${maxTested}% at most)` : ''}; deeper offers keep the behaviour rule and are marked “beyond tested depths”. Rule-based estimates, not a trained machine-learning model.</span>
      </p>
    </div>
  );
}

function DemandCurve({ model, cats, maxTested }: { model: ElasticityModel; cats: string[]; maxTested: number }) {
  const W = 520, H = 230, m = { l: 40, r: 12, t: 12, b: 34 };
  const xMax = 30;
  const pts = cats.flatMap((c, i) => (model.byCategory.get(c)?.points ?? []).map((p) => ({ ...p, c, color: CAT_COLORS[i % CAT_COLORS.length] })));
  const yMax = Math.max(4, Math.ceil(Math.max(...pts.map((p) => p.lift), demandLift(model.pooled.beta, xMax)) ));
  const X = (d: number) => m.l + (d / xMax) * (W - m.l - m.r);
  const Y = (v: number) => m.t + (1 - (v - 1) / (yMax - 1)) * (H - m.t - m.b);
  const curve = (b: number, from: number, to: number) => Array.from({ length: 31 }, (_, i) => from + ((to - from) * i) / 30).map((d) => `${X(d)},${Y(Math.min(yMax, demandLift(b, d)))}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Units sold against discount depth">
      {maxTested > 0 && <rect x={X(maxTested)} y={m.t} width={X(xMax) - X(maxTested)} height={H - m.t - m.b} fill="#f3f5f8" />}
      {maxTested > 0 && <text x={X(xMax) - 4} y={m.t + 12} textAnchor="end" className="chart-text" style={{ fontSize: 10, fill: 'var(--ink-3)' }}>not tested</text>}
      {Array.from({ length: yMax }, (_, i) => i + 1).map((v) => (
        <g key={v}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="chart-grid" /><text x={m.l - 6} y={Y(v) + 3.5} textAnchor="end" className="chart-text" style={{ fontSize: 10 }}>{v}×</text></g>
      ))}
      {[0, 5, 10, 15, 20, 25, 30].map((d) => <text key={d} x={X(d)} y={H - m.b + 14} textAnchor="middle" className="chart-text" style={{ fontSize: 10 }}>{d}%</text>)}
      <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" className="chart-text" style={{ fontSize: 10.5, fill: 'var(--ink-2)', fontWeight: 600 }}>Discount</text>
      <polyline points={curve(model.pooled.beta, 0, Math.min(xMax, maxTested))} fill="none" stroke="var(--navy)" strokeWidth={2.5} />
      <polyline points={curve(model.pooled.beta, Math.min(xMax, maxTested), xMax)} fill="none" stroke="var(--navy)" strokeWidth={2} strokeDasharray="5 4" opacity={0.45} />
      {pts.map((p) => <circle key={p.campaignId} cx={X(p.depth * 100)} cy={Y(Math.min(yMax, p.lift))} r={4.5} fill={p.color} stroke="#fff" strokeWidth={1.5}><title>{`${p.name} (${p.c}): ${Math.round(p.depth * 100)}% off, ${p.lift.toFixed(2)}× normal units`}</title></circle>)}
      <text x={m.l + 4} y={m.t + 12} className="chart-text" style={{ fontSize: 10, fill: 'var(--ink-3)' }}>units sold ÷ normal units</text>
    </svg>
  );
}

function TypeSensitivity({ model }: { model: ElasticityModel }) {
  const read = (b: number) => (b <= -5 ? 'Very price-sensitive' : b <= -2 ? 'Price-sensitive' : b < 0 ? 'Barely moved by price' : 'Buy less as discounts deepen');
  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-semibold">Why behaviour still decides who gets the offer</p>
      <p className="mb-2 text-[11.5px] text-[var(--ink-3)]">The same past price offers, read for each customer type. One average curve would hide these differences.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {(['persuadable', 'sure', 'lost', 'dog'] as TypeId[]).map((t) => {
          const f = model.byType.get(t);
          const ok = !!f && Number.isFinite(f.se);
          return (
            <div key={t} className="rounded-lg border border-[var(--line)] bg-white p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-bold"><span className="h-2 w-2 rounded-full" style={{ background: TYPE_BY_ID[t].color }} />{TYPE_BY_ID[t].name}</p>
              {ok ? <>
                <p className="mt-1 text-[12px] font-semibold" style={{ color: f!.beta < 0 ? 'var(--ink)' : 'var(--red)' }}>{read(f!.beta)}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-3)]">{f!.beta < 0 ? `At 20% off they bought about ${demandLift(f!.beta, 20).toFixed(1)}× their normal units` : 'They bought less than normal during deeper price offers'} · elasticity {f!.beta.toFixed(1)}</p>
              </> : <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">Too few purchases to read.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendedDepths({ items, settings, cats, model }: { items: OptItem[]; settings: OptSettings; cats: string[]; model: ElasticityModel }) {
  const types: TypeId[] = ['persuadable', 'sure'];
  const best = (cat: string, t: TypeId) => {
    const it = items.find((i) => i.category === cat && i.type === t);
    const cs = (it?.cells ?? []).filter((c) => c.promo.family === 'price' && qualifies(c, settings));
    return cs.reduce<(typeof cs)[number] | null>((a, c) => (!a || objectiveValue(c, settings.objective) > objectiveValue(a, settings.objective) ? c : a), null);
  };
  return (
    <div>
      <p className="text-[12.5px] font-semibold">Best price-cut depth, by customer type</p>
      <p className="mb-2 text-[11.5px] text-[var(--ink-3)]">The % off that adds the most for your aim if the whole group could be funded (price offers only, at your minimum return). With a limited budget the plan may choose a shallower or different offer to reach more customers per rupee.</p>
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
        <table className="w-full min-w-[480px] text-[12px]">
          <thead><tr className="bg-[var(--page)] text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]"><th className="px-3 py-2">Category</th>{types.map((t) => <th key={t} className="px-3 py-2">{cap(PLAIN_TYPE[t])}</th>)}</tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c} className="border-t border-[var(--line-2)]">
                <td className="px-3 py-1.5 font-semibold">{c}</td>
                {types.map((t) => {
                  const b = best(c, t);
                  return (
                    <td key={t} className="px-3 py-1.5">
                      {b ? <span className="inline-flex items-center gap-2"><b className="num">{b.promo.depth}% off</b><span className="text-[var(--ink-3)]">₹{b.roi.toFixed(2)} back per ₹1</span>{!inRange(model.byCategory.get(c), b.promo.depth) && <Chip tone="amber">beyond tested</Chip>}</span>
                        : <span className="text-[var(--ink-3)]">No price cut pays off</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** a practical A/B check of the chosen depth: split the treated customers between the chosen depth and the next shallower one */
function DepthTest({ plan, items }: { plan: Plan; items: OptItem[] }) {
  // the biggest price offer in the plan that has a shallower tested price offer to test against
  const shallowerOf = (x: Plan['allocations'][number]) => items.find((i) => i.id === x.item.id)?.cells
    .filter((c) => c.promo.family === 'price' && c.promo.depth < x.cell.promo.depth && c.eligible.ok && c.depthSource !== 'behaviour')
    .sort((p, q) => q.promo.depth - p.promo.depth)[0];
  const a = [...plan.allocations].filter((x) => x.cell.promo.family === 'price' && shallowerOf(x)).sort((x, y) => y.spend - x.spend)[0];
  if (!a) return null;
  const shallower = shallowerOf(a)!;
  const n = a.treated, half = Math.floor(n / 2);
  const gap = a.cell.uplift - shallower.uplift;
  const mde = minDetectableUplift(a.cell.p1, half, n - half);
  const clear = mde <= gap;
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white p-3.5">
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">Test the depth before scaling <Chip tone={clear ? 'green' : 'amber'}>{clear ? 'Test would give a clear answer' : 'Group too small for a clear answer'}</Chip></p>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-2)]">
        For {TYPE_BY_ID[a.item.type].name} in {a.item.category}, send <b>{a.cell.promo.label}</b> to half of the {int(n)} customers and <b>{shallower.promo.label}</b> to the other half (the holdout stays as it is).
        The plan expects {(gap * 100).toFixed(1)} more buyers in every 100 from the deeper offer; with {int(half)} customers per side the test can reliably show a gap of {(mde * 100).toFixed(1)} or more.
        {clear ? ' Keep the deeper offer only if it beats the shallower one on extra margin.' : ' Run it across more categories or for longer before relying on the result.'}
      </p>
    </div>
  );
}

