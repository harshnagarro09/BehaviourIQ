const fs=require('fs');const p='src/pages/Analytics.tsx';let s=fs.readFileSync(p,'utf8');
const a=s.indexOf("\n                legend={[{ label: 'Green', color: 'var(--green)', text: 'extra sales");
const b=s.indexOf("}>",a);
s=s.slice(0,a)+s.slice(b+1).replace(/^/,'');
fs.writeFileSync(p,s);
