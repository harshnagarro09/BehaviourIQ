import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { useApp, useEngine, type PageId } from '@/state';
import { answer, SUGGESTED, type Answer } from '@/engine/advisor';
import { PageTop } from '@/pages/Analytics';

interface Msg { role: 'user' | 'ai'; text: string; a?: Answer }

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
}

function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="my-1 space-y-1 pl-4">{list.map((l, i) => <li key={i} className="list-disc">{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) list.push(line.slice(2));
    else { flush(); blocks.push(<p key={blocks.length} className="my-1">{inline(line)}</p>); }
  }
  flush();
  return <>{blocks}</>;
}

// links in answers point at the old page ids; map them onto the four pages
const PAGE_MAP: Record<string, PageId> = { plan: 'planning', simulator: 'simulation', simulation: 'simulation', planning: 'planning' };
const toPage = (p: string): PageId => PAGE_MAP[p] ?? 'analytics';

export function Advisor() {
  const e = useEngine();
  const { go } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  const ask = (q: string) => {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    setTimeout(() => {
      setMsgs((m) => [...m, { role: 'ai', text: '', a: answer(e, q) }]);
      setBusy(false);
    }, 350);
  };

  return (
    <div className="flex h-full flex-col">
      <PageTop title="AI Advisor" sub="Conversational AI tuned to your customer and promotion data" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[900px] space-y-4">
          {msgs.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-white p-5 text-[12px] leading-relaxed text-[var(--ink-2)]">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--ink)]"><Sparkles className="h-3.5 w-3.5" />Ask about campaigns, budget, customers or predictions</p>
              Answers are calculated from the loaded CSV by the same engine behind the other pages. Try a suggested question below, or a customer ID such as C0042.
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end"><div className="max-w-[70%] rounded-xl rounded-tr-sm bg-[var(--navy)] px-3.5 py-2 text-[12px] font-medium text-white">{m.text}</div></div>
            ) : (
              <div key={i} className="max-w-[640px] rounded-xl rounded-tl-sm border border-[var(--line)] bg-white px-4 py-3 text-[12px] leading-relaxed">
                <Rich text={m.a!.text} />
                {m.a!.table && (
                  <div className="my-2 overflow-hidden rounded-lg border border-[var(--line)]">
                    <table className="w-full text-[11.5px]">
                      <thead><tr className="bg-[var(--page)] text-left text-[10px] font-semibold text-[var(--ink-3)]">{m.a!.table.head.map((h) => <th key={h} className="px-2.5 py-1.5">{h}</th>)}</tr></thead>
                      <tbody>{m.a!.table.rows.map((r, ri) => <tr key={ri} className="border-t border-[var(--line-2)]">{r.map((c, k) => <td key={k} className={`num px-2.5 py-1.5 ${k === 0 ? 'font-semibold' : ''}`}>{c}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
                {m.a!.links && <div className="mt-2 flex flex-wrap gap-1.5">{m.a!.links.map((l) => <button key={l.label} onClick={() => go(toPage(l.page))} className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] font-medium hover:bg-[var(--page)]">{l.label} →</button>)}</div>}
                {m.a!.followUps && <div className="mt-2 flex flex-wrap gap-1.5">{m.a!.followUps.map((f) => <button key={f} onClick={() => ask(f)} className="rounded-full bg-[var(--page)] px-2.5 py-0.5 text-[11px] text-[var(--ink-2)] hover:bg-[var(--line)]">{f}</button>)}</div>}
              </div>
            ),
          )}
          {busy && <div className="dot-blink flex gap-1 pl-1 text-[var(--ink-3)]"><span>●</span><span>●</span><span>●</span></div>}
          <div ref={end} />
        </div>
      </div>
      <div className="border-t border-[var(--line)] bg-white px-6 py-3">
        <div className="mx-auto max-w-[900px]">
          <p className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Suggested questions</p>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[10.5px] text-[var(--ink-2)] hover:bg-[var(--page)]">{s}</button>)}
          </div>
          <div className="flex items-center gap-2">
            <input value={input} onChange={(ev) => setInput(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && ask(input)} placeholder="Ask about campaigns, budget, customers, or predictions…" className="h-10 flex-1 rounded-lg border border-[var(--line)] px-3 text-[12px] outline-none focus:border-[var(--navy)]" />
            <button onClick={() => ask(input)} disabled={!input.trim() || busy} className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--green)] text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
