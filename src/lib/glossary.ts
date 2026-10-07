// Plain-English help text for jargon. Edit the wording here; every "?" tooltip in the app reads from this file.
// Sources: the glossary in docs/PROJECT_GUIDE.md.
import { PREDICTION_WINDOW_DAYS } from '../engine/model.ts';

export const GLOSSARY = {
  predictionWindow: { term: 'Prediction window', text: `Chance this customer buys our brand within ${PREDICTION_WINDOW_DAYS} days of the promotion starting. Profit is for the same ${PREDICTION_WINDOW_DAYS} days, not a yearly value.` },
  auc: { term: 'AUC', text: 'How well the model ranks customers, from 0.5 (no better than guessing) to 1.0 (perfect). Higher means the customers it puts first really are the ones who buy.' },
  uplift: { term: 'Uplift', text: 'The chance of buying with the promotion minus the chance without it, in percentage points. It is an estimate from observed behaviour, not a measured experiment.' },
  leakage: { term: 'Leakage', text: 'Discount given on purchases that would have happened anyway, so it earned nothing extra.' },
  incrementality: { term: 'Incrementality', text: 'How much of the promoted sales are estimated to be extra, above what each customer would normally have bought at full price.' },
  roi: { term: 'ROI', text: 'Net profit divided by the discount given. Above 0 the promotion earned its discount back; below 0 it lost money.' },
  calibration: { term: 'Calibration', text: 'A check that predicted chances match what really happened: of customers given about a 40% chance, roughly 40% should actually buy.' },
  netProfit: { term: 'Net profit', text: 'Margin on promoted sales, minus the margin that would have been earned anyway, minus the dip in later weeks.' },
  pullForward: { term: 'Pull-forward / dip', text: 'Buying brought forward from later weeks, so sales just after a promotion are lower than normal.' },
  customerType: { term: 'Customer type', text: 'One of five groups based on how a customer reacts to promotions: Buys Anyways, Deal-Only, Stock-Up, Switcher or Ignores.' },
  anyways: { term: 'Buys Anyways', text: 'Mostly buys our brand at full price whether or not there is a promotion, so a discount only gives margin away.' },
  deal: { term: 'Deal-Only', text: 'Rarely buys our brand at full price but responds strongly to almost every promotion, even shallow ones.' },
  stockup: { term: 'Stock-Up', text: 'Buys 2 to 4 times the usual quantity on promotion, then holds off for weeks.' },
  switcher: { term: 'Switcher', text: 'Normally buys a competitor and tries our brand only when the discount is deep, around 20% or more.' },
  ignores: { term: 'Ignores Promotions', text: 'Rarely buys our brand and barely reacts to promotions.' },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
