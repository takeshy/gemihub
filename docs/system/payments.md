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

`rules.payment.refundTiers` lists refund percentages by hours remaining before the start, from the largest number of hours down to 0. The current default is "24 hours or more: 100%, 12–24 hours: 70%, 1–12 hours: 40%, less than 1 hour: 0%"; saved policies, including older 48-hour and 72-hour defaults, remain unchanged.

- The tiers and amount in force when the customer booked are stored with the booking. Changing the settings later does not change refunds for existing bookings.
- The refund is the paid amount × the percentage, rounded down once to the smallest unit (1 yen for JPY, 1 cent for USD).
- A cancellation by the shop ("cancel for shop reasons") always refunds 100%, whatever the time remaining.
- Recording a no-show does not refund.
- After the start time the last tier applies.

# Changing refund terms

In Booking rules, **Set up with AI** can propose refund percentages or convert cancellation fees into refunds. It shows the current and proposed time thresholds and rates. **Apply to form** changes only the form; **Save** applies the terms to new bookings. Unmentioned payment fields remain unchanged. AI does not execute payments/refunds or change existing booking snapshots.

# Customer cancellation

Customers cancel from My page. Eligible paid bookings automatically accept a replacement reservation at a fixed discount: 10%, 30% or 50% off, choosing the largest fixed discount that returns at least 20 percentage points more than normal cancellation. The default policy uses 10% off in the 70%-refund zone, 30% off in the 40%-refund zone, and half price in the 0%-refund zone until 10 minutes before the visit. Custom refund rates above 70% cannot meet this improvement with the fixed discounts and use normal cancellation. Equal-rate tiers form one zone. Menus can disable replacement bookings with `transferable: false` (default allowed); every booked menu and add-on must allow it. Full-refund periods, ineligible menus and appointments past the booking deadline use immediate normal cancellation. The confirmation shows the expected refund, the higher refund if someone books, and the deadline; changed amounts or deadline require confirmation. If nobody books, cancellation settles at the expected refund without reducing it as time passes. Expiry ends the request; no relisting after settlement or automatic move to the next zone. Before another customer starts paying and before the deadline, the customer can undo cancellation and restore the original booking. Payment started before the deadline has its own 10-minute hold. A replacement capture switches the current customer and payment and persists an equal-amount refund intent for the former customer; the shop total is unchanged. New customers see discounted appointments and never receive previous customer identities, messages or internal request keys. Previous messages remain only in operator history. Without prepayment, customers can cancel until `rules.cancelHours` hours before the start; after that they are asked to contact the shop.

# Refund status

Replacement notices and a shop-history intent commit with a delivery acknowledgement. The history intent is applied under the configuration lock with its own atomic acknowledgement, so payment operations never wait for Drive, concurrent publication cannot overwrite the history, and retries never append it twice.

Each final cancellation is fixed (time, actor, reason, percentage, amount) before PayPal is called and uses one refund request ID, so retries never refund twice. Statuses shown to the shop and customer: completed, pending, processing (retrying automatically), awaiting funds in the shop's PayPal balance, not required (zero refund), and needs review. The server checks unfinished payments and refunds every minute; uncertain results older than five hours stop for the shop to review.

# PayPal checks, alerts and proposals

Consult & ask can read the shop's PayPal records. For a question about payments, refunds or transactions (for example "Did the $49.50 refund go through?" or "Are any refunds stuck?"), the research step uses read-only tools: find a booking's order, capture and refund IDs in the shop's ledger, read an order, capture or refund from PayPal by ID, and search the shop's PayPal transactions for up to 31 days. Only IDs that appear in this shop's ledger can be read; other shops' IDs are refused before PayPal is called. Results contain status, amount, IDs and times only, never customer email addresses, and amounts use normal units (USD 49.50, not cents). When the ledger and PayPal disagree, the answer states the difference and cites the PayPal record (for example `paypal:refund:<ID>`). If a record cannot be read, the answer says so instead of guessing. The AI has no tool that writes to PayPal.

A background check runs every 60 minutes and compares the ledger with PayPal. It reports, by severity:

- **Needs review** (urgent): a refund in `manual_review`.
- **Payment not confirmed** (urgent): a capture still in progress after 15 minutes, or a capture whose result is unknown.
- **Ledger and PayPal disagree** (urgent): PayPal reports a different state from the ledger. Only open refunds and payments active in the last 7 days are checked against PayPal (at most 30). `REFUNDED` and `PARTIALLY_REFUNDED` captures are treated as expected.
- **Refund stalled** (attention): a refund still `retrying` or `pending` after 2 hours.
- **Awaiting funds** (attention): a refund waiting for the shop's PayPal balance.
- **Unsold discounted slot** (check): a replacement-booking offer with 2 hours or less before its deadline.

Detection follows these fixed rules; the AI only writes a 2–4 sentence summary of what was found. Owners see the list under **Needs attention** in Consult & ask and can run **Check now** at any time. Urgent items are emailed when they appear or change; the rest are sent once a day as a digest at the hour chosen in **Notification settings** (9:00 in the shop's time zone by default). Email can be turned off there, and the same item is not sent again until its state changes. Judge shops never send email.

Items that can be fixed carry a proposal, and an answer about a booking shows the proposals for the bookings and PayPal IDs it mentions (otherwise up to five, most urgent first). Proposals are limited to: retry a refund (`retrying`/`pending`), re-sync the state from PayPal (on a disagreement), complete a manual review when PayPal shows the refund finished, and close an unsold discounted slot now at the refund quoted at cancellation. The server decides every operation and amount; the AI cannot propose a new refund or change an amount. Only the owner can approve. Before running, the server takes the booking lock, reads the booking from PayPal again and refuses if anything changed since the proposal, returning the current state. Retries reuse the original PayPal request ID, so a refund is never sent twice. Each executed proposal is recorded in `history.md` and the operation log.
