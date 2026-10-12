// Display names for past campaigns (mechanic code + depth -> label)
/** Display name of a promotion type */
export function offerName(mechanic: string, depth: number, flat = 0, minSpend = 0): string {
  if (mechanic === 'BOGO') return 'BOGO';
  if (mechanic === 'MULTIBUY_3FOR2') return 'Buy 3 Pay for 2';
  if (mechanic === 'FLAT_OFF') return `₹${Math.round(flat)} Off on ₹${Math.round(minSpend)}+`;
  if (mechanic === 'B1G1_50') return 'Buy 1 Get 1 at 50%';
  if (mechanic === 'TIERED') return `Buy 2+ Save ${depth}%`;
  if (mechanic === 'COMBO') return `Combo Pack ${depth}% Off`;
  if (mechanic === 'CASHBACK') return `${depth}% Cashback (Points)`;
  return `${depth}% Discount`;
}
