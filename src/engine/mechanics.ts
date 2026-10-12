// Promotion types used for reporting past campaigns, in one place. A campaign maps to one type from its mechanic and depth.
export type MechKey = 'pct10' | 'pct15' | 'pct20' | 'pct25' | 'flat' | 'b1g1' | 'bogo' | 'multibuy' | 'tiered' | 'combo' | 'cashback';

export const MECH_LABEL: Record<MechKey, string> = {
  pct10: '10% Off', pct15: '15% Off', pct20: '20% Off', pct25: '25% Off', flat: '₹ Off on Min Spend', b1g1: 'Buy 1 Get 1 at 50%',
  bogo: 'Buy 1 Get 1 Free', multibuy: 'Buy 3 Pay for 2', tiered: 'Buy 2+ Save 15%', combo: 'Combo Pack 20% Off', cashback: '10% Cashback (Points)',
};

/** How the mechanic works, in one line, for tooltips and the KPI notes */
export const MECH_HOW: Record<MechKey, string> = {
  pct10: 'Straight price cut at the till on every unit.',
  pct15: 'Straight price cut at the till on every unit.',
  pct20: 'Straight price cut at the till on every unit.',
  pct25: 'Deep price cut. Only safe in high-margin categories.',
  flat: 'Fixed rupees off once the basket for the category reaches a minimum spend.',
  b1g1: 'Second unit at half price: 25% off across the pair.',
  bogo: 'Second unit free: 50% off across the pair. Only safe where margin is well above 50%.',
  multibuy: 'Three for the price of two: 33% off across the pack of three.',
  tiered: 'Volume tier: 15% off once two or more units are bought.',
  combo: 'Two different products of the category bought together, 20% off both.',
  cashback: 'Shelf price unchanged; 10% of the spend comes back as loyalty points. Cost is only what is redeemed.',
};

export const MECH_ORDER: MechKey[] = ['pct10', 'pct15', 'pct20', 'pct25', 'flat', 'b1g1', 'bogo', 'multibuy', 'tiered', 'combo', 'cashback'];

export function mechKey(c: { mechanic: string; depth: number }): MechKey {
  switch (c.mechanic) {
    case 'BOGO': return 'bogo';
    case 'MULTIBUY_3FOR2': return 'multibuy';
    case 'FLAT_OFF': return 'flat';
    case 'B1G1_50': return 'b1g1';
    case 'TIERED': return 'tiered';
    case 'COMBO': return 'combo';
    case 'CASHBACK': return 'cashback';
    default: return c.depth <= 12 ? 'pct10' : c.depth <= 17 ? 'pct15' : c.depth <= 22 ? 'pct20' : 'pct25';
  }
}
