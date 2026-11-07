---
type: "Concept"
title: "Data and storage"
description: "Firestore records, owner Drive files, and JSON/CSV exports."
tags: ["data", "storage", "firestore", "drive", "privacy"]
updated: "2026-11-06"
---

# Business records

Firestore is the source of truth for shop settings, bookings, customers, inquiries, members, notes, articles and AI chats. Google Sheets is not used for reads or writes. Records are queried by shop and record type; transactions commit business records and pending operational work together. Published settings come from the saved shop configuration.

Cancellation, no-show, membership revocation and note deletion preserve records through status changes. Payment amounts and refund decisions come from their processing journals. Menu and booking prices use the shop's major currency units; captured payments and refunds use integer yen or cents.

# Owner's Google Drive

Images, private attachments, specifications, change history and offline page exports remain in the owner's Drive. Business records do not require Drive access to be read. Drive or email failures remain visible and can be retried.

# Operational and traffic records

Operational logs, page displays and browser-deduplication records are stored in the shop's Firestore database for 90 days. Logs do not contain email addresses, names, IP addresses, credentials, request bodies, URL query strings or raw payment responses. Customer activity uses a shop-scoped hash of the normalized customer email. Anonymous traffic uses a separate shop-scoped hash of a random browser UUID stored in localStorage for 90 days, with no browser fingerprint or customer identity matching.

Page displays and their article/daily browser records commit in one Firestore batch. Reports use database count aggregations, not samples of recent logs. A logging failure must not change authentication, booking or payment outcomes. Firestore TTL and application query bounds enforce retention. BigQuery and external analytics are not used by this implementation.

# Export

In Publication settings, the owner can save all records as JSON or choose a CSV table: bookings, customers, inquiries, customer notes, members, articles, services or staff. JSON includes the current configuration, draft, history and the owner's own chats. Other people's private chats, encrypted Google credentials, sessions and internal payment-processing records are excluded. Booking payment fields retain the recorded amounts and cancellation state.

Image and attachment references are included; file bytes remain in Drive. Export files are private downloads. Editing an exported file does not update the shop. CSV values are quoted and text that could be evaluated as a spreadsheet formula is escaped. Use the app to update records or cancel bookings.

## Inquiry interaction records

`inquiryInteraction` stores operator-only append-only phone, customer-message, internal-note and outgoing-email records, keyed by a shop/inquiry/request digest. `inquiryCreateRequest` and `inquiryEntryRequest` deduplicate creation and recording. Mail intent and the conversation entry commit atomically; the mail worker updates delivery state under the existing mail lock. The worker reads the recipient from the inquiry at send time, so queued replies follow contact corrections, and history records the address actually used. A reply with no remaining address, or still failing after `maxInquiryMailAttempts` sends, becomes `failed` and leaves the queue. A failed delivery-state save is only reported: it neither resends accepted mail nor stops later jobs. Old `inquiryReplyRequest` receipts continue to prevent duplicate legacy retries. Manual contact edits use previous email/phone comparisons, and public verified reply addresses remain immutable. JSON exports include `records.inquiryInteractions`; CSV exports support `inquiryInteractions`. Existing inquiry CSV fields stay first, with optional reception metadata appended.
