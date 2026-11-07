# gemihub

[English](README.md) · [日本語](README_ja.md)

**Ask AI to build and run your shop's system the same way you would ask a person.**

A booking and shop management system for small independent businesses and salons. No technical configuration jargon required—talk through what kind of shop you want, circle an area on the screen with a pen to say "change this part," review the preview, and publish when you're ready.

## Screenshots

**Point and ask:** Circle the part of the screen you want to change, tell AI what you want, and preview the result before applying.

![Owner screen editor with an area marked for an AI change request](public/manual/en/22-pen.jpg)

**Customer booking:** Choose a service, staff preference, and available time slot.

![Customer booking screen with services, staff selection, available times, and booking details](public/manual/en/07-reservation.jpg)

---

## What You Can Do

### 1. Ask AI the Same Way You Ask a Person
- **Set up by conversation:** Describe your business type and desired features by text or voice; AI asks follow-up questions and proposes the screens your shop needs.
- **Fill settings from notes or URLs:** Use **Set up with AI** in shop, service, staff, hours, and booking-rule settings. Review the suggested values, apply them to the form, then save.
- **Circle on screen with a pen:** Draw a circle around any part of a preview screen and ask by text or voice to adjust text, layout, or styling—just like pointing at a screen with a designer.
- **Consult by voice or chat:** Ask the shop assistant questions like "What is our current refund policy?" or discuss rule changes via live voice (Gemini Live) or chat to prepare a change request.
- **Request photos and blog posts in plain words:** Ask AI to generate custom images for services and pages, or draft blog posts and announcements.

### 2. Bookings, Payments, and Staff Sync
- **Smart availability calculation:** Automatically computes open slots from business hours, holidays, staff shifts, and service durations (with or without staff preference).
- **Google Calendar integration:** Owner sign-in requests Calendar FreeBusy access alongside Drive and Gmail. No staff registration is required for the owner; their Calendar busy times are checked automatically. A shop can start with no additional staff. Other staff grant Calendar access through their staff login.
- **Add-on services:** Configure removal or care as an optional addition to selected services. Prices and durations are combined for availability, booking and payment; options in the same group are mutually exclusive.
- **Weekday opening hours:** Keep normal hours and override individual weekdays, such as closing at 19:00 normally and 21:00 on Tuesdays and Fridays.
- **PayPal prepayment & automated refunds:** Accept PayPal payments at booking time and automatically calculate refunds upon cancellation based on your shop's policy.
- **Cancellations and refunds:** Cancel, and an eligible prepaid appointment is automatically offered again at a discount. If someone books, the refund increases; before payment starts and before the deadline, the customer can undo the cancellation. New customers see discounted appointments they can book at the displayed price.
- **AI-assisted PayPal checks:** Ask **Consult & ask** questions such as "Did the $49.50 refund go through?" and the AI reads the shop's own PayPal orders, captures, refunds and transactions with read-only tools, pointing out any difference from the booking ledger. An hourly check flags stuck refunds, unconfirmed payments, mismatched states and unsold discounted slots under **Needs attention**, emails urgent items at once and the rest in a daily digest, and offers fixes chosen by the server. The owner approves each fix on screen; the server re-checks PayPal first and never refunds twice. The AI cannot write to PayPal or decide amounts.
- **Shop controls:** Enable or disable replacement bookings per service under **Settings → Services and prices** (default on). The Booking rules AI can also propose refund-rate changes for review and saving. Default refunds are 100% from 24 hours, 70% from 12 hours, 40% from one hour, then 0%. Available discounts are 10%, 30% and 50%; expired requests settle without relisting. See the illustrated steps at `/manual#guide-cancellations` in the app.

### 3. Daily Operations & CRM
- **Booking & inquiry management:** Track daily reservations by staff or date. Create inquiries manually and keep phone calls, customer messages, internal notes and email replies in one history. Switch between list and four-column kanban views; an email address is optional when creating an inquiry. Customer forms and operator records support attachments (five files, 5MB each, 10MB total), and replies can email their own attachments. Older resolved cases stay hidden until a receipt-date range is set.
- **Customer records (CRM):** Automatically aggregate visit counts and spending by customer, and attach private operator notes and photos.
- **Traffic before registration:** Open **Shop traffic** in **Customers** or **Blog posts and announcements** for daily PV/unique browsers and article-level counts over 7, 30 or 90 days. A browser counts once per shop-local day across pages. Unique browsers approximate people: other devices, private browsing and cleared storage can count separately. Signed-in owners and staff are excluded; browsers without storage contribute PV only.
- **Customer activity and log research:** At the bottom of customer details, activity appears in pages of 10 with Previous/Next controls: sign-ins, booking/My page views, payment starts, confirmations, cancellations and rebooking requests/withdrawals. Ask **Consult & ask** "How many visitors came yesterday?", "Which articles are read most?" or "Were there any errors today?" It reads the same traffic counts and the shop's own access, error and PayPal logs, with sources. Logs are retained for 90 days in Firestore. See the in-app manual at `/manual#guide-shop-traffic`, `/manual#guide-article-access` and `/manual#guide-customer-activity`.
- **Bilingual interface:** Switch between Japanese and English across management screens, customer pages, and the illustrated manual.
- **JP/US support:** Choose your shop's currency and time zone independently of the interface language. See the [language and region guide](docs/i18n.md).

---

## Cancel, and recover more

Cancel, and the appointment is offered again at a discount. If someone books it, your refund goes up. Customers see the expected refund, the larger refund if someone books, and the deadline before confirming. Another customer books through the same shop's booking page and pays with PayPal.

With the default cancellation policy:

| Time before visit | Standard cancellation refund | New customer's price | You recover | Increase |
| --- | --- | --- | --- | --- |
| 24 h or more | 100% | Not offered — full refund | 100% | — |
| 24–12 h | 70% | 10% off | 90% | +20 percentage points |
| 12–1 h | 40% | 30% off | 70% | +30 percentage points |
| Under 1 h | 0% | Half price | 50% | +50 percentage points |

The higher refund requires another customer to book and pay. If nobody books by the deadline, the expected refund shown at cancellation is settled without reducing it as time passes; the request then ends. The final offer closes 10 minutes before the visit. Customers can undo cancellation only before the deadline and before someone else starts paying.

This applies to eligible PayPal-prepaid bookings and services that allow replacement bookings. Percentages use the customer's actual payment and the policy saved with the booking; custom policies can differ. For example, a $55 booking with a $38.50 expected refund returns $49.50 if someone books at 10% off. See the [project description](docs/about_this.md#cancel-and-recover-more) for the full flow.

---

## How It Works

```
[Owner / Staff / Customer]
         │
         │ (Voice, chat, or pen-marked screen captures)
         ▼
   [ gemihub Server ] ── (Intent understanding, proposals, images) ──► [ Vertex AI (Gemini) ]
     │            │
     │            ├── (Business data, sessions, locks) ──────────► [ Cloud Firestore ]
     │            └── (Generated public storefront pages) ───────► [ Cloud Storage (private) ]
     │
     └── (Images, attachments, specs, exports) ────────────► [ Owner's Google Drive ]
```

- **Multimodal proposals for pages, articles, and settings—with server-enforced booking & payment logic:**
  Gemini on Vertex AI understands natural conversation, live voice, and pen-marked screenshots to draft page structures, Markdown copy, layouts, images, and shop settings. Meanwhile, authentication, access control, availability calculation, and payment amounts are strictly enforced by the server.
- **Theme creation and review:**
  Initial setup asks for your shop name and logo, with separate choices for blog, announcements, staff introduction, and products/services. AI builds an HTML/CSS theme from reference images, then an independent AI review checks it with up to three repair attempts. Reference-page images guide the design; explicitly requested logos and photos are displayed. Use the red pen to revise the first theme preview.
- **Source-backed answers and a Propose → Preview → Approve workflow:**
  In **Consult & ask**, a dedicated research LLM checks the system docs, the shop's `spec.md`, `history.md`, and live ledger records to answer with sources—explicitly stating when something is not defined instead of guessing. Change requests only go live after the owner previews the diff and approves on screen, recording the request in `history.md`.
- **Data storage and export:**
  Business data (settings, bookings, customers, inquiries, articles, and AI chats) lives in **Firestore**. Owners can download a JSON export or CSV tables from **Publication settings**. Images, attachments, specs, history, and offline HTML exports remain in the owner's **Google Drive**; exported records include file references, not the file bytes.
- **Public storefront as generated pages:**
  Publishing (and saving settings, designs or articles) generates the shop's home, custom pages, article archives and articles as finished HTML in Japanese and English, and stores them in a private Cloud Storage bucket. The server checks access and returns the stored page, so public content needs no JavaScript or API calls and carries search metadata and sitemaps. CSS and images are stored once per shop and cached by browsers. Booking, My page and inquiries open the app as interactive screens.

---

## Getting Started

Requires Node.js 24 or later.

### 1. Try Locally (Demo Mode)

You can try the salon demo with in-memory data and form-based editing without Google Cloud or OAuth credentials. Free-form questions, pen editing, and natural-language changes require a Vertex AI connection.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

Open http://localhost:3000 and click **Try the salon demo** (use http://localhost:3000/?lang=en for English).

- For development with hot reload, run `npm run dev` (server) and `npm run dev:web` (Vite at http://localhost:5173) in separate terminals.
- To browse all screens with isolated mock data, run `npm run storybook` (http://localhost:6005).
- Inquiry kanban, manual creation and conversation history stories are under **Management → Bookings and customers → Inquiries**. After `npm run build` and `npm run build-storybook`, run `npm run check:inquiry-workflow` to validate Japanese/English desktop/mobile operations, local API persistence and the mail queue. `npm run capture:manual:inquiries` also refreshes the guide images. Delivery is replaced by a test stub; no email is sent.
- Traffic stories are under **Management → Bookings and customers → Customers** (daily traffic and activity history) and **Management → Blog posts and announcements** (article PV/unique browsers). After `npm run build-storybook`, run `npm run capture:manual:access` to refresh the Japanese/English guide images, or `npm run check:manual:access` to check period switching, all activity types, image zoom and desktop/mobile layout. The checks use isolated mocks and send no live API requests.
- Traffic and diagnostic logs use the existing Firestore database. Apply the TTL policies and filtered-search/article indexes in [infra/README.md](infra/README.md) before enabling them in production. Counts cover recorded displays; network failures and recording limits can omit visits. No BigQuery or external analytics account is required.
- After building Storybook, run `npm run capture:manual:cancellations` to capture the Japanese and English cancellation guide. `npm run check:manual` checks all referenced images, translated instructions, image zoom and mobile layout.
- Cancellation stories are under **Customer screens → Cancellations and discounted appointments** and **Management → Bookings and customers → Replacement bookings** (15 states). Cancellation, undo, payment confirmation and refund retry are simulated. After `npm run build-storybook`, run `npm run check:storybook:transfers` to check their interactions in Japanese/English and desktop/mobile widths; set `CHROMIUM` to an installed browser path if needed.

### 2. Connect Google and Vertex AI

To use real AI generation and Firestore and Google Drive storage, enable the following APIs in your Google Cloud project and configure Application Default Credentials (`gcloud auth application-default login`):

- Vertex AI API / Cloud Firestore API
- Google Drive API / Gmail API / Google Calendar API

Update `.env` (see `.env.example` for all options):

| Variable | Purpose |
| --- | --- |
| `DEMO_MODE=false` | Disable demo mode and use real Google / AI integrations |
| `SESSION_SECRET` | Random secret (32+ characters) used for sessions and token encryption |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI location (e.g., `us-central1`) |
| `VERTEX_MODEL` | Gemini model ID on Vertex AI |
| `VERTEX_REVIEW_MODEL` | Optional first-theme review model; defaults to `VERTEX_MODEL` in a fresh context |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Web application OAuth credentials (redirect URI: `${APP_ORIGIN}/auth/google/callback`) |
| `APP_ORIGIN` | Management origin (e.g., `http://localhost:3000` locally) |
| `STOREFRONT_BUCKET` | Private Cloud Storage bucket for generated storefront pages (required with Firestore; the in-memory demo keeps them in memory). Deployment creates it: see [infra/README.md](infra/README.md#generated-storefront-storage) |

For PayPal Sandbox testing, also set `PAYPAL_ENVIRONMENT=sandbox`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET_FILE`.

---

## Documentation & Testing

- **Illustrated manual:** Open `/manual` in the app, or browse the manual story in Storybook.
- **Detailed docs:**
  - Specification: [docs/spec.en.md](docs/spec.en.md) ([日本語](docs/spec.md))
  - System reference: [docs/system/index.md](docs/system/index.md)
  - Terraform deployment: [infra/README.md](infra/README.md) ([日本語](infra/README_ja.md))
- **Run tests:** `npm test`

## License

[MIT](LICENSE) © 2026 takeshy. Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
