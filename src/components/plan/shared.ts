// Small helpers and labels shared by the Planning components.

import type { Objective } from '@/engine/targeting';


export const GOALS: { id: Objective; label: string; text: string }[] = [
  { id: 'margin', label: 'Most profit', text: 'Puts money where it adds the most profit after paying for the offer.' },
  { id: 'revenue', label: 'Most sales', text: 'Puts money where it adds the most sales. Extra sales can come with thinner profit.' },
  { id: 'buyers', label: 'Most buyers', text: 'Puts money where it wins the most extra buyers. More buyers is not always more profit.' },
];

export const per1 = (roi: number) => `${roi < 0 ? '−' : ''}₹${Math.abs(roi).toFixed(2)}`;

export const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export type LimitInput = Record<string, { min: string; max: string }>;

export const num = (s: string) => (s.trim() === '' || !Number.isFinite(+s) || +s < 0 ? null : +s);

export const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-3)]';

