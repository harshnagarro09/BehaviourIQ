const fs=require('fs');
let p='src/components/charts.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('miss '+a.slice(0,50)); s=s.replace(a,b); };
rep(`showValues = false, yLabel, maxW,
}: {`,`showValues = false, yLabel, maxW, xTitle, yTitle,
}: {`);
rep(`showValues?: boolean; yLabel?: string;
  /** override the default maximum width (see useWidth) */
  maxW?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(maxW ?? capFor(data.length, 120, 380, 1000));
  const { box, show, hide, el } = useTip();
  const m = { t: 14, r: 8, b: 34, l: 52 };`,`showValues?: boolean; yLabel?: string;
  /** override the default maximum width (see useWidth) */
  maxW?: number;
  /** visible axis titles (optional) */
  xTitle?: string; yTitle?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(maxW ?? capFor(data.length, 120, 380, 1000));
  const { box, show, hide, el } = useTip();
  const m = { t: 14, r: 8, b: xTitle ? 52 : 34, l: yTitle ? 66 : 52 };`);
rep(`            <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} />
            {data.map((d, i) => {
              const cx = m.l + bw * i + bw / 2;
              const y0 = y(0);`,`            <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} />
            {yTitle && <text transform={\`translate(11 \${m.t + ih / 2}) rotate(-90)\`} textAnchor="middle" className="chart-text" style={{ fill: 'var(--ink-2)', fontWeight: 600 }}>{yTitle}</text>}
            {xTitle && <text x={m.l + iw / 2} y={height - 6} textAnchor="middle" className="chart-text" style={{ fill: 'var(--ink-2)', fontWeight: 600 }}>{xTitle}</text>}
            {data.map((d, i) => {
              const cx = m.l + bw * i + bw / 2;
              const y0 = y(0);`);
fs.writeFileSync(p,s);

p='src/pages/Analytics.tsx'; s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const a=s.indexOf('                <BarChart height={210} maxW={420} showValues yLabel="Units sold"');
const b=s.indexOf('              </Panel>',a);
const body=`                <BarChart height={250} maxW={460} showValues yLabel="Units sold" yTitle="Units sold" xTitle="Promoted sales, split" format={(v) => int(v)}
                  data={[
                    { label: 'All promo sales', value: A.units, color: 'var(--navy)' },
                    { label: 'Would sell anyway', value: A.base, color: '#94a3b8' },
                    { label: 'Extra from promo', value: A.units - A.base, color: 'var(--green)' },
                  ]} />
                <div className="mt-3 space-y-2 rounded-lg bg-[var(--page)] p-3 text-[12.5px] leading-snug">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">How the numbers come from the bars</p>
                  <p className="num flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <Chip tone="navy">{int(A.units)} sold</Chip>−<span className="rounded-full bg-[#e2e8f0] px-2 py-0.5 font-semibold">{int(A.base)} anyway</span>=<Chip tone="green">{int(A.units - A.base)} extra</Chip>
                  </p>
                  <p><b>{pct(incShareOf(A))} extra</b> = {int(A.units - A.base)} extra ÷ {int(A.units)} sold.</p>
                  <p><b>{pct(leakOf(A))} of the discount wasted</b> = {inr(A.leak, 0)} ÷ {inr(A.cost, 0)}. {inr(A.leak, 0)} is the discount handed out on the "would sell anyway" units. Those customers would have paid full price.</p>
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-[var(--ink-3)]">An estimate: each customer's own usual full-price buying is the baseline. There was no test group.</p>
`;
s=s.slice(0,a)+body+s.slice(b);
fs.writeFileSync(p,s);
