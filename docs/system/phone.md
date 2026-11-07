---
type: "Concept"
title: "AI phone reception"
description: "How the shop answers calls with Gemini Live, creates cash bookings in the same inventory, records inquiries and keeps searchable transcripts."
tags: ["phone", "twilio", "gemini-live", "bookings", "inquiries", "logs"]
updated: "2026-11-07"
---

AI phone reception lets a shop answer calls while the owner is working. Twilio sends the call to gemihub, gemihub connects the audio to Gemini Live, and the assistant uses only the published shop settings. The model never decides availability, prices, payment rules or stock.

# Requirements and routing

- The owner enables phone reception, stores the Twilio number in E.164 form and optionally sets the hours when the AI answers.
- For this integration, set the shop's `twilioNumber` to `+18312167968`. This is a per-shop setting, not a shared default for every shop.
- The Twilio number's Voice webhook is `https://<host>/phone/incoming`.
- The webhook checks the Twilio signature with `TWILIO_AUTH_TOKEN`, looks up the shop by the dialled number, and returns TwiML that streams audio to `/phone/stream`.
- The stream URL path is `/phone/stream/<shop>/<CallSid>/<caller>/<HMAC>` with each component URL-encoded; it has no query parameters, as required by [Twilio Stream](https://www.twilio.com/docs/voice/twiml/stream). The WebSocket upgrade rejects unknown shops, disabled reception, out-of-hours calls, invalid tokens and missing signing secrets. No public fallback signing key is used.
- `PHONE_STREAM_ORIGIN` overrides the public origin used for the stream (defaults to `APP_ORIGIN`). `PHONE_LIVE_MODEL` overrides `VERTEX_LIVE_MODEL` for phone calls.

# Call flow

1. Withheld, anonymous and public/unknown caller IDs are ended with a short request to call back with caller ID. They never reach Gemini and the outcome is logged.
2. The AI answers with the shop name and asks whether the call is about a booking or another matter.
3. For a booking it asks the menu, calls `check_availability`, offers real slots, asks the name, reads the caller ID back for confirmation, repeats the menu, time and cash payment, then calls `create_booking`.
4. For a simple question it answers from the published record only: opening hours, address, menus and prices. Anything else becomes an inquiry: the AI asks the name and reason, calls `create_inquiry`, and tells the caller the shop will call back.
5. If listening fails, the AI stops guessing, takes a name and reason and creates an inquiry.

The caller never has to say their number. The caller ID becomes the callback number and the CRM key.

# Booking rules

- Cash bookings use the same availability as online bookings, pending payments, connected calendars and bookings awaiting a replacement, so a slot cannot be sold twice.
- With PayPal prepayment enabled, phone cash bookings are limited to today's remaining slots in the shop time zone. Later dates are online prepayment only.
- Without prepayment, phone bookings may use any date inside the booking window, because online bookings are unpaid too.
- Today's transfer listings may be offered to cash callers. The original booking is cancelled with the same refund promised to an online replacement; the cash booking is created for that slot at the listing price. If the cash customer does not arrive, the refund amount shown to the owner is a shop loss. The owner notification states that amount.
- A caller is matched by normalized caller ID to existing email-based or phone-only CRM records. Japanese domestic mobile and landline numbers and US national numbers match their E.164 forms. Existing customer keys are retained; a new number creates a phone-only customer, so no email is sent.
- Booking retries use the Gemini tool-call ID within the Twilio call. A separate booking action can create a new reservation after cancellation; retrying a cancelled action cannot report success.
- Cancelling a cash booking by phone is allowed from the same number and has no refund. Online booking changes and cancellations stay online; the AI explains that instead of changing them.

# Inquiries and notifications

Accepted inquiries use the existing inquiry store and kanban as `source: "phone"`, with the caller's name, callback number, reason and subject. The full call transcript is appended as phone interactions of at most 5,000 characters each, preserving their order. The owner receives an email intent for new bookings, inquiries and unresolved calls. Cash booking prices in notifications use the shop's major currency units (for example, $55.00 for a $55 booking).

# Transcripts and operation logs

Every connected call writes one `kind: "phone"` operation log with the Twilio `CallSid`, outcome (`booking`, `inquiry`, `cancelled`, `answered`, `blocked`, `closed` or `error`), duration and transcript (up to 10,000 characters). Logs are searchable with `search_shop_logs` and the owner settings screen lists the last seven days. A call ID or booking/inquiry ID can be used as a reference filter.

If a caller disconnects during a tool operation, the server waits for that operation before finalizing the call log and inquiry transcript. For a normal farewell, it waits for the final Gemini turn and [Twilio's playback mark acknowledgement](https://www.twilio.com/docs/voice/media-streams/websocket-messages#mark-message) before closing the stream. The 15-minute call limit still applies.

# Owner settings

`GET/POST /api/shops/:id/phone/settings` reads and writes `enabled`, `twilioNumber`, optional `hours` (`start`, `end`, `weekdays`), `cashBookings` and optional `greeting`. `GET /api/shops/:id/phone/calls` returns the recent call logs. These settings live on the shop, separate from the published `spec.md`, so changing them does not require a new publication.
