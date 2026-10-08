# Customer Prediction page: a short guide and script

This page answers one question: **"For this customer, which promotion will work, and is it worth the discount?"**
Everything runs on the simulated Reliance Fresh data. All chances and profits cover the **next 14 days**.

---

## 1. Why "Who to contact" looks fixed (read this first)

The numbers on the "Who to contact" card (for example 319 of 488 customers) do not move when you click around. That is by design. Here is what changes them and what does not.

**What the number is based on**
1. **Who is counted.** Only customers who bought in the last 90 days ("recently active"). That is about 488 customers, not all 520.
2. **"Today".** The app treats today as the day after the last order in the data file. The data file is fixed, so "today" never moves.
3. **The prediction.** For each customer the model works out the chance of buying with no offer and with each offer (10% off, 20% off, ₹-off, BOGO, Bundle). It then keeps the offer with the highest profit.
4. **The rule.** A customer goes on the list only if their best offer **earns more than it costs** (net profit above 0) **and** lifts the chance of buying by **at least 3 points**.

So the same data, the same date and the same rule always give the same answer. It is a calculation, not a stored number.

**What changes it (try these live)**
| Control | Effect on the card |
|---|---|
| **Category** filter (Beverages, Dairy, ...) | Big change. Each category has its own offers and its own buying behaviour. |
| **Customer type** filter | The card recounts for that type only. |
| **Channel** filter or **Customer ID** search | The card recounts for the customers left in view. |

**What does not change it**
- Sorting the table, "Show more", or clicking a customer. These only change how the list is shown.
- The "Customers to contact" count is the same whatever you sort by.

**When it would change in real life:** when new orders are loaded (new CSV), the model and the 90-day window update, and the card changes with them.

**One-line answer for your manager:** "The count is fixed because it is calculated from a fixed data file with a fixed rule. It changes when we change the category, the customer group, or the data."

---

## 2. The page, part by part

### Top bar: Filters
- **Category, Customer type, Channel, Customer ID.** They decide which customers are in view.
- Right side shows "X of 488 recently active customers".

> Script: "I choose one category first, because a promotion is always for a product group. Then I can narrow to a customer type or channel."

### Tab 1: Customers

**A. One-line takeaway (top)**
A plain sentence for the selected customer, for example: without any offer this customer has a 33% chance of buying; with 10% off it is 47%.

**B. Customers table (left)**
- One row per customer: type, best promotion, response (chance without the offer → with it), profit over 14 days.
- "No discount" means no offer earns money for this customer.
- Click a row to open that customer on the right. Sort by profit, response, uplift or silence.

> Script: "Every customer gets their own best offer. Some get 10% off, some get nothing, because nothing pays off for them."

**C. Who to contact (left, under the table)** *(see section 1)*
Four boxes:
- **Customers to contact.** How many customers have an offer that pays off.
- **Extra buyers expected.** Added up uplift: buyers we would not have got without the offer.
- **Discount cost.** What we give away to this group, next to the cost of giving 20% off to everyone.
- **Net profit.** Profit for this group, next to the profit of 20% off to everyone.
- **Export target list (CSV)** downloads the list for the campaign team.

> Script: "Instead of 20% off to everyone, we contact only these customers. Less discount given away, and more profit."

**D. Summary of the customers in view (collapsed)**
A dropdown of four roll-ups: best promotion mix, profit by customer type, response lift by customer type, and who to contact by group (the five groups in section 3).

**E. Customer card (right, top)**
The behaviour of the selected customer: orders per month, last order, spend, promo reliance, brand share, channel and others. "Why this type" lists the rules that gave the customer type.

> Script: "This is the evidence. The model reads these behaviours, nothing else."

**F. "What will C0241 respond to?" (right, middle)**
- **Chart view:** left chart is the chance of buying for each promotion (grey = no promotion, green = best). Right chart is the expected profit (red = loses money).
- **Table view:** adds uplift, revenue, margin, discount cost, net profit and ROI.
- The sentence below says which promotion is recommended and why.

> Script: "BOGO gives this customer the highest chance, 86%, but loses ₹106. So the best offer is the one that earns the most, not the one with the highest response."

**G. Why the model predicts this (collapsed)**
Bars show which behaviours push the chance up (green) or hold it back (orange). Two or three sentences put it in the customer's own numbers.

**H. Past promotions (collapsed)**
One chip per past campaign: green = bought, grey = did not buy, pale = not active then.

### Tab 2: How the model predicts, and does it work
Three panels, explained in the main manager script (section 7):
1. Which behaviours predict promotion response.
2. Who responds to what.
3. Is the prediction accurate, and does acting on it make money? (ranking score 0.82 on 8 unseen campaigns; targeting by behaviour ROI 1.18 vs 0.08 for everyone).

---

## 3. The five groups (used in "Who to contact, by group")

| Group | Plain meaning | How it is decided |
|---|---|---|
| **High-probability responders** | Offer clearly works | Best offer pays off and lifts the chance by 10+ points |
| **Small but profitable lift** | Works a little | Pays off, lift is 3 to 10 points |
| **Do not need a discount** | Would buy anyway | 35%+ chance of buying with no offer |
| **Need a stronger incentive** | Only a deep offer moves them | 50%+ chance only with an offer that costs more than it earns |
| **Not worth a discount** | Skip | Low response and no offer earns money |

"Customers to contact" = the first two groups.

---

## 4. A 3-minute spoken script

"This page works one customer at a time.

First I pick a category, say Beverages. The page looks at customers who bought in the last 90 days, about 488 people.

For each one the model asks two questions: what is the chance this customer buys with no offer, and what is the chance with each offer. The difference is the lift from the offer.

Then it checks the money. Revenue from the extra purchase, minus the discount we give, minus the purchases we pulled forward. If the offer earns more than it costs, and lifts the chance by at least three points, the customer goes on the contact list.

Look at customer C0241. With no offer, 33% chance to buy. With 10% off, 47%, and about ₹65 profit. With BOGO, 86%, but it loses ₹106. So we pick 10% off, not BOGO.

The Who to contact card adds this up for everyone in view. We contact about 319 of 488 customers. Compare that with 20% off to everyone: this costs less discount and earns more profit.

You may notice the 319 does not change when I sort or click. That is because it comes from a fixed data file and a fixed rule. It changes when I change the category, the customer type, or when new data is loaded.

The 'Why the model predicts this' panel shows the behaviours behind each prediction, so the answer is explainable, not a black box.

All numbers here come from simulated data, and the lift is an estimate, because we have no control group. The next step is a pilot on real data."

---

## 5. Likely questions

- **Why is the number fixed?** See section 1. Fixed data, fixed date, fixed rule.
- **Why not contact everyone?** Many customers either buy anyway or lose us money with a discount. 20% off to everyone earns far less.
- **Why does BOGO get high response but is not chosen?** It costs too much per sale. The page picks by profit.
- **Why 3 points and 90 days?** These are the app's settings (minimum lift 0.03, active in last 90 days). They are choices the business can review.
- **Is the lift exact?** No. It is an estimate from behaviour, not a measured result.
