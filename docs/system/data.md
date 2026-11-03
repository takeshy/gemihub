---
type: "Concept"
title: "Data and storage"
description: "Firestore records, owner Drive files, and JSON/CSV exports."
tags: ["data", "storage", "firestore", "drive", "privacy"]
updated: "2026-11-03"
---

# Business records

Firestore is the source of truth for shop settings, bookings, customers, inquiries, members, notes, articles and AI chats. Google Sheets is not used for reads or writes. Records are queried by shop and record type; transactions commit business records and pending operational work together. Published settings come from the saved shop configuration.

Cancellation, no-show, membership revocation and note deletion preserve records through status changes. Payment amounts and refund decisions come from their processing journals. Menu and booking prices use the shop's major currency units; captured payments and refunds use integer yen or cents.

# Owner's Google Drive

Images, private attachments, specifications, change history and offline page exports remain in the owner's Drive. Business records do not require Drive access to be read. Drive or email failures remain visible and can be retried.

# Export

In Publication settings, the owner can save all records as JSON or choose a CSV table: bookings, customers, inquiries, customer notes, members, articles, services or staff. JSON includes the current configuration, draft, history and the owner's own chats. Other people's private chats, encrypted Google credentials, sessions and internal payment-processing records are excluded. Booking payment fields retain the recorded amounts and cancellation state.

Image and attachment references are included; file bytes remain in Drive. Export files are private downloads. Editing an exported file does not update the shop. CSV values are quoted and text that could be evaluated as a spreadsheet formula is escaped. Use the app to update records or cancel bookings.
