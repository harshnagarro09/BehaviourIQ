import { useRef } from 'react';
import { BarChart3, CalendarRange, UserSearch, Activity, MessageSquareText, SlidersHorizontal, Upload } from 'lucide-react';
import { RETAILER_NAME, DATA_NOTE } from '@/lib/brand';
import { AppProvider, useApp, type PageId } from '@/state';
import { Analytics } from '@/pages/Analytics';
import { CustomerPrediction } from '@/pages/CustomerPrediction';
import { Planning } from '@/pages/Planning';
import { Simulation } from '@/pages/Simulation';
import { Advisor } from '@/pages/Advisor';

const NAV: { group: string; items: { id: PageId; label: string; icon: React.ReactNode }[] }[] = [
  { group: 'Analytics', items: [{ id: 'analytics', label: 'Behaviour Analytics', icon: <BarChart3 className="h-3.5 w-3.5" /> }] },
  { group: 'Prediction', items: [{ id: 'customers', label: 'Customer Prediction', icon: <UserSearch className="h-3.5 w-3.5" /> }] },
  {
    group: 'Planning',
    items: [
      { id: 'planning', label: 'Planning', icon: <CalendarRange className="h-3.5 w-3.5" /> },
      { id: 'simulation', label: 'Simulation', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
    ],
  },
  { group: 'Intelligence', items: [{ id: 'advisor', label: 'AI Advisor', icon: <MessageSquareText className="h-3.5 w-3.5" /> }] },
];

function Shell() {
  const { engine, error, page, go, loadText } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-full">
      <aside className="hidden w-[208px] shrink-0 flex-col bg-[var(--navy)] text-white md:flex">
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--green)] text-white"><Activity className="h-4 w-4" strokeWidth={2.6} /></div>
          <div><p className="text-[15px] font-bold leading-none tracking-tight">BehaviourIQ</p><p className="mt-1 text-[11px] leading-none text-white/45">for {RETAILER_NAME}</p></div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5">
          {NAV.map((g) => (
            <div key={g.group}>
              {g.items.map((i) => (
                <button
                  key={i.id}
                  onClick={() => go(i.id)}
                  className={`relative mb-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-[13px] transition-colors ${page === i.id ? 'bg-white/10 font-semibold text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
                >
                  {page === i.id && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-[var(--green)]" />}
                  {i.icon}
                  {i.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => loadText(t, f.name)); }} />
          <button onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-white/60 hover:bg-white/5 hover:text-white" title="Load another CSV with the same columns">
            <Upload className="h-3.5 w-3.5" />Load CSV
          </button>
          <p className="px-2.5 pt-1 text-[11px] leading-snug text-white/35">{DATA_NOTE}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-1 overflow-x-auto bg-[var(--navy)] px-3 py-2 md:hidden">
          {NAV.flatMap((g) => g.items).map((i) => (
            <button key={i.id} onClick={() => go(i.id)} className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium ${page === i.id ? 'bg-white/15 text-white' : 'text-white/60'}`}>{i.icon}{i.label}</button>
          ))}
        </div>
        <main id="main-scroll" className="min-h-0 flex-1 overflow-y-auto">
          {error && <div className="card m-6 border-[#f3b4b4] bg-[#fdeeee] p-4 text-[13px] text-[#b91c1c]"><p className="font-semibold">Could not load the data</p><p className="mt-1">{error}</p></div>}
          {!engine && !error && <Loading />}
          {engine && (
            <div key={page} className={`rise ${page === 'advisor' ? 'h-full' : ''}`}>
              {page === 'analytics' && <Analytics />}
              {page === 'customers' && <CustomerPrediction />}
              {page === 'planning' && <Planning />}
              {page === 'simulation' && <Simulation />}
              {page === 'advisor' && <Advisor />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="p-6" aria-busy="true" aria-live="polite">
      <div className="mb-5 flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--green)]" />
        <div>
          <p className="text-[13px] font-semibold">Analysing customer behaviour…</p>
          <p className="text-[12px] text-[var(--ink-3)]">Profiling customers, training the response model and scoring campaigns.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-[92px]" />)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="skeleton h-72 lg:col-span-2" />
        <div className="skeleton h-72" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
