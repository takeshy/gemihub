---
type: "Concept"
title: "Shop settings and changes"
description: "What the settings in spec.md mean and how changes are requested, approved, published and recorded."
tags: ["settings", "spec", "history", "publication", "changes"]
updated: "2026-11-03"
---

What the settings in `spec.md` mean and how changes are requested, approved, published and recorded.

# Settings in spec.md

`spec.md` contains the shop's current settings as JSON:

- `name`, `industry`, `description`, `address`: shop information shown to customers.
- `notificationEmail`: where the shop receives booking and inquiry emails.
- `menus[]`: `id`, `name`, `duration` (minutes), `price` (yen), `active`, optional image.
- `staff[]`: `name`, `menuIds` they handle, `weekdays` (0 = Sunday), `start`, `end`, optional photo.
- `hours`: `start`, `end`, `closedWeekdays`, `holidays` (dates).
- `rules`: `interval`, `advanceDays`, `leadMinutes`, `sameDay`, `cancelHours`, and `payment` (`enabled`, `refundTiers`).
- `pages[]`, `header`, `footer`, `appearance`: customer-facing pages and design.

# Publication

A new shop is first published provisionally: only the owner who created it can view the pages. After checking the screens, the owner publishes it publicly. Later changes are reflected to the public pages when approved.

# How changes happen

1. The owner describes a change in words (chat or voice) or edits a settings screen.
2. gemihub writes a change plan showing exactly which settings change. Nothing is applied yet.
3. The owner approves the plan on screen. Voice agreement alone is never approval.
4. gemihub saves the settings to the shop's spreadsheet and Drive, regenerates `spec.md`, and adds an entry to `history.md`.

Amounts are always decided by the server, payment policies are fixed per booking, and factual data is read from the shop settings; a change request cannot override these.

# history.md

Each published change adds a dated entry with the owner's request (when the change came from a request) and a summary of what changed. Use it to answer when and why a setting changed. Entries made before requests were recorded show only the summary.
