# BehaviourIQ – customer behaviour → promotion prediction

How purchase history, promotion responsiveness, basket and timing behaviour predict which customer **segments** respond to
which promotion, and how to spend a promotion budget on them.
**Behaviour Analytics** · **Customer Prediction** · **Planning** · **Simulation** · **Advisor**.

```
npm install
npm run dev            # http://localhost:5173
npm test               # invariants, KPI identities, optimiser vs brute force, backtest calibration
npm run data:generate  # regenerate the demo CSV (seeded, reproducible)
npm run check:engine   # run the whole analytics pipeline in Node
```

## Data
One file: `public/data/promo_behaviour_data.csv` (one row = one product line in one order; ~520 customers, Jul 2025 – Sep 2026,
39 past campaigns). Mechanics in the history: 10/15/20/25% off, ₹ off on a minimum spend, Buy 1 Get 1 Free, Buy 1 Get 1 at 50%,
Buy 3 Pay for 2, Buy 2+ Save 15%, Combo Pack, and 10% cashback in loyalty points (`reward_value` column; shelf price unchanged).
**The file holds only the retailer's own brand**: a retailer cannot see what customers buy elsewhere.
"Load CSV" accepts any file with the same columns (`reward_value` is optional). The data is **synthetic**.

## KPI methodology
Measured on the reached audience (ordered in the 90 days before a campaign), against each customer's own pre-campaign baseline:
- **Promo investment** = till discount × units + loyalty points × 70% redemption (actual)
- **Promo revenue** = price paid × units on promoted lines (actual)
- **Incremental revenue** = window revenue − baseline units × list price (estimate)
- **Promo ROI** = incremental margin ÷ promo investment, where incremental margin = window margin after discount and points − baseline margin. 0 = break-even.
- Redemption rate, subsidy rate, uplift share, break-even coverage, cost per incremental unit, pull-forward (diagnostic, not deducted).

**Net promo profit is not reported**: it needs overheads, supplier funding, cannibalisation and a measured dip that the data does not hold.

## Pipeline (`src/engine`)
No machine learning: nothing is trained or fitted. Every rule is stated in the code comments.
1. `behaviour.ts` – per-customer profile, point-in-time (only orders before the reference date).
2. `segments.ts` – the four customer types (Persuadables, Sure Things, Lost Causes, Sleeping Dogs) by explicit behaviour rules: the unit of every targeting decision.
3. `campaigns.ts` – what past campaigns delivered, with the KPI methodology above.
4. `response.ts` – incremental responsiveness: past offers' conversion **above** what each customer would have bought anyway.
5. `promotions.ts` – twelve-mechanic catalogue with economics and guardrails (margin floor, partner funding, digital-only reach, untested-mechanic haircut).
6. `targeting.ts` – customer type × category × promotion prediction, recommendation and reason codes.
7. `optimizer.ts` – budget optimiser: exact multiple-choice knapsack (DP) with ROI hurdle, coverage levels, holdout, efficient frontier, measurement plan (minimum detectable uplift) and an activation file.
8. `drivers.ts` / `backtest.ts` – which behaviours predict response; prediction accuracy on the last 8 campaigns with the clock set back.
9. `simulation.ts`, `economics.ts`, `planner.ts`, `advisor.ts` – the rules behind Planning, Simulation and Advisor.

## How to read the app
- **Behaviour Analytics** – *Promotion results*: investment, revenue, extra revenue and ROI, campaign returns and which promotion types pay back. *Customer types*: how Persuadables, Sure Things, Lost Causes and Sleeping Dogs respond, which promotion works for each, and which behaviours predict a response.
- **Customer Prediction** – *Who to target*: the best offer per customer type for a category, with reasons. *Budget planner*: the best spend across types, categories and offers for a budget, with a control group and a customer-list export. *Prediction accuracy*: backtest on past campaigns.
- **Planning** and **Simulation**: recommended campaigns and what-if scenarios, built on the same customer-type prediction as Customer Prediction (uplift, ROI, margin guardrails). A customer type is targeted only if the offer lifts its purchase probability by 15+ points and pays back.
- Every KPI has a "?" tooltip with its plain-English definition.
