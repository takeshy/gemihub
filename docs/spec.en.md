# gemihub specification

[Japanese source](spec.md) · [English README](../README.md)

This is the English counterpart of the staged requirements and later refinements in `spec.md`. Later refinements take precedence over early roadmap ideas. The initial roadmap names Go, React, Google Cloud/Firestore/Drive, Storybook, and Terraform; the current repository implements its backend in TypeScript/Node.js. The final voice requirements use browser dictation, not the earlier bidirectional voice concept.

## Product and promises

Create a dedicated booking system for a small salon, beauty practice, bodywork business, private lesson studio, or similar independent shop through a conversation with its nontechnical owner. Begin with Google login, use plain language, and keep business records, credentials and operational state in Firestore, with images and page files in the owner's Drive. Owners can export records as JSON or CSV. The owner retains readable specifications and history even if the service ends.

Do not add payments, deposits, or automated no-show prevention. Record cancellations and no-shows without deleting their rows. Customers see only their own bookings. Only the owner and registered staff who completed Google login/calendar consent can operate a shop. Require on-screen review and explicit application of page/design changes; never treat speech as approval. Dedicated management saves apply live business data. Record changes in history.

Every screen must be reviewable in Storybook, including staff preference/no preference and disconnected, connected, own-calendar, and removed-staff states. Group stories by management tasks, customer registration/booking/My page/additional pages, articles, Calendar, and help. Include an illustrated manual with fictional sample data.

## Initial setup, private preview, and public publication

- When restoring a pending settings save from browser storage, always fetch the saved settings. Automatically recover a completed save when the selected section already matches. Otherwise preserve its request ID for retry and offer to discard pending changes after fetching the latest saved configuration, without writing shop data. Keep retry state if the read fails or publication is unfinished.

- In owner-enabled shops, Staff and shifts includes Owner information for the owner's name, photo, working days, hours and services. Save updates customer-facing screens. Retain the profile under staff ID `owner` without adding a second booking resource or an additional staff login; configured owner shifts and services restrict availability just like additional staff, within shop opening hours. Existing name/photo-only profiles keep automatic shop availability until working conditions are edited. Calendar access uses consent granted during owner sign-in.

- Describe what to change returns to the private conversation that produced the proposal, including after reopening the review. Preserve conversation history and in-session drafts, focus the composer, and stay on the review for retry if restoration fails. Do not restart setup or create a replacement conversation when a saved reference exists.

- Before the first private publication, show only Build your shop with AI. Hide the management sidebar, shop name, sample storefront, and screen editor, and do not fetch editor data. Return to creation on subsequent logins and direct management links until a private preview has been published. Then reveal settings and editing. Show booking management and Customers only after public publication. Data management remains disabled after public publication.
- Group Shop information, Services and prices, Staff and shifts, Image library, and Publication settings under Settings, in that order, above Try and edit screens. The group starts expanded and can be collapsed. Preserve each item's existing access permissions.
- Management menu, shop, and editor-screen choices update URL parameters (`tab`, `shop`, `screen`, and `article`) through pushState. Restore back/forward with popstate and support direct links and reload. Keep language, clear context specific to the previous menu, avoid duplicate history for repeated selections, and use replaceState when publication or permissions require an available destination. History navigation preserves local editor drafts.

- Interview by text or dictation about business type and desired features/pages; do not require staff, prices, or hours at the start. Adapt questions to known information rather than following a fixed checklist. Before preparing screens, always ask whether there is anything else to add, wait for the answer, and include any additions.
- Show a plain-language feature diagram and thumbnails for booking, about, My page, contact, blog/archive/article, announcements/archive/article, and additional pages. Page captures exclude the header and footer; show each shared part in its own preview below the pages. Mark content provisional. Explain that designs and detailed settings can be adjusted after the private preview.
- Publish a private preview directly from the review. No intermediate approved-only or initial bulk-details screen. Only the creator signed in with the same Google account can view it; other customers and staff cannot. Apply this to HTML, APIs, articles, additional pages, images, availability, and custom domains. Use private caching and noindex headers.
- Enter staff, menus/prices, hours, and rules in their dedicated menus after the private preview. Save updates that private preview without making it public.
- Each settings section offers Set up with AI using notes and up to three public reference URLs. Show current and suggested values, warnings, and fetched source links. Apply to form changes only the local fields; the existing Save action persists them. Include valid unsaved manual edits, keep unknown values and unmentioned existing rows, and add new services inactive only when both price and duration are known. AI cannot change notification email, maps, region, currency, time zone, payments, or refunds.
- Read only public HTTP/HTTPS HTML or text, without executing scripts or loading subresources. Reject local/private DNS and redirect destinations and bound time, bytes, and page count. If fetching fails, ask the owner to paste the content as notes. Validate owner and origin, reuse saved suggestions for retries with the same request ID, and release the booking lock before fetching or generating.
- Review screens and publish shows only saved/applied configuration and published articles, never uncommitted browser drafts or unapplied proposals. Practice actions use sample customers/data and do not affect real bookings or email. Start on About the shop and navigate using the actual shop menu, without a separate screen chooser.
- Publish publicly removes only the creator-viewing restriction. Server-side version and content/article fingerprints must still match the reviewed preview. Changes since review require reloading and reviewing again. Booking actions and personal history still require customer authentication.
- Provide Request changes for the current screen, behavior/features, or registered data. Route to that screen/article editor, AI Changes, or Shop information respectively; use the dedicated settings menus for services, prices, and articles. Closing the choice retains preview state. Explain the publication boundary in a sticky action bar. Repeat publication attempts must not duplicate writes or history.

## Current settings, history, and AI consultation

Show the current settings infographic, collapsed change history with count, and the AI change chat together under Build your shop with AI. Display services/prices/durations, staff/schedules/qualified services, opening hours/closures, booking/cancellation rules, staff assignment, and public pages. History opens by mouse or keyboard, newest first. Fetch on entry and show retry only on failure; no download/history-management UI.

Show data flow, record-to-menu mappings, public/private destinations, and access permissions in How data and permissions work. Put owner data-export and Drive links there. Do not duplicate a separate data/files panel or show it during initial interviewing/review.

Questions are answered in Consult & ask. Changes clarifies a requested edit. New page proposes content and customer navigation label with new IDs/addresses, preserving unrelated pages and booking configuration. Chat continues on the same screen; a proposal is opened from the chat and explicitly applied after review. Current settings/version fingerprints prevent applying stale conversation-based changes. Operators may read settings/history; owner-only actions remain owner-only.

## Reset for recording

Google-signed-in owners can reveal Reset my shop in the header even during initial setup and in production. Admin and Reset my shop are hidden initially and after reload. Ctrl+Shift+L toggles both controls while preserving their existing authorization checks; ignore repeated keydown events from holding the keys. Hiding the controls must not close a confirmation or interrupt an ongoing reset. Require a confirmation explaining that the storefront closes and settings, bookings, inquiries, customers, articles, images, and AI conversations reset. Focus Cancel first, block duplicate actions while running, and allow the same operation to resume after failure. Customers and another shop’s staff cannot reset it; judges keep their existing judge-menu reset.

Keep Google authorization, sign-in, country, and time zone; return to an empty shop’s creation screen. Archive the old shop, move only its dedicated Drive folder to the trash, and stop its storefront, custom domain, APIs, synchronization, and old staff access. The next private publication creates new storage. Remove only that shop’s local drafts. Retain PayPal payment/refund journals and reset audit records without issuing refunds. Validate owner and origin server-side. A journal and locks keyed to the old shop make retries and concurrent requests safe; a stale tab never resets a later take.

## Local screen editor and scoped releases

After private publication, the owner starts in Try and edit screens; staff start in their calendar until public publication, then booking management. Keep a persistent sidebar tree for shared components, booking/shop pages, blog/announcements, and additional pages. Use the real customer components with an isolated mock API. Practice bookings, cancellations, inquiries, sample names, and sample articles must never affect Firestore, Gmail, Calendar, or production data.

Show blog and announcement lists/articles in the tree and sample data only when those features are enabled. Refresh feature choices in cached drafts without losing local design edits. Switching between cached screens does not wait for a remote update check; periodic checks and conflict detection at publication remain active.

Show the selected screen first, without a repeated marketing heading or shared shop-details form. Collapse page/sample editors below it. Show Apply changes and Discard changes only when needed. Save local drafts per account/shop in localStorage; retain them on reload, make storage failures visible, and refuse to publish unsaved drafts. Drafts are local to the device and may be lost when site data is cleared.

Check metadata on entry, every 30 seconds, and on focus. Fetch each screen's body automatically when opened. Mark changed items only, not internal cache states. Preserve local edits on remote changes; show conflict comparison instead of overwriting. Discard only the selected screen after confirmation.

Headers and footers are separate shared components. A compact toolbar holds screen name, changed state, pen editing, and display options. Hide headers/footers in preview by default; visibility changes affect only the current preview, never saved drafts or production. Display the selected component when editing it directly. The display menu closes on outside click or Escape, not internal interaction.

Pen editing is available only inside this editor, not on published or private storefronts. Capture the screen, circle the target, accept text/dictation, identify candidates with Gemini, and require the owner to choose ambiguous targets. Supported changes include shop name, introduction, directions, page body/images/layout, and shared components. Prices, durations, staff schedules, hours, and rules use their dedicated menus. Pen results update local drafts first, without creating a publication plan or changing the live site.

Apply a selected page's addition/update/deletion or one shared component after showing before/after differences. Do not include other page drafts, sample data, or unrelated business rows. Shared settings precede additional page publication for a new shop. Compare the selected baseline with current live content; retain unrelated remote changes. Preserve other drafts and their baselines after release. Store operation/plan IDs before and after requests; retry the same operation and require completion/status confirmation before resuming editing.

## Conflict preview and merging

Show local and remote read-only previews, including edit/deletion conflicts. Allow Use local, Use remote, or an AI merge using only the selected baseline/local/remote values. Do not let AI change IDs or unrelated settings. Review before adopting the merge locally; publication remains a separate action. Recheck remote state before adoption and compare again if changed. Preserve up to 20 pre-resolution backups of local/baseline/remote and allow local restoration without affecting other screens or samples.

Scoped Drive releases update/delete only the chosen page HTML/JSON and row. Keep `pages` as one JSON record per page and `settings.pages` as a body-free index. Refresh shared indexes, spec/history, and downloadable index.html/data.js/shop.json/mock.json together. Removed or renamed page artifacts move to Drive trash; unrelated page files and menu/staff rows are untouched.

Acceptance includes practice actions, reload restoration, pen target identification and local preview, differences before publication, no premature live changes, no leaked sample data, conflict rejection, and retry recovery.

## Customer bookings

Show About the shop before login and a unified Register/Login panel below the header for new/existing customers. Explicit booking links still open booking. After login, My page is the first and leftmost destination with recent shop news and personal bookings.

Customers choose a service, a qualified staff member or No preference, then date/time. Default to no preference; there is no owner-side booking-method toggle. Named selection checks only that person and never falls back to another. No preference assigns an actually available qualified person at confirmation. Changing service/staff/date clears the slot and refreshes availability; keep no preference across service changes and reset an incompatible staff choice.

Validate opening hours, staff shifts, service duration, closures, existing active bookings, lead time, same-day policy, advance limit, and connected Calendar busy times. Recheck immediately before confirmation under the shop lock. No booking on a closed day or overlapping an occupied slot. Show assigned person, recorded price, status, booking number, and optional message. Cancellation deadlines apply; preserve cancelled/no-show records. Operators filter bookings by date/staff and can cancel or mark no-show.

Store a required nonnegative booking-time price in the shop's currency (whole JPY or USD with two decimal places); later service price changes do not alter history. Optional messages are up to 2,000 characters and appear in operator bookings, customer timeline, personal history, and notification emails.

## Customer membership and CRM

After Google verifies email, register a per-shop name, date of birth, and gender (female/male/other/prefer not to say). Date of birth must be valid and not future. Require registration before booking/inquiries in both UI and API. Prefill names; allow profile changes from My page. Bind all records to the verified email and shop. Store profiles in per-shop Firestore customer records. Expose profiles only to the customer and authorized operators, never in public configurations or public page exports. Include registration-only customers in CRM.

Aggregate existing bookings and inquiries by trimmed lowercase email, without extra owner input or AI. Names use the newest timestamp with deterministic ties. Visits count ended active reservations only, excluding cancellations, no-shows, and future bookings; spending sums recorded prices. Search by name/email and sort by visit count/last visit.

Periods are all time, one week/month/three months/six months/year, or custom start. Use midnight in the shop's time zone and calendar subtraction with month-end clamping. Apply the same lower bound to metrics and history, keeping future bookings visible. Names and note availability use all dates.

Details show name/email/birth date/gender, current reservations, expandable past bookings/cancellations, inquiry handling, and a newest-first timeline filtered by notes/bookings/inquiries. Missing profile values show Not registered. Operator-only access applies to every detail, write, and file endpoint.

Private notes may contain up to five attachments, 5 MB each, 10 MB total, stored privately in the owner's Drive. Show PNG/JPEG/GIF/WebP inline and other files as downloads. Rename before upload or while editing; synchronize ledger and Drive names. Journal upload and note IDs to retry without duplication. Reject stale note edits and preserve deletion as status. The customer's image gallery includes all active image attachments, newest first, without note text/email; support rename, zoom, previous/next, arrow keys, Escape, and close. Deleted-note images are excluded. Do not expose customer note images in the managed library, request pickers, or AI context.

## Inquiries

Use the signed-in name and read-only verified Google email. Submit and reply only to the server-verified address. Show inquiries newest first, hide resolved by default, and support Include resolved, partial name/email/message/latest-reply search, reply state, and inclusive shop-local date bounds. Legacy records without timestamps are excluded only when filtering dates.

Track resolution as `in_progress` or `completed`, reading legacy `open` as in progress and `replied` as completed. Preserve record identities. A nonempty reply determines Replied independently; replying must not resolve automatically. A phone-handled inquiry can be resolved without an email reply.

Open the corresponding inquiry on customer details. Show message, latest reply, reply form, and resolution control. Replies replace the latest reply; do not introduce a separate threaded messaging product. Deduplicate retry IDs and reject stale latest-reply/status writes with 409 while preserving input. Mail failures use the existing queue. Owner and active operators only; no customer, revoked, pending, cross-shop, or other unauthorized access.

## Staff login and Calendar

Replace separate family invitations in the UI with per-staff Google email registration under Staff and schedules. Share the staff login URL. Staff OAuth uses `openid email profile calendar.freebusy` in one flow, not Drive/Gmail permissions. Do not create an owner shop/token for staff login. Validate registered email, real staff, membership, state/cookie/PKCE/expiry, and recheck revocation at callback. Missing Calendar consent prevents completing staff login.

Keep membership records in Firestore; registration is `registered`/accepted=false and completed login is accepted. Keep `staffAccount` as authentication mapping. Legacy invitation APIs remain only for compatibility and cannot activate new-style registrations. Enforce one account per staff and one staff per account per shop. Owner revocation/replacement immediately removes operator and Calendar access. Staff see My calendar and My staff photo, with reconnect/disconnect.

Use primary-calendar FreeBusy only, following Google's busy intervals for recurring/all-day events. Free events do not block bookings. No shared/additional-calendar chooser or calendar writes. Intervals touching at their endpoints do not overlap. Never read titles/descriptions or store/publish busy intervals. Encrypt Calendar refresh tokens in Firestore separately from owner Drive/Gmail tokens; never send them to browsers or other members.

On lookup failure, pause affected availability/confirmation with 503 and a reconnect explanation, never assume availability. Disconnect/revocation deletes stored tokens and stops checks. Revoking Google's app permission is done in Google account settings. Configure Calendar API and calendar.freebusy consent using the existing OAuth client/callback. Calendar edits and final confirmation cannot be atomic.

Verify reconnect/disconnect, mismatched accounts, duplicate mappings, cross-shop isolation, busy overlap/all-day handling, no-preference reassignment, confirmation recheck, failure pauses, and revocation. Distinguish automated mocks from real Google-account testing.

## Durable records and notifications

Deduplicate booking requests even when users retry or acknowledgement is lost. The current implementation requires successful Firestore commits before confirmation; queued auxiliary work may recover later. Preserve business records, expose pending tasks/errors, retry delivery automatically and manually, and never silently lose or duplicate bookings. Confirm recovery from interrupted writes using the same request/record identities.

Text change requests propose additions such as closure days or services, require review/approval/application, update the screen and Firestore, and record dated changes plus current specifications. Booking confirmation/cancellation emails go to the customer and owner. Email transport is at least once and may duplicate delivery after a lost success response; booking records remain deduplicated.

## Storage, schemas, and offline Drive exports

Read settings, services, staff, and business records from Firestore, scoped by shop and record type. Commit business records and operational work together and preserve references and soft-delete behavior. Owners can download all data as JSON or selected record types as CSV from Publication settings. Exclude credentials, other accounts' private chats and binary files; escape spreadsheet formulas in CSV. Editing an export does not change live data. Store images, attachments, specs/history and generated pages in the owner's Drive. Keep public/customer artifacts separate from operational documents and APIs.

Downloaded `web/index.html` must open by double-click with built JS/CSS inlined. Keep rendering input in separate relative `web/data.js` defining `window.__GEMIHUB_MOCK__`, with shop config, preview customer, empty bookings/inquiries, mode=mock, and writes=discarded. Generate shop.json/mock.json from the same source. Escape embedded user strings safely. Practice actions mutate only browser memory and reset on reload; editing data.js changes the display without editing HTML.

Use the mock only for file:// plus valid data. Missing/invalid data leaves static shop/service content. HTTP/HTTPS always uses the server API regardless of a mock global. Do not add the offline data reference to the served dist/admin shell. Verify actual file:// actions, discarded writes, edited data, missing-data fallback, and HTTP guards.

Data management is disabled for now, including after public publication. Hide its menu, additional-sheet editor, links, and manual instructions. Preserve existing ledgers and additional sheets; manage bookings, customers, services, and other standard records through their dedicated screens.

## Dedicated live management

Provide Shop information (basic details, hours/closures/rules together), Services and prices, and Staff and schedules. Only the owner saves these sections, updating that section while merging unrelated live changes and preserving local edits. Validate references first. Add new services inactive and enable after staff assignments. Store save IDs and request content locally, resume interrupted saves, and never replace an in-progress operation without checking status.

Booking statuses, inquiry replies, and articles use their own management menus. Articles save per article with version checks. Additional pages have dedicated URLs/navigation and Drive configuration/HTML/spec/history. Keep practice data separate from real data.

## Voice input and private AI context

Get started opens an AI-authored first question for setup/changes/new pages. Use short adaptive questions, editable typed answers, or browser dictation. Do not persist interim speech or unsent drafts. Read AI replies on screen; do not provide bidirectional speech or save recordings.

Voice input opens a modal and starts recognition. Preserve edits and draft text in chat. Show/change the end phrase only inside the dialog. Default Japanese phrase is 以上; English is send. Store per-language preferences; blank disables it. Strip and send only a final trailing phrase, never interim results or mentions in the middle. Manual stop, silence, errors, Escape, close, and Back to draft keep unsent text. Do not overwrite manual edits with older recognition. Stop recognition on sending, navigation, and unmount. Image/pen completion stops input only; generation/application remains explicit.

Keep chats/messages private per shop/account. Only their author can list, resume, or write them; no public API or other-account export exposure. Keep the current conversation visible, without a separate user-managed history UI. Search related past messages for the same account/shop along with current settings/history, including model-requested follow-up queries. Past proposals are not current facts or automatic new requests. Client-supplied fake history cannot overwrite saved context.

Persist user messages before generation and deduplicate by request ID. Retry failed AI requests and recover the same change plan. Store conversations and messages directly in Firestore before and after publication, scoped by shop and account.

## Images and generation

Owners have a dedicated Image management navigation menu as well as image-selection dialogs in requests and editors. Only the management screen shows Generate from this image, Rename, and Remove from image management on image cards. Selection dialogs retain upload, AI generation, search, filtering, zoom, and selection without those management actions. Uploads are selected automatically in a picker; AI results are reviewed and selected with OK before confirming the selection. Management uploads/generation save to the library without claiming a selection was made. The owner-only library combines uploads, service images, and Gemini images. Upload PNG/JPEG/GIF/WebP up to 5 MB each. Show a spinner, file name, and uploading message throughout file reading and upload, including while the AI generation form is open; disable duplicate actions and provide retry after a failure. Use the same feedback for service/staff photos and article uploads. No destination is required at upload. Show usage and keep Drive files when removing unused records. Only published references are served; reject CRM/cross-shop image IDs, unselected new proposed IDs, and removal while in use.

AI text/voice/pen/page requests select up to 15 managed images, 75 MB total, passing bytes and IDs. Keep original 5 MB images in Drive. Above 12 MB total, create model-only JPEG copies up to 2048 px and 768 KB each, retaining IDs and public originals.

Generation starts with text/voice method cards, instructions, name, aspect ratio, and optional reference image. Review voice text before generating. Show the result and let the owner accept or request another iteration using it as reference. Save results to the library with prompt/model/origin, not automatically to pages. Use the server's Google SDK and ADC; only Storybook returns sample results. Store operation IDs and generated bytes to retry Drive saves without another paid call. Separate generation locks from shop bookings/settings. Chunk temporary Firestore data and expire it after 24 hours. Failed/uncertain generation requires an explicit new request after checking the library.

Service/staff photos offer upload or an existing-image picker. Publish only after Save. Owners manage all staff; each staff member can edit only their own photo and see current/self-uploaded images. Store imageId in the saved Firestore staff configuration. Staff photo writes cannot change other settings. Show published photos on About and named-staff booking. Include references in previews/Drive, record history, and block deleting in-use photos. Refresh image lists/pickers on opening and after mutations; retry controls only on failure.

## Articles, references, and publication finishing

Choose Ask AI or Write it yourself; remove the old memo-to-draft flow. Manual authoring uses wysimark-lite with headings, lists, and photos, saves Markdown, and displays a continuous preview below. Enter title/body/category/display date only. AI generates an excerpt up to 300 characters and lowercase slug at save, without rewriting title/body. Preserve existing addresses even for drafts; suffix new collisions. Published category/date/address remain fixed. Failures preserve input and do not publish. Do not hold the shop lock during model generation; recheck versions and reuse completed generation/request IDs on retry.

AI authoring supports image uploads/existing picker and [[path]] references. Resolve only shop-scoped virtual files: spec.md, history.md, shop.json, pages/slug.md, articles/category/date-slug.md, and images/id/name. Reject arbitrary OS files, external URLs, CRM files, and other shops. Require read_shop_file verification for selected references before completion. Tools are read-only, bounded to 30 calls and 15 images, and preserve function-call IDs/signatures. Optimize retrieved image copies; validate final structured output separately. Keep requests/responses in the author's private chat and reuse finished proposals on retry.

Images are stored as shop-image:ID and rendered only when authorized. Publish article images through the public API and Drive HTML only when the article is published; drafts/uploads alone do not expose them. Block removal of used images. Unsaved edits do not affect public content. Saving applies immediately; the date is display-only, not scheduling. Provide archives, dated individual pages, and five recent items. Unpublishing removes public views while preserving drafts/history.

Regenerate the deterministic settings diagram on publication and save it in Drive. Publish shops on dedicated subdomains or verified custom domains, with operator-configured DNS/TLS. Put the live-shop link under Publication settings, separate from the local editor, and hide it before publication. Complete all acceptance flows with privacy, retry, and conflict boundaries intact.

## Japanese and English acceptance requirements

Support Japanese and English across the landing page, management, customer screens, help/manual, notifications and validation, generated artifacts, and AI instructions. Provide a visible language switch and explicit lang links; preserve selection across reloads/login/offline previews without changing business data. Isolate concurrent server locales. Translate readable dates/weekdays and recognition language while retaining the shop's JPY/USD currency, local time zone, fixed date inputs, schema identifiers, and authorization.

Maintain English/Japanese README files and this English specification. Capture English manual screens, expose both languages through the Storybook toolbar, validate every story in both languages and secure/insecure browser contexts, and exercise English booking/inquiry/publication/editor and actual offline output. Record automated evidence separately from untested live Google, model, microphone, and delivery behavior.

## Shared kiokuflow VM deployment

The new infra configuration adds this app to the existing shared VM. This repository owns app service accounts, a named Firestore database, Secret Manager references, registry, Cloud Build, DNS, and certificates. Kakeratta's existing state owns the shared VM/additional backend; kiokuflow's state owns the HTTPS URL map. Do not duplicate resource ownership. Explicitly configure management/storefront domains, OAuth client ID, and available models.

Terraform does not generate or read secret values; pass version references. Runtime uses its own Docker network and gets short-lived credentials for its dedicated account through the shared broker. Container port is 8080, host port is 8105. See [infra/README.md](../infra/README.md) for bootstrap, deployment, recovery, and live-verification boundaries.

## Consult & ask

- A main menu item answers questions about the shop. A read-only research layer reads the shared system OKF bundle (`docs/system`), the shop's `spec.md` and `history.md`, and its bookings, customers and inquiries, and returns concise answers with sources. Unstated facts are reported as not stated.
- Text chat and Gemini Live voice share a conversation layer with two tools: `investigate` (research) and `draft_request`. Change requests become an editable draft with the current state from research, the requested change and fixed constraints. Only on-screen approval creates a change plan; the existing plan review, publication and history follow. Voice answers are short, the user leads, and spoken agreement is never approval.
- Published changes record the owner's request text in `history.md`.
- Build your shop with AI is one chat for every change after publication; the AI asks whether to edit or add a page.

## Judge access, invitation-only sign-up, and administration

- A shared invitation URL lets hackathon judges start as owners without Google until `JUDGE_UNTIL`. Judge shops are stored in the operator's demo Google Drive, one folder per judge, through the ordinary storage path. Judge shops never send mail; the judge menu lists each message instead, with AI usage, the trial path and a reset that archives the shop and starts again without restoring AI usage. Judges can switch to a trial customer on their own storefront and back. Each judge has a per-request AI quota.
- While `ACCESS_PASSWORD` is set, a new Google owner without a shop enters it before the first shop is created. Existing owners, former note users, customers and staff are unaffected.
- Administrators listed in `ADMIN_EMAILS` connect the demo Google account (`drive.file` and `calendar.freebusy`, stored apart from their own token), see invitation URLs and judges, and switch every shop's AI between Vertex AI (Gemini) and OpenAI. Judge owner slots use the demo account's Calendar without requiring judges to sign in to Google. Reconnect existing Drive-only grants in the admin screen. A provider without its key and models cannot be selected, and there is no silent fallback. Details: [specs/judge-access-spec.md](../specs/judge-access-spec.md).

## Service name and public domain

The management host serves a public `/lp` service overview in Japanese and English. Explain bookings, customer notes, news, the three-step setup/publication flow, PayPal prepayment and timed refunds, Firestore/Drive storage and JSON/CSV export, and FAQs. Do not invent pricing or customer metrics. Server-render content, title, description, Open Graph metadata and language-specific canonical/alternate links without session/database reads. Do not serve the LP on custom storefront hosts. Preserve the selected language when linking to onboarding and the manual. Verify desktop/mobile layouts, keyboard access, feature switching, FAQs and the Storybook state.

The public brand is gemihub. The management origin is https://gemihub.net and all Google OAuth flows use https://gemihub.net/auth/google/callback. Storefront subdomains default to shops.gemihub.net and need separate DNS/TLS setup. Production settings are provided in .env.production.example; local demo settings remain separate. Configure Google client credentials on the server only.

The separate former gemihub service is now kiokuflow. This service uses the named database gemihub, collections gemihub_state/gemihub_locks, gemihub_session/gemihub_oauth cookies, gemihub: browser keys, X-Gemihub-Language, window.__GEMIHUB_MOCK__, and TXT _gemihub. The former name was never released, so no migration or compatibility aliases are provided. Use gemihub-web for shared-VM registration and cloud-resource prefixes because kiokuflow retains the legacy runtime ID gemihub.

## JP / US country and time-zone settings

Each shop selects JP (JPY, Asia/Tokyo) or US (USD, one of seven US zones) in Shop information. Missing region is JP for compatibility. Prices use major currency units; payment/refund records use integer yen or cents and snapshot their currency. Region changes do not convert menu prices, and AI/design proposals cannot change region. Dates, availability, Calendar bounds, filters, mail and Drive exports follow the shop, including summer-time transitions. First visits use the browser's preferred language, and new-shop defaults use that language and a supported browser time zone, independently of later language choices. See [system settings](system/shop-settings.md) and [verification](i18n.md#region-verification).

## First shop theme and interview

Ask for the real shop name and whether the owner has a logo before proposing screens. Accept no logo or later; if a logo is available, ask for its attachment. Offer separate choices for shop introduction, booking, blog, announcements, inquiries, staff introduction, and products/services. Only selected article kinds appear; legacy settings without flags retain both. Staff and product introductions create custom pages without inventing booking staff or prices.

For first creation only, generate structural HTML/CSS around trusted navigation, page content, and footer slots. Reference-page images guide design; display an image itself when explicitly requested as a photo or logo. A separate reviewer context checks the request, every attachment's purpose, duplicate menus, and layout. Repair and review up to three attempts; reject incomplete reviews and persist candidates for retries. Scripts, independent forms, external CSS and unsafe URLs are rejected, CSS is scoped, and booking/payment/authentication remain application components. Optional VERTEX_REVIEW_MODEL / OPENAI_REVIEW_MODEL override the normal model for review.

After the first theme sample, use Make changes and red-pen instructions. A reviewed replacement is saved without changing business settings or publishing. Return to questions is available for correcting interview facts and restores the original private conversation.

## Editing chat and initial selections

The first-theme and regular red-pen editors keep the picture on the left and the editing conversation on the right (below on phones). The original preview is hidden while the annotation capture is shown. Replies and target confirmations stay in the chat; applying a revision retains the conversation. Initial themes update on Send; regular changes require target confirmation and remain unpublished until the existing publication action.

Read feature numbers from the actual question, including prefixed or reordered choices. Do not enable unselected blog/news features. Recover selections for existing initial plans using their own interview turn, without changing legacy published shops. Drive allocated for an image upload is file storage, not an existing shop configuration: save the first configuration in Firestore during initial publication and preserve conflict checks for published shops.

## Comparing editing versions

Back and Forward switch between editing versions for both the first theme and regular screen edits. Navigation does not call AI or publish anything; controls remain available when the chat is closed. Further edits and publication use the displayed version. Editing an older version drops its former forward history, and initial-theme branches update the saved conversation link. History belongs to the current editing session and resets on publication, reload, screen changes, or baseline updates. Navigation is disabled while an operation is running.

## Owner Calendar consent

Normal owner sign-in requests Calendar FreeBusy alongside Drive and Gmail, validates the granted scope and refresh token, and retains an encrypted Calendar credential. Denied Calendar consent creates no shop or owner credential. A legacy Drive/Gmail token alone does not establish Calendar consent. New shops start with no additional staff, with the owner bookable during shop hours and their Calendar used automatically. No owner staff registration or owner calendar status panel is shown. The last additional staff member can be deleted; existing bookings continue to block the solo owner. Adding staff later retains owner availability. Legacy explicit assignments are preserved, and another person's connection is never overwritten. Disconnect removes both the staff connection and the retained owner Calendar credential. Customer sign-in remains identity-only.

## Weekday hours and add-ons

Allow weekday start/end overrides while retaining normal hours. Closures and holidays take precedence; duplicate weekdays and invalid time ranges are rejected. Availability, owner working hours, public pages, diagrams, and AI settings use the same schedule.

Menus may be add-ons restricted to selected standalone services. A nonempty selection group permits at most one chosen option. Only eligible options appear in booking, and changing the base service clears the options. The server rejects standalone add-ons, invalid parents, duplicate options and duplicate groups. Combined prices use integer currency units; availability covers the full combined duration and requires staff qualified for every item. One booking stores the chosen IDs and immutable item names, prices and durations. PayPal consent, holds, capture, refunds, retry identities, notifications, customer history, JSON/CSV exports and offline previews retain the combined selection and total.
