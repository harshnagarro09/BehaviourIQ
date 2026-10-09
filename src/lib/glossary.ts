// Plain-English help text for jargon. Edit the wording here; every "?" tooltip in the app reads from this file.
// Sources: the glossary in docs/PROJECT_GUIDE.md.
import { SIM_WINDOW_DAYS } from '../engine/simulation.ts';

export const GLOSSARY = {
  predictionWindow: { term: 'Offer window', text: `The simulation looks at the ${SIM_WINDOW_DAYS} days after an offer starts: will this customer buy our brand in that time? Profit is for the same ${SIM_WINDOW_DAYS} days, not a yearly value.` },
  uplift: { term: 'Uplift', text: 'Sales or buying chance above the baseline because of the offer. It is estimated from past behaviour here, not measured with a control group.' },
  baseline: { term: 'Baseline', text: 'What customers would have bought anyway with no promotion.' },
  leakage: { term: 'Subsidy', text: 'Discount given on purchases that would have happened anyway (the baseline), so it earned nothing extra.' },
  incrementality: { term: 'Incrementality', text: 'Promoted sales split into baseline (would have sold anyway) and uplift (extra sales caused by the promotion).' },
  roi: { term: 'ROI', text: 'Net profit divided by the discount given. Above 0 the promotion earned its discount back; below 0 it lost money.' },
  netProfit: { term: 'Net profit', text: 'Margin on promoted sales, minus the margin that would have been earned anyway (baseline), minus the dip in later weeks.' },
  pullForward: { term: 'Pull-forward / dip', text: 'Buying brought forward from later weeks, so sales just after a promotion are lower than normal.' },
  customerType: { term: 'Customer type', text: 'One of four groups by how a customer responds to an offer: Persuadables, Sure Things, Lost Causes or Sleeping Dogs.' },
  allTypes: { term: 'Customer types', text: 'Persuadables: buy only because of the offer.\nSure Things: would buy anyway, so a discount gives away margin.\nLost Causes: will not buy either way.\nSleeping Dogs (Do Not Disturb): put off by the offer, so they buy less while it runs.' },
  persuadable: { term: 'Persuadables', text: 'Buy only because of the offer. They respond to many past promotions or buy extra units when discounted, so the offer creates new sales. The group to target.' },
  sure: { term: 'Sure Things', text: 'Would buy anyway. They buy our brand at full price several times a month, so a discount just gives away margin. Keep them out of broad offers.' },
  lost: { term: 'Lost Causes', text: 'Will not buy either way. They rarely buy our brand and ignore offers, so a promotion only wastes cost.' },
  dog: { term: 'Sleeping Dogs', text: 'Also called Do Not Disturb. They buy regularly at full price but are put off or pulled away by the offer, buying less while it runs. Do not send them offers.' },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
