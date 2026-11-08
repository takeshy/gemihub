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

# Judge phone demo

- Set `JUDGE_PHONE_NUMBER` for the English (US) menu and `JUDGE_PHONE_NUMBER_JA` for the Japanese menu. In the shared VM configuration, use `judge_phone_number` and `judge_phone_number_ja`. Leave a number empty to hide the optional demo in that language.
- The judge registers the number they will call from, publishes their demo shop and calls the number shown in their menu. Registration belongs to the current demo shop and is removed on reset. Each caller number can belong to one judge shop at a time.
- During judge access, signed calls to the configured numbers select the demo shop by `From`. An unregistered caller can instead enter the shop's 8-digit PIN from the judge menu using the phone keypad. The [Twilio Gather](https://www.twilio.com/docs/voice/twiml/gather) callback is signature-verified; there are at most three attempts per call and ten submissions per caller in 15 minutes. Empty input counts as an attempt. The PIN grants only that call access and does not register the caller number. PIN-authenticated streams use a separate HMAC scope, bound to the shop, caller and CallSid. PINs change after a shop reset or invitation rotation. Withheld callers must enable caller ID and call again. Other numbers route by `To` as usual. The demo accepts cash test bookings and inquiries through the usual phone tools.
- When a non-judge shop has the same Twilio number configured, all callers, including registered judges, hear the keypad menu. Entering `00000000` selects that original shop; a judge PIN selects a demo shop. Zero is reserved and never issued as a judge PIN. The original shop uses its own reception settings, hours, booking rules and transcripts, and must have phone reception enabled and a published configuration. Missing or ambiguous original shops never route elsewhere. The public `00000000` choice does not consume the judge PIN guessing budget.
- A forwarded number can use the existing Twilio webhook if the forwarding service passes the original caller number to Twilio as `From`. Test the forwarding line before offering it to judges.

# Call flow

1. Withheld, anonymous and public/unknown caller IDs, including their numeric keypad spellings such as `+266696687`, are ended with a short request to call back with caller ID. They never reach Gemini and the outcome is logged.
2. The AI answers with the shop name and asks whether the call is about a booking or another matter.
3. For a booking it asks the menu, calls `check_availability`, offers real slots, asks the name and whether there is anything to pass on to the shop, repeats the menu, time, name and cash payment for the caller's agreement, then calls `create_booking`. A message becomes the booking's message and appears in the owner notification. After the booking succeeds, the AI states the confirmed date, time and menu and asks whether there is anything else before ending the call.
4. For a cash phone booking cancellation, it looks up the caller's booking, confirms the details and uses `cancel_booking` to cancel it within the shop's deadline.
5. For a simple question it answers from the published record only: opening hours, address, menus and prices. Other inquiries are recorded with the caller's name and reason using `create_inquiry`, and the AI tells the caller the shop will call back.
6. If listening fails, the AI stops guessing, takes a name and reason and creates an inquiry.

The caller never has to say their number, and the AI neither asks for it nor reads it aloud. The caller ID becomes the callback number and the CRM key.

# Booking rules

- The owner can edit separate phone conversation rules in AI phone reception settings. AI improvement uses the current draft, the owner's request, published menus and optionally one selected call from the last seven days. It returns a before/after proposal and warnings; applying it changes only the input, and saving activates it for subsequent calls. Draft generation never changes menus, bookings or settings. Owners alone can read or update these rules and use call context; stale settings saves are rejected.
- Phone rules supplement the built-in requirements. Registered availability, menu compatibility, prices and payment rules remain authoritative. The phone prompt includes each addon's effective `optionFor` IDs and exclusion group; `optionForAll` expands to all active standalone menus. Standalone services cannot be sent as addons. Both availability and booking reject invalid combinations with a structured error and current menu relationships, so the AI can ask about alternatives or record an inquiry without dropping a requested service. Availability returns the validated selection, total duration and price. Callback promises require a successfully recorded inquiry.
- Cash bookings use the same availability as online bookings, pending payments, connected calendars and bookings awaiting a replacement, so a slot cannot be sold twice.
- With PayPal prepayment enabled, phone cash bookings are limited to today's remaining slots in the shop time zone. Later dates are online prepayment only.
- Without prepayment, phone bookings may use any date inside the booking window, because online bookings are unpaid too.
- AI phone reception never sells transfer listings. A listing's replacement triggers the original holder's refund, and caller ID cannot prove who is calling, so a holder could otherwise trigger their own refund with a booking they never attend. A listed slot is not offered as a regular slot either.
- A caller is matched by normalized caller ID to CRM records. Japanese domestic mobile and landline numbers and US national numbers normalize to E.164, including forms such as `+81-090-...` and `0081...`. Phone-only customers are keyed by `tel:` plus that E.164 number, whichever way the number was entered.
- A number held by exactly one email-based customer books under that customer. Otherwise the call uses the phone-only customer for the number, created on the first booking or inquiry, so no email is sent. A call never overwrites an existing customer's name.
- `create_booking` compares `start` as an instant, so a slot still matches when the model rewrites it with an offset or as shop-local time.
- `finish_call` runs after any other tool in the same turn. It is refused once while a booking or inquiry has failed, or while slots were offered and nothing was booked, so the caller can be told; the second request ends the call. A failure that was never resolved is recorded as outcome `error` and reaches the owner.
- Booking retries use the Gemini tool-call ID within the Twilio call, and a booking with the same guest, menu, time, staff and options that is still active in the call is reused under any tool-call ID. A separate booking action can create a new reservation after cancellation; retrying a cancelled action cannot report success.
- Callers can cancel an upcoming cash phone booking from the number recorded on the booking, within the shop's cancellation window. The AI looks up matches, repeats the appointment details and asks the caller to confirm before cancelling. It releases the slot, and no refund applies. The AI directs callers with online bookings to manage them online and records phone booking changes or late cancellation requests as inquiries for the shop to review.

# Inquiries and notifications

Accepted inquiries use the existing inquiry store and kanban as `source: "phone"`, with the caller's name, callback number, reason and subject. The same name and reason within one call is one inquiry. The full call transcript is appended as phone interactions of at most 5,000 characters each. The parts share one timestamp and a `part` position, so they read from the start in both oldest-first and newest-first views. The owner receives an email for new bookings, cash cancellations, inquiries and unresolved calls. Cash cancellations also send a confirmation to the customer email stored on the booking, when present; phone-only identifiers are never mail recipients, and a repeated cancellation does not queue another notification. Mail is sent right after the event without delaying the call, and the scheduled mail run retries a failure. Cash booking prices in notifications use the shop's major currency units (for example, $55.00 for a $55 booking).

# Transcripts and operation logs

Every connected call writes one `kind: "phone"` operation log with the Twilio `CallSid`, outcome (`booking`, `inquiry`, `cancelled`, `answered`, `blocked`, `closed`, `ended` or `error`), duration and transcript (up to 10,000 characters). Logs are searchable with `search_shop_logs` and the owner settings screen lists the last seven days. A call ID or booking/inquiry ID can be used as a reference filter.

If a caller disconnects during a tool operation, the server waits for that operation before finalizing the call log and inquiry transcript. For a normal farewell, it waits for the Gemini turn completed after the `finish_call` response and [Twilio's playback mark acknowledgement](https://www.twilio.com/docs/voice/media-streams/websocket-messages#mark-message) before closing the stream. Audio generated after the mark moves the mark behind it. If either signal never arrives, the call ends five seconds after the estimated end of playback. A caller who interrupts the farewell resumes the conversation, which cancels that deadline. The 15-minute call limit still applies.

Calls use the shop's language, not a language preference from Twilio: spoken messages, the AI's instructions and tool descriptions, and owner notifications all follow it.

# Owner settings

`GET/POST /api/shops/:id/phone/settings` reads and writes `enabled`, `twilioNumber`, optional `hours` (`start`, `end`, `weekdays`; an `end` earlier than `start` crosses midnight, and the hours after midnight belong to the starting weekday), `cashBookings` and optional `greeting`. `GET /api/shops/:id/phone/calls` returns the recent call logs. These settings live on the shop, separate from the published `spec.md`, so changing them does not require a new publication.
