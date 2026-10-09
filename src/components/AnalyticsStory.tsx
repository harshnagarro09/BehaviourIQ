import { TYPES } from '@/engine/segments';
import { inr, int, pct } from '@/lib/fmt';
import { roiOf, respOf, type Agg } from '@/lib/analytics';

// ----------------------------------------------------------------------------- customer types
/** Customer types side by side: who creates uplift and who only receives subsidy */
export function TypeCards({ rows }: { rows: { id: string; n: number; share: number; a: Agg; spendShare: number }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {TYPES.map((t) => {
        const r = rows.find((x) => x.id === t.id);
        if (!r) return null;
        const up = r.a.units ? (r.a.units - r.a.base) / r.a.units : 0;
        const roi = roiOf(r.a);
        return (
          <article key={t.id} className="card group relative p-3" style={{ borderTop: `3px solid ${t.color}` }}>
            <h3 className="text-[13px] font-semibold leading-tight">{t.name}</h3>
            <p className="text-[11px] text-[var(--ink-3)]">{t.tagline}</p>
            <dl className="mt-2 grid grid-cols-4 gap-x-2 text-[11.5px]">
              {[['Customers', `${int(r.n)}`], ['Spend', pct(r.spendShare)], ['Response', pct(respOf(r.a))], ['ROI', roi.toFixed(2)]].map(([l, v]) => (
                <div key={l}><dt className="text-[10px] text-[var(--ink-3)]">{l}</dt><dd className="num font-bold" style={l === 'ROI' ? { color: roi < 0 ? 'var(--red)' : 'var(--green-dark)' } : undefined}>{v}</dd></div>
              ))}
            </dl>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--line-2)]">
              <div style={{ width: `${Math.min(100, Math.max(0, (1 - Math.max(0, up)) * 100))}%`, background: '#94a3b8' }} />
              {up > 0 && <div style={{ width: `${Math.min(100, up * 100)}%`, background: 'var(--green)' }} />}
            </div>
            <p className="num mt-1 text-[11px] text-[var(--ink-2)]">{up >= 0 ? <>Baseline {pct(1 - up)} · <b className="text-[var(--green-dark)]">Uplift {pct(up)}</b></> : <b className="text-[var(--red)]">Offers cut sales ({int(r.a.units)} vs {int(r.a.base)} baseline)</b>} · <b style={{ color: r.a.net < 0 ? 'var(--red)' : 'var(--green-dark)' }}>{inr(r.a.net, 0)} profit</b></p>
            <div className="pointer-events-none invisible absolute inset-x-0 top-full z-30 mt-1.5 rounded-lg border border-[var(--line)] bg-white p-3 text-[11.5px] leading-snug text-[var(--ink)] opacity-0 shadow-[0_12px_32px_rgba(15,23,42,0.18)] transition-opacity group-hover:visible group-hover:opacity-100">
              <p className="flex items-center gap-2 text-[13px] font-bold"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name}</p>
              <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">{t.signature}</p>
              <p className="mb-1.5 mt-2 text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--ink-3)]">How to read this card</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1">
                {([
                  [`Customers ${int(r.n)} · Spend ${pct(r.spendShare)}`, 'var(--ink)', 'Customers of this type, and their share of all spend.'],
                  [`Response ${pct(respOf(r.a))}`, 'var(--ink)', 'Share of reached customers who bought on the offer.'],
                  [`ROI ${roi.toFixed(2)}`, roi < 0 ? 'var(--red)' : 'var(--green-dark)', 'Incremental profit earned per ₹1 of discount given.'],
                  [`Baseline ${pct(Math.min(1, r.a.units ? r.a.base / r.a.units : 0))}`, '#64748b', up >= 0 ? `Of the ${int(r.a.units)} units sold on promotion, ${int(r.a.base)} would have sold anyway at full price.` : `Offers brought sales below the ${int(r.a.base)} units these customers normally buy.`],
                  up >= 0
                    ? [`Uplift ${pct(up)}`, 'var(--green-dark)', `The other ${int(r.a.units - r.a.base)} units were extra sales caused by the offers.`]
                    : ['No uplift', 'var(--red)', `Only ${int(r.a.units)} units sold against ${int(r.a.base)} normally, so the offers reduced sales.`],
                  [`${inr(r.a.net, 0)} profit`, r.a.net < 0 ? 'var(--red)' : 'var(--green-dark)', 'Incremental profit: promoted profit minus baseline profit, discount and later dip.'],
                ] as [string, string, string][]).map(([k, c, d]) => (
                  <div key={k} className="contents"><dt className="whitespace-nowrap text-[11px] font-bold" style={{ color: c }}>{k}</dt><dd className="text-[11px] text-[var(--ink-2)]">{d}</dd></div>
                ))}
              </dl>
              <p className="mt-2 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--ink)]" style={{ background: 'var(--green-bg)' }}><b className="text-[var(--green-dark)]">Action: </b>{t.play}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
