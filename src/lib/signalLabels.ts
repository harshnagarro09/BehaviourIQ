// Plain-English names for the 19 signals the model reads. Edit the wording here; the original technical
// name (from src/engine/model.ts) is used whenever a key is missing. The chart colour shows the direction.
export const SIGNAL_LABELS: Record<string, string> = {
  recency: 'How long since their last order',
  freq: 'How often they shop',
  baseline: 'How much of our brand they already buy in this category',
  qty: 'Buying more units than usual when there is a promotion',
  avgDisc: 'The average discount they have taken so far',
  depth: 'How deep the discount on offer is',
  promoRel: 'How much of their buying is on promotion',
  pastResp: 'How often they responded to earlier promotions',
  lift: 'How much their volume jumped in past promotions',
  dxPromoRel: 'Deeper discounts work better on customers who usually buy on promotion',
  dxResp: 'Deeper discounts work better on customers who responded before',
  ourShareCat: 'Share of their category buying that is our brand',
  compShare: 'Share of their purchases that go to competitors',
  dxComp: 'Deeper discounts work better on customers who buy from competitors',
  dxOur: 'Deeper discounts work better (or worse) on customers who already buy our brand',
  catShare: 'How much of their basket is in this category',
  basket: 'How many items they put in each order',
  dxQty: 'Multi-buy offers work better on customers who stock up',
  due: 'Whether they are due for a repeat order',
};

export const signalLabel = (key: string, fallback: string) => SIGNAL_LABELS[key] ?? fallback;
