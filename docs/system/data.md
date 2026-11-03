---
type: "Concept"
title: "Data and storage"
description: "Where shop data is kept and what direct spreadsheet edits change."
tags: ["data", "storage", "spreadsheet", "drive", "privacy"]
updated: "2026-11-03"
---

Where shop data is kept and what direct spreadsheet edits change.

# Owner's Google account

- The booking ledger is a Google spreadsheet in the owner's Drive. Bookings, inquiries, members, customers, notes and articles are rows there, and settings are in the `menus`, `staff`, `settings` and `pages` tabs.
- Images, attachments, `spec.md`, `history.md` and a runnable export of the shop pages are in the shop's Drive folder.

# Server

The server keeps sign-in sessions, encrypted Google tokens, publication state, pending plans, payment and refund processing records, and locks. Payment amounts and refund decisions come from these records, not from spreadsheet edits.

# Direct spreadsheet edits

Settings edited directly in the spreadsheet take effect on the next request. Keep column names and order. Invalid master data stops booking until fixed. Plans created before a direct edit must be created again. Do not add bookings directly while the app is taking bookings; direct edits do not use the booking lock.
