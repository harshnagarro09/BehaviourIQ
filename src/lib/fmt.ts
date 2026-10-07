export function inr(v: number, digits = 1): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(digits)}K`;
  return `${sign}₹${Math.round(a)}`;
}
export const int = (v: number) => Math.round(v).toLocaleString('en-IN');
export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
export const signed = (v: number, f: (n: number) => string) => (v > 0 ? '+' : '') + f(v);
export const dateLabel = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
