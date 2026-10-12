// Colour scales shared by the analytics pages. Sequential = one hue light to dark; diverging = two hues around a grey midpoint.

/** text colour for an ROI value: red below break-even, amber below the 0.5 scale line, green above */
export const roiColor = (roi: number) => (roi < 0 ? 'var(--red)' : roi < 0.5 ? '#92400e' : 'var(--green-dark)');

/** diverging fill for ROI: red below 0, neutral grey at 0, green above (one hue each side) */
export function roiFill(v: number): string {
  const t = Math.max(-1, Math.min(1, v / 2));
  const n = [238, 241, 246];
  const pole = t >= 0 ? [4, 120, 87] : [220, 38, 38];
  const a = Math.abs(t) * 0.85;
  return `rgb(${Math.round(n[0] + (pole[0] - n[0]) * a)}, ${Math.round(n[1] + (pole[1] - n[1]) * a)}, ${Math.round(n[2] + (pole[2] - n[2]) * a)})`;
}
/** sequential fill for a rate 0..1 (single green hue, light to dark) */
export function rateFill(v: number): string {
  const t = Math.max(0, Math.min(1, v / 0.8));
  return `rgb(${Math.round(238 + (4 - 238) * t)}, ${Math.round(241 + (120 - 241) * t)}, ${Math.round(246 + (87 - 246) * t)})`;
}

