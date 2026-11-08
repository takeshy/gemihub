## Inspiration

A friend of mine is a nail artist, and the hair salon I visit is a small independent shop. Both rely on the industry's dominant booking platform, paying listing fees and booking commissions, but payment there is taken at the visit, not when the customer books. When a customer does not show up, the shop loses the revenue and is still charged the booking commission unless it processes the cancellation on the platform. Worse, the platform's rigid layout leaves no room to express a shop's unique style or atmosphere.

I've been on the customer's side, too. I once completely forgot an appointment, offered to pay for the missed slot, and was waved off with "don't worry about it"—leaving things awkward for both of us. The shop couldn't ask, and I couldn't pay. Sometimes, when feeling unwell, I also wished I could let someone else take my appointment. Cancelling at the last minute feels awkward. If I could cover a discount, the appointment becomes more appealing to someone else, giving the shop a better chance of filling the slot.

Ambiguous money matters strain human relationships, but when rules are executed systematically, nobody gets hurt. Just as software engineers now build applications by conversing with AI rather than writing code from scratch, shop owners should be able to create their ideal storefronts through simple conversation and feedback. By combining AI with PayPal's flexible payment infrastructure, I built **gemihub** to eliminate awkward money conversations and minimize losses for everyone when plans change.

## What it does

**gemihub** lets independent shop and salon owners build and run a custom booking and payment system simply by talking to AI—no configuration jargon or developers needed.

* **Conversational & Red-Pen Editing**: Build and update storefronts through natural dialogue or by circling areas with a red pen for targeted edits.
* **PayPal Prepayment & Automatic Refunds**: Customers pay in full through **PayPal Orders v2** when they book, so no-shows no longer cost the shop. Cancellations are refunded automatically through the **PayPal Refunds API**, using the policy saved with each booking. Every step is persisted before calling PayPal and retried with `PayPal-Request-Id` idempotency keys, so nobody is charged or refunded twice.
* **Coupons & Reminders**: Owners describe a coupon in plain words, the AI drafts the rule, and the server applies the discount before the PayPal order is created; booked customers get a reminder 24 hours before the visit.
* **Plain-Language Policy Generation**: Say *"No cancellation fee at least 24 hours before; 30% within 24 hours, 60% within 12 hours, and 100% within one hour."* The AI structures this into a concrete refund policy (`24h → 100%`, `12h → 70%`, `1h → 40%`, `0h → 0%`) for the owner to review and approve before applying it to new bookings.
* **AI That Watches the Money Without Touching It**: Ask *"Did that refund go through?"* and the research AI reads the live PayPal record and cites it. An hourly check compares the shop's ledger with PayPal and flags stuck payments or refunds; fixes are decided by fixed server rules and run only after the owner approves them on screen. The AI's PayPal access is read-only—it cannot create refunds or change amounts.
* **Research AI & Gemini Live**: Ask questions like *"What is our current refund policy?"* via chat or low-latency voice (**Gemini Live**), receiving answers grounded in shop specs and live data.
* **AI Phone Reception (Twilio + Gemini Live)**: When the owner is busy with a client, an AI receptionist answers the shop's phone. It answers questions about hours, location, menus and prices from the published shop settings, takes cash bookings from the same inventory as online bookings (same-day only when the shop requires PayPal prepayment), lets callers cancel their own cash phone bookings any time before the appointment starts, and records everything else as an inquiry for a callback. The caller ID becomes the callback number and the CRM key, so callers never have to say their number. Every call keeps a searchable transcript and outcome, and the owner is emailed about new bookings, cancellations and inquiries.
* **Centralized Customer CRM**: Keep the lifeblood of the business in one place—view past bookings, inquiries, memos, and reference photos on a single screen.
* **Traffic & Operations Visibility**: Daily and per-page traffic reports, customer activity, and searchable operational logs—so the owner can see how the shop is doing and trace anything that happened.
* **Opening Alerts**: Customers can request alerts for openings that match their preferred service and time, including discounted slots.
* **Accurate Availability Calculation**: Computes available slots dynamically from business hours, special opening days, staff shifts, service durations, add-ons, and **Google Calendar** busy times. Customers book frictionlessly via Google sign-in or magic links.

### Cancel, and recover more

**Cancel an appointment, and it is offered again at a discount. If someone books it, your refund goes up.**

1. When a customer cancels an eligible paid booking within 24 hours of the visit, the slot is immediately offered again at a discount (replacement bookings can be enabled per service).
2. When a new customer books and pays via PayPal, that payment is passed along to the original customer as an increased refund, and the booking transfers over.
3. If no one books by the displayed deadline, the request safely settles at the initial confirmed refund amount.

| Time before visit | Standard cancellation refund | New customer's price | Original customer recovers | Increase |
| --- | --- | --- | --- | --- |
| 24 h or more | 100% | Not offered (Full refund) | 100% | — |
| 24–12 h | 70% | 10% off | 90% | +20 percentage points |
| 12–1 h | 40% | 30% off | 70% | +30 percentage points |
| Under 1 h | 0% | Half price | 50% | +50 percentage points |

## How we built it

**gemihub** is a TypeScript monorepo sharing domain logic and **Zod** schemas between a **Node.js 24** server and a **React 19 + Vite** frontend.

* **PayPal Integration (Robust Server-Side Architecture)**:
    * Direct REST integration with Orders v2 and Payments v2 Refunds (tested in PayPal Sandbox).
    * Firestore-backed idempotent state machine (`creating → awaiting_approval → capturing → captured → confirmed`), preventing double-charges: interrupted captures and refunds are retried safely, and anything unresolved is escalated to manual review before PayPal's 6-hour idempotency window expires.
    * Deterministic refunds calculated by a pure server function (`refundQuote()`) with full Playwright E2E recovery tests.
* **AI Layer**:
    * Configurable LLM layer supporting both **Vertex AI (Gemini)** and **OpenAI**.
    * **Gemini Live** for real-time voice conversations over WebSockets.
    * **Twilio Media Streams** bridged to **Gemini Live** for phone reception: signed webhooks, HMAC-signed stream URLs, and server-side tools (`check_availability`, `create_booking`, `cancel_booking`, `create_inquiry`) that enforce availability, prices and cancellation deadlines—the model only converses.
    * Read-only grounded research agent with PayPal lookups scoped strictly to transaction IDs within the shop's ledger.
* **Google Cloud & Workspace**:
    * **Cloud Firestore**: Stores business records and distributed locks for payment concurrency control.
    * **Workspace Integration**: `drive.file` scope for **Google Drive** storage, **Gmail** for notifications, and **Google Calendar** for busy-time checks.
    * **Terraform & Cloud Build**: Automated infrastructure provisioning and CI/CD.

## Challenges we ran into

Small, family-run salons often operate with irregular rules: staying open late before holidays, opening exclusively on certain national holidays, or offering add-on services (like callus care) that cannot be booked on their own. gemihub supports all of these—special opening days with their own hours and staff, weekday-specific hours, and add-on services—but handling every corner case in one system can make settings overwhelmingly complex.

Instead of just offering a conversational setup interface, I built **infographic architecture diagrams directly into the dashboard** to visualize active rules and dependencies. This allows non-technical owners to understand their exact shop setup at a glance without feeling overwhelmed by configuration complexity.

## Accomplishments that we're proud of

In Japanese merchant history, there has long been a saying: *"Even if a fire breaks out, grab the customer ledger and run."* Customer records are the lifeblood of any independent business. Yet modern CRM and booking SaaS platforms often lock data away behind high subscription fees and cluttered, hard-to-export interfaces.

gemihub delivers genuine data portability:

* Generated HTML/CSS, images, specs, and change histories are saved directly in the owner's **Google Drive**.
* All operational data (bookings, customers, inquiries) exports cleanly as **JSON or CSV**.
* The exported offline site (`index.html + data.js`) **runs with mock data by simply double-clicking it**—no server required to view.
* The entire codebase is open source, eliminating vendor lock-in.

With full ownership over their data, owners can easily use modern AI tools to run independent sales analyses or migrate to self-hosted infrastructure whenever they choose.

## What we learned

**AI-generated designs break easily, so they must be effortless to verify.**
While using AI coding tools to build gemihub, I frequently ran into issues where tweaking one screen broke spacing or responsive mobile layouts on another. I solved this by cataloging every screen in **Storybook** with isolated mock data in both English and Japanese.

Realizing that salon owners face the exact same risk when redesigning their sites with AI, I integrated that same safety net directly into the product:

* **Storefront Screen Catalog**: Displays all key pages as live thumbnails side-by-side to catch layout regressions immediately.
* **Visual Version History**: Allows owners to roll back an entire design or just individual components (header, footer, specific pages) with automatic archiving of the 10 most recent versions.

## What's next for gemihub

* **Expanded Business Types**: Support restaurants and cafés with table-size configurations, course selections, and prepaid PayPal reservations.
* **Plain-Language Analytics**: Build on the traffic reports and operational logs now in place, letting AI surface actionable advice on popular services, drop-off points, and peak operating hours in plain English and Japanese.
* **External AI Agent Access**: Provide a **Model Context Protocol (MCP) server** and agent APIs, allowing external AI assistants to look up availability and handle PayPal bookings while adhering to the strict *propose → preview → approve* safety boundaries.
