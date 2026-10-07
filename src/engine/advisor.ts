// The chatbot's brain. Every number in an answer is read from the loaded CSV via the engine;
// questions are routed by intent (keywords + entities such as customer ids, categories, consumer types, budgets).
// No external service is called.
import type { TypeId } from './behaviour.ts';
import type { Engine } from './index.ts';
import { TYPES, TYPE_BY_ID } from './segments.ts';
import { PREDICTION_WINDOW_DAYS } from './model.ts';
import type { Scenario } from './planner.ts';

export interface Answer {
  text: string; // **bold** and "- " bullets
  table?: { head: string[]; rows: string[][] };
  links?: { label: string; page: string; params?: Record<string, string> }[];
  followUps?: string[];
}

export const SUGGESTED = [
  'Give me a summary of how we are doing',
  'Which customers buy even without a discount?',
  'Where are we wasting discount money?',
  'Best offer for ₹10K discount budget',
  'What should we run for Beverages?',
  'Who are the stock-up buyers?',
  'Is the prediction accurate and does it make money?',
  'Which behaviours predict response?',
  'What do customers buy together?',
];

const inr = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e5 ? `${(a / 1e5).toFixed(2)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${Math.round(a)}`;
  return `${v < 0 ? '-' : ''}₹${s}`;
};
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

const TYPE_WORDS: [TypeId, RegExp][] = [
  ['anyways', /anyway|any way|regardless|even without|full price|loyal/],
  ['deal', /deal|only when disc|only on promo|bargain|waits? for/],
  ['stockup', /stock|bulk|load up|pantry/],
  ['switcher', /switch|competitor|rival|conquest/],
  ['ignores', /ignor|unresponsive|never respond|not respond/],
];

function findType(q: string): TypeId | null {
  for (const [t, re] of TYPE_WORDS) if (re.test(q)) return t;
  return null;
}
function findCategory(e: Engine, q: string): string | null {
  return e.ds.categories.find((c) => q.includes(c.toLowerCase())) ?? null;
}
function findBudget(q: string): number | null {
  const m = /(?:₹|rs\.?\s?|inr\s?)?\s?(\d+(?:\.\d+)?)\s?(k|l|lakh|lac)?\b/.exec(q.replace(/,/g, ''));
  if (!m) return null;
  const hasMoney = /₹|rs|inr|budget|spend|k\b|lakh/.test(q);
  if (!hasMoney) return null;
  let v = +m[1];
  if (m[2] === 'k') v *= 1e3;
  if (m[2] === 'l' || m[2] === 'lakh' || m[2] === 'lac') v *= 1e5;
  return v;
}

export function answer(e: Engine, raw: string): Answer {
  const q = raw.toLowerCase().trim();
  const t = e.totals;
  const type = findType(q);
  const cat = findCategory(e, q);
  const idm = /\bc\d{1,4}\b/i.exec(q);

  // ------------------------------------------------ a specific customer
  if (idm) {
    const cid = idm[0].toUpperCase().replace(/^C(\d+)$/, (_, d) => 'C' + d.padStart(4, '0'));
    const r = e.recById.get(cid);
    if (!r) return { text: `I could not find **${cid}** in the data. Customer IDs look like C0001 to C${String(e.records.length).padStart(4, '0')}.` };
    const offers = e.recommendations
      .map((x) => ({ x, ex: x.expectations.get(cid) }))
      .filter((o) => o.ex && o.x.best && o.ex.net > 0)
      .sort((a, b) => b.ex!.net - a.ex!.net);
    const lines = [
      `**${cid}** is a **${TYPE_BY_ID[r.type].name}** (confidence ${pct(r.confidence)}).`,
      ...r.reasons.map((s) => `- ${s}`),
      `They order about ${r.b.ordersPerMonth.toFixed(1)} times a month, spent ${inr(r.b.totalSpend)} in total and last ordered ${r.b.recencyDays} days ago.`,
      offers.length
        ? `**Best next offer:** ${offers[0].x.candidate.name} at ${offers[0].x.best!.option.label}. Chance of buying rises from ${pct(offers[0].ex!.p0)} to ${pct(offers[0].ex!.p1)}.`
        : `**No discount recommended.** The model expects any offer to give away more margin than it wins. ${TYPE_BY_ID[r.type].play}`,
    ];
    return { text: lines.join('\n'), links: [{ label: 'Open profile', page: 'customers', params: { id: cid } }] };
  }

  // ------------------------------------------------ best offer for a budget / category
  if (/(best|top).*(offer|promo|campaign)|what should (we|i) run|recommend|next campaign|which campaign|plan/.test(q) || findBudget(q)) {
    const budget = findBudget(q);
    const recs = e.recommendations.filter((r) => !cat || r.candidate.category.toLowerCase() === cat.toLowerCase());
    let cands: { name: string; s: Scenario; cat: string }[] = [];
    for (const r of recs) for (const s of r.scenarios) if (s.net > 0) cands.push({ name: r.candidate.name, s, cat: r.candidate.category });
    if (budget) cands = cands.filter((c) => c.s.discountCost <= budget);
    cands.sort((a, b) => b.s.net - a.s.net);
    if (!cands.length) return { text: `No campaign has a positive expected profit${budget ? ` within a ${inr(budget)} discount budget` : ''}${cat ? ` in ${cat}` : ''}. A non-price trigger such as sampling or loyalty points is a safer use of the slot.` };
    const top = cands[0];
    const alt = cands.filter((c) => c.name !== top.name).slice(0, 3);
    return {
      text: [
        `**${top.name}** (${top.cat}) at **${top.s.option.label}** is the best fit${budget ? ` for ${inr(budget)}` : ''}.`,
        `- Target ${top.s.audience.targeted} of ${top.s.audience.total} active customers, skipping those who would buy anyway`,
        `- Discount spend ${inr(top.s.discountCost)}, expected net profit **${inr(top.s.net)}**, ROI ${top.s.roi.toFixed(2)}`,
        `- About ${Math.round(top.s.incrementalBuyers)} extra buyers because of the offer`,
        top.s.blanket.net < top.s.net ? `- Sending the same offer to everyone would earn ${inr(top.s.blanket.net)}, so targeting adds ${inr(top.s.net - top.s.blanket.net)}` : `- Sending to everyone earns ${inr(top.s.blanket.net)}, similar to targeting`,
      ].join('\n'),
      table: alt.length ? { head: ['Alternative', 'Offer', 'Spend', 'Net profit'], rows: alt.map((a) => [a.name, a.s.option.label, inr(a.s.discountCost), inr(a.s.net)]) } : undefined,
      links: [{ label: 'Open AI Recommendations', page: 'plan' }, { label: 'Try in Simulator', page: 'simulator' }],
      followUps: ['Where are we wasting discount money?', 'Who should we target?'],
    };
  }

  // ------------------------------------------------ waste / leakage
  if (/wast|leak|losing|loss|lose|cannibal|giving away|subsid|anyway.*discount/.test(q) && !/accura|profitable|make money|worth|loss.?making|profit.?making|reliable/.test(q)) {
    const worst = [...e.results].sort((a, b) => a.netProfit - b.netProfit).slice(0, 3);
    const anyw = e.stats.find((s) => s.type === 'anyways')!;
    const ign = e.stats.find((s) => s.type === 'ignores')!;
    return {
      text: [
        `Across ${e.results.length} past campaigns, **${inr(t.leakage)}** (${pct(t.leakagePct)} of ${inr(t.discountCost)} discount) went to purchases that would have happened anyway.`,
        `After counting baseline sales and the post-promo dip, promotions returned **${inr(t.netProfit)}** (ROI ${t.roi.toFixed(2)}).`,
        `- Buys-anyways customers: net ${inr(anyw.netProfit)} (${anyw.n} customers)`,
        `- Ignores-promotions customers: net ${inr(ign.netProfit)} (${ign.n} customers)`,
      ].join('\n'),
      table: { head: ['Weakest campaigns', 'Offer', 'Net profit', 'Leakage'], rows: worst.map((r) => [r.campaign.name, `${r.campaign.depth}%`, inr(r.netProfit), pct(r.leakagePct)]) },
      links: [{ label: 'See scorecard', page: 'lab' }, { label: 'Watchdog alerts', page: 'plan' }],
      followUps: ['Which customers buy even without a discount?', 'Best offer for ₹10K discount budget'],
    };
  }

  // ------------------------------------------------ consumer type
  if (type && !/accura/.test(q)) {
    const meta = TYPE_BY_ID[type];
    const s = e.stats.find((x) => x.type === type)!;
    const sample = e.records.filter((r) => r.type === type).sort((a, b) => b.confidence - a.confidence).slice(0, 4).map((r) => r.cid);
    return {
      text: [
        `**${meta.name}**: ${meta.tagline.toLowerCase()}. ${s.n} customers (${pct(s.share)} of the base, ${pct(s.spendShare)} of spend).`,
        `- In the data: ${meta.signature}`,
        `- ${pct(s.respRate)} response to past promotions, ${pct(s.promoReliance)} of purchases on promo`,
        `- Past promotion profit: **${inr(s.netProfit)}** (ROI ${s.roi.toFixed(2)})`,
        `**What to do:** ${meta.play}`,
        `Examples: ${sample.join(', ')}`,
      ].join('\n'),
      links: [{ label: 'See these customers', page: 'customers', params: { type } }],
      followUps: ['Where are we wasting discount money?', 'What should we run for Beverages?'],
    };
  }
  if (/type|segment|kinds? of (customer|consumer)|who are our (customers|consumers)/.test(q)) {
    return {
      text: 'Customers fall into five behaviour types, assigned from what they actually buy:',
      table: { head: ['Type', 'Customers', 'Promo ROI'], rows: e.stats.map((s) => [TYPE_BY_ID[s.type].name, `${s.n} (${pct(s.share)})`, s.roi.toFixed(2)]) },
      links: [{ label: 'Open Consumer Types', page: 'types' }],
    };
  }

  // ------------------------------------------------ model
  if (/accura|auc|model|predict|how does it work|trust|validate|profitable|make money|worth|loss.?making|profit.?making|reliable|behaviours? (that )?(predict|matter|drive)/.test(q)) {
    const m = e.model;
    const V = e.validation;
    const sum = (f: (v: (typeof V)[number]) => number) => V.reduce((x, v) => x + f(v), 0);
    const real = sum((v) => v.realNet), cost = sum((v) => v.cost), broad = sum((v) => v.broadNet), broadCost = sum((v) => v.broadCost), skipped = sum((v) => v.skippedNet);
    const top20 = m.gains.find((g) => g.pctCustomers >= 0.2);
    const groups = m.groupImportance.slice(0, 3).map((g) => g.group.toLowerCase() + ' (' + pct(g.share) + ')').join(', ');
    return {
      text: [
        `The model estimates each customer's chance of buying in ${PREDICTION_WINDOW_DAYS} days, with and without a promotion. It was checked on **${V.length} campaigns it never saw**.`,
        `- **Accurate?** AUC **${m.aucTest.toFixed(2)}** (0.5 = guessing). The 20% of customers it ranks highest hold **${pct(top20?.pctResponders ?? 0)}** of all buyers.`,
        `- **Profitable?** Targeting by behaviour earned **${inr(real)}** (ROI ${(cost ? real / cost : 0).toFixed(2)}), versus **${inr(broad)}** (ROI ${(broadCost ? broad / broadCost : 0).toFixed(2)}) for offering everyone. ${real > 0 ? 'It is profit-making.' : 'It is loss-making.'}`,
        `- Customers it chose to skip would have lost a further ${inr(-skipped)} if offered.`,
        `- **What drives it:** ${groups}.`,
      ].join('\n'),
      links: [{ label: 'See the validation', page: 'analytics' }],
      followUps: ['Where are we wasting discount money?', 'What should we run for Beverages?'],
    };
  }

  // ------------------------------------------------ campaigns performance
  if (/best campaign|worst campaign|performed|past campaign|roi|which promotion/.test(q)) {
    const sorted = [...e.results].sort((a, b) => b.roi - a.roi);
    const show = [...sorted.slice(0, 3), ...sorted.slice(-2)];
    return {
      text: `Best: **${sorted[0].campaign.name}** (ROI ${sorted[0].roi.toFixed(2)}). Worst: **${sorted[sorted.length - 1].campaign.name}** (${inr(sorted[sorted.length - 1].netProfit)}). ${e.results.filter((r) => r.roi < 0).length} of ${e.results.length} lost money.`,
      table: { head: ['Campaign', 'Offer', 'Net profit', 'ROI'], rows: show.map((r) => [r.campaign.name, `${r.campaign.depth}% ${r.campaign.mechanic === 'BOGO' ? 'BOGO' : ''}`.trim(), inr(r.netProfit), r.roi.toFixed(2)]) },
      links: [{ label: 'Open scorecard', page: 'lab' }],
    };
  }

  // ------------------------------------------------ basket
  if (/together|basket|bundle|pair|cross.?sell|combo/.test(q)) {
    const p = e.basket.pairs.slice(0, 3);
    return {
      text: `${p[0].a} and ${p[0].b} are bought together **${p[0].lift.toFixed(2)}x** more often than chance. Good bundle candidates:`,
      table: { head: ['Pair', 'Orders', 'Lift'], rows: p.map((x) => [`${x.a} + ${x.b}`, pct(x.support, 1), x.lift.toFixed(2)]) },
      links: [{ label: 'Basket analysis', page: 'lab' }],
    };
  }

  // ------------------------------------------------ timing
  if (/when|weekend|weekday|season|month|day of|timing|festiv|diwali/.test(q)) {
    const d = e.timing.dow;
    const tot = d.reduce((s, v) => s + v, 0);
    const peaks = e.timing.seasonality.map((s) => `${s.category}: ${e.timing.months[s.index.indexOf(Math.max(...s.index.slice(1, -1)))]?.label}`);
    return {
      text: [`Weekends carry **${pct((d[0] + d[6]) / tot)}** of orders (Sat+Sun).`, `Peak months by category: ${peaks.join(' · ')}.`, 'Avoid deep discounts in a category\'s natural peak month; the sales were coming anyway.'].join('\n'),
      links: [{ label: 'Timing analysis', page: 'lab' }],
    };
  }

  // ------------------------------------------------ price
  if (/depth|how much (discount|off)|sensitiv|price|willing|threshold/.test(q)) {
    const sw = e.stats.find((s) => s.type === 'switcher')!;
    const dl = e.stats.find((s) => s.type === 'deal')!;
    return {
      text: [`Deal-only buyers take about **${dl.avgDisc.toFixed(0)}%** off on average, Switchers about **${sw.avgDisc.toFixed(0)}%**.`, `Across the planned slots the model's best offers are: ${[...new Set(e.recommendations.filter((r) => r.best).map((r) => r.best!.option.label))].join(', ')}. Deeper offers mostly add leakage and pull-forward.`].join('\n'),
      links: [{ label: 'Price behaviour', page: 'lab' }, { label: 'Try the Simulator', page: 'simulator' }],
    };
  }

  // ------------------------------------------------ brand
  if (/brand|loyal|compet|switch/.test(q)) {
    const f = e.funnel;
    return {
      text: `Of ${f.rivals} customers who normally buy competitors, **${f.tried}** tried us on promotion and only **${f.stayed}** (${f.tried ? pct(f.stayed / f.tried) : '0%'}) bought us again at full price within 30 days.`,
      links: [{ label: 'Brand behaviour', page: 'lab' }],
    };
  }

  // ------------------------------------------------ target audience
  if (/target|audience|who should/.test(q)) {
    const r = (cat ? e.recommendations.find((x) => x.candidate.category === cat) : e.recommendations[0])!;
    const b = r.best;
    if (!b) return { text: `No customers are worth discounting for ${r.candidate.name}.` };
    return {
      text: `For **${r.candidate.name}** (${b.option.label}), target ${b.audience.targeted} of ${b.audience.total} customers:`,
      table: { head: ['Type', 'Targeted', 'Of'], rows: TYPES.map((x) => [x.short, String(b.audience.byType[x.id].targeted), String(b.audience.byType[x.id].total)]) },
      links: [{ label: 'Open AI Recommendations', page: 'plan' }],
    };
  }

  // ------------------------------------------------ overview / default help
  if (/summar|overview|how are we|kpi|status|headline/.test(q) || q.length < 3) {
    return {
      text: [
        `**${t.customers} customers**, ${t.orders.toLocaleString()} orders, ${inr(t.revenue)} revenue over 15 months.`,
        `- Promotions gave away ${inr(t.discountCost)} in discount. Only ${pct(t.incShare)} of promoted units are estimated to be incremental (estimated from each customer's own baseline, not a randomised test).`,
        `- Net promotion profit: **${inr(t.netProfit)}** (ROI ${t.roi.toFixed(2)}). ${e.results.filter((r) => r.roi < 0).length} of ${e.results.length} campaigns lost money.`,
        `- The prediction model scores AUC ${e.model.aucTest.toFixed(2)} on unseen campaigns.`,
        `- The planner expects ${inr(e.recommendations.reduce((s, r) => s + (r.best?.net ?? 0), 0))} from the next ${e.recommendations.length} campaigns.`,
      ].join('\n'),
      links: [{ label: 'Overview', page: 'problem' }],
      followUps: ['Where are we wasting discount money?', 'What should we run for Beverages?'],
    };
  }

  return {
    text: 'I can answer questions about customer behaviour, consumer types, past promotion results, predictions and upcoming campaigns, using the loaded data. For example:',
    followUps: SUGGESTED.slice(0, 5),
  };
}
