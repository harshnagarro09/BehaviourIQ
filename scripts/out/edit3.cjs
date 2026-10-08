const fs=require('fs');const p='src/pages/Analytics.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const a=s.indexOf('              <Panel title={<>Incrementality');
const b=s.indexOf('</Panel>',a)+'</Panel>'.length;
const panel=`              <Panel title={<>Incrementality<Help term="incrementality" /></>} what="Of all the sales made on promotion, how many were truly extra, and how much of the discount paid for sales that would have happened anyway."
                legend={[{ label: 'Green', color: 'var(--green)', text: 'extra sales, estimated to be caused by the promotion' }, { label: 'Grey / red', color: '#94a3b8', text: 'customers would have bought anyway at full price' }]}>
                <div className="space-y-5">
                  <div>
                    <p className="text-[12.5px] font-semibold">Promoted sales: how many were extra?</p>
                    <p className="num mt-1 text-[26px] font-bold leading-none text-[var(--green-dark)]">{pct(incShareOf(A))} <span className="text-[13px] font-medium text-[var(--ink-2)]">were extra</span></p>
                    <Split a={{ v: A.units - A.base, label: 'Extra', color: 'var(--green)' }} b={{ v: A.base, label: 'Bought anyway', color: '#94a3b8' }} fmt={(v) => \`\${int(v)} units\`} />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-semibold">Discount: where did the money go?</p>
                    <p className="num mt-1 text-[26px] font-bold leading-none" style={{ color: leakOf(A) > 0.15 ? 'var(--red)' : 'var(--ink)' }}>{pct(leakOf(A))} <span className="text-[13px] font-medium text-[var(--ink-2)]">given away for nothing</span></p>
                    <Split a={{ v: Math.max(0, A.cost - A.leak), label: 'Earned extra sales', color: 'var(--navy)' }} b={{ v: A.leak, label: 'Wasted', color: 'var(--red)' }} fmt={(v) => inr(v, 0)} />
                  </div>
                </div>
                <p className="mt-3 border-t border-[var(--line)] pt-2.5 text-[11.5px] leading-snug text-[var(--ink-3)]"><b className="text-[var(--ink-2)]">How it is estimated:</b> each customer's own normal buying at full price is the baseline. Anything above it during the promotion counts as extra. There was no test group, so this is an estimate.</p>
              </Panel>`;
s=s.slice(0,a)+panel+s.slice(b);
s=s.replace("import { BarChart, Heat, Scatter, Waterfall, useWidth }","import { BarChart, Heat, Scatter, useWidth }");
s=s.replace("/** the response map, with cells",`/** one bar split in two, with the share and value of each part labelled underneath */
function Split({ a, b, fmt }: { a: { v: number; label: string; color: string }; b: { v: number; label: string; color: string }; fmt: (v: number) => string }) {
  const tot = a.v + b.v || 1;
  return (
    <div className="mt-2.5">
      <div className="flex h-7 overflow-hidden rounded-md bg-[var(--line-2)]">
        <div style={{ width: \`\${(a.v / tot) * 100}%\`, background: a.color }} />
        <div style={{ width: \`\${(b.v / tot) * 100}%\`, background: b.color }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-[11.5px]">
        {[a, b].map((x, i) => (
          <div key={x.label} className={i ? 'text-right' : ''}>
            <p className="flex items-center gap-1.5 font-semibold" style={{ justifyContent: i ? 'flex-end' : undefined }}><span className="h-2 w-2 rounded-sm" style={{ background: x.color }} />{x.label} · {pct(x.v / tot)}</p>
            <p className="num text-[var(--ink-3)]">{fmt(x.v)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** the response map, with cells`);
fs.writeFileSync(p,s);
