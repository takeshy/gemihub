---
type: "Process"
title: "Customers, inquiries, staff and notifications"
description: "Customer records, inquiries, staff accounts and Calendar connection, and email notifications."
tags: ["customers", "inquiries", "staff", "notifications", "email"]
updated: "2026-11-06"
---

Customer records, inquiries, staff accounts and Calendar connection, and email notifications.

Settings saves retain their request ID and submitted settings in browser storage when a response is lost. Always read the saved settings when restoring this state: if that section already matches, clear the completed retry automatically. Otherwise retain the pending inputs, and offer “Discard pending changes and load saved settings.” This action reads the current server settings before clearing browser state and makes no configuration write. If the server is unavailable or publication is unfinished, keep the pending retry state. A cached staff row may therefore differ from the current shop; never treat it as proof that a removed staff member was restored on the server.

# Customers

Bookings and inquiries are grouped by email address. The shop sees visit counts, the last visit and totals, and can keep private notes with up to five attachments per note. Customers never see notes. Customer periods and inquiry date filters use midnight in the shop's time zone. Notification dates use that time zone; paid/refunded amounts use the payment's saved currency.

# Inquiries

Customers send inquiries from the shop page. The shop replies from the management screen; the reply is emailed to the customer and the inquiry status is updated.

# Traffic and activity history

Open "Shop traffic" in Customers or Blog posts and announcements to view daily visits or article traffic over 7, 30 or 90 days. This includes visitors who have not signed in or registered. PV counts page displays, including reloads. Daily unique browsers count the same browser once per shop-local calendar day across all pages; article unique browsers count each browser once per article in the chosen period. Dates follow the shop's configured time zone.

Unique browsers approximate people. Separate devices, private browsing, cleared storage and the 90-day browser-ID rotation may count separately. When browser storage is unavailable, a display contributes PV only. Never add daily or article unique counts and call the result overall unique people. Signed-in owners and accepted staff, previews, provisional pages and offline displays are excluded. Views before logging began or that could not be sent are unavailable. These are major page displays rather than complete click tracking. Under extreme traffic each shop counts at most 1,200 views per minute, so totals can be lower than actual views.

Customer details also show signed-in activity history: login, opening booking and My page screens, booking confirmation and cancellation. This personal history is separate from anonymous traffic; anonymous browser IDs are not matched to customer names or email addresses.

For actual counts, assistant research uses `get_daily_traffic` (`logs:traffic`) and `get_article_access_counts` (`logs:articles`), shared with the management reports. Use `search_shop_logs` (`logs:shop`) for access, errors, PayPal processing diagnostics and signed-in activity. Generic log search is bounded; do not use its truncated counts instead of traffic aggregates. Only owners and accepted staff can read shop reports and histories.

# Staff

The owner grants Calendar FreeBusy access during normal owner sign-in, alongside Drive and Gmail permissions. The owner is a booking provider without a staff registration, and their calendar is checked automatically. New shops start with no additional staff. The owner has no separate calendar status panel; ordinary sign-in handles consent. Legacy explicit staff assignments remain supported. Other staff sign in through the staff login link with their own Google account and can manage bookings, inquiries and customer notes, but not shop settings or publication. Busy times in each connected calendar block booking slots for the corresponding staff member.

# Notifications

gemihub sends email from the owner's Gmail for: booking confirmation, payment confirmation, cancellation and refund results, opening alerts, inquiry replies and staff invitations. The shop's `notificationEmail` receives a copy of booking-related mail, except opening alerts, which go to the customer alone. Delivery is at least once; a lost response can cause a duplicate email, never a duplicate booking.
