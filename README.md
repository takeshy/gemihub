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
- **Circle on screen with a pen:** Draw a circle around any part of a preview screen and ask by text or voice to adjust text, layout, or styling—just like pointing at a screen with a designer.
- **Consult by voice or chat:** Ask the shop assistant questions like "What is our current refund policy?" or discuss rule changes via live voice (Gemini Live) or chat to prepare a change request.
- **Request photos and blog posts in plain words:** Ask AI to generate custom images for services and pages, or draft blog posts and announcements.

### 2. Bookings, Payments, and Staff Sync
- **Smart availability calculation:** Automatically computes open slots from business hours, holidays, staff shifts, and service durations (with or without staff preference).
- **Google Calendar integration:** Staff members can connect their Google Calendar (FreeBusy) to prevent double bookings.
- **PayPal prepayment & automated refunds:** Accept PayPal payments at booking time and automatically calculate refunds upon cancellation based on your shop's policy.

### 3. Daily Operations & CRM
- **Booking & inquiry management:** Track daily reservations by staff or date, reply to customer inquiries via email, and track resolution status.
- **Customer records (CRM):** Automatically aggregate visit counts and spending by customer, and attach private operator notes and photos.
- **Bilingual interface:** Switch between Japanese and English across management screens, customer pages, and the illustrated manual.

---

## How It Works

```
[Owner / Staff / Customer]
         │
         │ (Voice, chat, or pen-marked screen captures)
         ▼
   [ gemihub Server ] ── (Intent understanding, proposals, images) ──► [ Vertex AI (Gemini) ]
     │            │
     │            └── (Sessions, locks, operational state) ──────────► [ Cloud Firestore ]
     │
     └── (Ledgers, posts, images, specs, change history) ────────────► [ Owner's Google Sheets / Drive ]
```

- **Multimodal proposals for pages, articles, and settings—with server-enforced booking & payment logic:**
  Gemini on Vertex AI understands natural conversation, live voice, and pen-marked screenshots to draft page structures, Markdown copy, layouts, images, and shop settings. Meanwhile, authentication, access control, availability calculation, and payment amounts are strictly enforced by the server.
- **Source-backed answers and a Propose → Preview → Approve workflow:**
  In **Consult & ask**, a dedicated research LLM checks the system docs, the shop's `spec.md`, `history.md`, and live ledger records to answer with sources—explicitly stating when something is not defined instead of guessing. Change requests only go live after the owner previews the diff and approves on screen, recording the request in `history.md`.
- **Owner-controlled data storage:**
  Business data (menus, staff, reservations, customers, inquiries, articles) lives in the owner's **Google Sheets**, while images, generated specs (`spec.md`), change history (`history.md`), and offline HTML exports live in the owner's **Google Drive**.

---

## Getting Started

Requires Node.js 24 or later.

### 1. Try Locally (Demo Mode)

You can run the full salon demo in memory without any Google Cloud or OAuth credentials:

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

Open http://localhost:3000 and click **Try the salon demo** (use http://localhost:3000/?lang=en for English).

- For development with hot reload, run `npm run dev` (server) and `npm run dev:web` (Vite at http://localhost:5173) in separate terminals.
- To browse all screens with isolated mock data, run `npm run storybook` (http://localhost:6005).

### 2. Connect Google and Vertex AI

To use real AI generation and Google Sheets/Drive storage, enable the following APIs in your Google Cloud project and configure Application Default Credentials (`gcloud auth application-default login`):

- Vertex AI API / Cloud Firestore API
- Google Drive API / Google Sheets API / Gmail API / Google Calendar API

Update `.env` (see `.env.example` for all options):

| Variable | Purpose |
| --- | --- |
| `DEMO_MODE=false` | Disable demo mode and use real Google / AI integrations |
| `SESSION_SECRET` | Random secret (32+ characters) used for sessions and token encryption |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI location (e.g., `us-central1`) |
| `VERTEX_MODEL` | Gemini model ID on Vertex AI |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Web application OAuth credentials (redirect URI: `${APP_ORIGIN}/auth/google/callback`) |
| `APP_ORIGIN` | Management origin (e.g., `http://localhost:3000` locally) |

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
