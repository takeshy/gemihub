---
okf_version: "0.2"
---

# gemihub system

This **OKF v0.2 bundle** explains how gemihub works for every shop. It describes the shared implementation, not any one shop. A shop's own facts — its name, menus, prices, hours, staff, booking rules and refund tiers — are in that shop's `spec.md`, and the reasons for past changes are in its `history.md`. Read those first; read a chapter here when a question is about how the system behaves. The implementation reference date is 2026-11-03.

# Chapters

- [Booking and availability](./booking.md) - Customer sign-in and registration, menu and staff selection, nominated and unassigned staff, how open slots are calculated from hours, holidays, staff shifts, existing bookings and connected Google Calendars, and double-booking prevention.
- [Payments, cancellation and refunds](./payments.md) - PayPal prepayment at booking, server-decided amounts, refund tiers fixed at booking time, customer and shop cancellations, rounding, no-shows, refund statuses, cancellation without prepayment, and reading PayPal in Consult & ask with background alerts and owner-approved fixes.
- [Shop settings and changes](./shop-settings.md) - What each setting in `spec.md` means, provisional and public publication, how changes are requested, planned, approved and published, and how `history.md` records them.
- [Customers, inquiries, staff and notifications](./operations.md) - Customer records and notes, inquiries and replies, staff accounts and Calendar connection, and the emails customers and the shop receive.
- [Data and storage](./data.md) - Where bookings, settings, files, specifications and history are kept, what the server keeps, and how owners export JSON or CSV.

# Reading the bundle

- Shop facts come only from the shop's `spec.md` (settings) and `history.md` (dated requests and changes). If neither the shop files nor this bundle state something, it is not specified.
- Setting names in backticks, such as `rules.cancelHours`, are the keys in `spec.md`.
- Chapter frontmatter provides `type`, `title`, `description`, `tags` and `updated`, the last implementation-check date.
