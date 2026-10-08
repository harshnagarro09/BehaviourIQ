const fs=require('fs');const p='src/pages/Analytics.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const a=s.indexOf('              <Panel title={<>Incrementality');
const b=s.indexOf('</Panel>',a)+'</Panel>'.length;
const panel=`              <Panel title={<>Incrementality<Help term="incrementality" /></>} what="Of the units sold during promotions, how many would have sold anyway and how many were extra."
                legend={[{ label: 'Navy', color: 'var(--navy)', text: 'all units sold during the promotions' }, { label: 'Grey', color: '#94a3b8', text: 'would have been bought anyway at full price' }, { label: 'Green', color: 'var(--green)', text: 'extra units the promotion brought in' }]}>
                <BarChart height={210} maxW={420} showValues yLabel="Units sold" format={(v) => int(v)}
                  data={[
                    { label: 'All promo sales', value: A.units, color: 'var(--navy)' },
                    { label: 'Would sell anyway', value: A.base, color: '#94a3b8' },
                    { label: 'Extra from promo', value: A.units - A.base, color: 'var(--green)' },
                  ]} />
                <p className="mt-2 text-[12.5px] leading-snug text-[var(--ink-2)]"><b>{pct(incShareOf(A))}</b> of promo sales were extra. <b>{inr(A.leak, 0)}</b> of the {inr(A.cost, 0)} discount ({pct(leakOf(A))}) went to sales that would have happened anyway.</p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-3)]">An estimate: each customer's own usual full-price buying is the baseline. There was no test group.</p>
              </Panel>`;
s=s.slice(0,a)+panel+s.slice(b);
// drop the Split helper
const c=s.indexOf('/** one bar split in two'); const d=s.indexOf('/** the response map, with cells');
s=s.slice(0,c)+s.slice(d);
fs.writeFileSync(p,s);
