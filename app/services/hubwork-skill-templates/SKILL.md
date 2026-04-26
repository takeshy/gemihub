---
name: webpage-builder
description: Use when building or editing the user's webpage / website — static HTML pages, magic-link login pages, protected pages, workflow-based JSON APIs (web/api/*.yaml), publishing blog posts or announcements, wiring sheet/calendar/gmail data into pages, setting up sign-in, building contact/booking forms, or operating the admin side of an existing site. Triggering keywords include web/, gemihub.*, requireAuth, sheet-read/sheet-write, "公開する" / "サイトに追加" / "Webページ作成". Lean toward using this skill whenever the user wants to put something on their site or expose data as a JSON endpoint — even if they don't name a file under web/.
---

```skill-capabilities
workflows:
  - path: workflows/create-article.yaml
    description: Publish a Drive note as a dated article under web/<folder>/<pubDate>-<note-slug>.html (where folder is typically "blogs" or "announcements"), regenerate that folder's /index archive page, and refresh the homepage "recent articles" marker block (which aggregates the 5 newest items across blogs and announcements). Collect folder, notePath, pubDate, and postTitle from the user before invoking.
    inputVariables: [folder, notePath, pubDate, postTitle]
```

{{RESPONSE_LANGUAGE_INSTRUCTION}}

## Overview

You build static HTML pages and YAML workflow APIs that are served on the user's custom domain. The platform has its own client-side helper (`/__gemihub/api.js`) and workflow runtime — standard web patterns (raw `fetch`, form `action`, JS frameworks like Alpine/Vue/React) DO NOT WORK here.

## ⛔ The Iron Law

**NO FILE-WRITING TOOL CALL — `create_drive_file`, `update_drive_file`, `migrate_spreadsheet_schema`, `run_skill_workflow` — UNTIL THE USER HAS APPROVED A PLAN POSTED IN CHAT.**

Even when the request seems trivial. Even when you "just want to confirm the layout works". The Plan goes in the chat as text. Then you wait. Then the user says OK / 進めて / go ahead. Then you write.

## When to Use / NOT to Use

**Use when:** the user wants to add or edit anything under `web/`, build a login or protected page, expose a sheet/calendar/gmail data source as a JSON endpoint, publish a blog post or announcement, or generate API mocks for the IDE preview.

**Do NOT use when:** the user is editing a Drive-level workflow under `workflows/` (those run via `run_skill_workflow`, not served as HTTP), asking about the GemiHub IDE itself, or working with files outside `web/`.

## First Step Every Conversation

Read `web/__gemihub/spec.md` with `read_drive_file` to learn what already exists. Skip if absent.

## Core Pattern: Before / After

| ❌ DOES NOT WORK on this platform | ✅ Correct pattern |
|---|---|
| `<form action="/api/login" method="post">` | `gemihub.auth.login("accounts", email)` in JS |
| `await fetch("/api/tickets")` | `await gemihub.get("tickets/list")` |
| `await fetch("/api/save", { method: "POST", body: ... })` | `await gemihub.post("tickets/save", body)` |
| Alpine.js / Vue / React for reactivity | Plain JS with `gemihub.*` |
| Reading session cookies in JS | `await gemihub.auth.me("accounts")` |
| `<input type="password">` on login | Magic-link only — email input + "Send Login Link" |

Every HTML page that touches data or auth MUST include `<script src="/__gemihub/api.js"></script>`.

## Quick Reference

**Auth (`accounts` is the default account type):**

| Call | Purpose |
|---|---|
| `gemihub.auth.login(type, email, redirect?)` | Send magic link. NO form action, NO fetch. |
| `await gemihub.auth.require(type, "/login/...")` | Guard a page. Returns user or redirects. |
| `await gemihub.auth.me(type)` | Get user, returns `null` if not logged in. |
| `await gemihub.auth.logout(type)` | Destroy session. NO fetch. |

**Data:**

| Call | Maps to |
|---|---|
| `await gemihub.get("path", { qkey: v })` | `GET /__gemihub/api/path?qkey=v` |
| `await gemihub.post("path", { ... })` | `POST /__gemihub/api/path` (JSON body) |

**Workflow caller-input variables (NEVER use bare `{{query.x}}` / `{{body.x}}`):**

| Variable | Source |
|---|---|
| `{{request.method}}` | `"GET"` or `"POST"` |
| `{{request.query.X}}` | URL query parameter |
| `{{request.body.X}}` | POST JSON body field |
| `{{request.params.X}}` | `[X]` URL pattern capture |
| `{{auth.email}}` | Authenticated email (when `requireAuth` set) |
| `{{auth.<column>}}` | Any non-email column on the identity sheet row (blank cells → `""`) |
| `{{auth.<dataKey>}}` | Advanced: account `data:` source key (JSON string, dot access) |

**Valid workflow node types:** `sheet-read`, `sheet-write`, `sheet-update`, `sheet-delete`, `gmail-send`, `calendar-list`, `calendar-create`, `set`, `variable`, `if`, `json`, `http`, `script`. NEVER `steps:`, `action:`, `params:`, `readSheet`, or any other invented syntax.

**For full API surface, request shape, account-type config, and node-type details:** read `references/api-reference.md`.

**Before writing OR debugging any `web/api/*.yaml`, call `get_workflow_spec()` with no arguments** for the authoritative spec. Do NOT rely on memory.

## Required Flow

For every build request, in order — do NOT skip ahead even when the request seems clear:

1. **Clarify** — ambiguous fields, sheet name, auth vs public, layout? Ask in a short bulleted list. Don't guess.
2. **Plan** — post the Plan in chat (see "Planning Guidelines"). NO tool calls yet.
3. **Wait for approval** — STOP after posting. Wait for "OK" / "進めて" / "go ahead" / revisions.
4. **Implement** — copy the matching template from `references/page-patterns.md` VERBATIM, replace only the placeholders, save with `create_drive_file` / `update_drive_file`. One file at a time.
5. **Verify** — `read_drive_file` EVERY saved file and check against the Pre-Save & Verification Checklist below. Re-save anything that fails.

## ⚠️ Red Flags / Rationalisations

If you catch yourself thinking any of these, STOP — the counter-rule is load-bearing.

| Tempting thought | Counter-rule |
|---|---|
| "The plan is obvious, I'll skip approval and just write." | Iron Law. STOP. |
| "Bare `{{query.x}}` / `{{body.x}}` should work." | Resolves to `""` and the next node breaks. Always `request.query.x` / `request.body.x`. |
| "I'll add `:json` to `__response` to be safe." | `{{var}}` already JSON-serialises. `:json` doubles the escaping → invalid JSON. `__response` is always `{{var}}`. |
| "I'll use `{{sys.uuid}}` / `{{now}}` / `{{request.body.datetime}}` directly in `gmail-send`." | No `sys.*` helpers exist. UUIDs, timestamps, and human-readable dates are produced by a `script` node and referenced via `{{<saveTo>.field}}`. Unknown placeholders end up in sheets/emails verbatim. |
| "`data:` as a YAML map is cleaner than the JSON string." | The handler `JSON.parse`s the value. A YAML map crashes at runtime. `data:` is always a single-quoted JSON string literal: `data: '[{"id":"{{prepared.id}}"}]'`. |
| "User-derived `{{...}}` inside a JSON literal is fine without `:json`." | A single `"` in the value breaks `JSON.parse`. ALL user-derived values inside JSON string literals (`sheet-write` / `sheet-update` / `sheet-delete` `data:`, `sheet-read` filters, `http` body) MUST be `"{{var:json}}"`. Bare `"{{var}}"` is only safe for engine-generated primitives (UUIDs, ISO timestamps from `new Date().toISOString()`). |
| "I'll use Alpine.js / Vue / React for reactivity." | Plain JS with the `gemihub.*` API. Frameworks break on this platform. |
| "I'll add an email field to the protected form." | The user is already authenticated. Use `(await gemihub.auth.me(type)).email` in JS or `{{auth.email}}` in workflows. |
| "Calendar event has `evt.start.dateTime`." | That's the raw Google Calendar shape. Our API flattens it. Use `new Date(evt.start)` directly. |
| "`requireAuth` will limit which rows the user sees." | It only checks login. ALWAYS filter `sheet-read` by `{{auth.email}}` for user-specific data. |
| "I'll guard the register page with `gemihub.auth.require()`." | Register pages are UNAUTHENTICATED — the user has no session yet. `require()` redirects to /login and blanks the page. Use plain form → `gemihub.post("register", body)`; copy the Register Page Template from `references/page-patterns.md`. |
| "I'll put the admin page under `web/admin/` — one folder is simpler." | Puts the admin API on the public domain. The serving layer only exposes `web/`, so admin pages belong at `admin/*.html` + `admin/api/*.yaml`. |
| "I'll add `trigger.requireAuth: admin` to the admin workflow." | No `admin` account type exists — admins are the Drive owner, authenticated by the IDE. Adding `requireAuth` breaks the workflow (no `admins` identity sheet to match against). Omit `requireAuth` entirely on `admin/api/*.yaml`. |
| "I'll use `{{auth.email}}` to record who cancelled the booking." | Admin workflows don't have `auth.*`. Use `{{session.email}}` (injected by the IDE admin preview) for `cancelled_by`, `reply_by`, etc. |
| "I'll `sheet-delete` the cancelled booking." | Soft-delete only — `sheet-update` sets `status: "cancelled"` and records `cancelled_at` / `cancelled_by`. Hard delete loses the audit trail and can't distinguish a cancellation from a no-show. |
| "I'll expose customer bookings to admin via `{{auth.meetings}}` / `data:` config." | `data:` returns only the logged-in user's own rows — useless for admin (who needs every row). Use `sheet-read` with no filter in `admin/api/*.yaml`. |
| "I'll add `trigger.requireAuth` to the contact form so only members can ask." | A contact form's whole point is accepting questions from people without an account. Leave it public (no `requireAuth`). |
| "I'll add `trigger.honeypotField` / `trigger.idempotencyKeyField` to the contact form." | Those trigger options are checked only for `application/x-www-form-urlencoded` / `multipart/form-data` submissions. A contact form that posts via `gemihub.post()` sends JSON, so those checks never run. Implement bot-defense (honeypot) and dedup (submissionId) as workflow nodes instead — see the **API Workflow Template (Public Contact Form)** in `references/page-patterns.md`. |

## Spreadsheet & Schema

A spreadsheet **webpage_builder** is auto-created with an **accounts** sheet (`email`, `name`, `created_at`, `logined_at`). Account type is fixed to **accounts**, identity column `email`.

`web/__gemihub/schema.md` is the source of truth for sheets and columns. Format:

```markdown
## sheet_name
- column1: type (e.g. "sample value")
- column2: type (e.g. "sample value")
```

`migrate_spreadsheet_schema` extracts only the column name (before `:`) when creating sheets.

**Adding a new sheet or column:**
1. `read_drive_file` `web/__gemihub/schema.md`, edit, save with `update_drive_file`.
2. Migration runs **automatically** as a side effect of saving — the response from `update_drive_file`/`create_drive_file` includes a `schemaMigration` field with `created` / `updated` / `unchanged` lists. Inspect that field to confirm the new sheets/columns landed before any `sheet-write` to them. If `schemaMigration.error` is set, retry with `migrate_spreadsheet_schema` after fixing the issue (or pass the file content again via `update_drive_file`).
3. `migrate_spreadsheet_schema` is still available for explicit retries / dry runs, but you do **not** need to call it after a normal `update_drive_file` save.

**NEVER guess column names.** Call `get_spreadsheet_schema` first to read the exact case-sensitive names (formats like `contact-email` are common).

## Article Publishing

The skill ships one workflow `create-article` that turns a Drive note into a styled HTML page.

| `folder` input | File path | URL | Archive |
|---|---|---|---|
| `blogs` | `web/blogs/<pubDate>-<noteSlug>.html` | `/blogs/<pubDate>-<noteSlug>` | `/blogs/index` |
| `announcements` | `web/announcements/<pubDate>-<noteSlug>.html` | `/announcements/<pubDate>-<noteSlug>` | `/announcements/index` |

On every run the workflow also regenerates `web/<folder>/index.html` and refreshes the homepage's `<!-- recent-articles:start -->` … `<!-- recent-articles:end -->` block (5 newest aggregated across `blogs` + `announcements` only).

**When to invoke:** "ブログ" / "blog" → `folder: "blogs"`. "お知らせ" / "announcement" → `folder: "announcements"`.

**Inputs (all four MUST be collected BEFORE calling the workflow — interactive prompts are skipped in headless mode):**
- `folder` — typically `blogs` or `announcements`. Other folder names work but will not appear on the homepage.
- `notePath` — full Drive path (e.g. `notes/2026-q2-release.md`). Default to active file if open, else ask.
- `pubDate` — `YYYY-MM-DD`, default today.
- `postTitle` — default to note basename, ask to confirm.

The standard Plan → Approval flow still applies. After collecting inputs, post a short plan listing target paths (e.g. "Create `web/blogs/2026-04-23-release-notes.html`, update `web/blogs/index.html` and the homepage's recent-articles block") and wait for approval. `run_skill_workflow` is BLOCKED until the user approves. Do NOT hand-write article HTML — the workflow's meta tags drive index regeneration.

**Prerequisite:** `web/index.html` must already exist. The workflow only touches the `recent-articles` marker block — it leaves your nav and the rest of the page alone. For new sites that will use articles, pre-place the marker pair to control layout, and include nav links only for the archives the site actually uses.

**Updating an article:** edit the HTML directly OR re-run `create-article` with the same `folder` + `pubDate` (and the updated title) — the workflow regenerates the matching path and refreshes every listing.

## What You Build

- **HTML pages** — `web/about.html` → `/about`
- **Workflow APIs** — `web/api/users/list.yaml` → `/__gemihub/api/users/list`
- **Login pages** — magic-link only (email input + `gemihub.auth.login`)
- **Protected pages** — `gemihub.auth.require` guard
- **Contact forms** — public `web/contact.html` + `web/api/contact.yaml` (writes to `inquiries`, notifies owner; replies are sent from the IDE admin preview, see below)
- **Admin pages (IDE-only)** — `admin/*.html` + `admin/api/*.yaml` for the Drive owner to cancel bookings, mark no-shows, reply to inquiries. See `references/admin-patterns.md`.
- **Mock files** — `web/__gemihub/auth/me.json` (auth) and `web/__gemihub/api/{path}.json` (one per endpoint) for IDE preview
- **Living docs** — `web/__gemihub/spec.md` (overview) and `web/__gemihub/history.md` (change log)
- **Articles** — via the `create-article` workflow above

## Admin Pages (IDE-only)

Operator-facing pages (cancel a booking, mark no-show, reply to an inquiry) are **not** published on the public custom domain. They live under `admin/` (not `web/admin/`) — the serving layer only exposes `web/`, so `admin/` is automatically 404 from the public web. The Drive owner opens these pages in the GemiHub IDE "admin preview" mode, which injects `{{session.email}}` (the IDE-logged-in Google account) into the workflow context in place of the public site's `{{auth.*}}`.

Key rules (full templates in `references/admin-patterns.md`):

- Put admin HTML at `admin/*.html`, admin workflows at `admin/api/*.yaml`. **Never `web/admin/...`** — that publishes the admin API to the whole internet.
- Admin workflows MUST NOT include `trigger.requireAuth` — no admin account type exists. The IDE preview is the authentication boundary.
- Use `{{session.email}}` for operator identity (e.g. `cancelled_by`). `{{auth.email}}` is undefined in admin workflows.
- Soft-delete only: cancel / no-show updates the `status` column via `sheet-update`. Never `sheet-delete` bookings or inquiries.
- Admin pages read **all** rows (no user filter) — use `sheet-read` directly. Do not use `data:` config (that's per-logged-in-user).

## Planning Guidelines

The Plan is chat text (NOT tool calls). List every file with full `web/...` paths. Use the account type name(s) from the "Configured Account Types" section; if none are listed, ask the user which account type to use before proceeding.

For any auth-enabled feature the Plan MUST cover ALL of: login page → protected page → API workflow → auth mock → API mock → spec + history update. Missing one silently breaks the flow.

If new sheets/columns are needed: include the schema.md update step. Migration runs automatically when `web/__gemihub/schema.md` is saved (the file-write response carries `schemaMigration`); inspect that response before any API workflow that uses `sheet-write` / `sheet-read`.

Example:
```
1. web/login/customer.html — Login page (magic link, no password)
2. web/dashboard.html — Protected dashboard
3. web/api/tickets/list.yaml — GET API filtered by auth.email
4. web/__gemihub/auth/me.json — Auth mock for IDE preview
5. web/__gemihub/api/tickets/list.json — API mock
6. web/__gemihub/spec.md — Site spec update
7. web/__gemihub/history.md — Change log entry
```

For admin / operator features (cancel, no-show, reply), list `admin/...` paths (NOT `web/admin/...`) and omit login / auth mocks — the IDE is the authentication boundary:

```
1. admin/bookings.html — Admin bookings list (IDE-only)
2. admin/api/bookings/list.yaml — Read all rows (no filter)
3. admin/api/bookings/status.yaml — sheet-update (cancel / no_show) + gmail-send
4. web/__gemihub/schema.md — Add status / cancelled_at / cancelled_by / cancel_reason to meetings
5. web/__gemihub/spec.md — Admin pages documented
6. web/__gemihub/history.md — Change log entry
```

## Creating Files

For EACH file in the plan:
1. **Copy the matching template from `references/page-patterns.md` VERBATIM** — do NOT generate from your own knowledge. This platform's API surface differs from generic web patterns; ad-hoc code WILL NOT WORK.
2. Replace only the placeholders (`ACCOUNT_TYPE`, `SheetName`, page-specific content).
3. Pre-save check against the checklist below.
4. Save with `create_drive_file` (new) or `update_drive_file` (existing — prefer this with the known fileId when editing). Both upsert by path with auto-detected mimeType from the extension.

## Pre-Save & Verification Checklist

Run before saving AND after `read_drive_file` of each saved file.

### All HTML pages
- [ ] Has `<script src="https://cdn.tailwindcss.com"></script>`
- [ ] Has `<script src="/__gemihub/api.js"></script>` (if page uses data or auth)
- [ ] Uses `gemihub.get()`/`gemihub.post()` for API calls — NEVER raw `fetch()`

### Login pages
- [ ] Has email input ONLY — NO password field, NO username field
- [ ] Uses `gemihub.auth.login("TYPE", email, redirect)` for magic link
- [ ] Button text says "Send Login Link" or similar — NOT "Login" or "Sign In"
- [ ] Shows success message about checking email after submission
- [ ] NO form action or fetch — uses `gemihub.auth.login()` in JS

### Register pages (self-registration)
- [ ] Has an email input AND every profile field stored in the identity sheet
- [ ] Submits via `gemihub.post("register", body)` — path is literally `register` (or `register/<sub>`)
- [ ] **NO `gemihub.auth.require()` / `gemihub.auth.me()`** — the user has no session yet; any auth check redirects to /login and blanks the page
- [ ] Matching `web/api/register.yaml` workflow exists, copied from the **API Workflow Template (Public Register)** in `references/page-patterns.md`:
  - No `trigger.requireAuth` (endpoint is public)
  - Reads the identity sheet first and short-circuits on duplicate email (silent success — never reveal whether an email is registered)
  - `sheet-write` with `:json`-escaped `{{request.body.*}}` values for every column
  - `gmail-send` welcome email AFTER the successful write
- [ ] Shows "check your inbox" success message after submission

### Protected pages
- [ ] Starts with loading state (`<div id="loading">Loading...</div>`)
- [ ] Content is hidden by default (`class="hidden"`)
- [ ] Calls `gemihub.auth.require("TYPE", "/login/TYPE")` FIRST
- [ ] Has `if (!user) return;` guard after require
- [ ] Header shows the user's email AND a logout button — do NOT strip the header from the Protected Page Template
- [ ] Content is revealed only after auth resolves

### API workflows (YAML)
- [ ] Has `trigger.requireAuth: TYPE` (if auth-protected)
- [ ] Filters data by `{{auth.email}}` (if user-specific)
- [ ] GET endpoints are read-only (no `sheet-write`, `gmail-send`)
- [ ] POST endpoints for data changes
- [ ] Sets `__response` variable for output using `value: "{{var}}"` — NOT `"{{var:json}}"`
- [ ] `sheet-write`/`sheet-update`/`sheet-delete` `data:` is a single-quoted JSON string (e.g. `data: '[{"id": "{{prepared.id}}"}]'`) — NEVER a YAML mapping
- [ ] Any user-derived placeholder embedded inside a JSON string literal uses `:json` (`"{{request.body.x:json}}"`, `"{{auth.email:json}}"`, `"{{prepared.derivedFromUser:json}}"`); bare `"{{var}}"` is only safe for engine-generated primitives (UUIDs, ISO timestamps)
- [ ] UUIDs, timestamps, and any user-facing date are produced by a `script` node and referenced via `{{<saveTo>.field}}` — `gmail-send` body and `dialog` messages use the script-formatted value (e.g. `{{prepared.displayRange}}`), NEVER the raw `{{request.body.start}}` ISO timestamp

### Contact form (public)
- [ ] Page file is `web/contact.html` (or similar under `web/`) — publicly reachable
- [ ] HTML does NOT call `gemihub.auth.require()` / `gemihub.auth.me()`
- [ ] Workflow at `web/api/contact.yaml` has NO `trigger.requireAuth`
- [ ] Honeypot + idempotency are implemented **as workflow nodes** (script checks `{{request.body._hp:json}}`; `sheet-read` + `if` rejects a duplicate `submissionId`). Do **NOT** declare `trigger.honeypotField` / `trigger.idempotencyKeyField` — those trigger options run only for form-POST requests and are silently ignored for `gemihub.post()` JSON requests.
- [ ] HTML form has `<input name="_hp" class="hidden">` and a hidden `<input name="submissionId">` populated via JS on form init (`crypto.randomUUID()` with a `Math.random` fallback)
- [ ] `inquiries` sheet schema (with `submissionId` + `reply_text` / `reply_at` / `reply_by` / `status` columns) is in `web/__gemihub/schema.md` and migrated before first write

### Admin HTML pages (`admin/*.html`)
- [ ] Path starts with `admin/`, **NOT** `web/admin/`
- [ ] Does NOT call `gemihub.auth.require("admin", ...)` / `gemihub.auth.me("admin")` — admin account type does not exist
- [ ] Does NOT reference `data:` sources (`auth.meetings` etc.)
- [ ] Escapes user-derived values (`name`, `subject`, `message`) when rendering to the DOM (`innerHTML`)
- [ ] Destructive actions (cancel, no-show, reply) go through `confirm()` before calling `gemihub.post(...)`

### Admin API workflows (`admin/api/*.yaml`)
- [ ] Path starts with `admin/api/`
- [ ] NO `trigger.requireAuth` (the IDE session cookie + same-origin check is the auth boundary)
- [ ] Operator-identity columns (`cancelled_by`, `reply_by`, etc.) use `{{session.email:json}}` — NOT `{{auth.email}}`
- [ ] Cancellation / no-show / archive uses `sheet-update` with a `status` column (NOT `sheet-delete`)
- [ ] `sheet-update` / `sheet-delete` `filter:` targets a unique key (`id`) to avoid mass-updates
- [ ] `script` validates enum values (`status` ∈ `{active, cancelled, no_show}`) before writing — reject unknown values
- [ ] **`gmail-send` runs BEFORE the `sheet-update` that records "done"**. If the email fails, the row should stay in its previous state so the operator can retry; the reverse order leaves the sheet marked "replied" / "notified" while the customer never received anything
- [ ] When a single endpoint covers both "do X" and "undo X" (cancel vs. restore), branch with an `if` so the undo path clears state-change columns (`cancelled_at` / `cancelled_by` / `cancel_reason` etc.) — don't write the operator's email into a column whose name says the row is cancelled
- [ ] Notification email bodies use `{{request.body.*}}` / `{{row[0].*}}` directly (bare `{{...}}`) — `:json` is only for JSON-string fields (`data:`, `filter:`)

### Mock files
- [ ] Auth mock at `web/__gemihub/auth/me.json` exists (if ANY page uses auth)
- [ ] API mock at `web/__gemihub/api/{path}.json` exists for each API endpoint
- [ ] Admin page mocks go at `admin/__gemihub/api/{path}.json` (same `[param]` pattern rules) — only if the IDE preview for `admin/` is still using mocks; once live exec is enabled, mocks are optional
- [ ] Mock data structure matches what the API/auth would return

### Spec / history
- [ ] `web/__gemihub/spec.md` lists all pages, API endpoints, and data sources
- [ ] `web/__gemihub/history.md` has a dated entry describing this iteration's changes

## Living Docs: spec.md and history.md

`web/__gemihub/spec.md` is the site's source of truth (overview, pages, APIs, data sources, account types). `web/__gemihub/history.md` is the change log. Both MUST be updated on every iteration.

- `read_drive_file` first. **MERGE** new entries into `spec.md`. **PREPEND** dated entries (newest first) to `history.md`. Never overwrite.
- Create from the Spec / History File Template in `references/page-patterns.md` if absent.
- Write prose in the user's conversation language. Keep paths, account-type identifiers, sheet/column names as-is.

## Authentication ≠ Authorization

`requireAuth` only checks login. Workflows MUST also filter by the authenticated user:

```yaml
# CORRECT — filters by authenticated user
- id: read
  type: sheet-read
  sheet: Tickets
  filter: '{"email": "{{auth.email}}"}'
  saveTo: result

# WRONG — returns ALL data regardless of who is logged in
- id: read
  type: sheet-read
  sheet: Tickets
  saveTo: result
```

## Sample Reference

For a complete real-world example (login + protected page + GET/POST APIs combining calendar + sheet + gmail + IDE mock data), see `references/sample-interview.md`.
