const fs=require('fs');const p='src/pages/Analytics.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('miss '+a.slice(0,50)); s=s.replace(a,b); };
rep(`                <div className="mt-3 space-y-2 rounded-lg bg-[var(--page)] p-3 text-[12.5px] leading-snug">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">How the numbers come from the bars</p>
                  <p className="num flex`,`                <details className="group mt-3 rounded-lg bg-[var(--page)] text-[12.5px] leading-snug">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-[12px] font-semibold text-[var(--ink)] [&::-webkit-details-marker]:hidden">
                    How the numbers come from the bars
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)] transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-2 px-3 pb-3">
                  <p className="num flex`);
rep(`Those customers would have paid full price.</p>
                </div>`,`Those customers would have paid full price.</p>
                  </div>
                </details>`);
rep(`import { RotateCcw, SlidersHorizontal }`,`import { ChevronDown, RotateCcw, SlidersHorizontal }`);
fs.writeFileSync(p,s);
