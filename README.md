# omaiweb

[English](README.md) · [日本語](README_ja.md)

Terraform deployment on the shared GemiHub VM: [infra/README.md](infra/README.md).

**“Oh my web” — build your shop's booking system in your own words.**

A booking system for small independent businesses. Sign in with Google, describe your shop, review a proposal, publish a private preview, and then open it to customers. Generative AI uses **Gemini on Vertex AI**, authenticated by the server.

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

## Languages

The landing page, management screens, customer pages, manual, validation and API messages, generated documents, and AI instructions support Japanese and English. The language switcher is available before login, on public shop pages, and in offline Drive previews. The selection is stored in this browser and a same-site cookie; explicit `lang` links also work when storage is unavailable.

- Requests carry `X-Omaiweb-Language`. Server language state is isolated per request, so concurrent English and Japanese users do not affect each other.
- AI-generated explanations and new content follow the selected language. Existing shop text, articles, customer names, notes, and other saved content remain as entered; changing the interface does not translate or rewrite them.
- Prices remain **Japanese yen** and booking times remain **Asia/Tokyo** in both languages. Date inputs stay `YYYY/MM/DD`, or `YYYY/MM/DD HH:mm`, while readable dates and weekdays use the selected language. ISO API values and ledger columns are unchanged.
- Voice recognition uses `ja-JP` or `en-US`. The default end phrase is **以上** in Japanese and **send** in English. Each language has its own saved end-phrase preference.
- Translation keys use the Japanese source text in `tr(...)`; English translations are in [shared/en.json](shared/en.json). See [docs/i18n.md](docs/i18n.md) for maintenance and verification.

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

**Build your shop with AI** offers Consultation, Changes, and New page. Questions do not change settings. Change and page proposals require review and an explicit on-screen action before applying. New pages include a new ID, address, content, and customer navigation label while preserving unrelated settings.

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
| `web/data.js` | Separately editable preview config/data in `window.__OMAIWEB_MOCK__` |
| `web/shop.json`, `web/mock.json` | Matching machine-readable export data |
| `web/parts/`, `web/pages/` | Component/page HTML, JSON, and page index |
| `admin/system.svg` | Deterministically generated shop diagram |
| `admin/index.html`, `schema.md` | Management shell and ledger schema |

Private chat records use `ai_chats` and `ai_chat_messages`. Only the signed-in author can resume them. Messages are journaled in Firestore before Sheets writes; retries restore the same rows. Pre-connection conversations migrate to private sheets after connection, then temporary copies are removed. AI can search relevant past exchanges for the same shop/account; past proposals are not treated as current facts or new requests. Users do not manage a separate history UI.

Download the folder and double-click `web/index.html`. Only `file://` with valid `data.js` uses the mock API. Practice bookings/inquiries stay in browser memory and disappear on reload; files are never rewritten. Editing data.js changes the display without editing HTML. Missing data leaves a static shop/service fallback. HTTP/HTTPS always uses the real API, even if a mock global exists. Served builds and the admin shell never get the offline data.js reference.

Masters are read from Sheets on each request; direct edits take effect. Preserve column names/order and `schema.md` types. `settings.value` and staff `menuIds`/`weekdays` contain JSON. Invalid master data blocks booking; stale publication plans must be recreated after sheet edits. Page-specific releases update only selected page rows/files while refreshing shared indexes, specs, history, and public snapshots. Removed/renamed page files move to Drive trash.

Business writes must succeed in Sheets before the app reports success. Writes use RAW values, not formulas. Booking request keys in the ledger recover successful writes even if Firestore acknowledgement fails. Do not confirm new bookings while Sheets is unavailable. Cancellations, revoked members, and deleted notes preserve rows through status changes.

Additional sheets use owner-only Data management: up to 100 unique columns and 1,000 data rows; add/search/edit rows, preserve formulas and column order, save only changed cells, reject stale edits, and reuse row identities on retry. Configure sheets/columns/formulas in Sheets itself. Entire-row deletion is not provided.

## Deployment and operations

Production operational state uses Firestore Native mode in `GOOGLE_CLOUD_PROJECT`; optionally set `FIRESTORE_DATABASE_ID`. Give ADC access to Firestore. `FIRESTORE_EMULATOR_HOST` supports local integration testing. `omaiweb_state` holds encrypted tokens, sessions, domains/publication, plans, conversation staging, and queues, not the primary business rows. Published configuration is a serving snapshot.

`omaiweb_locks` serializes availability checks and ledger writes per shop across processes. Locks are not stolen after a timeout. After a crash, an administrator must confirm the old process has stopped and inspect ledger writes before removing a lock. Direct Sheets edits do not participate in these locks; avoid adding reservations there while app bookings are running.

Persistent disk is unnecessary. There is no automatic migration from old SQLite data. Keep `SESSION_SECRET` stable. Production requires `NODE_ENV=production`, HTTPS `APP_ORIGIN`, a secret of at least 32 characters, and disabled demo mode.

Set `SITE_DOMAIN=shops.example.com` and configure wildcard DNS/TLS at the reverse proxy to serve `shop-xxxxxxxx.shops.example.com`; otherwise use `/s/shop-xxxxxxxx`. Public hosts cannot access management pages/APIs; those are served only on `APP_ORIGIN`. Preserve the original Host and Origin; forwarded headers are not trusted unconditionally.

For custom domains, register the domain in Publication settings, add the displayed `_omaiweb.<domain>` TXT record, and verify ownership. Administrators must separately configure DNS routing and TLS termination. Certificate issuance/load-balancer changes are not automated. Public-host customer authentication uses management-side Google login and a short-lived, one-time, host-bound handoff ticket.

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
