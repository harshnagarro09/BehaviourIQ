import { Lightbulb } from 'lucide-react';

/** One-sentence "so what" line. Text comes from src/lib/takeaways.ts. */
export function Takeaway({ children, className = '' }: { children: string; className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-lg border border-[var(--line)] bg-white px-3.5 py-2.5 text-[12px] font-medium leading-snug text-[var(--ink)] ${className}`}>
      <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--green-dark)]" />
      <span>{children}</span>
    </p>
  );
}
