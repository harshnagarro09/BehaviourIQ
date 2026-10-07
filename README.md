# BehaviourIQ – customer behaviour → promotion prediction

Five pages following the flow: historical data → behaviour → customer types → predicted response → target → simulate → compare → recommend → impact.
**Behaviour Analytics** (stages 1-5, 11) · **Customer Prediction** (5-7) · **Planning** (10) · **Simulation** (8-9) · **AI Advisor**.
brand loyalty/switching, basket, timing) predicts who responds to a promotion, and what to do about it.

```
npm install
npm run dev            # http://localhost:5173
npm run data:generate  # regenerate the demo CSV (seeded, reproducible)
npm run check:engine   # run the whole analytics pipeline in Node
```

## Data
One file: `public/data/promo_behaviour_data.csv` (one row = one product line in one order, with channel, ~520 customers,
Jul 2025 – Sep 2026, 30 past campaigns (10% Discount, 20% Discount, ₹ off on min spend, BOGO, Bundle / Combo)). The app derives everything from it. "Load CSV" in the header accepts any
file with the same columns. The data is **synthetic**: `scripts/generate-data.mjs` simulates the five consumer types;
the type labels are never shipped.

## Pipeline (`src/engine`)
1. `behaviour.ts` – per-customer profile, using only data before a given date.
2. `segments.ts` – the five Customer Types via explicit rules (the one grouping shown in the UI); `groups.ts` – an internal spend-based grouping, hidden in the UI.
   `options.ts` – the six promotion options, comparison, recommendation score and per-customer explanation.
3. `model.ts` – logistic regression: P(buy our brand in 14 days | offer depth). Asked with and without the offer, the
   difference is the uplift. Time-split validation.
4. `campaigns.ts` – real incrementality of past promotions vs each customer's own baseline, incl. post-promo dip; backtest.
5. `planner.ts` / `economics.ts` – AI agents: score scenarios, choose audience + depth, raise alerts.
6. `advisor.ts` – chatbot; answers are computed from the data (no external LLM).

## Honest caveats
- Typing accuracy vs the simulated truth is ~93%; this cannot be measured on real data without labels.
- Next-quarter campaign slots are inputs in `planner.ts` (`CANDIDATES`), not part of the CSV.
- Backtest assumes non-targeted customers behave at their baseline.

## How to read the app
- **Behaviour Analytics** answers the aim directly: past results, which behaviours predict response, and a validation panel that tests the model on held-out campaigns (is it accurate, does acting on it make money).
- **Customer Prediction**: what each customer will respond to, why, and an exportable target list.
- **Planning** and **Simulation**: recommended campaigns, and what-if scenarios with guardrails.
- Every chart has a one-line description and a "How to read" dropdown; secondary charts are collapsed by default.
