## Explain how your project meets the main technology requirement.
* Please name each PayPal tool and AI tool (model or AI service) you used and what it does in your project. Requirement: Your project must integrate the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform of your choice.

PayPal (Sandbox)

PayPal REST API (OAuth 2.0): authenticates the server with the Sandbox app’s client ID and secret.
Orders API v2 (create, approve, capture): customers prepay for a booking with PayPal. The server checks the amount before confirming the booking.
Payments API v2 (refund, refund status): when a booking is cancelled, the customer is refunded automatically according to the shop’s refund policy. For eligible cancellations, gemihub automatically offers the appointment again at a discount. A new customer pays through Orders v2, and after capture the same amount is refunded to the original customer through Payments v2. If nobody books by the deadline, the originally quoted refund is settled.
Orders API v2 (order lookup), Payments API v2 (capture and refund lookup) and Transaction Search API (Reporting): read-only tools for the AI in Consult & ask and for a background check. The AI looks up the shop's own orders, captures, refunds and transactions (up to 31 days) to answer questions such as "Did the $49.50 refund go through?", and the hourly check compares the booking ledger with PayPal to flag stuck refunds, unconfirmed captures, mismatched states and unsold discounted slots.
All PayPal transactions in the demo run in the PayPal Sandbox with Sandbox business and buyer accounts.

AI

Google Vertex AI (Gemini) and OpenAI API: administrator-selectable providers for the setup interview, screenshot understanding, page and theme generation, tool-based research, image generation, drafting payment settings from plain-language instructions, and explaining and summarizing PayPal payment states. A separate review pass checks AI-generated themes. Gemini is the default provider; the judge demo currently uses Gemini 3.8 Flash.
Gemini Live API: real-time voice conversations with the shop assistant.

How they work together
The AI turns the owner’s words into a structured refund policy for the owner to approve. The server applies the approved policy to calculate refund amounts and processes charges and refunds through PayPal.
Consult & ask also reads live PayPal data through read-only PayPal tools. The AI explains what it found, states any difference between the booking ledger and PayPal, and cites the PayPal record. A background check flags payments that need attention, the AI summarizes them, and the server attaches a fix chosen by fixed rules (retry a refund, re-sync a state, complete a manual review, or close an unsold discounted slot). The owner approves on screen; the server re-checks the booking with PayPal and executes it with the same idempotent PayPal requests. The AI has no tool that writes to PayPal and never decides an amount.

## Is your project new, or did it exist before Oct 1, 2026 (9:15 am PT)?

Existing

## If it existed before, explain what already existed and what you built or changed during the submission period.

gemihub was inspired by hubwork, a website-building feature in a personal AI workspace I developed earlier. That workspace was previously called gemihub and continues separately as kiokuflow. I had registered the gemihub trademark, so I decided to use the name for this new product.

The earlier hubwork used conversation to create web pages, with backend behavior also driven by workflows built with AI. Building a site therefore involved reviewing Mermaid workflows.

For the current gemihub, I redesigned the approach so beginners without programming experience could use it. Booking, payments, and access control run on fixed, deterministic backend code, removing the complexity of designing backend workflows. Owners can freely build and customize their storefront through conversation and on-screen annotations.

During the submission period, I implemented PayPal prepayment at booking, automatic policy-based refunds, discounted rebooking after eligible cancellations with a larger refund when someone else books, an invitation-based judge demo mode, a voice-enabled assistant grounded in the shop’s own documents and records, AI-assisted PayPal operations (read-only PayPal lookups in the assistant, stuck-payment alerts with AI summaries, and owner-approved fixes), a CRM, and design version history with one-click rollback.


## Which additional sponsor tool(s) did you use for this project?

* Reminder: Usage of a Paypal tool and an AI tool is required for all projects. Using the listed sponsors are optional.

None

## How would you rate your overall experience integrating PayPal?

9

## Overall experience rating: Please share why or provide additional feedback.

The PayPal REST APIs were easy to integrate directly without an SDK. Orders v2 (create → approve → capture) and the Refunds API fit our booking flow well, the PayPal-Request-Id header made safe retries possible, and the Sandbox let us test the full payment and refund cycle end to end.

Two things could be improved: (1) Sandbox accounts were confusing at first, because it was easy to mix up the business (merchant) account and the personal (buyer) account. (2) More comprehensive Japanese-language documentation for the REST APIs would make it easier for Japanese developers to get started.

## Which AI tools have you leveraged while working on this project?

In the product:

Google Vertex AI (Gemini) and OpenAI API: administrator-selectable providers for the setup interview, screenshot understanding, page and theme generation, tool-based research, image generation, drafting payment settings from plain-language instructions, and explaining and summarizing PayPal payment states. A separate review pass checks AI-generated themes. Gemini is the default provider; the judge demo currently uses Gemini 3.8 Flash.
Gemini Live API: real-time voice conversations with the shop assistant.

During development:

OpenAI Codex and Claude Code: AI coding agents used heavily for implementation, tests and documentation
Google Antigravity: organizing and refining the project documentation
Grok, Muse and dots: consulted as sounding boards for ideas and design decisions; we asked each for its opinion and compared their answers

