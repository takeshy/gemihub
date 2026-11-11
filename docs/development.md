# Development

[English](development.md) · [日本語](development_ja.md)

Notes for people working on gemihub. To just run the demo, see [Getting Started](../README.md#getting-started).

## Development servers

For development with hot reload, run `npm run dev` (server) and `npm run dev:web` (Vite at http://localhost:5173) in separate terminals.

## Screen-edit reviews

Screen-edit reviews require a built preview (`npm run build`) and Chromium: set `CHROMIUM` to an installed executable, or install the matching browser with `npx playwright install --with-deps chromium`. The Docker image includes Chromium and Japanese fonts. After building, `npm run check:visual-review` tests real browser captures and the reject/repair/review flow using a stub AI model. The isolated review browser uses sample data and registered shop images, has no session credentials, and blocks external network requests; unavailable external images are reported to the reviewer.

## Storybook

- To browse all screens with isolated mock data, run `npm run storybook` (http://localhost:6005).
- Inquiry kanban, manual creation and conversation history stories are under **Management → Bookings and customers → Inquiries**. After `npm run build` and `npm run build-storybook`, run `npm run check:inquiry-workflow` to validate Japanese/English desktop/mobile operations, local API persistence and the mail queue. `npm run capture:manual:inquiries` also refreshes the guide images. Delivery is replaced by a test stub; no email is sent.
- Traffic stories are under **Management → Bookings and customers → Customers** (daily traffic and activity history) and **Management → Blog posts and announcements** (article PV/unique browsers). After `npm run build-storybook`, run `npm run capture:manual:access` to refresh the Japanese/English guide images, or `npm run check:manual:access` to check period switching, all activity types, image zoom and desktop/mobile layout. The checks use isolated mocks and send no live API requests.
- Cancellation stories are under **Customer screens → Cancellations and discounted appointments** and **Management → Bookings and customers → Replacement bookings** (15 states). Cancellation, undo, payment confirmation and refund retry are simulated. After `npm run build-storybook`, run `npm run check:storybook:transfers` to check their interactions in Japanese/English and desktop/mobile widths; set `CHROMIUM` to an installed browser path if needed.

## Manual images

After building Storybook, run `npm run capture:manual:cancellations` to capture the Japanese and English cancellation guide. `npm run check:manual` checks all referenced images, translated instructions, image zoom and mobile layout. `npm run capture:manual:guides` captures the add-on service, phone customer registration and PayPal attention guides, and `npm run check:manual:guides` checks their goal links, related links and images at desktop and phone widths.

## Traffic and diagnostic logs

Traffic and diagnostic logs use the existing Firestore database. Apply the TTL policies and filtered-search/article indexes in [infra/README.md](../infra/README.md) before enabling them in production. Counts cover recorded displays; network failures and recording limits can omit visits. No BigQuery or external analytics account is required.

## Connect Google and Vertex AI

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
| `STOREFRONT_BUCKET` | Private Cloud Storage bucket for generated storefront pages (required with Firestore; the in-memory demo keeps them in memory). Deployment creates it: see [infra/README.md](../infra/README.md#generated-storefront-storage) |

For PayPal Sandbox testing, also set `PAYPAL_ENVIRONMENT=sandbox`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET_FILE`.
