# BehaviourIQ: Script to Explain the Project to My Manager

*Topic: how customer behaviour can be used for promotion prediction.*

How to use this file: the text in quotes is what to say. The bullets under each part are notes for you. All numbers come from the demo app and its simulated data. Say early that the data is simulated.

Time needed: about 10 to 12 minutes.

---

## 1. Opening (1 minute)

"Thank you for your time. I want to show you what I built for my research topic: how customer behaviour can be used for promotion prediction.

The idea is simple. When a shop runs a promotion, most customers get the same offer. But customers are not the same. Some would buy anyway, so the discount is wasted. Some only buy when there is a deal. Some switch from a competitor if the offer is strong. Some never respond.

So my question was: if we look at how each customer behaved in the past, can we guess who will respond to a promotion, to which offer, and whether it is worth the money?

I built a web app to test this. One important point: the data in the app is simulated. It is not Reliance Fresh data. So it shows the method works. It does not prove the numbers for our real customers."

---

## 2. The problem (1 minute)

"First, the problem. In my data there are 30 past promotions. Nine of them lost money. If we add all 30, the net result is about minus 22,500 rupees. In the last six months we gave about 2.85 lakh rupees of discount and kept only about 17,200 rupees of profit. The return was 0.06. That means promotions barely pay back.

The reason is that we treat all customers the same."

---

## 3. Customer behaviour in simple words (1.5 minutes)

"In the data I found five types of customers. The app puts each customer in one type using simple rules on their own purchase history.

- **Buys Anyways.** Buys our brand at full price anyway. A discount just gives margin away.
- **Deal-Only.** Buys mostly when there is a discount.
- **Stock-Up.** Buys 2 to 4 times the usual quantity on promotion, then buys less for a few weeks.
- **Switcher.** Normally buys a competitor, and tries us when the discount is deep.
- **Ignores.** Rarely buys our brand and barely reacts to promotions.

These are not labels in the data. The app works them out from behaviour."

Notes:
- Counts in the demo data: Buys Anyways 117, Deal-Only 106, Stock-Up 79, Switcher 109, Ignores 109 (520 customers).
- There is no separate type for "buys only during big sale events". Deal-Only is the closest.

---

## 4. The idea in one line (1 minute)

"Here is the whole idea:

Customer behaviour, then customer patterns, then promotion response, then a predicted response, then the right customers, then the right offer.

There are two steps here. **Behaviour analysis** looks backwards: what did customers do? **Promotion prediction** looks forwards: for this customer and this offer, what is the chance they will buy?

The first one gives the signals. The second one uses them."

---

## 5. The behaviour signals (1 minute)

"For every customer the app measures these signals from past orders:

- How often they shop, and how long since their last order.
- How much they spend and the size of their basket.
- How many past promotions they answered, for example 19 out of 30.
- How much of their buying is on promotion, and the average discount they took.
- How loyal they are to our brand compared with competitors.
- How much more they buy when there is a promotion.

The model uses most of these. Spend and channel are shown in the app but the model does not use them.

The strongest signals are brand habits and past promotion response. Together they are about 72% of the model's weight."

---

## 6. Show the app (6 to 7 minutes)

"Now I will show how I turned this into a working app. It has five pages in the order of the story."

### Page 1: Behaviour Analytics (2 minutes)

"This page looks at the past. The question is: did our promotions pay, and which customers explain the result?

**At the top there is a period switch** (3 months, 6 months, all time) and **filters**: category, promotion type, customer type, channel, and under 'More filters' brand loyalty and how often they shop. They let me check if a pattern holds for one group only. The page changes when I change them.

**The six cards** are: discount invested, net promo profit, average ROI, response rate, prediction quality and profit from acting on it. ROI means profit divided by discount. Above zero means the promotion earned its money back. The last two cards come from the model test, which I explain later.

**Tab: Past results.**
- *Campaign performance.* Each bubble is one campaign. Left to right is discount spent. Up is profit. Red means it lost money. I added it to see which campaigns failed. Four of the 15 campaigns in the last six months lost money.
- *Incrementality.* It shows how much of the promoted sales were really extra. About 77% were extra, and about 9% of the discount went to sales that would have happened anyway. This is an estimate, because there is no test group.
- *Promotion type performance.* 10% Discount returned 1.75. 20% Discount 0.37. BOGO minus 0.43. BOGO and Bundle had the highest response and still lost money. So a high response is not the same as a good result.

**Tab: Customer behaviour.**
- *How each customer type behaves.* Deal-Only and Stock-Up earn money from promotions. Buys Anyways, Switcher and Ignores cost money.
- *Response map.* Rows are customer types and columns are categories. Darker green means more of them bought on promotion. For example, Deal-Only customers respond strongly everywhere, and Ignores almost never do.

The key point from this page: the same promotion earns money from some customers and loses it on others. Behaviour explains who is who.

Now that we know this, let's move to prediction."

### Page 2: Customer Prediction (2.5 minutes)

"This page answers: what will this customer respond to, and is it worth it?

**Filters:** category (the prediction is always for one category, I use Beverages), customer type, channel, and a customer ID search. The list can be sorted by expected profit, response, uplift or time since last order.

I open customer C0241. This is a Stock-Up customer. They shop 4.6 times a month, 31% of their buying is on promotion, and they answered 19 of 30 past promotions.

**The chart 'What will C0241 respond to?'** shows two things for each promotion: the chance of buying, and the expected profit over the next 14 days. I use 14 days because the model predicts buying within 14 days of the offer starting.

- With no promotion, the chance is 33%.
- 10% Discount: 47%, which is 14 points more, and the profit is 65 rupees.
- 20% Discount: 61%, profit 47 rupees.
- BOGO: 86%, the highest. But it loses 106 rupees.

This is the main point. Predicting response is not the same as making a decision. BOGO has the highest response, but 10% Discount is the better decision.

Below the list there is a **Who to contact** card. If we contact only the customers where the offer pays, we contact 319 of 488 customers. We get about 51 extra buyers. The discount cost is about 2,200 rupees against 5,500 for 20% off to everyone. The profit is about 1,700 rupees against about minus 184. There is a button to export this list for the campaign team.

**Second tab: How the model predicts, and does it work.** It shows which behaviours drive the prediction (brand habits and past response are the top), who responds to what, and the test results. I trained the model on earlier campaigns and tested it on the last 8, which it had never seen. The model scored 0.82 on its ranking score. 0.5 is guessing and 1.0 is perfect. On those 8 campaigns, targeting by behaviour earned about 41,100 rupees at a return of 1.18. Offering everyone earned about 17,700 rupees at 0.08. This is my proof."

### Page 3: Planning (1 minute)

"Once we can predict, we can plan. This page gives the next quarter's six campaigns with a recommended offer for each. The summary says: six campaigns, about 25,600 rupees expected profit, three flagged.

The table shows the offer, audience, budget, expected extra buyers, return and confidence. I can Accept, Reject or Modify each one. Three campaigns are ready, for example Year-End Glow at 10% with a return of 1.38. Three are flagged as 'Needs Attention' because the expected return is thin, so they should be tested small first. About 8,000 rupees of budget is in those flagged campaigns."

### Page 4: Simulation (1 minute)

"Here the manager can try changes before spending. The controls are the business goal, the type of offer, the discount depth, a budget cap, a minimum return rule and which customer types to include. If the scenario breaks the rule, a red banner appears.

For Diwali Beverage Fest, the highest response comes from 20%, but it earns only about 857 rupees. The most profitable is 10%, which earns about 2,000 rupees. As the discount gets deeper more customers respond, but profit goes up and then comes down.

At the end there is the **Business impact** panel. It compares 20% to everyone with the behaviour-based plan for the six campaigns. Behaviour-based uses about 66% less discount and earns about 22,100 rupees more. I want to be honest about one thing: it creates fewer extra buyers, 250 against 535, but much more profit."

### Page 5: AI Advisor (15 seconds)

"The last page is a simple question box, for example 'Where are we wasting discount money?'. It answers from the same numbers. It runs locally and does not use an outside AI service."

---

## 7. How prediction works, in simple steps (1 minute)

"To summarise the logic:

1. I measure each customer's behaviour from past orders.
2. I put them in one of five types with simple rules.
3. A model gives the chance of buying in the next 14 days. I ask it twice, with and without the promotion. The difference is the estimated uplift.
4. I check the money: margin, discount cost, discount wasted, and the dip in later weeks.
5. A customer is contacted only if the offer earns more than it costs and raises the chance by at least 3 points.
6. I pick the offer with the best result."

---

## 8. Business value (30 seconds)

"What the business can gain:

- Give discounts only where they pay.
- Avoid wasting discount on customers who would buy anyway.
- Choose the offer by profit, not by response.
- Know which customers to leave out, such as Ignores and Buys Anyways.
- Test small first on campaigns the app flags as risky."

---

## 9. Closing (45 seconds)

"To finish. My question was how customer behaviour can be used for promotion prediction.

I found that behaviour shows who responds, to which offer, and whether it is worth the money. Customer types responded very differently. A model built on behaviour could rank customers well on campaigns it had never seen. Targeting by behaviour earned more with less discount.

The data is simulated and the uplift is an estimate. So my suggestion is a small pilot on real data for one or two campaigns, with a small group kept out for comparison. Thank you. I am happy to take questions."

---

## 10. Questions your manager may ask

**Is this real data?**
No. It is simulated to behave like retail data. It shows the method works, not what the real numbers will be.

**How do you know the promotion caused the extra sales?**
I do not know for sure. I compare each customer with their own normal buying, so I call it an estimate. There is no test group in this data.

**Why not target the customers with the highest response?**
High response can still lose money. For customer C0241, BOGO has 86% response and loses 106 rupees. 10% Discount has 47% and earns 65 rupees.

**What does 0.82 mean?**
It is a score for how well the model ranks customers. 0.5 is guessing and 1.0 is perfect. It was measured on 8 campaigns the model had not seen.

**Why 14 days?**
The model predicts buying within 14 days of the offer starting, and each campaign lasts 14 days. All chances and profits in the app use the same window.

**Does it work on new campaigns?**
It worked on the last 8 campaigns, which were kept out of training. The return was 1.18 against 0.08.

**How reliable are the customer types?**
They come from simple rules on behaviour. In the simulation they match the hidden truth about 92% of the time. On real data the rules would need review.

**Why fewer extra buyers in Business impact?**
Because it contacts fewer customers. It aims at profit, not volume: 250 extra buyers instead of 535, but about 22,100 rupees more profit and 66% less discount.

**Is the model always right?**
No. It is a simple model. It is a bit too optimistic for the least likely customers. It predicted about 17,100 rupees of profit and the real result was about 41,100, so it was cautious there.

**What data do we need?**
Order history with product, quantity, price, discount, which promotion it was, and whether the product is our brand. The app can load another file with the same columns.

**Does it handle festival seasons?**
Not directly. The timing signals carry only about 1% of the model's weight. **[NEEDS CONFIRMATION]** The code also counts the share of orders in October and November, but I could not find where it is used.

**What do we do next?**
A pilot on one or two campaigns with a small group kept out, so we can measure the real effect.

---

## 11. Numbers to remember

| What | Number |
|---|---|
| Customers, orders, campaigns | 520, 22,798, 30 |
| Campaigns that lost money | 9 of 30 (4 of 15 in the last 6 months) |
| Last 6 months | 2.85 lakh discount, 17.2K profit, ROI 0.06, response 40% |
| Estimated extra sales / wasted discount | about 77% / about 9% |
| Offer ROI (last 6 months) | 10% 1.75, ₹ off 0.45, 20% 0.37, Bundle −0.02, BOGO −0.43 |
| Model weight | Brand 42%, Promotion 30%, Price 10%, Purchasing 10%, Basket 7%, Timing 1% |
| Ranking score on unseen campaigns | 0.82 (top 20% of customers hold 38% of buyers) |
| Targeting by behaviour vs everyone | 41.1K at ROI 1.18 vs 17.7K at ROI 0.08 |
| Loss avoided by skipping the wrong customers | about 23.4K |
| Customer C0241 | 33% with no promotion, 47% with 10% off (+14 points, 65 rupees), BOGO 86% but −106 rupees |
| Who to contact (Beverages) | 319 of 488, profit about 1.7K vs about −184 for 20% to all |
| Next quarter plan | 6 campaigns, about 25.6K expected, 3 flagged, about 8K at risk |
| Business impact forecast | 66% less discount, about 22.1K more profit, ROI 0.05 to 0.98 |

Short definitions:
- **ROI:** profit divided by the discount given.
- **Uplift:** the chance of buying with the promotion minus the chance without it, in points. It is an estimate.
- **Leakage:** discount given on sales that would have happened anyway.
- **Prediction vs decision:** will they respond, versus is it worth offering.
