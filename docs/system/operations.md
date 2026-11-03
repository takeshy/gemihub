---
type: "Process"
title: "Customers, inquiries, staff and notifications"
description: "Customer records, inquiries, staff accounts and Calendar connection, and email notifications."
tags: ["customers", "inquiries", "staff", "notifications", "email"]
updated: "2026-11-03"
---

Customer records, inquiries, staff accounts and Calendar connection, and email notifications.

# Customers

Bookings and inquiries are grouped by email address. The shop sees visit counts, the last visit and totals, and can keep private notes with up to five attachments per note. Customers never see notes. Customer periods and inquiry date filters use midnight in the shop's time zone. Notification dates use that time zone; paid/refunded amounts use the payment's saved currency.

# Inquiries

Customers send inquiries from the shop page. The shop replies from the management screen; the reply is emailed to the customer and the inquiry status is updated.

# Staff

The owner grants Calendar FreeBusy access during normal owner sign-in, alongside Drive and Gmail permissions. The owner is a booking provider without a staff registration, and their calendar is checked automatically. New shops start with no additional staff. The owner has no separate calendar status panel; ordinary sign-in handles consent. Legacy explicit staff assignments remain supported. Other staff sign in through the staff login link with their own Google account and can manage bookings, inquiries and customer notes, but not shop settings or publication. Busy times in each connected calendar block booking slots for the corresponding staff member.

# Notifications

gemihub sends email from the owner's Gmail for: booking confirmation, payment confirmation, cancellation and refund results, inquiry replies and staff invitations. The shop's `notificationEmail` receives a copy of booking-related mail. Delivery is at least once; a lost response can cause a duplicate email, never a duplicate booking.
