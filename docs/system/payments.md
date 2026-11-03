---
type: "Rule"
title: "Payments, cancellation and refunds"
description: "PayPal prepayment, how amounts and refunds are decided, and cancellation rules."
tags: ["payment", "paypal", "cancellation", "refund"]
updated: "2026-11-03"
---

PayPal prepayment, how amounts and refunds are decided, and cancellation rules.

# Prepayment

When `rules.payment.enabled` is true, customers pay the full menu price with PayPal when booking. The amount is decided by the server from the menu price at the time of booking (`menus[].price`, yen for JP or dollars for US); neither the browser nor a request can set it. The slot is held while the customer approves the payment and the booking is confirmed after capture. gemihub uses the server's PayPal account; this deployment uses the PayPal Sandbox.

# Currency and stored amounts

Checkout snapshots JPY or USD when it starts. PayPal order/capture/refund currency and amount must match that snapshot. Menu prices and `booking.price` are major units; `payment.amount` and refund amounts are integer minor units (yen or cents). For example, USD 55.01 is stored as 5501 cents and a 50% refund is 2750 cents (USD 27.50). Legacy checkouts without a currency are JPY. A later change to the shop country does not reprice an in-progress checkout or a captured payment.

# Refund tiers

`rules.payment.refundTiers` lists refund percentages by hours remaining before the start, from the largest number of hours down to 0. For example, "72 hours or more: 100%, 24–72 hours: 50%, less than 24 hours: 0%".

- The tiers and amount in force when the customer booked are stored with the booking. Changing the settings later does not change refunds for existing bookings.
- The refund is the paid amount × the percentage, rounded down once to the smallest unit (1 yen for JPY, 1 cent for USD).
- A cancellation by the shop ("cancel for shop reasons") always refunds 100%, whatever the time remaining.
- Recording a no-show does not refund.
- After the start time the last tier applies.

# Customer cancellation

Customers cancel from My page. With prepayment, gemihub shows the refund estimate before confirming; if the amount changes between estimate and confirmation, the customer confirms again. Without prepayment, customers can cancel until `rules.cancelHours` hours before the start; after that they are asked to contact the shop.

# Refund status

Each cancellation is fixed (time, actor, reason, percentage, amount) before PayPal is called and uses one refund request ID, so retries never refund twice. Statuses shown to the shop and customer: completed, pending, processing (retrying automatically), awaiting funds in the shop's PayPal balance, not required (zero refund), and needs review. The server checks unfinished payments and refunds every minute; uncertain results older than five hours stop for the shop to review.
