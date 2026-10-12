// Plain-English help text for jargon. Edit the wording here; every "?" tooltip in the app reads from this file.
// Formulas match src/lib/analytics.ts (KPI_DEFS) and src/engine/campaigns.ts.
import { SIM_WINDOW_DAYS } from '../engine/simulation.ts';

export const GLOSSARY = {
  predictionWindow: { term: 'Offer window', text: `The prediction looks at the ${SIM_WINDOW_DAYS} days after an offer starts: will customers in the group buy our brand in that time? Revenue and return are for the same ${SIM_WINDOW_DAYS} days, not a yearly value.` },
  uplift: { term: 'Uplift', text: 'Incremental purchase probability or sales above the baseline because of the offer. Estimated from each customer\'s own history, not measured with a control group.' },
  baseline: { term: 'Baseline', text: 'What customers would have bought anyway with no promotion: their own full-price buying rate before the campaign.' },
  leakage: { term: 'Subsidy rate', text: 'Share of the promo investment given away on purchases that would have happened anyway (the baseline). It earns nothing extra.' },
  incrementality: { term: 'Incrementality', text: 'Sales in the promotion window split into baseline (would have sold anyway) and uplift (extra sales caused by the promotion).' },
  investment: { term: 'Promo investment', text: 'What the promotions cost: till discount (list price − price paid) × units, plus loyalty points issued × the share that gets redeemed (70%). Actual, from the orders.' },
  roi: { term: 'Promo ROI', text: 'Incremental margin ÷ promo investment. Incremental margin = margin earned in the promotion window (after discounts, using each product’s unit cost) minus the margin the baseline would have earned at full price. 0 = break-even, 0.5 or more = high performer, below 0 = did not pay back. The post-promotion dip is not deducted.' },
  promoRevenue: { term: 'Promo revenue', text: 'Cash actually received on lines bought under the promotion (price paid × units). Taken straight from the orders. It is not incremental: much of it would have been earned anyway.' },
  incRevenue: { term: 'Incremental revenue', text: 'Revenue received in the promotion window minus what the baseline units would have brought at full price. Estimated: there is no control group.' },
  redemption: { term: 'Redemption rate', text: 'Reached customers who bought under the promotion ÷ reached customers. Reached = ordered in the 90 days before the campaign started.' },
  breakEven: { term: 'Break-even coverage', text: 'How many times the margin on the extra units covered the promo investment. 1.0x is break-even; it equals ROI + 1.' },
  revPerDiscount: { term: 'Incremental revenue per ₹1', text: 'Incremental revenue ÷ promo investment: how much extra sales each rupee bought. Read it with ROI: growth that loses margin is not a win.' },
  pullForward: { term: 'Pull-forward / dip', text: 'Buying brought forward from later weeks, so sales in the 21 days after a promotion are lower than normal. Shown as a diagnostic; not deducted from ROI because it needs a longer read and a control group.' },
  hurdle: { term: 'ROI hurdle', text: 'The minimum ROI an offer must reach to be funded. 0 accepts anything that pays for itself; a higher hurdle keeps budget for the strongest offers.' },
  responseScore: { term: 'Response score', text: 'From 0 to 100: how much more likely the offer makes this customer to buy, ranked against all customers. 100 = moved the most. High is 70 or more, Medium 40 to 69, Low under 40.' },
  holdout: { term: 'Holdout (control group)', text: 'A random share of every targeted customer group that does not get the offer. Comparing them with those who did is the only way to measure the true uplift afterwards.' },
  mde: { term: 'Minimum detectable uplift', text: 'The smallest uplift a treated-vs-holdout comparison can reliably detect (5% significance, 80% power). If the predicted uplift is smaller, read the result for the whole campaign rather than for one group alone.' },
  frontier: { term: 'Budget frontier', text: 'The best achievable result at every budget. Where the curve flattens, extra budget buys little: that is the efficient budget.' },
  untested: { term: 'Untested mechanic', text: 'A promotion type that has never run in this category. Its predicted uplift is cut by a quarter and it should launch as a controlled test.' },
  incMargin: { term: 'Incremental margin', text: 'Margin earned in the window after the discount and points, minus the margin the baseline would have earned at full price. The numerator of ROI. Not a net profit: overheads, pull-forward and cannibalisation are not deducted.' },
  customerType: { term: 'Customer type', text: 'One of four groups by how a customer responds to an offer: Persuadables, Sure Things, Lost Causes or Sleeping Dogs.' },
  allTypes: { term: 'Customer types', text: 'Persuadables: buy only because of the offer.\nSure Things: would buy anyway, so a discount gives away margin.\nLost Causes: will not buy either way.\nSleeping Dogs (Do Not Disturb): put off by the offer, so they buy less while it runs.' },
  persuadable: { term: 'Persuadables', text: 'Buy only because of the offer. They respond to many past promotions or buy extra units when discounted, so the offer creates new sales. The group to target.' },
  sure: { term: 'Sure Things', text: 'Would buy anyway. They buy our brand at full price several times a month, so a discount just gives away margin. Keep them out of broad offers.' },
  lost: { term: 'Lost Causes', text: 'Will not buy either way. They rarely buy our brand and ignore offers, so a promotion only wastes cost.' },
  dog: { term: 'Sleeping Dogs', text: 'Also called Do Not Disturb. They buy regularly at full price but are put off or pulled away by the offer, buying less while it runs. Do not send them offers.' },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
