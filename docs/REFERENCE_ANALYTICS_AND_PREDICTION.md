# Reference: Behaviour Analytics and Customer Prediction

An in-depth reference for the two pages that carry the explanation of the project:
how customer behaviour is used to predict promotion response.

- Retailer: Reliance Fresh. **All data is simulated** (520 customers, 22,798 orders, 48,213 order lines, 30 campaigns).
- Example numbers below come from the demo app with its default settings (Behaviour Analytics: Last 6 months, all filters on "All"; Customer Prediction: Beverages). They change when you change the filters.
- This file replaces the page-by-page parts of the older `docs/CUSTOMER_PREDICTION_SCRIPT.md`, which still describes a panel and a default sort that no longer exist.

---

## 0. The idea in one paragraph

When a shop runs a promotion, most customers get the same offer. But customers are not the same. Some would have bought anyway, so the discount is wasted. Some only buy on a deal. Some switch from a competitor if the offer is strong. Some never respond.

- **Behaviour Analytics** looks **backwards**: what did past promotions earn, and how do different kinds of customers behave and respond?
- **Customer Prediction** looks **forwards**: for one customer, what is the chance they buy with and without each promotion, and is the offer worth the discount?

---

## 1. Key terms (used on both pages)

| Term | Meaning |
|---|---|
| **Customer type** | One of five groups from how a customer reacts to promotions (section 2). |
| **Response / response rate** | Share of reached customers who bought on a promotion. |
| **Uplift** | Chance of buying with the promotion minus the chance without it, in percentage points. An estimate, not a measured experiment. |
| **Discount invested / discount cost** | List price minus price paid, times quantity, added up. |
| **Net promo profit** | Margin on promoted sales, minus the margin you would have earned anyway, minus the dip in sales in the weeks after. |
| **ROI** | Net profit ÷ discount given. Above 0 the promotion earned its discount back. Below 0 it lost money. |
| **Incrementality** | How much of the promoted sales were extra, above what each customer would normally buy at full price. |
| **Leakage** | Discount given on purchases that would have happened anyway. |
| **Pull-forward (dip)** | Buying brought forward from later weeks, so sales just after a promotion are lower than normal. |
| **Prediction window** | 14 days. Chances and profits on Customer Prediction are for the 14 days after a promotion starts, not a yearly value. |

---

## 2. The five customer types

Each customer gets exactly one type from ordered rules. The first rule that matches wins:

1. Buys **1.7x or more** the usual quantity when a promotion runs → **Stock-Up**.
2. Otherwise, **55% or more** of full-price purchases are our brand → **Buys Anyways**.
3. Otherwise, responded to **under 20%** of campaigns → **Ignores**.
4. Otherwise, responded to **under 55%** → **Switcher**.
5. Otherwise → **Deal-Only**.

| Type | Plain meaning |
|---|---|
| **Buys Anyways** | Buys our brand at full price anyway. A discount only gives margin away. |
| **Deal-Only** | Buys mostly when there is a discount. |
| **Stock-Up** | Buys 2 to 4 times the usual quantity on promotion, then buys less for a few weeks. |
| **Switcher** | Normally buys a competitor and tries us when the discount is deep. |
| **Ignores** | Rarely buys our brand and barely reacts to promotions. |

The rules match the simulation's hidden truth for about 92% of customers. The customer card on Customer Prediction lists the exact reasons ("Why this type").

---

# PART A: Behaviour Analytics

Question the page answers: **what did past promotions earn, and how do customers behave and respond?**

## A1. Header and period switch

- Title, a one-line subtitle, and the data range (1 Jul 2025 to 30 Sep 2026).
- **Period switch (top right):** Last 3 months, Last 6 months (default), All time. It sets which campaigns are counted.
- With 3 or 6 months, each card also compares against the **same length of time immediately before** (the "vs prior 6 months" chips). With All time there is no comparison.

## A2. Filters

Category, Promotion type (10% Discount, 20% Discount, ₹ Off on Minimum Spend, BOGO, Bundle / Combo), Customer type, Channel. **More filters** adds Brand loyalty (mostly our brand, mixed, mostly competitors) and Frequency (Frequent 3+ orders a month, Regular 1.5 to 3, Occasional under 1.5). **Reset** clears them.

Use them to check whether a pattern holds for one group only. Everything on the page, except where noted, recalculates.

## A3. Tabs

Two tabs share the same header and filters: **Past results** and **Customer behaviour**. Each tab has its own four cards and its own one-line takeaway.

---

## A4. Tab 1: Past results

### Cards (money view)

| Card | What it is | Example (6 months) |
|---|---|---|
| **Discount invested** | Total discount given in the selected campaigns | ₹2.85L |
| **Net promo profit** | Profit after discount, baseline margin and the later dip | ₹17.2K |
| **Avg promo ROI** | Net profit ÷ discount | 0.06 |
| **Response rate** | Reached customers who bought on promotion | 40% |

Each card shows a change chip against the prior period (for example net profit up 141%). Green is good, red is bad.

### Takeaway line

"Across 15 campaigns, 4 lost money; an estimated 23% of promoted sales would have happened anyway." Built from the numbers on the page. Here 23% is the share of promoted sales that were **not** extra (100% − 77%).

### Panel: Campaign performance

- **What it shows:** every past campaign as one bubble.
  - Across (x): discount invested. Up (y): net profit. Below zero is a loss.
  - Bubble size: customers who bought.
  - Colour: **Green** ROI 0.5 or more, **Amber** ROI 0 to 0.5, **Red** loses money.
- **Why it exists:** to see which campaigns failed and how big the discount was when they did.
- **Chart/Table toggle:** the table lists Campaign, Offer, Window (dates), Response, Discount, Net profit, ROI and a verdict chip.
- **Verdict labels** (based only on ROI):
  - **Scale** (ROI 0.5 or more): earned its discount back well, run more like it.
  - **Optimise** (ROI 0 to 0.5): made a little money, margin is thin, improve it.
  - **Stop** (ROI below 0): lost money, do not repeat it as it was.
  - The 0.5 and 0 cut-offs are the app's own rule of thumb.

### Panel: Incrementality

- **Question:** of the sales made on promotion, how many did the promotion actually cause?
- **Chart:** three bars, vertical axis "Units sold".
  - **All promo sales** (navy): 9,247 units.
  - **Would sell anyway** (grey): 2,152 units. The customers' own usual full-price buying over the same days.
  - **Extra from promo** (green): 7,095 units = 9,247 − 2,152.
- **Text:** "77% of promo sales were extra. ₹26K of the ₹2.85L discount (9%) went to sales that would have happened anyway."
- **Dropdown "How the numbers come from the bars":** shows the subtraction and both divisions.
- **How 77% is made:** 7,095 ÷ 9,247.
- **How ₹26K is made** (one customer in one campaign at a time, then added up):
  1. Discount given = (list price − price paid) × quantity, over their purchases in the campaign.
  2. A = units they bought in the campaign. B = units they would normally buy over the same days.
  3. Share that would sell anyway = the smaller of A and B, divided by A.
  4. Wasted discount = their discount × that share.
  5. Add up over everyone and every campaign.
- **Why 9% and not 23%:** the 23% counts units, the 9% counts money. Customers who mostly buy anyway do not take the biggest discounts.
- **Caveat:** an estimate. There was no control group (customers deliberately given no offer). The baseline comes from each customer's own history.

### Panel: Promotion type performance

- **Question:** which kinds of offer earned their discount back?
- **One block per offer type** that ran in the period: 10% Discount, 20% Discount, ₹ Off on Minimum Spend, BOGO, Bundle / Combo.
  - Bold **ROI** (red if negative) and **response** (reached customers who bought).
  - A bar for that type's **share of all discount spent**, with "% of spend · number of campaigns".
- **Example (6 months):** 10% Discount ROI 1.75 with 25% response. 20% Discount ROI 0.37 with 44% response. BOGO ROI −0.43. BOGO and Bundle have the highest response and still lose money.
- **Message:** a high response is not the same as a good result. Judge an offer by whether it earns back its discount.
- **Caution:** each row covers only the campaigns that used that offer, possibly one or two, in different categories and periods. The prediction side corrects for this by working out the offer's effect customer by customer.

---

## A5. Tab 2: Customer behaviour

### Cards (behaviour view)

These are **different** from the Past results cards on purpose.

| Card | What it is | Example |
|---|---|---|
| **Customers in view** | Customers after the filters, and how many types they fall into | 520, 5 customer types |
| **Buying on promotion** | Average share of a customer's purchases that were on promotion. Based on each customer's whole history, so the period switch does not change it | 42% |
| **Top-earning type** | Customer type with the highest promo profit in the period | Stock-Up, ₹23.6K |
| **Biggest money-loser** | Customer type with the lowest promo profit | Ignores, −₹13.3K |

### Takeaway line

"Deal-Only Buyer and Stock-Up Buyer customers earn money from promotions; Buys Anyways, Competitor Switcher and Ignores Promotions cost money." A type needs at least 5 customers in view to be counted.

### Panel: How each customer type behaves and responds

- **Chart:** one bar per customer type, in the type's colour. Red bars are losses.
- **Dropdown (7 metrics):** Promo response, Promo ROI (default), Net promo profit, Purchases on promo, Orders per month, Order value, Our-brand share.
- **Table view:** all columns together: Customers, Orders per month, Days since order, Average spend, Order value, Items per order, On promo, Our-brand share, Promo response, Discount, Net profit, ROI.
- **Reading it:** Deal-Only and Stock-Up are above zero (promotions earn money). Ignores is far below zero (discount spent on people who barely respond).

### Panel: Response map

- **Grid:** customer types down the side, categories across the top.
- **Cell:** share of reached customers of that type who bought on a promotion in that category, within the period. Darker green is higher. "–" means no campaign.
- **Example:** Deal-Only 59% to 81% in every category. Ignores 2% to 9% everywhere.
- **Below the grid:** each type's strongest and weakest category.
- **Message:** the same promotion earns money from some types and loses it on others.

### How this tab supports the pitch

Customers fall into types, and each type responds very differently. So the right question is not "which offer?" but "which offer for whom?". Customer Prediction answers that for each customer.

---

# PART B: Customer Prediction

Question the page answers: **for this customer, which promotion will work, and is it worth the discount?**

## B1. How the prediction works (the logic behind everything on this page)

1. **Profile each customer** from their past orders only: frequency, recency, order value, basket, reliance on promotions, our-brand share at full price, response history, quantity on promotion, weekend share, channel and category mix.
2. **Train a model** on earlier campaigns. It is a logistic regression with **19 signals**, grouped into **6 themes**: Brand, Promotion, Price, Purchasing, Basket, Timing.
3. **Ask the model twice for every customer and every offer:**
   - Chance of buying with **no promotion** (P0).
   - Chance of buying **with the promotion** (P1).
   - **Uplift = P1 − P0.**
4. **Turn chances into money** for the 14-day window: extra revenue, the margin on it, the discount given, the leakage, and the pull-forward dip. This gives net profit and ROI per offer.
5. **Pick the best offer for each customer:** the offer with the highest net profit, but only if net profit is above 0 **and** uplift is at least **3 points**. If no offer qualifies, the customer gets "No discount".
6. **Test it:** the model was trained on earlier campaigns and tested on the last 8, which it had never seen (ranking score AUC 0.82; 0.5 is guessing and 1.0 is perfect). This check is in the engine but is no longer shown on the page.

All the uplift and incrementality figures are **estimates**, not causal measurements, because there is no control group in the data.

## B2. Header, tabs and filters

- **Two tabs:** **Customers** and **How customer behaviour is used for promotion prediction**.
- **Filters (Customers tab):**
  - **Category** (default Beverages). The prediction is always for one category, because offers and behaviour differ by category.
  - **Customer type**, **Channel**, **Customer ID** search.
  - Counter on the right: "488 of 488 recently active customers".
- **Who is counted:** customers who bought in the **last 90 days**. About 488 of the 520. "Today" is the day after the last order in the data file, so it does not move.

## B3. Takeaway line

A sentence for the selected customer, for example: "C0001: 4% chance of buying with no promotion, 9% with ₹10 Off on ₹100+, +5 pts (estimated), expected profit about ₹1."

## B4. Customers tab, left column

### Customers table

- One row per customer: **Customer**, **Customer type**, **Best promotion**, **Response** (chance without the offer → with it), **Profit (14d)**.
- "No discount" means no offer earns money for that customer. The response then shows only the chance without an offer, and profit shows "–".
- **Sort (default Customer ID):** Customer ID, expected profit, predicted response, uplift, longest silent.
  - Why Customer ID is the default: sorting by profit puts the same type (Stock-Up on 10% off) at the top, so the list looks like it has only one type and one discount. By ID you see the true mix.
- 12 rows at a time, **Show more** adds 12. Click a row to open that customer on the right.

### Who to contact

Four boxes and an export button, for the customers currently in view.

| Box | How it is worked out |
|---|---|
| **Customers to contact** | Customers whose best offer pays off (net profit above 0 and uplift of at least 3 points). Example: 319 of 488, 65% |
| **Extra buyers expected** | The uplift added up over those customers: buyers gained "because of the offer". Example: 51 |
| **Discount cost** | Discount given to those customers. Shown next to the cost of **20% off to everyone in view** (₹2.2K vs ₹5.5K) |
| **Net profit** | Their net profit, next to the net profit of 20% off to everyone (₹1.7K vs −₹184) |

- **Export target list (CSV)** downloads: customer ID, type, promotion, response without and with the offer, uplift in points, expected profit, discount cost and group.
- **Why the numbers look fixed:** they come from a fixed data file, a fixed "today" and a fixed rule. They change with the **Category, Customer type, Channel** filters and the ID search. They do not change with sorting, "Show more" or clicking a customer.

### Summary of the customers in view

Open by default. A dropdown with two views:

- **Best promotion mix:** how many customers each offer is best for, including "No discount". Example (Beverages): No discount 169, ₹10 off 165, 10% 147, 20% 7. This is the proof that offers differ by customer.
- **Who to contact, by group:** five groups with the average chance without and with the best offer.

| Group | Meaning | How it is decided |
|---|---|---|
| **High-probability responders** | Offer clearly works | Best offer pays off and lifts the chance by 10 points or more |
| **Small but profitable lift** | Works a little | Pays off, lift is 3 to 10 points |
| **Do not need a discount** | Would buy anyway | 35% or more chance of buying with no offer |
| **Need a stronger incentive** | Only a deep offer moves them | 50% or more chance only with an offer that costs more than it earns |
| **Not worth a discount** | Skip | Low response and no offer earns money |

"Customers to contact" = the first two groups.

## B5. Customers tab, right column (the selected customer)

### Customer card

- Name, **customer type** badge with a "?" help tip, the type's one-line description, "customer since" date and order count.
- **Behavioural features:** Orders per month, Last order, Total spend, Order value, Items per order, Top categories, On promotion, Avg discount taken, Promo response (for example 19 of 30), Our-brand share, Weekend orders, Preferred channel.
- **Why this type:** the rule evidence, for example "Buys 3.2x the usual quantity when a promotion runs. Category buying drops to 28% of normal after a promo."
- This is the **input**: the model reads these behaviours and nothing else.

### What will C0241 respond to? (the main chart)

- **Chart view:**
  - Left: **predicted chance of buying** for None and each promotion (grey = no promotion, green = best, navy = others).
  - Right: **expected profit over 14 days** per promotion. Red means the discount costs more than it earns.
- **Table view** (click a row to explain that promotion below): Promotion, Predicted response, Uplift, Revenue, Margin, Cost, Net profit, ROI. ROI here is net profit ÷ discount cost.
- **Sentence below:** "Recommended: 10% Discount. It lifts the chance of buying from 33% to 47% and earns about ₹65 after the discount given and any stock borrowed from future purchases." Or "Recommended: no discount", with the reason (already likely to buy, or nothing earns more than it costs).
- **Worked example C0241 (Stock-Up, Beverages):** no promotion 33%. 10% off 47% (+14 points, ₹65). 20% off 61% (₹47). BOGO 86% (highest response, but −₹106). Best choice: 10% off, because **the best offer is the one that earns the most, not the one with the highest response.**

### Why the model predicts this (collapsed)

- **Scope:** one customer and one promotion (the recommended one, or the row you clicked in the table view).
- **Bars:** one per behaviour factor (nine): previous promotion response, price sensitivity, purchase frequency, product affinity, basket behaviour, recency, timing preference, brand habit (competitor use), existing buying of our brand.
  - Green to the right: raises this customer's chance compared with an average customer.
  - Orange to the left: holds it back.
  - Longer bar: stronger effect. The number (for example +0.35) is a score, not a percentage.
- **How a bar is made:** for each signal, how far the customer is above or below the average customer, multiplied by the weight the model learned. Signals are added within each factor.
- **Sentences under the bars:** the top one or two green factors and the strongest orange factor, in the customer's own numbers. Shown only when the effect is bigger than 0.05 either way.
- **Why it matters:** it shows the prediction is explainable, not a black box.

## B6. Tab 2: How customer behaviour is used for promotion prediction

One panel: **Which behaviours predict promotion response**.

- **Behaviour themes (6) view:** each theme's share of the model's weight. Brand 42%, Promotion 30%, Price 10%, Purchasing 10%, Basket 7%, Timing 1%.
  - Brand: loyalty versus competitors. Promotion: past response. Price: discount taken. Purchasing: frequency, recency, quantity. Basket: items, category mix. Timing: purchase rhythm.
- **Individual signals (19) view:** each signal's weight. Green raises the chance of responding, orange lowers it.
- A line above the chart names the top three signals, for example "Share of their purchases that go to competitors (18%); deeper discounts work better on customers who buy from competitors (15%); deeper discounts work better on customers who responded before (13%)."

### This tab versus "Why the model predicts this"

| | This tab | Why the model predicts this |
|---|---|---|
| Scope | The whole model, all customers | One customer, one promotion |
| Question | Which behaviours matter most? | Why did this customer get this chance? |
| Bars show | The weight the model gives each behaviour | How far each behaviour pushed this customer up or down |
| Changes when you click another customer | No | Yes |
| Labels | 6 themes, 19 signals | 9 factors |
| Numbers | Shares that add to 100% | Effect scores, positive or negative |

Short version: the tab is the rulebook, and the card is one customer's score under those rules. A behaviour can matter a lot in the tab and show a tiny bar for a customer who is exactly average on it.

---

## C. How the two pages fit the story

1. **Behaviour Analytics, Past results:** promotions cost money and some lose it. About one in four promoted sales would have happened anyway. A high response is not a good result.
2. **Behaviour Analytics, Customer behaviour:** customers fall into five types that respond very differently, so the same offer earns from some and loses on others.
3. **Customer Prediction, one customer:** behaviour in, predicted response out. The best offer is chosen by profit, not response.
4. **Customer Prediction, Who to contact:** contact only customers where an offer pays: less discount, more profit than 20% off to everyone.
5. **Customer Prediction, how behaviour is used:** the behaviours that drive the prediction, and why any single prediction is explainable.

## D. Limits to say out loud

- The data is **simulated**. It shows the method works, not that it works on real customers.
- Uplift and incrementality are **estimates**. No control group exists.
- Chances and profit cover **14 days**, not a year.
- The model is a simple, explainable regression.
- Rules such as the 3-point minimum lift, the 90-day active window and the type thresholds are the app's own settings and can be reviewed with the business.
- Next step: load real data with the same columns and pilot on one or two campaigns with a held-out control group.
