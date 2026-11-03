---
type: "Process"
title: "Booking and availability"
description: "How customers book and how gemihub decides which time slots are open."
tags: ["booking", "availability", "staff", "calendar"]
updated: "2026-11-03"
---

How customers book and how gemihub decides which time slots are open.

# Booking flow

1. The customer signs in with a Google account. The first time, they register a name and profile for the shop.
2. They choose a menu, a staff member or "no preference", a date and an open time.
3. The server checks the slot again, saves the booking and emails the customer and the shop's `notificationEmail`.
4. With prepayment enabled, the customer pays with PayPal first; the booking is confirmed only after the payment is captured (see [Payments, cancellation and refunds](./payments.md)).

Customers see and cancel their own bookings on My page.

# How open slots are calculated

A slot is offered only when all of the following hold:

- The menu is active (`menus[].active`).
- The date is not a closed weekday (`hours.closedWeekdays`, 0 = Sunday) or a listed holiday (`hours.holidays`).
- The date is within `rules.advanceDays` days from today. Same-day booking requires `rules.sameDay: true`.
- The start is at least `rules.leadMinutes` minutes from now.
- Start times step by `rules.interval` minutes from `hours.start`, and the menu (`menus[].duration`) must finish by `hours.end`.
- A staff member who handles the menu (`staff[].menuIds`) works that weekday (`staff[].weekdays`) and the whole slot falls within their `start`–`end`.
- That staff member has no overlapping booking, payment in progress, or busy time in a connected Google Calendar.

All times are Japan time.

# Nominated and unassigned staff

Customers may choose a staff member or no preference. With no preference, gemihub assigns one available staff member who handles the menu. The shop cannot turn nomination off; customers always have both choices.

# Double-booking prevention

The server re-checks availability and saves the booking under a per-shop lock, so two customers cannot take the same staff member's time. A retried request with the same request ID does not create a second booking. If a connected Calendar cannot be read, availability is not guessed; the customer is asked to try again.
