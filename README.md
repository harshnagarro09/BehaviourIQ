# BehaviourIQ – customer behaviour → promotion prediction

How purchase history, promotion responsiveness, basket and timing behaviour predict which customer **segments** respond to
which promotion, and how to spend a promotion budget on them.
The story: **Behaviour Analytics** (understand customers) → **Planning** (target customer groups, manage the budget) → **Simulation** (test the plan, compare scenarios) → **Live campaigns** (finalised plans: running, scheduled, ended) · **Advisor**.

```
npm install
npm run dev            # http://localhost:5173
npm test               # invariants, KPI identities, optimiser vs brute force, backtest calibration, planning workflow
npm run data:generate  # regenerate the demo CSV (seeded, reproducible)
npm run check:engine   # run the whole analytics pipeline in Node
```

## Data
One file: `public/data/promo_behaviour_data.csv` (one row = one product line in one order; ~500 customers, Jul 2025 – Sep 2026,
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
6. `targeting.ts` – customer type × category × promotion prediction and the targeting rules.
7. `optimizer.ts` – budget optimiser: exact multiple-choice knapsack (DP) with ROI hurdle, coverage levels, holdout, efficient frontier and an activation file (the customer list).
8. `drivers.ts` / `backtest.ts` / `reliability.ts` – which behaviours predict response; accuracy on the last 8 campaigns with the clock set back; the likely range around estimates; how sensitive the customer types are to their hand-set cutoffs. `measure.ts` reads a live campaign's real result against its held-back control group.
8b. `shifts.ts` – customers whose last 3 months no longer match their type (Lost Causes / Sleeping Dogs who started buying on promotion, at 3+ orders and 2x their own earlier rate), with a chance yardstick from the 3 months before; shown as alerts and addable to a plan as Persuadables.
9. `simulation.ts`, `economics.ts`, `planner.ts`, `advisor.ts` – customer-level economics and the campaign recommendations Advisor answers from.
10. `src/lib/plan.ts` – the promotion plan shared by Planning and Simulation: one set of choices (customer groups, products, discount, budget, goal), calculated with the same prediction and optimiser everywhere.

## How to read the app
- **Behaviour Analytics** – *Promotion results*: investment, revenue, extra revenue and ROI, campaign returns and which promotion types pay back. *Customer types*: how Persuadables, Sure Things, Lost Causes and Sleeping Dogs respond, which promotion works for each, and which behaviours predict a response.
- **Planning** – *Build the plan*: (1) which customer groups to target and why (past behaviour and the model's estimate), (2) products and discount, (3) the budget, starting at the recommended level, (4) your plan next to the recommended plan, with the budget split, discount options, product table and customer-list export.
- **Planning also shows** a likely range around money estimates (sized from the model's accuracy on recent campaigns).
- **Live campaigns** – finalised plans as dated campaigns (running, scheduled, ended), scaled to their length; when the loaded data covers a campaign, its measured result against the held-back customers. The plan, scenarios and campaigns are saved in this browser (versioned and validated); export or import a backup file from this page.
- **Simulation** – your plan next to up to three what-if scenarios (other groups, products, discounts, budgets); apply a scenario back to the plan (with undo) and finalise it. Same calculation as Planning, so the numbers agree.
- Every KPI has a "?" tooltip with its plain-English definition.
