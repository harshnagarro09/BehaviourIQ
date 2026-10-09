# BehaviourIQ – customer behaviour → promotion prediction

Five pages following the flow: historical data → behaviour → customer types → simulated response → target → simulate → compare → recommend → impact.
**Behaviour Analytics** (stages 1-5, 11) · **Customer Prediction** (5-7) · **Planning** (10) · **Simulation** (8-9) · **AI Advisor**.
basket, timing) predicts who responds to a promotion, and what to do about it.

```
npm install
npm run dev            # http://localhost:5173
npm run data:generate  # regenerate the demo CSV (seeded, reproducible)
npm run check:engine   # run the whole analytics pipeline in Node
```

## Data
One file: `public/data/promo_behaviour_data.csv` (one row = one product line in one order, with channel, ~520 customers,
Jul 2025 – Sep 2026, 30 past campaigns: 10% Discount, 20% Discount, ₹ off on min spend, BOGO, Bundle / Combo). The app derives everything from it.
**The file holds only the retailer's own brand.** There is no competitor data: a retailer cannot see what customers buy elsewhere. Rows of any other brand in an uploaded file are ignored.
"Load CSV" in the header accepts any file with the same columns. The data is **synthetic**: `scripts/generate-data.mjs` simulates the four customer types (Persuadables, Sure Things, Lost Causes, Sleeping Dogs); the labels are never shipped.

## Pipeline (`src/engine`)
No machine learning: nothing is trained or fitted. The data is designed demo data and the response is simulated with fixed rules.
1. `behaviour.ts` - per-customer profile: previous promotion response, brand habit, frequency, product affinity, price sensitivity, recency, existing buying of our brand, timing, basket.
2. `segments.ts` - four customer types by explicit rules: Persuadables, Sure Things, Lost Causes, Sleeping Dogs (Do Not Disturb).
3. `simulation.ts` / `economics.ts` - rule-based chance of buying with and without an offer (baseline and uplift) and the profit that follows.
4. `campaigns.ts` - what past campaigns actually delivered (baseline vs uplift), measured from orders.
5. `planner.ts` / `advisor.ts` - recommendations and Q&A by fixed rules.

## Data design
`npm run data:generate` rebuilds the demo CSV. Own-label margins are set by category, and BOGO (50% off every unit) only runs in high-margin categories, so it has the best response and still earns a profit.

## How to read the app
- **Behaviour Analytics** answers the aim directly: past results, how each customer type responds, and whether acting on it pays (baseline vs uplift, ROI by promotion type).
- **Customer Prediction**: what each customer will respond to, why, and an exportable target list.
- **Planning** and **Simulation**: recommended campaigns, and what-if scenarios with guardrails.
- Every chart has a one-line description and a "How to read" dropdown; secondary charts are collapsed by default.
