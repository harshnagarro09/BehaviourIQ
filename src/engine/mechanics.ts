// The five promotion types used for reporting, in one place.
export type MechKey = 'pct10' | 'pct20' | 'flat' | 'bogo' | 'bundle';
export const MECH_LABEL: Record<MechKey, string> = {
  pct10: '10% Discount', pct20: '20% Discount', flat: '₹ Off on Minimum Spend', bogo: 'BOGO', bundle: 'Bundle / Combo Offer',
};
export function mechKey(c: { mechanic: string; depth: number }): MechKey {
  return c.mechanic === 'BOGO' ? 'bogo' : c.mechanic === 'MULTIBUY_3FOR2' ? 'bundle' : c.mechanic === 'FLAT_OFF' ? 'flat' : c.depth <= 15 ? 'pct10' : 'pct20';
}
