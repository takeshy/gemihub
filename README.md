# gemihub

[English](README.md) · [日本語](README_ja.md)

**Build your shop's booking system in your own words.**

A booking and shop management system for small independent businesses and salons. Describe your shop to AI, review the proposed screens in a private preview, refine your settings, and open it to customers.

## Screenshots

**Edit a screen:** Circle an area with the pen tool and ask AI to change it, then preview the result before applying.

![Owner screen editor with an area marked for an AI change request](public/manual/en/22-pen.jpg)

**Customer booking:** Choose a service, staff preference, and available time slot.

![Customer booking screen with services, staff selection, available times, and booking details](public/manual/en/07-reservation.jpg)

---

## What You Can Do

### 1. Build and Customize with AI
- **Conversational setup:** Describe your business type and desired features by text or voice to generate a tailored screen proposal.
- **Visual pen editing:** Circle any part of a preview screen and ask AI to update text, layout, or styling.
- **Shop assistant (Consult & ask):** Ask questions about your shop's rules, bookings, or change history, and turn requests into change drafts (supports text and Gemini Live voice).
- **AI image generation & blog:** Generate custom images for menus and pages, and write or generate blog posts and announcements.

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
         ▼
   [ gemihub Server ] ── (AI proposals, images, voice) ──► [ Vertex AI (Gemini) ]
     │            │
     │            └── (Sessions, locks, operational state) ► [ Cloud Firestore ]
     │
     └── (Ledgers, posts, images, specs, history) ────────► [ Owner's Google Sheets / Drive ]
```

- **Validated configuration, not arbitrary code:**
  AI proposes structured, validated configuration data rather than arbitrary executable code. Fixed templates guarantee authentication boundaries and safe rendering, and changes only go live after the owner reviews the diff and approves.
- **Owner-controlled data storage:**
  Business data (menus, staff, reservations, customers, inquiries, articles) lives in the owner's **Google Sheets**, while images, generated specs (`spec.md`), change history (`history.md`), and offline HTML exports live in the owner's **Google Drive**.
- **Staged publication workflow:**
  Start with an owner-only private preview, test and edit screens locally in the browser, and publish to a subdomain or custom domain when ready.

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
