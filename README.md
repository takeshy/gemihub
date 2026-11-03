# gemihub

[English](README.md) · [日本語](README_ja.md)

Terraform deployment on the shared kiokuflow VM: [infra/README.md](infra/README.md).

**Build your shop's booking system in your own words.**

A booking system for small independent businesses. Sign in with Google, describe your shop, review a proposal, publish a private preview, and then open it to customers. Generative AI uses **Gemini on Vertex AI**, authenticated by the server.

## Screenshots

**Edit a screen:** mark an area and ask AI to change it, then review the result before applying it.

![Owner screen editor with an area marked for an AI change request](public/manual/en/22-pen.jpg)

**Customer booking:** choose a service, staff preference, and available time.

![Customer booking screen with services, staff selection, available times, and booking details](public/manual/en/07-reservation.jpg)

Screenshots use fictional sample data. [Read the illustrated manual](#illustrated-manual) for the full workflow.

## Try locally

Requires Node.js 24 or later.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

Open http://localhost:3000 and choose **Try the salon demo**. Select **English** at the top, or open http://localhost:3000/?lang=en. Japanese remains the default; `?lang=ja` selects Japanese.

1. Describe the pages and features you want. Review the proposed screens and choose **Publish private preview**. Staff and prices can be decided later.
2. Only the creator, signed in with the same Google account, can view the private preview.
3. Update staff, services, prices, and hours in their dedicated settings. Edit designs per screen; discuss overall features in **Build your shop with AI**.
4. Open **Review screens and publish**, check each screen, and choose **Publish publicly**. Log in as a demo customer to try booking, My page, cancellation, and inquiries.
5. Return to management to see bookings and inquiries. The demo supports form-based edits; natural-language changes require Vertex AI.

The demo runs real approval, authorization, publication, and availability logic with in-memory data. Restarting clears it. It does not save to Google or send email. Demo login is unavailable in production.

For development, run `npm run dev` for the watched server and `npm run dev:web` in another terminal for Vite at http://localhost:5173. Set `APP_ORIGIN` and the Google OAuth redirect URI to that origin when using Vite.

## gemihub.net and Google OAuth

The public service name is **gemihub**. The management origin is `https://gemihub.net`; register **`https://gemihub.net/auth/google/callback`** as the Google OAuth web client's authorized redirect URI. Set the authorized JavaScript origin to `https://gemihub.net` when configuring the client. The same callback serves owners, customers, staff, and Calendar connections.

For a domain-hosted server, copy `.env.production.example` to `.env.production`, configure the server's Google Client ID/Secret, persistent session key, Firestore and Vertex settings, then run `npm run build` and `npm run start:production`. The server derives the callback from `APP_ORIGIN`. Local development retains `http://localhost:3000` in `.env.example`; add its callback separately if using Google login locally.

Terraform defaults now use `gemihub.net` and `shops.gemihub.net`. The latter is the storefront suffix and requires wildcard DNS/TLS; shop-path URLs remain available on the management origin. Supply the actual DNS project and managed-zone name before applying. Setting the OAuth callback in Google does not create DNS records, install TLS, or deploy the server.

The separate application in `../gemihub` is now **kiokuflow**. This service uses `gemihub` for its database, browser storage, cookies, language header, export data and domain-verification prefix. Shared-VM registration and new cloud resources use `gemihub-web`, because kiokuflow still retains the legacy runtime ID `gemihub`. The checkout directory remains `omaiweb`. See [the naming notes](docs/branding.md).

## Languages

The landing page, management screens, customer pages, manual, validation and API messages, generated documents, and AI instructions support Japanese and English. The language switcher is available before login, on public shop pages, and in offline Drive previews. The selection is stored in this browser and a same-site cookie; explicit `lang` links also work when storage is unavailable.

- Requests carry `X-Gemihub-Language`. Server language state is isolated per request, so concurrent English and Japanese users do not affect each other.
- AI-generated explanations and new content follow the selected language. Existing shop text, articles, customer names, notes, and other saved content remain as entered; changing the interface does not translate or rewrite them.
- Prices remain **Japanese yen** and booking times remain **Asia/Tokyo** in both languages. Date inputs stay `YYYY/MM/DD`, or `YYYY/MM/DD HH:mm`, while readable dates and weekdays use the selected language. ISO API values and ledger columns are unchanged.
- Voice recognition uses `ja-JP` or `en-US`. The default end phrase is **以上** in Japanese and **send** in English. Each language has its own saved end-phrase preference.
- Translation keys use the Japanese source text in `tr(...)`; English translations are in [shared/en.json](shared/en.json). See [docs/i18n.md](docs/i18n.md) for maintenance and verification.

## Service overview

`/lp` introduces gemihub: bookings, customer notes, news, the publication workflow, PayPal prepayment/refunds, and owner-controlled data storage. Use `/lp?lang=en` for English. The start buttons open the existing onboarding entry page in the selected language.

The server renders the content and search/sharing metadata without login or database access. Feature selectors and FAQs work in the browser. A Service overview story is also available under Operations → Get started in Storybook.

After `npm run build`, run `npm run check:lp` to check both languages, desktop/mobile layouts, keyboard interaction and JavaScript-disabled rendering. Screenshots are saved in `tmp/lp/`. Set `CHROMIUM` to a browser executable if needed.

## Storybook

```sh
npm run storybook
```

Open http://localhost:6005. Use the globe toolbar to select **English** or **日本語**. The explorer shows English/Japanese labels while existing story IDs and index metadata remain stable. Story iframes also accept `&globals=locale:en` or `&lang=en`.

Stories use the real `src/App.tsx` with isolated API mocks. They cover setup and publication, private previews, screen editing and conflicts, settings, bookings, inquiries and replies, staff Google login and Calendar, customer registration and My page, articles, private customer notes and image galleries, the image library, service and staff photos, additional data, domains, retry states, voice input, pen editing, and the manual. Resize the browser to check mobile layouts.

No app server, `.env`, Google credentials, Vertex AI, live API calls, or real email are needed. External navigation is intercepted and reloading a story resets its mock data. Google authentication, model output, and delivery require separate testing in the app.

```sh
npm run build-storybook
npm run check:storybook
```

The checker opens every story in Japanese and English on localhost and an insecure HTTP hostname, checks loading and browser errors, and rejects live API requests. Playwright Chromium is required; set `CHROMIUM` to override its executable. Screen fingerprints use SHA-256 without requiring Web Crypto.

## Illustrated manual

Open **Help**, or `/manual`, before or after login. English instructions use English screenshots. Images can be enlarged; the table of contents links to each chapter. All captured data is fictional.

The manual covers setup, settings, private preview and publication, customer registration and booking, My page, management, inquiries, staff login, CRM notes and attachments, images, additional data, articles, AI consultation and changes, pen editing, specifications, domains, and retries.

To regenerate Japanese screenshots, start Storybook and run:

```sh
npx playwright install chromium
npm run capture:manual
```

Use `npm run capture:manual:en` for English screenshots. `STORYBOOK_URL` selects the server; `CHROMIUM` overrides Chromium. Japanese assets live in `public/manual/`, English assets in `public/manual/en/`. Both are included in the app and static Storybook build.

## Connect Google and Vertex AI

Configure `.env`:

| Variable | Purpose |
| --- | --- |
| `DEMO_MODE=false` | Use real Google integrations |
| `SESSION_SECRET` | Persistent random secret, at least 32 characters; also encrypts refresh tokens |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `VERTEX_MODEL` | Vertex project, location, and an available Gemini model ID |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Web application OAuth credentials |
| `APP_ORIGIN` | Management origin; register `${APP_ORIGIN}/auth/google/callback` as the redirect URI |

Enable Vertex AI, Google Drive, Google Sheets, Gmail, and Google Calendar APIs in your project. Provide Application Default Credentials with Vertex access: locally, `gcloud auth application-default login`; in production, use the service account or equivalent runtime identity. Model availability depends on the project and location; the proposal model has no silent fallback. Integration follows the [Google Gen AI SDK](https://googleapis.github.io/js-genai/release_docs/classes/client.GoogleGenAI.html).

Owner OAuth requests `openid email profile drive.file gmail.send`; customer OAuth requests only `openid email profile`. Staff OAuth requests `openid email profile calendar.freebusy`, using the same callback. Staff never receive the owner's Drive or Gmail token. If the consent screen is in testing, register all participating accounts as test users. Complete Google's required production consent configuration separately.

### Staff login and Calendar

Under **Staff and schedules**, the owner registers one Google email per staff member and shares the staff login URL. The staff member signs in and grants Calendar access in one OAuth flow. Unregistered, revoked, removed, or mismatched accounts cannot manage the shop. Each staff member can have one account per shop, and each account maps to one staff member.

Calendar uses the primary calendar's FreeBusy intervals only. It never reads event titles or descriptions, stores busy intervals, creates calendar events, or shares calendar tokens. Busy times join opening hours, shifts, service duration, existing bookings, closures, and deadlines when calculating slots. Check again immediately before confirmation. A named staff selection never silently switches to someone else; no preference can use another qualified available person.

A Calendar error pauses affected availability and confirmation with HTTP 503 rather than assuming the person is free. Staff can reconnect or disconnect under My calendar. Revoking membership also removes their connection. Calendar edits and booking confirmation cannot be made atomic: a Google event created after the final check can still conflict.

## Building and editing your shop

AI proposes validated configuration, never arbitrary executable code. Fixed templates enforce authentication, customer isolation, and safe rendering. Initial setup asks only for the business type and desired features, adapting to answers. Before preparing screens, it asks whether there is anything else to add and waits for a reply. Staff, prices, and hours can be entered later.

**Build your shop with AI** is one chat for edits and new pages; the AI asks what you want. Questions go to **Consult & ask**. Change and page proposals require review and an explicit on-screen action before applying. New pages include a new ID, address, content, and customer navigation label while preserving unrelated settings.

Current settings and a collapsed, newest-first change history appear together. The data and permissions diagram shows ledger-to-screen mappings, storage locations, and access rules, with spreadsheet and Drive links for connected shops. There is no separate history-management workflow for the owner.

### Local screen editor

**Try and edit screens** opens customer screens using isolated practice data. The persistent sidebar tree groups shared components, booking/shop screens, articles, and additional pages. Staff start in booking management instead.

- Edit a page body, title, address, image, or layout; edit headers and footers independently. Header/footer visibility is a temporary preview option and is not saved to production.
- Practice bookings, cancellations, and inquiries stay in the local mock and never reach Sheets, Gmail, or Calendar. Sample names, bookings, and articles can be edited too.
- Drafts are stored in this browser per account and shop. They survive reloads but not clearing site data, and are not shared across devices. Storage failures are visible and block applying changes.
- Screens load their content automatically when opened. Metadata is checked initially, every 30 seconds, and on window focus. Only changed screens are marked.
- Pen editing captures the current screen. Circle an area, add text or voice instructions, let Gemini identify candidates, then confirm the target. Changes stay local until reviewed and applied. External images may appear as placeholders.
- Applying changes shows the difference and publishes only the selected page or shared component. It preserves other page drafts, sample data, and live prices/schedules. Shared settings must be applied before a new shop's additional page.
- Concurrent changes show local and remote read-only previews. Choose either side or ask AI for a merge using only baseline/local/remote content for that screen. Review a merge before adopting it locally; publication remains separate. Up to 20 pre-resolution backups allow restoration.
- Operation IDs and plan IDs are stored around publication requests. Retries resume the same operation without duplicate publication/history. An in-progress operation must finish or have its server status checked before returning to editing.

Live services/prices, staff/schedules, hours/rules, booking status, inquiry replies, and articles use their dedicated management menus. Save applies them directly, including during a private preview. New services start inactive until staff assignments are set. Stale writes preserve edits and stop rather than overwriting concurrent changes.

### Voice and pen input

Voice is browser speech-to-text, not bidirectional AI audio. HTTPS or localhost, microphone permission, and a supported browser are required. Press Voice input to open the dialog and begin recognition; edit the draft while speaking if needed. A final trailing end phrase removes itself and sends chat text. Interim matches and mentions in the middle do not send. Blank end phrases disable automatic completion. Stopping, silence, errors, Escape, and closing preserve unsent drafts. Recognition stops on send or navigation.

For image and pen requests, the end phrase only finishes input; generation or changes require a separate screen action. No audio recordings are stored. The demo requires Vertex AI for actual natural-language interpretation; Storybook simulates it.

## Customers, bookings, and inquiries

Customers verify their Google email and register a per-shop name, date of birth, and gender (including Prefer not to say). Birth dates cannot be in the future. Membership is required before booking or submitting inquiries; names are filled automatically and editable through My page. Profile data is visible only to the customer and authorized operators.

Before login, customers see About the shop, with registration and login below the header. After login, My page is the leftmost and initial destination, showing recent news and the customer's own bookings. Customers choose a service, no staff preference or a qualified staff member, and a slot. Changing service/staff/date clears the previous slot. Cancellation deadlines are enforced. Optional booking messages (up to 2,000 characters) appear in the owner's list, customer timeline, personal history, and notification email.

CRM aggregates existing bookings and inquiries by normalized email without requiring extra owner data entry. It supports name/email search, sorting, and all-time, past week/month/three months/six months/year, or custom start periods. Boundaries use Japan midnight; calendar subtraction clamps to month end. Visits count only ended active bookings, excluding no-shows and cancellations. Spending uses historical booking prices, never current menu prices. Names use the latest record across all dates; future bookings stay visible.

Customer details show basic information, current bookings, expandable past bookings/cancellations, inquiry handling, and a timeline filtered by notes/bookings/inquiries. Notes and files are private to operators. Attach up to five files per note, 5 MB each and 10 MB total. PNG/JPEG/GIF/WebP display inline; other files download. Rename files before upload or while editing; names are synchronized to Drive and the ledger. Retry IDs prevent duplicate notes/files; stale edits are rejected. Deleted notes retain their records.

The customer's image gallery shows active image attachments from all dates, newest first, without note text or email. Click to enlarge, use previous/next or arrow keys, and close with Escape. Names can be edited here too. Private CRM files never enter the general image library, AI references, or public pages.

Inquiries are newest first, with resolved items hidden by default. Filter by text, reply status, and inclusive received-date bounds in Japan time. Click an item to handle it on customer details. Replies go to the verified email, not an editable address. Resolution (`in_progress` / `completed`) is independent of whether a reply exists; replying never marks an inquiry resolved automatically. Legacy `open` and `replied` records remain readable. Reply/status writes detect conflicts and deduplicate retries; failed email delivery uses the normal queue.

## Images

The owner-only image library supports uploads, search, type filters, renaming, removal, and AI generation. Uploads support PNG/JPEG/GIF/WebP up to 5 MB each. Images need no destination at upload time; current usage appears in the list. Referenced images cannot be removed. Removing an unused library record leaves the Drive file intact.

Select **Request in text** or **Request by voice**, then provide instructions, name, aspect ratio, and an optional reference image. Review transcribed voice instructions before generating. After Generate and review, choose Looks good or request more changes using the result as a reference. Results are saved in the library, not automatically applied to pages.

`GEMINI_IMAGE_MODEL` defaults to `gemini-nano-banana-2.1` in this checkout. Image location resolves through `VERTEX_IMAGE_LOCATION`, `GOOGLE_CLOUD_LOCATION`, then `global`. The server uses ADC and `GOOGLE_CLOUD_PROJECT`. Storybook alone returns simulated sample images. See [Vertex image generation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation).

Generation has its own lock and request ID, so it does not block ordinary bookings/settings. Results survive interrupted Drive uploads without another paid model call. Temporary data uses small Firestore chunks, removed after saving or expired after 24 hours. Failed or uncertain generation is not silently repeated; check the library and explicitly start a new request.

AI requests accept up to 15 original images, 75 MB total. Above 12 MB, only model-bound copies are optimized to JPEG, up to 2048 px and 768 KB per image; originals and public images remain unchanged. IDs are preserved, and proposals cannot introduce unselected new image IDs.

Service and staff photo controls offer Upload image or Choose an existing image. Selection alone does not publish: save the settings. The owner can manage all staff photos; staff can change only their own, using their current photo and their own uploads. `staff.imageId` and `menus.imageId` are trailing columns; legacy staff rows remain readable. Published staff photos appear on About the shop and named-staff booking screens. Lists/pickers load on opening and refresh after changes.

Only images referenced by published headers, pages, active services, staff, or articles are publicly served. Unpublished uploads, private CRM files, and other-shop images stay inaccessible. Drive exports include referenced images.

## Blog and announcements

The owner chooses Ask AI or Write it yourself. The visual editor uses `wysimark-lite`, stores Markdown, and shows a continuous preview below. Enter title, body, category, and display date. AI generates a summary (up to 300 characters) and a lowercase slug when saving, leaving title/body intact. Existing addresses remain stable, including drafts; collisions get suffixes. Published category/date/address are fixed. Generation failure leaves input intact without publishing.

AI can read shop-specific `[[spec.md]]`, `[[history.md]]`, `[[shop.json]]`, `[[pages/slug.md]]`, `[[articles/category/date-slug.md]]`, and image paths through `read_shop_file`. Required references must be read before completion. The tool is read-only and cannot access OS files, external URLs, CRM files, or other shops. Function-call identities/signatures are preserved; retrieval is bounded to 30 calls and 15 images. Final structured generation is validated separately. Article request/reply history is private to its author.

Article images use `shop-image:ID`. Only authorized managed images render; public API and Drive HTML expose only published article references. Saving publishes immediately, even for future display dates: there is no scheduled publication. Unsaved edits stay private. Unpublishing removes lists/recent news/the article page while preserving drafts and history. Customers can read archives, dated article URLs, and the five latest posts across categories on My page.

## Storage and exports

Business records live in the owner's spreadsheet; images and files live in the owner's Drive. On first connected publication, the app creates a dedicated folder:

| Artifact | Contents |
| --- | --- |
| Booking ledger | `menus`, `staff`, `settings`, `reservations`, `inquiries`, `members`, `posts`, `pages`, `customers`, `customer_notes` |
| `spec.md`, `history.md` | Published settings/permissions and dated changes |
| `web/index.html` | Shop preview with built JS/CSS inlined; opens by double-click |
| `web/data.js` | Separately editable preview config/data in `window.__GEMIHUB_MOCK__` |
| `web/shop.json`, `web/mock.json` | Matching machine-readable export data |
| `web/parts/`, `web/pages/` | Component/page HTML, JSON, and page index |
| `admin/system.svg` | Deterministically generated shop diagram |
| `admin/index.html`, `schema.md` | Management shell and ledger schema |

Private chat records use `ai_chats` and `ai_chat_messages`. Only the signed-in author can resume them. Messages are journaled in Firestore before Sheets writes; retries restore the same rows. Pre-connection conversations migrate to private sheets after connection, then temporary copies are removed. AI can search relevant past exchanges for the same shop/account; past proposals are not treated as current facts or new requests. Users do not manage a separate history UI.

Download the folder and double-click `web/index.html`. Only `file://` with valid `data.js` uses the mock API. Practice bookings/inquiries stay in browser memory and disappear on reload; files are never rewritten. Editing data.js changes the display without editing HTML. Missing data leaves a static shop/service fallback. HTTP/HTTPS always uses the real API, even if a mock global exists. Served builds and the admin shell never get the offline data.js reference.

Masters are read from Sheets on each request; direct edits take effect. Preserve column names/order and `schema.md` types. `settings.value` and staff `menuIds`/`weekdays` contain JSON. Invalid master data blocks booking; stale publication plans must be recreated after sheet edits. Page-specific releases update only selected page rows/files while refreshing shared indexes, specs, history, and public snapshots. Removed/renamed page files move to Drive trash.

Business writes must succeed in Sheets before the app reports success. Writes use RAW values, not formulas. Booking request keys in the ledger recover successful writes even if Firestore acknowledgement fails. Do not confirm new bookings while Sheets is unavailable. Cancellations, revoked members, and deleted notes preserve rows through status changes.

Additional sheets use owner-only Data management: up to 100 unique columns and 1,000 data rows; add/search/edit rows, preserve formulas and column order, save only changed cells, reject stale edits, and reuse row identities on retry. Configure sheets/columns/formulas in Sheets itself. Entire-row deletion is not provided.

## Consult & ask: the shop assistant

The **Consult & ask** menu answers questions about the shop and turns change requests into drafts. It replaces the former "Consult" option inside Build your shop with AI, which is now a single chat for edits and new pages.

- **Research layer (read-only).** A separate LLM reads the shared system bundle in [docs/system](docs/system/index.md) (OKF v0.2, describing how gemihub works for every shop), the shop's `spec.md` and `history.md` from Drive, and the shop's records (bookings, customers, inquiries). It returns a concise answer with sources — system chapters, settings such as `rules.payment.refundTiers`, or ledger data — and says when something is not stated instead of guessing.
- **Conversation layer.** Text chat and voice have the same two tools and never answer facts from their own knowledge: `investigate` calls the research layer, and `draft_request` builds a draft request whose current state comes from research, with the requested change and fixed constraints (server-decided amounts, refund terms fixed per booking, facts read from settings). The owner edits the draft and presses **Approve and create a change plan**; the ordinary plan review, approval, publication and `history.md` entry follow. Staff can ask but not approve.
- **history.md records requests.** Each published change now records the owner's request text alongside the summary, so "why" questions can be answered. Older entries show only the summary.
- **Voice (Gemini Live API).** With `VERTEX_LIVE_MODEL` (and optionally `VERTEX_LIVE_LOCATION`, default `us-central1`), **🎙 Talk by voice** streams the microphone through the server to Live on Vertex AI. Answers are one or two spoken sentences; the assistant says a short acknowledgement while researching and lets the user lead. Spoken agreement is never approval: drafts appear on screen. Sessions end after 15 minutes. Voice needs HTTPS or localhost and microphone permission, and always uses Gemini regardless of the administrator's AI provider.

## Judge access, invitation-only sign-up, and administration

These features prepare `gemihub.net` for hackathon judging while PayPal stays in the Sandbox. See [the specification](specs/judge-access-spec.md).

| Variable | Purpose |
| --- | --- |
| `JUDGE_INVITE` | Unguessable invitation token (32+ characters). Unset disables judge access |
| `JUDGE_UNTIL` | RFC 3339 end of judge access (production: `2027-01-31T15:00:00Z`). Afterwards judges are signed out and their shops return 404 |
| `JUDGE_AI_LIMIT` | AI requests per judge (default 200) |
| `ACCESS_PASSWORD` | Invitation password required before a new Google owner creates a shop. Unset keeps open sign-up |
| `ADMIN_EMAILS` | Comma-separated Google accounts allowed to open `/admin` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_IMAGE_MODEL` | Optional OpenAI provider |

**Judge access.** `https://gemihub.net/judge/<invite>` lets judges start as a shop owner without Google. A fresh browser opens it in English. Each judge's shop is stored in the operator's demo Google Drive under `gemihub judges/<judge>/`, so storage, images and Sheets use the ordinary code path. Mail is never sent: each message is recorded and shown in the judge menu (`/judge-menu`), which also shows AI usage, the trial path and **Reset account data**. A reset moves the shop folder to the Drive trash, archives the shop, clears recorded mail and trial customers, and starts a new shop; AI usage is kept. On their own public page judges choose **Try as a customer** to book and pay with the PayPal Sandbox, then **Back to owner**. The same browser resumes the same judge; another browser starts a new one. Starting with live PayPal is refused while judge access is configured.

**Invitation-only sign-up.** "Sign in with Google" stays open, because existing owners and former note users must sign in before gemihub knows who they are. A new owner without a shop sees the invitation password screen before any shop is created; five wrong attempts within ten minutes are refused. Existing owners, former note users, customers and staff never see it.

**Administration (`/admin`).** Listed administrators connect the demo Google account (`drive.file` only; it is stored separately from their own shop token), copy the English and Japanese invitation URLs, review judges (shop, AI usage, resets, recorded mail, last use), and switch the AI provider for every shop between Vertex AI (Gemini) and OpenAI. Switching requires that provider's key and models; a connection test sends one short request. There is no silent fallback between providers. OpenAI uses the Responses API for structured output, image input and tool calls, and the Images API for generation and reference edits.

Put the invitation URL and password only in the submission form's testing instructions, never in this public README.

## Deployment and operations

Production operational state uses Firestore Native mode in `GOOGLE_CLOUD_PROJECT`; optionally set `FIRESTORE_DATABASE_ID`. Give ADC access to Firestore. `FIRESTORE_EMULATOR_HOST` supports local integration testing. `gemihub_state` holds encrypted tokens, sessions, domains/publication, plans, conversation staging, and queues, not the primary business rows. Published configuration is a serving snapshot.

`gemihub_locks` serializes availability checks and ledger writes per shop across processes. Locks are not stolen after a timeout. After a crash, an administrator must confirm the old process has stopped and inspect ledger writes before removing a lock. Direct Sheets edits do not participate in these locks; avoid adding reservations there while app bookings are running.

Persistent disk is unnecessary. Keep `SESSION_SECRET` stable. Production requires `NODE_ENV=production`, HTTPS `APP_ORIGIN`, a secret of at least 32 characters, and disabled demo mode.

Set `SITE_DOMAIN=shops.example.com` and configure wildcard DNS/TLS at the reverse proxy to serve `shop-xxxxxxxx.shops.example.com`; otherwise use `/s/shop-xxxxxxxx`. Public hosts cannot access management pages/APIs; those are served only on `APP_ORIGIN`. Preserve the original Host and Origin; forwarded headers are not trusted unconditionally.

For custom domains, register the domain in Publication settings, add the displayed `_gemihub.<domain>` TXT record, and verify ownership. Administrators must separately configure DNS routing and TLS termination. Certificate issuance/load-balancer changes are not automated. Public-host customer authentication uses management-side Google login and a short-lived, one-time, host-bound handoff ticket.

Interrupted publication records its plan and pauses bookings. Retry the approved plan to resume. Gmail delivery is at least once: losing the response after Google accepts a message may cause a duplicate email. Booking request IDs prevent duplicate bookings.

## Verification

```sh
npm test
npm run build
npm run check:i18n
npm run build-storybook
npm run check:storybook
npm run check:i18n:browser
npm run check:drive-artifacts
```

Focused browser checks are also available through `check:chat`, `check:multimodal`, `check:inquiries`, `check:images`, `check:staff-images`, and `check:publication-routing`. They use mocks where documented; they do not prove real microphone, Google OAuth, Vertex inference, Drive/Sheets writes, or email delivery.

Automated coverage includes booking/closure/deadline calculations, staff choice, approval and private-preview authorization, safe public routes, customer isolation, concurrent bookings, soft deletion, staff access, article lifecycles, stale edits, request retries, and CSRF. English-specific checks cover request isolation, translated UI/API/exports, onboarding, and offline behavior.

See [docs/spec.md](docs/spec.md) for the Japanese requirements, [docs/spec.en.md](docs/spec.en.md) for the English counterpart, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices. Real Google and Vertex connections require a separately configured account and runtime.

`npm run check:articles` checks both article creation methods, visual editing, uploads and existing-image selection, automatic preview, saving/publication, and AI reference insertion on desktop and mobile. AI output is mocked.

## PayPal Sandbox: booking payments and automatic refunds

In **Shop information**, enable **Collect full payment through PayPal when booking** in the booking rules and save. Existing unpaid bookings keep their original cancellation deadline. Free services do not require payment.

Configure these server environment variables (see `.env.example`):

```dotenv
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=<Sandbox Client ID>
PAYPAL_CLIENT_SECRET_FILE=tmp/paypal.secret
```

The secret is read from a file. You can also supply `PAYPAL_CLIENT_SECRET` through Secret Manager or a similar service. `tmp/` and `.env` are excluded from Git, Docker, and Cloud Build. Keep Sandbox and Live credentials separate, and do not change the environment or receiving account while transactions are unfinished. Configure both the client ID and secret on the server; never expose the secret in customer or owner screens. Payments go to the single PayPal account configured on the server. Per-shop merchant connections and revenue splitting are not included.

1. Sign in as a customer, choose a service and time, agree to the amount and refund policy, and approve payment with a PayPal Sandbox **buyer account**.
2. On return to the shop, the server checks the amount, currency, and booking before capturing payment. Check My page for the paid and confirmed states. Approval alone or a PENDING payment does not confirm a booking.
3. Cancelling on My page shows a refund estimate. Defaults are 100% at least 72 hours before the appointment, 50% from 24 to 72 hours before it, and 0% with less than 24 hours remaining. Boundaries use the actual appointment start time. Refund rates can be changed in settings or through a reviewed AI proposal.
4. To test a half refund, use an appointment between 24 and 72 hours away. Owner-initiated cancellation uses **Shop cancellation and full refund** in management and always refunds the full amount.

The amount and policy are fixed when the order is created and saved in the booking's `payment` column. Later changes to prices or policies do not affect that booking. Cancellation fixes the reason, timestamp, and refund amount, then issues one refund with one operation ID. Fractional yen are rounded down. No refund API call is made for a zero refund. Customers and operators can check the refund state on My page, in management, and in notification emails.

Checkout holds the time slot for 10 minutes and rechecks Calendar immediately before confirmation. After a disconnection, Firestore operation records and PayPal order queries recover progress; a ledger-write failure does not charge again. Pending refunds query the existing refund ID. On the shared VM, recovery runs every minute and continues after restarts. My page and management also provide status checks. Retries of writes with ambiguous results are limited to five hours; after that, or after a definitive error, the operation stops for review. Reconcile the PayPal transaction with the Firestore `checkout` record before resolving it, and avoid duplicate refunds. Editing a spreadsheet alone must not change the refund state.

The original 14 `reservations` columns are preserved, with a JSON `payment` column appended automatically. Firestore also stores a booking snapshot and fixed amounts, policies, and operation IDs for recovery. These records do not contain secret credentials.

Previews, Storybook, and offline Drive exports use mocks. The payment and refund stories cover consent, paid bookings, half/zero/full refunds, pending/review states, and owner actions.

API references: [PayPal Orders v2](https://developer.paypal.com/api/orders/v2/), [capture refunds](https://developer.paypal.com/api/payments/v2/captures-refund), and [idempotency](https://developer.paypal.com/api/rest/reference/idempotency/).

Verification commands: `npm test`, `npm run check:payments` (desktop/mobile interactions), `npm run check:drive-payments` (offline payment/refund practice without network requests), and `npm run check:paypal:sandbox` (create and query an uncaptured Sandbox order). Set `CHROMIUM` to use an existing browser executable.

Use `npm run check:paypal:e2e` for actual Sandbox captures and refunds. It does not run against Live. Store a Sandbox buyer account in `tmp/paypal.personal.json` as `{"email":"…","password":"…"}` to complete the normal PayPal approval in the browser. Use a Personal buyer account separate from the receiving account. Override the file with `PAYPAL_BUYER_FILE=tmp/paypal.personal.json` if needed. If the buyer has no payment method, add an official Sandbox test card. Only when no buyer file exists does the script try approval using [PayPal's official test cards](https://developer.paypal.com/sandbox-testing/card-testing); account settings may reject this path. The test captures two payments of ¥5,500, then refunds ¥2,750 for a customer cancellation and ¥5,500 for a shop cancellation. It uses a local temporary shop/ledger and the real Sandbox API, without writing to Google. If interrupted, retain `tmp/paypal-e2e-journal.json` and rerun the same command. Do not delete unfinished records: retaining operation IDs prevents duplicate charges and refunds.

If PayPal returns `REFUND_FAILED_INSUFFICIENT_FUNDS`, management shows that the refund balance is insufficient. Recovery checks every minute with the same amount and operation ID. After adding funds, operators can also retry through the refund-status action. Unfinished operations more than five hours after the first submission stop for review.

`npm run check:paypal:recovery` simulates a lost response for a completed full Sandbox refund and verifies that the app's status API retrieves the same refund ID using the same operation ID and amount. It does not create an additional charge and can run only within five hours of the first refund submission.

Google OAuth for gemihub.net reuses `projects/495062043717/secrets/google-client-id/versions/1` and `projects/495062043717/secrets/google-client-secret/versions/1`. Both enabled version numbers were checked without reading payloads. Terraform grants the service runtime access to these two secrets and exports versioned references for the shared deployer; credentials are not copied into this repository. To supply the client ID directly, set both `google_client_id_secret_ref` and `google_client_secret_ref` to null and configure the client ID and managed secret version.

## Existing note users moving to kiokuflow

This app serves `gemihub.net`, so it detects existing note users after owner Google login by reading the legacy `settings.json`. Matching users reach `/settings/migration`, which explains the move and links to `https://kiokuflow.net/settings/migration`. They authenticate there with the same Google account to copy their workspace. Tokens, settings contents and folder IDs never appear in the handoff URL or session response.

Existing note users must finish migration before creating or managing a shop. There is no pre-migration bypass. After kiokuflow verifies the copy and moves the old `settings.json` to Trash, Check migration completion verifies its absence before opening the shop workflow. Customer/staff login does not run the detector. The copy and resumable state belong to kiokuflow; this app never modifies or deletes old note files.

## License

[MIT](LICENSE) © 2026 takeshy. Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
