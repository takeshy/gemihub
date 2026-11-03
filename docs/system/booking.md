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

Dates, weekdays, holidays, opening hours and staff shifts use the shop's `region.timeZone`; absent settings mean Asia/Tokyo. The booking horizon counts local calendar days. Calendar FreeBusy queries cover local midnight to the following local midnight (23 or 25 hours on US summer-time transitions). Durations and lead times are elapsed minutes. Nonexistent spring-forward times are not offered; a repeated fall-back start uses its earlier occurrence, and appointment ends must stay within opening hours and staff shifts. ISO booking records remain UTC.

`hours.weekdayHours` overrides the normal start/end for specific weekdays; regular closed days and holidays still take precedence. By default, the owner handles every service during those actual daily opening hours until owner working conditions are configured. New shops retain the owner's availability when additional staff are added later; legacy explicit staff schedules remain supported.

In owner-enabled shops, Staff and shifts includes an Owner information card for the owner's name, photo, working days, hours and services. Saving it retains a `staff` row with the reserved ID `owner`; it is a profile for the existing owner booking resource, so it never adds a second booking resource or a staff login. Owner rows with `customAvailability: true` use their stored `weekdays`, `start`, `end` and `menuIds` just like other staff, intersected with shop opening hours and closures. Earlier name/photo-only profiles omit this marker and keep all services and all opening hours, including weekday overrides. Editing working conditions, either manually or through settings AI, opts into configured availability. Name/photo changes alone preserve the previous availability mode. Customer-facing names and photos use the saved profile. The owner's Google sign-in supplies Calendar consent; no separate staff-account or Calendar setup is required.

A menu with `optionFor` is an add-on and cannot be booked alone. It lists the standalone menu IDs that accept it. Only one selected add-on per nonempty `optionGroup` is allowed. Availability covers the combined duration and requires a staff member qualified for the base service and every selected add-on. Prices are summed in integer currency units before conversion back to shop currency. Booking records retain `optionIds`, a frozen `items` list, the combined price, and the full start/end interval. PayPal consent, holds, capture, and refunds use that combined snapshot. Preview and offline exports follow the same rules.

# Nominated and unassigned staff

Customers may choose a staff member or no preference. With no preference, gemihub assigns one available staff member who handles the menu. The shop cannot turn nomination off; customers always have both choices.

# Double-booking prevention

The server re-checks availability and saves the booking under a per-shop lock, so two customers cannot take the same staff member's time. A retried request with the same request ID does not create a second booking. If a connected Calendar cannot be read, availability is not guessed; the customer is asked to try again.
