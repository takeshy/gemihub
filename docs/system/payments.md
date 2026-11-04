---
type: "Rule"
title: "Payments, cancellation and refunds"
description: "PayPal prepayment, how amounts and refunds are decided, and cancellation rules."
tags: ["payment", "paypal", "cancellation", "refund"]
updated: "2026-11-05"
---

PayPal prepayment, how amounts and refunds are decided, and cancellation rules.

# Prepayment

When `rules.payment.enabled` is true, customers pay the full menu price with PayPal when booking. The amount is decided by the server from the menu price at the time of booking (`menus[].price`, yen for JP or dollars for US); neither the browser nor a request can set it. The slot is held while the customer approves the payment and the booking is confirmed after capture. gemihub uses the server's PayPal account; this deployment uses the PayPal Sandbox.

# Processing and delivery

Booking creation, capture, cancellation, refunds and reconciliation share a per-shop booking/payment lock. Drive exports use the configuration lock, and email delivery uses a separate delivery lock after booking/payment writes complete. Slow exports cannot hold up a payment, and slow PayPal responses cannot hold up independent exports. Only committing a changed public configuration briefly shares the booking lock; file refreshes for unchanged settings do not. Reset waits for configuration, booking/payment and delivery operations before archiving the shop. During an unfinished publication, new bookings remain paused while existing payments and refunds can finish using the saved published settings.

# Currency and stored amounts

Checkout snapshots JPY or USD when it starts. PayPal order/capture/refund currency and amount must match that snapshot. Menu prices and `booking.price` are major units; `payment.amount` and refund amounts are integer minor units (yen or cents). For example, USD 55.01 is stored as 5501 cents and a 50% refund is 2750 cents (USD 27.50). Legacy checkouts without a currency are JPY. A later change to the shop country does not reprice an in-progress checkout or a captured payment.

# Refund tiers

`rules.payment.refundTiers` lists refund percentages by hours remaining before the start, from the largest number of hours down to 0. The current default is "48 hours or more: 100%, 24–48 hours: 50%, less than 24 hours: 0%"; saved policies, including older 72-hour defaults, remain unchanged.

- The tiers and amount in force when the customer booked are stored with the booking. Changing the settings later does not change refunds for existing bookings.
- The refund is the paid amount × the percentage, rounded down once to the smallest unit (1 yen for JPY, 1 cent for USD).
- A cancellation by the shop ("cancel for shop reasons") always refunds 100%, whatever the time remaining.
- Recording a no-show does not refund.
- After the start time the last tier applies.

# Customer cancellation

Customers cancel from My page. Eligible paid bookings automatically accept a replacement reservation at a fixed discount: 20% off in a refund zone below 80%, or half price in a 0% zone until 10 minutes before the visit. Equal-rate tiers form one zone. Menus can disable replacement bookings with `transferable: false` (default allowed); every booked menu and add-on must allow it. Full-refund periods, ineligible menus and appointments past the booking deadline use immediate normal cancellation. The confirmation shows the expected refund, the higher refund if someone books, and the deadline; changed amounts or deadline require confirmation. If nobody books, cancellation settles at the expected refund without reducing it as time passes. Before another customer starts paying and before the deadline, the customer can undo cancellation and restore the original booking. Payment started before the deadline has its own 10-minute hold. A replacement capture switches the current customer and payment and persists an equal-amount refund intent for the former customer; the shop total is unchanged. New customers see discounted appointments and never receive previous customer identities, messages or internal request keys. Previous messages remain only in operator history. Without prepayment, customers can cancel until `rules.cancelHours` hours before the start; after that they are asked to contact the shop.

# Refund status

Replacement notices and a shop-history intent commit with a delivery acknowledgement. The history intent is applied under the configuration lock with its own atomic acknowledgement, so payment operations never wait for Drive, concurrent publication cannot overwrite the history, and retries never append it twice.

Each final cancellation is fixed (time, actor, reason, percentage, amount) before PayPal is called and uses one refund request ID, so retries never refund twice. Statuses shown to the shop and customer: completed, pending, processing (retrying automatically), awaiting funds in the shop's PayPal balance, not required (zero refund), and needs review. The server checks unfinished payments and refunds every minute; uncertain results older than five hours stop for the shop to review.
