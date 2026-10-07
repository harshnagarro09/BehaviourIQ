// The five consumer types from the research brief, assigned from OBSERVED behaviour only.
import type { Behaviour, TypeId } from './behaviour.ts';

export interface TypeMeta {
  id: TypeId;
  name: string;
  short: string;
  color: string;
  tagline: string;
  signature: string; // what the data looks like
  play: string; // what to do with them
  promoStance: 'exclude' | 'target' | 'bundle' | 'conquest' | 'nurture';
}

export const TYPES: TypeMeta[] = [
  {
    id: 'anyways', name: 'Buys Anyways', short: 'Buys anyways', color: '#2a78d6',
    tagline: 'Would have bought at full price',
    signature: 'Mostly picks our brand at full price, few purchases depend on a promo, no volume spike during offers.',
    play: 'Keep them out of broad discounts. Reward with loyalty perks or early access instead, so margin is not given away.',
    promoStance: 'exclude',
  },
  {
    id: 'deal', name: 'Deal-Only Buyer', short: 'Deal-only', color: '#eb6834',
    tagline: 'Buys only when discounted',
    signature: 'Most of our-brand purchases happen on promotion, buys the category rarely at other times, responds to almost every campaign.',
    play: 'Core audience for percent-off offers. Use the shallowest discount that still converts and watch for promo fatigue.',
    promoStance: 'target',
  },
  {
    id: 'stockup', name: 'Stock-Up Buyer', short: 'Stock-up', color: '#1baf7a',
    tagline: 'Buys more and stocks up',
    signature: 'Quantity per promo purchase is a multiple of normal, followed by a visible dip in category buying afterwards.',
    play: 'Multi-buy and bundle mechanics fit. Count the post-promo dip against the uplift, so pull-forward is not mistaken for growth.',
    promoStance: 'bundle',
  },
  {
    id: 'switcher', name: 'Competitor Switcher', short: 'Switcher', color: '#8a63d2',
    tagline: 'Switches from a competitor',
    signature: 'Normally buys competitor brands, tries ours during a deep promotion, then drifts back.',
    play: 'Use deeper, time-boxed offers or trial packs, with a follow-up to convert the trial into a habit.',
    promoStance: 'conquest',
  },
  {
    id: 'ignores', name: 'Ignores Promotions', short: 'Ignores', color: '#8b8a85',
    tagline: 'Promotions do not move them',
    signature: 'Rarely buys our brand either way and does not react when it is discounted.',
    play: 'Do not spend promo budget here. Test a non-price trigger such as sampling or content before giving up.',
    promoStance: 'nurture',
  },
];
export const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t])) as Record<TypeId, TypeMeta>;

export interface Classification {
  type: TypeId;
  confidence: number; // 0.5 - 0.99, how far the customer sits from the decision thresholds
  reasons: string[];
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Transparent decision rules (no hidden labels). Each rule reads one behavioural signal:
 *  1. quantity per promo purchase vs normal  -> stock-up
 *  2. our share of full-price purchases      -> buys anyways
 *  3. response to past campaigns             -> ignores when very low
 *  4. response rate: moderate -> switcher, high -> deal-only
 */
export function classify(b: Behaviour): Classification {
  const reasons: string[] = [];
  let type: TypeId;
  let margin: number;
  if (b.qtyRatio >= 1.7) {
    type = 'stockup';
    margin = (b.qtyRatio - 1.7) / 0.8;
    reasons.push(`Buys ${b.qtyRatio.toFixed(1)}x the usual quantity when a promotion runs`);
    if (b.dipRatio < 0.8) reasons.push(`Category buying drops to ${pct(b.dipRatio)} of normal after a promo`);
  } else if (b.ourShareFull >= 0.55) {
    type = 'anyways';
    margin = (b.ourShareFull - 0.55) / 0.25;
    reasons.push(`${pct(b.ourShareFull)} of full-price purchases are our brand`);
    reasons.push(`Only ${pct(b.promoReliance)} of our-brand purchases needed a promo`);
  } else if (b.respRate < 0.2) {
    type = 'ignores';
    margin = (0.2 - b.respRate) / 0.2;
    reasons.push(`Responded to only ${b.respondedCampaigns} of ${b.activeCampaigns} campaigns (${pct(b.respRate)})`);
    reasons.push(`Just ${pct(b.promoReliance)} of our-brand purchases were on promo`);
  } else if (b.respRate < 0.55) {
    type = 'switcher';
    margin = (0.55 - b.respRate) / 0.3;
    reasons.push(`Buys ${b.compPerMonth.toFixed(1)} competitor items per month at full price`);
    reasons.push(`Takes our brand mainly when the discount is deep (${pct(b.promoReliance)} of our purchases on promo)`);
  } else {
    type = 'deal';
    margin = (b.respRate - 0.4) / 0.4;
    reasons.push(`${pct(b.promoReliance)} of our-brand purchases were on promotion`);
    reasons.push(`Responded to ${b.respondedCampaigns} of ${b.activeCampaigns} campaigns (${pct(b.respRate)})`);
  }
  return { type, confidence: 0.5 + 0.49 * clamp(margin), reasons };
}
