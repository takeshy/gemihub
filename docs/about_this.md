## Inspiration

A friend of mine is a nail artist, and the hair salon I go to is a small independent shop. Both rely on the industry's dominant booking platform: they pay a listing fee and a commission on every booking, yet they can't easily take prepayment through it. When a customer no-shows, the shop earns nothing and still pays the fee. Worse, the platform's rigid layout leaves no room to express a shop's unique style or atmosphere.

I've been on the other side, too. I once forgot an appointment, offered to pay for the missed slot, and was waved off with "don't worry about it"—leaving things awkward for both of us. The shop couldn't ask, and I couldn't pay.

**gemihub** is my answer: a booking site a small shop truly owns, built and edited in its own words. Customers prepay with PayPal when they book, and cancellations are refunded automatically under the shop's policy—so the system, not the people, handles the awkward money conversation.

## What it does

**gemihub** lets independent shop and salon owners build and run a custom booking and payment system simply by talking to AI—no configuration jargon, no developer needed.

- Build and update a shop's booking site through conversation and red-pen edits.
- Turn plain-language cancellation rules into owner-approved policies for PayPal prepayments and refunds.
- Manage bookings and customer records, with previews and approval before changes go live.

### For the owner
- **Set up by conversation**: Describe your business by text or voice, or paste existing notes and URLs. The AI asks follow-up questions, fills in services, staff, hours, and rules, and generates a custom HTML/CSS theme from your logo and reference photos.
- **Point and ask (Red-Pen editing)**: Circle any part of a preview screen with a red pen and say *"make this bigger"* or *"change this wording."* The AI updates only that section and shows a diff preview before anything goes live.
- **Plain-language payment rules**: Say *"full refund up to 3 days before, half the day before, nothing after."* The AI converts this into a structured policy (`72h → 100%`, `24h → 50%`, `0h → 0%`) and clarifies ambiguity (*"the day before" = 24 hours prior*).
- **Consult & ask**: Ask questions like *"What is our current refund policy?"* via chat or live voice (**Gemini Live**). A research AI answers with citations from the shop's spec, change history, and live bookings—and admits when something isn't defined instead of guessing.

### PayPal at the core of every booking
AI turns the owner's plain-language cancellation rules into a structured policy for approval. The server saves the approved policy with each booking and uses it to calculate and execute PayPal refunds.

- **Prepayment at booking**: Powered by **PayPal Orders v2** (`create → buyer approval → capture`). Time slots are held during checkout, and the server verifies order ID, currency, and amount before confirming.
- **Automatic, policy-based refunds**: Uses the **PayPal Refunds API**. The refund policy is snapshotted at booking time so later rule changes never affect paid bookings. Shop-initiated cancellations always refund 100%.
- **Built for real money**: Every state transition is persisted before calling PayPal, using `PayPal-Request-Id` idempotency keys and a background reconciler to recover interrupted captures or pending refunds without double-charging.
- **Prepayment for no-shows**: When prepayment is enabled, customers pay the full booking amount upfront. Recording a no-show does not trigger a refund or an additional charge.

### For customers and daily operations
- **Seamless booking**: Availability is calculated from business hours, staff shifts, service durations, add-ons, and **Google Calendar** busy times. Customers sign in via Google or passwordless email links.
- **Built-in CRM & Workspace integration**: Owners manage bookings, inquiries, and customer histories, with confirmation emails sent directly from their own **Gmail**. Full **Japanese & English** UI with **JPY & USD** support.

## How we built it

**gemihub** is a TypeScript monorepo sharing domain logic and **Zod** schemas between a **Node.js 24** server and a **React 19 + Vite** frontend.

### PayPal integration (server-side, no SDK lock-in)
- **Direct REST API integration**: OAuth2 client credentials, Orders v2, Payments v2 Refunds, and status lookups tested against the PayPal Sandbox.
- **Idempotent state machine**: Every checkout is tracked in Firestore (`creating → awaiting_approval → capturing → captured → confirmed`). Lost capture responses never free a slot or charge twice, escalating to manual review before PayPal's 6-hour idempotency window expires.
- **Deterministic refunds & E2E tests**: Refund amounts are calculated by a pure server function (`refundQuote()`) and retried by a per-minute background job. Playwright E2E tests run real Sandbox buyer approvals, captures, cancellations, and crash-recovery replays.

### AI layer
- **Configurable AI providers**: A shared LLM layer (`server/llm.ts`) supports **Vertex AI (Gemini)** and **OpenAI** for text, image input (including red-pen annotated screenshots), tool calling, and image generation. Administrators select the provider.
- **Live voice**: **Gemini Live** provides real-time voice conversations over WebSockets.
- **Strict safety boundaries**: The AI never writes data or moves money directly. It returns Zod-validated JSON scoped strictly to the owner's target (e.g., circling the header can only modify the header).
- **Sanitized HTML/CSS & AI review**: Generated themes are parsed with `parse5` and `PostCSS` against a strict allowlist (no scripts, iframes, or external URLs) and checked by a secondary reviewer AI with up to 3 auto-repair attempts.
- **Grounded research agent**: Read-only tool calling inspects system docs, `spec.md`, `history.md`, and live records to answer owner questions with cited sources.

### Google Cloud & Workspace
- **Cloud Firestore** stores business data and distributed locks to prevent concurrent payment processing.
- **Google Workspace integration**: **Google Drive** uses the `drive.file` scope for app-created or user-authorized files. **Gmail** sends notification emails, and **Google Calendar** provides busy-time checks through separate permissions.
- **Terraform & Cloud Build** automate deployment across Firestore, Secret Manager, and Artifact Registry.
- **Quality & Judge mode**: ~60 unit/integration test suites, dozens of Playwright checks, full **Storybook** coverage, an in-memory demo mode, and an isolated **Judge Access Mode** with dedicated AI quotas and no Google login required.

## Challenges we ran into

Building a system that non-technical salon owners can configure purely through conversation required bridging the gap between casual human requests and strict software logic:

- **People point, they don't specify**: Owners don't say *"update the hero section padding"*—they point and say *"fix this."* We built the red-pen tool to pass the screenshot, annotations, and DOM structure to the AI, while enforcing server-side scoping so edits never bleed into other sections.
- **Everyday language is ambiguous, but money must be exact**: *"The day before"* could mean the previous calendar day or 24 hours prior. We designed the AI to translate casual phrasing into exact hour/percentage tiers, state its interpretation clearly for approval, and leave all payment execution strictly to deterministic server code.
- **Non-technical users don't know what to ask for**: Instead of blank forms, the AI interviews the owner, imports data from existing URLs/notes, and cites real shop records when answering questions.
- **Earning trust**: Every AI action follows a strict **propose → preview → approve** workflow, logged in a plain-language change history.

## Accomplishments that we're proud of

- **A rock-solid backend with a freely editable AI storefront**: Payments, idempotency, crash recovery, and scheduling run on deterministic, thoroughly tested server code, while the storefront design remains freely customizable via chat, voice, or red pen.
- **Portable data and storefront exports**:
  - All generated HTML/CSS, images, specs, and histories live in the owner's own **Google Drive**.
  - All business records (bookings, customers, inquiries) export cleanly as JSON or CSV.
  - The exported offline site (`index.html + data.js`) opens by double-clicking—no server required to browse it.
  - Online booking and payments still require the gemihub backend and its connected services (PayPal, Google).
- **AI that acts like a reliable partner**: It asks when unsure, cites its sources, previews diffs, and never acts without approval.

## What we learned

**AI-generated designs break easily, so they must be effortless to verify.** While building gemihub with AI coding tools, we noticed that tweaking one screen often broke spacing or mobile layouts on another. We solved this for ourselves by cataloging every screen in **Storybook** with isolated mock data in both Japanese and English.

We quickly realized shop owners face the exact same risk when redesigning their site with AI—so we built the same safety net directly into the product:
- **Storefront screen catalog**: All pages (Booking, About, My Page, Contact, blog, custom pages, shared header/footer) appear side-by-side as live thumbnails so owners can spot layout issues at a glance.
- **Visual version history**: Owners can step back and forward through previous design versions to see exactly what changed, and return to an earlier one if needed.

**The takeaway**: When AI does the building, making results easy to see and verify matters just as much as generation quality.

## What's next for gemihub

- **More business types**: Expand beyond salons and studios to restaurants and cafés with table/party-size booking, course menus, and prepaid PayPal reservations.
- **Plain-language analytics**: Turn storefront access logs into actionable AI insights—highlighting popular services, booking drop-off points, and peak days.
- **Open to external AI agents**: Provide an **MCP server** and agent-friendly APIs so external AI assistants can update content, check availability, and process PayPal bookings under the same *propose → preview → approve* safety rules.

