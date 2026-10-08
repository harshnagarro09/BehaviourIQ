const fs=require('fs');const p='src/pages/Analytics.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('miss: '+a.slice(0,60)); s=s.replace(a,b); };
// KPI row per tab
rep(`        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Discount invested" value={inr(A.cost)} delta={dPct(A.cost, P.cost, null)} note={sub || \`\${A.campaigns} campaigns\`} />
          <Kpi help="netProfit" label="Net promo profit" value={inr(A.net)} tone={A.net < 0 ? 'bad' : 'good'} delta={dPct(A.net, P.net)} note={sub || 'past promotions'} />
          <Kpi help="roi" label="Avg promo ROI" value={roiOf(A).toFixed(2)} tone={roiOf(A) < 0 ? 'bad' : undefined} delta={dAbs(roiOf(A), roiOf(P), (n) => n.toFixed(2))} note={sub || 'profit per ₹ of discount'} />
          <Kpi label="Response rate" value={pct(respOf(A))} delta={dAbs(respOf(A), respOf(P), pp)} note={sub || 'bought on promo'} />
        </div>
`,`        {tab === 'results' ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Discount invested" value={inr(A.cost)} delta={dPct(A.cost, P.cost, null)} note={sub || \`\${A.campaigns} campaigns\`} />
            <Kpi help="netProfit" label="Net promo profit" value={inr(A.net)} tone={A.net < 0 ? 'bad' : 'good'} delta={dPct(A.net, P.net)} note={sub || 'past promotions'} />
            <Kpi help="roi" label="Avg promo ROI" value={roiOf(A).toFixed(2)} tone={roiOf(A) < 0 ? 'bad' : undefined} delta={dAbs(roiOf(A), roiOf(P), (n) => n.toFixed(2))} note={sub || 'profit per ₹ of discount'} />
            <Kpi label="Response rate" value={pct(respOf(A))} delta={dAbs(respOf(A), respOf(P), pp)} note={sub || 'bought on promo'} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Customers in view" value={int(behaviourKpi.n)} note={\`\${feat.length} customer types\`} />
            <Kpi label="Buying on promotion" value={pct(behaviourKpi.promo)} note="average share of a customer's purchases" />
            <Kpi label="Top-earning type" value={behaviourKpi.best?.name ?? '–'} tone="good" note={behaviourKpi.best ? \`\${inr(behaviourKpi.best.a.net)} promo profit\` : ''} />
            <Kpi label="Biggest money-loser" value={behaviourKpi.worst?.name ?? '–'} tone={behaviourKpi.worst && behaviourKpi.worst.a.net < 0 ? 'bad' : undefined} note={behaviourKpi.worst ? \`\${inr(behaviourKpi.worst.a.net)} promo profit\` : ''} />
          </div>
        )}
`);
rep(`  const personaRows = f.persona`,`  const behaviourKpi = useMemo(() => {
    const n = feat.reduce((a, g) => a + g.n, 0);
    const byNet = [...feat].sort((a, b) => b.a.net - a.a.net);
    return { n, promo: n ? feat.reduce((a, g) => a + g.promo * g.n, 0) / n : 0, best: byNet[0], worst: byNet.length > 1 ? byNet[byNet.length - 1] : undefined };
  }, [feat]);

  const personaRows = f.persona`);
// trim behaviour metrics to the ones that explain behaviour
for (const k of ['cost','rec','spend','basket','weekend']) {
  s=s.replace(new RegExp(`  \{ key: '${k}', label:.*\n`),'');
}
fs.writeFileSync(p,s);
