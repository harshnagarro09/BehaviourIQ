// The chatbot's brain. Every number in an answer is read from the loaded CSV via the engine;
// questions are routed by intent (keywords + entities such as customer ids, categories, consumer types, budgets).
// No external service is called.
import type { TypeId } from './behaviour.ts';
import type { Engine } from './index.ts';
import { TYPES, TYPE_BY_ID } from './segments.ts';
import { SIM_WINDOW_DAYS } from './simulation.ts';
import type { Scenario } from './planner.ts';

export interface Answer {
  text: string; // **bold** and "- " bullets
  table?: { head: string[]; rows: string[][] };
  links?: { label: string; page: string; params?: Record<string, string> }[];
  followUps?: string[];
}

export const SUGGESTED = [
  'Give me a summary of how we are doing',
  'Which customers are Sure Things?',
  'Where are we wasting discount money?',
  'Best offer for ₹10K discount budget',
  'What should we run for Beverages?',
  'Who are the Sleeping Dogs?',
  'How does the simulation work?',
  'Which behaviours drive the simulated response?',
  'What do customers buy together?',
];

const inr = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e5 ? `${(a / 1e5).toFixed(2)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${Math.round(a)}`;
  return `${v < 0 ? '-' : ''}₹${s}`;
};
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

const TYPE_WORDS: [TypeId, RegExp][] = [
  ['sure', /sure thing|anyway|any way|regardless|even without|full price|loyal/],
  ['persuadable', /persuad|only when disc|only on promo|bargain|waits? for|stock|bulk/],
  ['lost', /lost cause|ignor|unresponsive|never respond|not respond/],
  ['dog', /sleeping dog|do not disturb|put off|pulled away|dog/],
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
    const offers = e.recommendations.filter((x) => x.best && x.best.audience.byType[r.type].targeted > 0).sort((a, b) => b.best!.incMargin - a.best!.incMargin);
    const lines = [
      `**${cid}** is one of the **${TYPE_BY_ID[r.type].name}** (rule fit ${pct(r.confidence)}).`,
      ...r.reasons.map((s) => `- ${s}`),
      `They order about ${r.b.ordersPerMonth.toFixed(1)} times a month, spent ${inr(r.b.totalSpend)} in total and last ordered ${r.b.recencyDays} days ago.`,
      offers.length
        ? `**Best offer for this customer type:** ${offers[0].best!.option.label} on ${offers[0].candidate.category}. Offers are decided per customer type, and ${TYPE_BY_ID[r.type].name} show a positive uplift here (expected ROI ${offers[0].best!.roi.toFixed(2)}).`
        : `**No discount recommended.** Offers are decided per customer type, and no offer clears the uplift and ROI bar for ${TYPE_BY_ID[r.type].name}. ${TYPE_BY_ID[r.type].play}`,
    ];
    return { text: lines.join('\n'), links: [{ label: 'Customer types', page: 'analytics' }] };
  }

  // ------------------------------------------------ best offer for a budget / category
  if (/(best|top).*(offer|promo|campaign)|what should (we|i) run|recommend|next campaign|which campaign|plan/.test(q) || findBudget(q)) {
    const budget = findBudget(q);
    const recs = e.recommendations.filter((r) => !cat || r.candidate.category.toLowerCase() === cat.toLowerCase());
    let cands: { name: string; s: Scenario; cat: string }[] = [];
    for (const r of recs) for (const s of r.scenarios) if (s.incMargin > 0) cands.push({ name: r.candidate.category, s, cat: r.candidate.category });
    if (budget) cands = cands.filter((c) => c.s.discountCost <= budget);
    cands.sort((a, b) => b.s.incMargin - a.s.incMargin);
    if (!cands.length) return { text: `No offer has a positive extra profit${budget ? ` within a ${inr(budget)} promotion budget` : ''}${cat ? ` in ${cat}` : ''}. A non-price trigger such as sampling or loyalty points is a safer choice.` };
    const top = cands[0];
    const alt = cands.filter((c) => c !== top).slice(0, 3);
    return {
      text: [
        `**${top.s.option.label}** on **${top.cat}** is the best fit${budget ? ` for ${inr(budget)}` : ''}.`,
        `- Target ${top.s.audience.targeted} of ${top.s.audience.total} active customers (the customer types with a positive uplift), skipping those who would buy anyway`,
        `- Promotion cost ${inr(top.s.discountCost)}, extra profit **${inr(top.s.incMargin)}**, ROI ${top.s.roi.toFixed(2)}`,
        `- About ${Math.round(top.s.incrementalBuyers)} extra buyers because of the offer`,
        top.s.blanket.incMargin < top.s.incMargin ? `- Sending the same offer to everyone would return ${inr(top.s.blanket.incMargin)} (ROI ${top.s.blanket.roi.toFixed(2)}), so targeting adds ${inr(top.s.incMargin - top.s.blanket.incMargin)}` : `- Sending to everyone returns ${inr(top.s.blanket.incMargin)}, similar to targeting`,
      ].join('\n'),
      table: alt.length ? { head: ['Category', 'Offer', 'Promotion cost', 'Extra profit'], rows: alt.map((a) => [a.name, a.s.option.label, inr(a.s.discountCost), inr(a.s.incMargin)]) } : undefined,
      links: [{ label: 'Open Planning', page: 'plan' }, { label: 'Open Simulation', page: 'simulator' }],
      followUps: ['Where are we wasting discount money?', 'Who should we target?'],
    };
  }

  // ------------------------------------------------ waste / leakage
  if (/wast|leak|losing|loss|lose|cannibal|giving away|subsid|anyway.*discount/.test(q) && !/accura|profitable|make money|worth|loss.?making|profit.?making|reliable/.test(q)) {
    const worst = [...e.results].sort((a, b) => a.roi - b.roi).slice(0, 3);
    const anyw = e.stats.find((s) => s.type === 'sure')!;
    const ign = e.stats.find((s) => s.type === 'dog')!;
    return {
      text: [
        `Across ${e.results.length} past campaigns, **${inr(t.leakage)}** (${pct(t.leakagePct)} of ${inr(t.discountCost)} discount) was subsidy on baseline purchases that would have happened anyway.`,
        `Measured against each customer's own baseline, promotions returned **${inr(t.incMargin)}** of incremental margin (ROI ${t.roi.toFixed(2)}).`,
        `- Sure Things: ROI ${anyw.roi.toFixed(2)} (${anyw.n} customers)`,
        `- Sleeping Dogs: ROI ${ign.roi.toFixed(2)} (${ign.n} customers)`,
      ].join('\n'),
      table: { head: ['Weakest campaigns', 'Offer', 'ROI', 'Subsidy rate'], rows: worst.map((r) => [r.campaign.name, `${r.campaign.depth}%`, r.roi.toFixed(2), pct(r.leakagePct)]) },
      links: [{ label: 'Promotion results', page: 'lab' }, { label: 'Open Planning', page: 'plan' }],
      followUps: ['Which customers are Sure Things?', 'Best offer for ₹10K discount budget'],
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
        `- ${pct(s.respRate)} redemption of past promotions, ${pct(s.promoReliance)} of purchases on promo`,
        `- Past promotions: incremental margin **${inr(s.incMargin)}** (ROI ${s.roi.toFixed(2)})`,
        `**What to do:** ${meta.play}`,
        `Examples: ${sample.join(', ')}`,
      ].join('\n'),
      links: [{ label: 'See this customer type', page: 'analytics' }],
      followUps: ['Where are we wasting discount money?', 'What should we run for Beverages?'],
    };
  }
  if (/type|segment|kinds? of (customer|consumer)|who are our (customers|consumers)/.test(q)) {
    return {
      text: 'Customers fall into four types, assigned by fixed rules from what they actually buy:',
      table: { head: ['Type', 'Customers', 'Promo ROI'], rows: e.stats.map((s) => [TYPE_BY_ID[s.type].name, `${s.n} (${pct(s.share)})`, s.roi.toFixed(2)]) },
      links: [{ label: 'Open Consumer Types', page: 'types' }],
    };
  }

  // ------------------------------------------------ how the simulation works
  if (/accura|model|predict|simulat|how does it work|trust|assumption|behaviours? (that )?(predict|matter|drive)|reliable/.test(q)) {
    return {
      text: [
        `There is **no trained model**. Each customer's response is simulated with fixed business rules from their own purchase history over a ${SIM_WINDOW_DAYS}-day window, then summed per customer type:`,
        '- **Baseline**: chance of buying with no offer, from purchase frequency, existing buying of our brand, recency and timing',
        '- **Responsiveness**: how much past offers converted above what each customer would have bought anyway, scaled by depth, product affinity, mechanic fit and recent activity',
        '- **Uplift**: purchase probability with the offer minus baseline. ROI is incremental margin divided by promo investment; customers whose volume falls during promotions are Sleeping Dogs',
        'Results are **simulated** for a business demonstration, not forecasts from a model. The data itself is demo data.',
      ].join('\n'),
      links: [{ label: 'Open Simulation', page: 'simulation' }],
      followUps: ['Where are we wasting discount money?', 'What should we run for Beverages?'],
    };
  }

  // ------------------------------------------------ campaigns performance
  if (/best campaign|worst campaign|performed|past campaign|roi|which promotion/.test(q)) {
    const sorted = [...e.results].sort((a, b) => b.roi - a.roi);
    const show = [...sorted.slice(0, 3), ...sorted.slice(-2)];
    return {
      text: `Best: **${sorted[0].campaign.name}** (ROI ${sorted[0].roi.toFixed(2)}). Worst: **${sorted[sorted.length - 1].campaign.name}** (ROI ${sorted[sorted.length - 1].roi.toFixed(2)}). ${e.results.filter((r) => r.roi < 0).length} of ${e.results.length} did not pay back.`,
      table: { head: ['Campaign', 'Offer', 'Incremental margin', 'ROI'], rows: show.map((r) => [r.campaign.name, `${r.campaign.depth}% ${r.campaign.mechanic === 'BOGO' ? 'BOGO' : ''}`.trim(), inr(r.incMargin), r.roi.toFixed(2)]) },
      links: [{ label: 'Promotion results', page: 'lab' }],
    };
  }

  // ------------------------------------------------ basket
  if (/together|basket|bundle|pair|cross.?sell|combo/.test(q)) {
    const p = e.basket.pairs.slice(0, 3);
    return {
      text: `${p[0].a} and ${p[0].b} are bought together **${p[0].lift.toFixed(2)}x** more often than chance. Good bundle candidates:`,
      table: { head: ['Pair', 'Orders', 'Lift'], rows: p.map((x) => [`${x.a} + ${x.b}`, pct(x.support, 1), x.lift.toFixed(2)]) },
      links: [{ label: 'Behaviour Analytics', page: 'lab' }],
    };
  }

  // ------------------------------------------------ timing
  if (/when|weekend|weekday|season|month|day of|timing|festiv|diwali/.test(q)) {
    const d = e.timing.dow;
    const tot = d.reduce((s, v) => s + v, 0);
    const peaks = e.timing.seasonality.map((s) => `${s.category}: ${e.timing.months[s.index.indexOf(Math.max(...s.index.slice(1, -1)))]?.label}`);
    return {
      text: [`Weekends carry **${pct((d[0] + d[6]) / tot)}** of orders (Sat+Sun).`, `Peak months by category: ${peaks.join(' · ')}.`, 'Avoid deep discounts in a category\'s natural peak month; the sales were coming anyway.'].join('\n'),
      links: [{ label: 'Behaviour Analytics', page: 'lab' }],
    };
  }

  // ------------------------------------------------ price
  if (/depth|how much (discount|off)|sensitiv|price|willing|threshold/.test(q)) {
    const dl = e.stats.find((s) => s.type === 'persuadable')!;
    return {
      text: [`Persuadables take about **${dl.avgDisc.toFixed(0)}%** off on average.`, `Across the categories the best offers are: ${[...new Set(e.recommendations.filter((r) => r.best).map((r) => r.best!.option.label))].join(', ')}. Deeper offers mostly add subsidy and pull-forward.`].join('\n'),
      links: [{ label: 'Promotion results', page: 'lab' }, { label: 'Open Simulation', page: 'simulator' }],
    };
  }

  // ------------------------------------------------ target audience
  if (/target|audience|who should/.test(q)) {
    const r = (cat ? e.recommendations.find((x) => x.candidate.category === cat) : e.recommendations[0])!;
    const b = r.best;
    if (!b) return { text: `No customers are worth discounting in ${r.candidate.category}.` };
    return {
      text: `For **${r.candidate.category}** (${b.option.label}), target ${b.audience.targeted} of ${b.audience.total} active customers:`,
      table: { head: ['Type', 'Targeted', 'Of'], rows: TYPES.map((x) => [x.short, String(b.audience.byType[x.id].targeted), String(b.audience.byType[x.id].total)]) },
      links: [{ label: 'Open Planning', page: 'plan' }],
    };
  }

  // ------------------------------------------------ overview / default help
  if (/summar|overview|how are we|kpi|status|headline/.test(q) || q.length < 3) {
    return {
      text: [
        `**${t.customers} customers**, ${t.orders.toLocaleString()} orders, ${inr(t.revenue)} revenue over 15 months.`,
        `- Promotion cost was ${inr(t.discountCost)}. Only ${pct(t.incShare)} of promoted units are estimated to be incremental (estimated from each customer's own baseline, not a randomised test).`,
        `- Promotion ROI **${t.roi.toFixed(2)}** (extra profit ${inr(t.incMargin)}). ${e.results.filter((r) => r.roi < 0).length} of ${e.results.length} campaigns did not pay back.`,
        `- The best offer in each of the ${e.recommendations.length} categories is expected to add ${inr(e.recommendations.reduce((s, r) => s + (r.best?.incMargin ?? 0), 0))} of extra profit (Planning builds the full plan).`,
      ].join('\n'),
      links: [{ label: 'Behaviour Analytics', page: 'lab' }],
      followUps: ['Where are we wasting discount money?', 'What should we run for Beverages?'],
    };
  }

  // nothing matched: say so plainly, and offer the suggested questions closest to what was typed (shared words)
  const words = new Set(q.split(/[^a-z0-9₹]+/).filter((w) => w.length > 3));
  const near = SUGGESTED.map((s) => ({ s, hits: s.toLowerCase().split(/[^a-z0-9₹]+/).filter((w) => words.has(w)).length })).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 3).map((x) => x.s);
  return {
    text: `I did not recognise that question, and I would rather not guess. I answer from fixed rules over the loaded data, so I can help with customer types, one customer (type an ID such as C0042), past promotion results, the best offer for a category or budget, discount waste and who to target.${near.length ? ' Closest to what you asked:' : ' For example:'}`,
    followUps: near.length ? near : SUGGESTED.slice(0, 5),
  };
}
