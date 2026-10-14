// How a behaviour alert is said in words: shared by Behaviour Analytics (Customer types) and Planning, so both describe it the same way.
import { METRIC_TEXT, type Alert, type RuleKey } from '@/engine/groupInsights';
import { TYPE_BY_ID } from '@/engine/segments';
import { SHIFT_RULES, type Shift } from '@/engine/shifts';
import { int, pct } from '@/lib/fmt';

const RULE_PHRASE: Record<RuleKey, (label: string) => string> = {
  spend: (l) => `are ${l.toLowerCase()}`,
  frequency: (l) => `are ${l.toLowerCase()}`,
  visit: (l) => (l === 'Shopped recently' ? 'shopped in the last 30 days' : l === 'Slowing down' ? 'last shopped 31–90 days ago' : 'have not shopped for 90+ days'),
  deals: (l) => (l === 'Mostly on deals' ? 'buy mostly on deals' : l === 'Mostly full price' ? 'buy mostly at full price' : 'buy a mix of deals and full price'),
  channel: (l) => `shop mainly ${l === 'Store' ? 'in store' : l === 'App' ? 'in the app' : 'online'}`,
  promo: (l) => `bought on ${l}`,
};

export function alertText(a: Alert) {
  const t = TYPE_BY_ID[a.type];
  const m = METRIC_TEXT[a.metric];
  const more = a.inside > a.rest;
  const ratio = more ? a.inside / a.rest : a.rest / Math.max(1e-9, a.inside);
  const what = a.metric === 'catShare' ? `${a.category}'s share of their spending` : m.name;
  const title = `${int(a.n)} ${t.name} who ${RULE_PHRASE[a.rule.key](a.rule.label)} ${a.metric === 'catShare' ? `spend ${more ? 'more' : 'less'} of their money on ${a.category}` : a.metric === 'dealShare' ? `buy on deals ${more ? 'more' : 'less'} often` : a.metric === 'spendPerMonth' ? `spend ${more ? 'more' : 'less'} each month` : `shop ${more ? 'more' : 'less'} often`}`;
  const data = `${what[0].toUpperCase() + what.slice(1)}: ${m.fmt(a.inside)} for them, against ${m.fmt(a.rest)} for the other ${int(a.of - a.n)} ${t.name} (${ratio.toFixed(1)}× ${more ? 'higher' : 'lower'}).`;
  const why = `They are ${pct(a.n / a.of)} of the group but behave clearly differently, and a gap this size is very unlikely to be chance. If you plan for ${t.name} as one group, these customers may need their own offer or message.`;
  return { title, data, why };
}

/** customers whose last 3 months differ from their type: Lost Causes / Sleeping Dogs who have started buying on promotion */
export function shiftText(s: Shift) {
  const t = TYPE_BY_ID[s.from].name;
  const n = s.ids.length;
  const title = `${int(n)} ${t} have started buying on promotion in the last 3 months`;
  const data = `Orders on promotion a month: ${s.recent.promoOrdersPerMonth.toFixed(1)} lately, against ${s.before.promoOrdersPerMonth.toFixed(1)} before. They are ${pct(n / s.of)} of ${t}.`;
  const why = `A customer type is read from the whole history, so it has not caught up with them. Each of them bought on promotion in ${SHIFT_RULES.minPromoOrders}+ separate orders lately, at least ${SHIFT_RULES.minRise}× as often as in their own earlier months. The same check on the 3 months before flagged ${int(s.chance)}, so a few of these may be chance.`;
  return { title, data, why };
}
