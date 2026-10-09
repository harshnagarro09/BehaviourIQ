// The four customer types used in promotion targeting (industry uplift terms), assigned from OBSERVED behaviour only
// by transparent rules. No model and no hidden labels.
import type { Behaviour, TypeId } from './behaviour.ts';

export interface TypeMeta {
  id: TypeId;
  name: string;
  short: string;
  color: string;
  tagline: string;
  signature: string; // what the data looks like
  rule: string; // the rule that assigns the type
  play: string; // what to do with them
  promoStance: 'target' | 'exclude' | 'skip' | 'avoid';
}

export const TYPES: TypeMeta[] = [
  {
    id: 'persuadable', name: 'Persuadables', short: 'Persuadables', color: '#1baf7a',
    tagline: 'Buy only because of the offer',
    signature: 'Buy the brand mainly when it is on promotion, respond to many past offers and buy more units when it is discounted.',
    rule: 'Responded to 20%+ of past promotions, or buy 1.7x their normal quantity on offer',
    play: 'The only group that creates new sales. Target them with the shallowest offer that still adds profit.',
    promoStance: 'target',
  },
  {
    id: 'sure', name: 'Sure Things', short: 'Sure Things', color: '#2a78d6',
    tagline: 'Would buy anyway',
    signature: 'Buy the brand regularly at full price and take discounted units when they appear, but their volume does not rise because of the offer.',
    rule: '2.5+ full-price purchases of our brand a month and under 30% of their purchases on promotion',
    play: 'A discount just gives away margin. Keep them out of broad offers and reward loyalty without cutting price.',
    promoStance: 'exclude',
  },
  {
    id: 'lost', name: 'Lost Causes', short: 'Lost Causes', color: '#8b8a85',
    tagline: 'Will not buy either way',
    signature: 'Rarely buy our brand at full price or on promotion and do not react when it is discounted.',
    rule: 'Responded to fewer than 20% of past promotions and rarely buy our brand',
    play: 'Do not spend promotion budget or contact cost here. Test a non-price trigger such as sampling.',
    promoStance: 'skip',
  },
  {
    id: 'dog', name: 'Sleeping Dogs', short: 'Sleeping Dogs', color: '#d64545',
    tagline: 'Do Not Disturb: put off by the offer',
    signature: 'Buy our brand regularly at full price, but buy noticeably less of it while it is on promotion.',
    rule: 'Buy our brand 1.5+ times a month at full price, yet their volume in promotion windows is under 60% of normal',
    play: 'Do not send offers. A promotion pulls them away, so leaving them alone protects existing sales.',
    promoStance: 'avoid',
  },
];
export const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t])) as Record<TypeId, TypeMeta>;

export interface Classification {
  type: TypeId;
  confidence: number; // 0.5 - 0.99, how far the customer sits from the rule thresholds
  reasons: string[];
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Rules are checked in this order; each reads one observable behaviour. */
export function classify(b: Behaviour): Classification {
  const reasons: string[] = [];
  let type: TypeId;
  let margin: number;
  if (b.lift < 0.6 && b.fullPriceBuysPerMonth >= 1.5) {
    type = 'dog';
    margin = (0.6 - b.lift) / 0.4;
    reasons.push(`Buys our brand ${b.fullPriceBuysPerMonth.toFixed(1)} times a month at full price`);
    reasons.push(`During promotions their volume falls to ${pct(b.lift)} of normal`);
  } else if (b.qtyRatio >= 1.7) {
    type = 'persuadable';
    margin = (b.qtyRatio - 1.7) / 0.8;
    reasons.push(`Buys ${b.qtyRatio.toFixed(1)}x the usual quantity when a promotion runs`);
    if (b.dipRatio < 0.8) reasons.push(`Category buying drops to ${pct(b.dipRatio)} of normal afterwards (pull-forward)`);
  } else if (b.fullPriceBuysPerMonth >= 2.5 && b.promoReliance <= 0.3) {
    type = 'sure';
    margin = (b.fullPriceBuysPerMonth - 2.5) / 2;
    reasons.push(`Buys our brand at full price ${b.fullPriceBuysPerMonth.toFixed(1)} times a month`);
    reasons.push(`Only ${pct(b.promoReliance)} of their purchases of it needed a promotion`);
  } else if (b.respRate < 0.2) {
    type = 'lost';
    margin = (0.2 - b.respRate) / 0.2;
    reasons.push(`Responded to only ${b.respondedCampaigns} of ${b.activeCampaigns} campaigns (${pct(b.respRate)})`);
    reasons.push(`Buys our brand just ${b.fullPriceBuysPerMonth.toFixed(1)} times a month at full price`);
  } else {
    type = 'persuadable';
    margin = (b.respRate - 0.2) / 0.4;
    reasons.push(`Responded to ${b.respondedCampaigns} of ${b.activeCampaigns} campaigns (${pct(b.respRate)})`);
    reasons.push(`${pct(b.promoReliance)} of their purchases of our brand were on promotion`);
  }
  return { type, confidence: 0.5 + 0.49 * clamp(margin), reasons };
}
