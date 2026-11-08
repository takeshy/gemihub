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
- `map`: `enabled` shows a Google Map in the access section of "About the shop"; `query` is the place shown, and when blank the `address` is used. Absent or disabled means no map.
- `region`: `country` (`JP` or `US`) and `timeZone`. The country sets JPY or USD; the time zone sets local business dates and times. Missing region means JP / Asia/Tokyo for existing shops.
- `notificationEmail`: where the shop receives booking and inquiry emails.
- `menus[]`: `id`, `name`, `duration` (minutes), `price` (major currency units: whole yen for JP, dollars with up to two decimals for US), `active`, optional image.
- `staff[]`: `name`, `menuIds` they handle, `weekdays` (0 = Sunday), `start`, `end`, optional photo.
- `hours`: `start`, `end`, `closedWeekdays`, `holidays` (dates), `weekdayHours` (per-weekday hours) and `specialDays` (dates with their own hours that open even on a closed weekday, optionally with the `staffIds` working that date).
- `rules`: `interval`, `advanceDays`, `leadMinutes`, `sameDay`, `cancelHours`, and `payment` (`enabled`, `refundTiers`).
- `pages[]`, `header`, `footer`, `appearance`: customer-facing pages and design.
- `pages[]`: custom page bodies are checked HTML fragments, and `css` applies only to that page (layout, decoration and animation). Scripts, event attributes, forms, buttons, embedded documents, external CSS and CSS `url()` are rejected. Blog posts and announcements are Markdown.
- `screens`: the About, Booking, My page and Contact screens may each have checked HTML and screen-scoped CSS. Their working parts stay app components placed through slots: `booking` (required on Booking), `mypage` (required) and `news` on My page, `form` (required) on Contact, and `menus`, `staff`, `access` and `hours` on About. Without a design a screen uses the standard layout.
- `appearance.theme`: the header, the frame around every screen and the footer in checked HTML with one shared CSS; the owner can edit it after publication from a built-in screen in Try and edit screens.
- `appearance.articles`: separate `blogs` and `announcements` choices. If absent, both remain enabled for existing shops.
- `appearance.theme`: the reviewed first-creation HTML/CSS around application-provided navigation, content and footer slots. It cannot supply scripts, booking forms or authentication logic.

# Country, currency and time zone

The owner changes these in **Shop information**. JP uses Asia/Tokyo. US offers America/New_York, America/Chicago, America/Denver, America/Phoenix, America/Los_Angeles, America/Anchorage and Pacific/Honolulu. Summer time follows the selected zone; Phoenix and Honolulu do not switch. Interface language is independent of the shop's country.

Changing country does not convert menu amounts. Review prices before accepting new bookings. Existing captured payments and refunds keep their booked currency and amounts. AI proposals and screen design edits cannot change the region; use the settings screen.

New shops use the browser's preferred language: Japanese means JP, other languages mean US. A supported US browser time zone is used; otherwise US defaults to America/New_York. Missing language falls back to JP. Reconnecting or changing interface language does not change an existing shop. The browser supplies a time-zone cookie before login; these values are only initial defaults, not authorization.

# Publication

Before the first preview, gemihub asks for the shop name and whether a logo is available. Blog, announcements, staff introduction and products/services are separate choices. Staff and product introductions add pages; they do not create factual staff or price records.

The initial interview model extracts shop facts and custom page copy only. Provisional booking settings come from the application template; the model is not required to invent staff, prices, hours or booking rules. Theme generation uses its own output format, so a partial interview answer is never parsed as a complete operational configuration.

Attached reference pages guide the theme's layout, typography and composition. The screenshot itself is not pasted into the page. Images requested as logos or photos are used as assets. An independent model context reviews every attachment's purpose, duplicate navigation and the requested design; failed themes are repaired and reviewed, up to three generation attempts. A failed review never silently passes. Candidates are saved so a temporary review failure can resume without generating again.

After the theme sample appears, the owner can circle an area in red and request a theme revision. The reviewed replacement stays unpublished and preserves booking, price, staff and rule settings. Return to questions restores the same private interview for factual corrections.

A new shop is first published provisionally: only the owner who created it can view the pages. After checking the screens, the owner publishes it publicly. Later changes are reflected to the public pages when approved.

# How changes happen

In Services and prices, disabled menus are hidden from the editor by default. The **Show hidden menus** checkbox above the list reveals them for editing or re-enabling; it starts off each time the screen is opened. Disabling a menu never deletes it. Adding a new inactive menu turns the checkbox on so the new row can be edited immediately.

Add-ons have a separate **Can be added to any standalone service** checkbox. When enabled, individual target selection is unnecessary and future standalone services are included automatically. When disabled, the saved individual targets apply again. The selection group remains available in both modes.

In Shop information, Services and prices, Staff and shifts, Opening hours, and Booking rules, **Set up with AI** accepts notes and up to three public HTTP/HTTPS reference URLs. The server reads the HTML or text of those pages and suggests values for the selected section. Review the current and suggested values, warnings, and source links; choose **Apply to form**, then the screen's existing **Save** action. Creating or applying a suggestion does not save or publish it. Suggestions include valid unsaved form edits, preserve facts that were not supplied, and never delete unmentioned existing items. New services need both a duration and price and are added inactive; assign staff before enabling them.

Notification email, maps, region, currency and time zone remain manual. The Booking rules AI can propose `payment.enabled` and `payment.refundTiers`. Unspecified payment fields stay unchanged, and requesting refund rates alone never toggles prepayment. Review readable before/after time thresholds and rates, apply to form, then Save. Cancellation fees are converted to refund percentages. Invalid tiers are rejected by server validation. Existing bookings keep their saved terms; shop cancellations always refund in full. AI never executes a payment or refund. URL fetching does not execute scripts or load subresources; it rejects private/local DNS and redirect destinations and bounds page count, time, and size. If a page cannot be read, paste the relevant text as notes. An AI server connection is required; manual entry remains available.

The owner-only `POST /api/shops/:id/live-settings/:section/ai` accepts `note`, the selected section's current form `value`, and a UUID `requestId`. It returns `value`, readable `changes`, `warnings`, and fetched `sources`. Identical requests reuse the stored suggestion for one hour, including generated IDs; changing the payload for that ID is rejected. Reading pages and generating suggestions do not hold the shop's booking lock. Manual saves send the section's `value` and a UUID `requestId`. Each save overwrites that section with the submitted values, even if it changed after the form was opened; other sections retain their latest values. The settings screen has no reload or conflict-resolution button.

For conversation-based changes:

1. The owner describes a change in words (chat or voice) or edits a settings screen.
2. gemihub writes a change plan showing exactly which settings change. Nothing is applied yet.
3. The owner approves the plan on screen. Voice agreement alone is never approval.
4. gemihub saves the settings to Firestore and exports page files to Drive, regenerates `spec.md`, and adds an entry to `history.md`.

Amounts are always decided by the server, payment policies are fixed per booking, and factual data is read from the shop settings; a change request cannot override these.

# history.md

Each published change adds a dated entry with the owner's request (when the change came from a request) and a summary of what changed. Use it to answer when and why a setting changed. Entries made before requests were recorded show only the summary.
