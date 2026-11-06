---
type: "Process"
title: "Booking and availability"
description: "How customers book and how gemihub decides which time slots are open."
tags: ["booking", "availability", "staff", "calendar"]
updated: "2026-11-06"
---

How customers book and how gemihub decides which time slots are open.

# Booking flow

1. The customer enters their email and opens the single-use verification link sent by the shop. The link expires in 15 minutes; opening it shows an explicit email-confirmation button before creating a session. Google sign-in is also available as an alternative; both methods use the same verified email identity. The first time, they register a name and profile for the shop. Existing records remain associated with the same verified email.
2. They choose a menu, a staff member or "no preference", a date and an open time.
3. The server checks the slot again, saves the booking and emails the customer and the shop's `notificationEmail`.
4. With prepayment enabled, the customer pays with PayPal first; the booking is confirmed only after the payment is captured (see [Payments, cancellation and refunds](./payments.md)).
5. A confirmed booking response replaces the form with the completion screen. It uses the returned record's assigned person, snapshotted services/add-ons, price, dates, duration, booking number and message, with links to My page and another booking. Pending or failed payments stay on My page; missing or foreign booking data never produces a completion receipt. PayPal-return reloads recheck the existing checkout idempotently. Leaving the receipt clears PayPal-return parameters so a subsequent visit does not reopen that flow.

Customers see and cancel their own bookings on My page.

# Pre-visit reminders

Every minute, the mail worker queues one reminder per confirmed booking, start time and current customer. It normally runs 24 hours before the appointment. Unpaid bookings use one hour before the existing cancellation cutoff if that is earlier (25 hours before for a 24-hour cutoff), giving customers time to cancel. Bookings created or bought as a discounted appointment after their reminder time receive only their normal confirmation. A booking awaiting a replacement gets no reminder unless its cancellation is withdrawn. Following downtime, overdue reminders are queued while the appointment is still in the future.

The customer receives the appointment's start and end in the shop's time zone, snapshotted services/add-ons, assigned staff, address, and a language-preserving link to My page for review and cancellation. The link requires normal authentication and does not contain a login credential. The completion screen explains the timing and encourages early cancellation. Refund and cancellation rules still apply.

The reminder marker and existing mail outbox are committed together under the mail lock. Delivery failures retry from the outbox; workers recheck the current holder, start, active status and any replacement listing before sending, discarding cancelled, no-show, started, or superseded reminders. Draft-only and archived shops and unconfirmed payments are excluded. Booking language is saved for Japanese/English delivery; older bookings use the shop language, then Japanese. Judge shops record mail without sending, and preview/offline screens do not queue mail. As with other Gmail outbox messages, a process failure after Gmail accepts a message but before queue deletion can cause a retry; Gmail does not provide an exactly-once transaction with Firestore.

# How open slots are calculated

A slot is offered only when all of the following hold:

- The menu is active (`menus[].active`).
- The date is not a listed holiday (`hours.holidays`), and is not a closed weekday (`hours.closedWeekdays`, 0 = Sunday) unless it is a special opening day (`hours.specialDays`).
- The date is within `rules.advanceDays` days from today. Same-day booking requires `rules.sameDay: true`.
- The start is at least `rules.leadMinutes` minutes from now.
- Start times step by `rules.interval` minutes from `hours.start`, and the menu (`menus[].duration`) must finish by `hours.end`.
- A staff member who handles the menu (`staff[].menuIds`) works that weekday (`staff[].weekdays`) and the whole slot falls within their `start`–`end`.
- That staff member has no overlapping booking, payment in progress, or busy time in a connected Google Calendar.

Dates, weekdays, holidays, opening hours and staff shifts use the shop's `region.timeZone`; absent settings mean Asia/Tokyo. The booking horizon counts local calendar days. Calendar FreeBusy queries cover local midnight to the following local midnight (23 or 25 hours on US summer-time transitions). Durations and lead times are elapsed minutes. Nonexistent spring-forward times are not offered; a repeated fall-back start uses its earlier occurrence, and appointment ends must stay within opening hours and staff shifts. ISO booking records remain UTC.

`hours.weekdayHours` overrides the normal start/end for specific weekdays; regular closed days and holidays still take precedence.

`hours.specialDays` lists dates with their own `start`–`end`, such as a public holiday opened on a regular closed weekday or a late night on one date. A special day opens the date even on a closed weekday and its hours replace the weekday and normal hours. A special day may list `staffIds`: only those staff work that date. Without it, every staff member who handles the menu works. Working staff are available for the special hours; their regular `weekdays` and `start`–`end` are not checked. Saving the staff list removes deleted staff from `staffIds`; a date left with an empty list is rejected with its date. A substitute day off is entered as a holiday. A date cannot be both a holiday and a special day. By default, the owner handles every service during those actual daily opening hours until owner working conditions are configured. New shops retain the owner's availability when additional staff are added later; legacy explicit staff schedules remain supported.

In owner-enabled shops, Staff and shifts includes an Owner information card for the owner's name, photo, working days, hours and services. Saving it retains a `staff` row with the reserved ID `owner`; it is a profile for the existing owner booking resource, so it never adds a second booking resource or a staff login. Owner rows with `customAvailability: true` use their stored `weekdays`, `start`, `end` and `menuIds` just like other staff, intersected with shop opening hours and closures. Earlier name/photo-only profiles omit this marker and keep all services and all opening hours, including weekday overrides. Editing working conditions, either manually or through settings AI, opts into configured availability. Name/photo changes alone preserve the previous availability mode. Customer-facing names and photos use the saved profile. The owner's Google sign-in supplies Calendar consent; no separate staff-account or Calendar setup is required.

A menu with `optionFor` is an add-on and cannot be booked alone. It lists the standalone menu IDs that accept it. Only one selected add-on per nonempty `optionGroup` is allowed. Availability covers the combined duration and requires a staff member qualified for the base service and every selected add-on. Prices are summed in integer currency units before conversion back to shop currency. Booking records retain `optionIds`, a frozen `items` list, the combined price, and the full start/end interval. PayPal consent, holds, capture, and refunds use that combined snapshot. Preview and offline exports follow the same rules.

# Opening alerts

A signed-in customer with a profile can ask to be told when a time opens. Under the time list, Tell me when a time opens up takes a date and a from–to range; the service, add-ons and staff come from the form. Dates must be in the booking window, and each customer keeps at most 10 alerts. With PayPal enabled they can choose only discounted appointments.

gemihub checks each alert every minute, using the same availability rules as booking. It also matches open discounted appointments for the same base service and staff choice that fit the whole range and that nobody is paying for. It emails only openings that appear after registration, only to that customer, and holds nothing: first to book gets it. A time that fills and reopens is mailed again, at most one ordinary-opening mail an hour per alert. New discounted appointments skip that wait. If a connected Calendar cannot be read, the alert waits for the next check.

My page lists alerts with Stop alert. An alert is removed once the customer books inside its range after registering or the range has passed. A booking they already held does not count, so they can ask to move it. If the shop stops offering the service or add-on, the alert is removed and the customer is told by email.

# Nominated and unassigned staff

Customers may choose a staff member or no preference. With no preference, gemihub assigns one available staff member who handles the menu. The shop cannot turn nomination off; customers always have both choices.

# Same-day phone bookings

Operators can add a booking for today from Bookings when a customer telephones. It is paid in cash at the shop and requires a name and phone number. The customer has no account, so they receive no email; the booking registers them in Customers under that number, where their visits and notes accumulate. Only today's slots in the shop's time zone are accepted; later dates stay online prepayment only, so cash bookings cannot hold slots ahead. Phone bookings use the same availability as online bookings, including pending payments, connected calendars and bookings awaiting a replacement customer, so those slots are not offered in this form. Entering a registered number fills in the name without replacing a typed one. Same-day and minimum-notice rules for online booking do not apply to them. Coupons, refunds and transfers do not apply. Owners can cancel or record a no-show as usual.

An operator can instead give a slot awaiting a replacement to a cash customer from that booking, if it is today, has not started and no one is paying for it online. The original booking is cancelled with the refund promised for a replacement rather than the lower cancellation amount, and a phone booking for the same slot, menu and staff is created at the listing price, in one transaction. The cash collected equals the raised refund, so the shop's total stays unchanged when the customer pays. If they do not arrive, the original customer has still been refunded and the shop does not receive that amount.

# Double-booking prevention

The server re-checks availability and saves the booking under a per-shop lock, so two customers cannot take the same staff member's time. A retried request with the same request ID does not create a second booking. If a connected Calendar cannot be read, availability is not guessed; the customer is asked to try again.

The reservation form shows a loading message while checking availability. Failed requests show the returned error and a Retry button; they are never displayed as an empty schedule. Only a successful response with no slots shows the suggestion to choose another date. Dates use the shop's time zone, so a date that is already tomorrow for the viewer may still be a closed day at the shop.

The initial date is the first date with an actual available slot in the booking window. The search skips same-day restrictions, closed weekdays, holidays, lead time, unsuitable service durations or staff shifts, existing bookings, payment holds, and connected Calendar busy intervals. It checks Calendar over the candidate date range once per relevant member. An explicitly chosen date is kept when the service or staff changes; if that date has no slots, the customer can choose Find the first available date. A window with no slots has a separate message, and Calendar errors remain retryable errors. Practice and offline booking screens use the same initial-date rules with their sample data.

In judge access, Ctrl+Shift+L only reveals the judge controls. Role changes require the explicit Try as a customer or Back to owner button. A trial customer opening management sees Back to owner. Reopening the invitation resumes the saved owner and shop instead of creating another shop; an invalid recovery session produces an error instead of a replacement account.
