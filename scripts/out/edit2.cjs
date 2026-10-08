const fs=require('fs');const p='src/pages/CustomerPrediction.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('miss: '+a.slice(0,70)); s=s.replace(a,b); };
rep(`useState('net');`,`useState('id');`);
rep(`sub={\`Best promotion for \${category}, ranked\`}`,`sub={\`Best promotion for \${category}, customer by customer\`}`);
rep(`options={[{ value: 'net', label: 'Sort: expected profit' }, { value: 'resp', label: 'Sort: predicted response' }, { value: 'uplift', label: 'Sort: uplift' }, { value: 'recency', label: 'Sort: longest silent' }, { value: 'id', label: 'Sort: ID' }]}`,
    `options={[{ value: 'id', label: 'Sort: Customer ID' }, { value: 'net', label: 'Sort: expected profit' }, { value: 'resp', label: 'Sort: predicted response' }, { value: 'uplift', label: 'Sort: uplift' }, { value: 'recency', label: 'Sort: longest silent' }]}`);
// remove Past promotions panel
const a=s.indexOf('      <Panel title="Past promotions"'); const b=s.indexOf('</Panel>',a)+'</Panel>\n'.length;
s=s.slice(0,a)+s.slice(b);
rep(`  const hist = e.perCustomer.get(cid) ?? [];\n`,'');
// trim Insights views
rep(`  const [view, setView] = useState('mix');`,`  const [view, setView] = useState('mix');`);
const i0=s.indexOf('  const byType = TYPES.map'); const i1=s.indexOf('  const groupRows');
s=s.slice(0,i0)+s.slice(i1);
rep(`options={[{ value: 'mix', label: 'Best promotion mix' }, { value: 'profit', label: 'Profit by customer type' }, { value: 'lift', label: 'Response lift by customer type' }, { value: 'groups', label: 'Who to contact, by group' }]}`,
    `options={[{ value: 'mix', label: 'Best promotion mix' }, { value: 'groups', label: 'Who to contact, by group' }]}`);
const l0=s.indexOf("        : view === 'profit' ?"); const l1=s.indexOf("}>\n      {view === 'groups'");
s=s.slice(0,l0)+"        : []"+s.slice(l1);
const v0=s.indexOf("      {view === 'profit' &&"); const v1=s.indexOf('    </Panel>\n  );\n}', v0);
s=s.slice(0,v0)+s.slice(v1);
fs.writeFileSync(p,s);
