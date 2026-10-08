const fs=require('fs');const p='src/pages/Analytics.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('miss '+a.slice(0,50)); s=s.replace(a,b); };
s=s.replace(/            <Kpi label="Top-earning type".*\n/,'').replace(/            <Kpi label="Biggest money-loser".*\n/,'');
rep(`    const byNet = [...feat].sort((a, b) => b.a.net - a.a.net);
    return { n, promo: n ? feat.reduce((a, g) => a + g.promo * g.n, 0) / n : 0, best: byNet[0], worst: byNet.length > 1 ? byNet[byNet.length - 1] : undefined };`,
`    return { n, promo: n ? feat.reduce((a, g) => a + g.promo * g.n, 0) / n : 0 };`);
fs.writeFileSync(p,s);
