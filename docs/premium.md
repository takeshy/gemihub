# Premium Plan

GemiHub's premium plan transforms it into a web app builder with Google Sheets/Gmail integration, static page hosting, scheduled workflows, and custom domain support.

## Architecture Overview

```
Load Balancer + Cloud CDN + Certificate Manager
  ├── *.gemihub.online     → Cloud Run (wildcard subdomain)
  ├── app.acme.com         → Cloud Run (custom domain)
  └── app.other.com        → Cloud Run (custom domain)

Cloud Run (single, multi-tenant)
  ├── GemiHub IDE (existing free features)
  ├── Premium API (account resolved from Host header)
  ├── Page proxy (reads from Drive, returns with Cache-Control → CDN caches)
  ├── Scheduled workflow execution endpoint
  └── isolated-vm (server-side script node execution)

Firestore
  ├── hubwork-accounts/{id}                — account info, encrypted refresh token
  ├── hubwork-accounts/{id}/scheduleIndex  — desired cron schedule index (synced from settings.json)
  ├── hubwork-accounts/{id}/scheduleRuntime/{scheduleId} — runtime state for retries / locks
  ├── hubwork-magic-tokens/{token}         — magic link tokens (auto-deleted by TTL)
  └── hubwork-form-submissions/{key}       — idempotency keys (auto-deleted by TTL)


Cloud Scheduler (single job)
  └── POST /hubwork/api/workflow/scheduled (every minute)
```

### Design Decisions

- **Single Cloud Run for all accounts** — no per-account instances. Accounts are resolved from the `Host` header via Firestore lookup (cached 60s in memory).
- **Two-tier URL** — every account gets `{accountSlug}.gemihub.online` immediately; custom domains are optional and additive. DNS-pending accounts still work via the built-in subdomain.
- **Cloud Run as Drive proxy** — pages are read from Google Drive via `_sync-meta.json` lookup and served with `Cache-Control` headers. Cloud CDN caches the responses. No Cloud Storage or Backend Buckets needed.
- **Firestore for multi-instance state** — magic link tokens must be shared across Cloud Run instances. Rate limiting stays in-memory (per-instance, acceptable for DoS mitigation).
- **AJAX-based data access** — pages are static HTML; authenticated data is fetched at runtime via `/__gemihub/auth/me` and `/__gemihub/api/*` workflow endpoints. No server-side injection.
- **settings.json as schedule source of truth** — Firestore `scheduleIndex` stores desired schedule config rebuilt on save, while `scheduleRuntime` stores mutable execution state. Scheduler reads Firestore for matching and runtime state, and reads Drive only when loading workflow YAML for actual execution.

## Plans

| Feature | Free | Lite (¥300/mo) | Pro (¥2,000/mo) |
|---------|:----:|:--------------:|:---------------:|
| Upload limit | 20MB | 5GB | 5GB |
| Gmail Send node | - | Yes | Yes |
| HTTP node CORS proxy (cross-origin fetch) | 2 req/min | 60 req/min | 60 req/min |
| PDF Generation | - | Yes | Yes |
| Migration Token / Temp Edit URL | - | Yes | Yes |
| Google Sheets CRUD nodes | - | - | Yes |
| Static Page Hosting (CDN) | - | - | Yes |
| Built-in Subdomain | - | - | Yes |
| Custom Domains (auto SSL) | - | - | Yes |
| Multi-Type Auth | - | - | Yes |
| Workflow API (`/__gemihub/api/*`) | - | - | Yes |
| Client Helper (`/__gemihub/api.js`) | - | - | Yes |
| Interactions API Chat | - | Yes | Yes |
| AI Web Builder Skill | - | - | Yes |
| Server-Side Execution | - | - | Yes |
| Scheduled Workflows | - | - | Yes |
| Admin Panel | - | - | Yes |

## Account Management

### Firestore Schema

```
hubwork-accounts/{accountId}
  email: string
  encryptedRefreshToken: string      — AES-256-GCM, key derived from SESSION_SECRET
  accountSlug: string                — unique, e.g. "acme" → acme.gemihub.online
  defaultDomain: string              — "acme.gemihub.online" (auto-generated from slug)
  customDomain?: string              — e.g. "app.acme.com"
  rootFolderName: string
  rootFolderId: string
  plan: "lite" | "pro" | "granted"   — lite = ¥300/month, pro = ¥2,000/month, granted = admin-created free
  stripeCustomerId?: string          — Stripe customer ID (set by webhook)
  stripeSubscriptionId?: string      — Stripe subscription ID (set by webhook)
  billingStatus: "active" | "past_due" | "canceled"   — granted accounts always set to "active"
  accountStatus: "enabled" | "disabled"
  domainStatus: "none" | "pending_dns" | "provisioning_cert" | "active" | "failed"
  createdAt: Timestamp

hubwork-accounts/{accountId}/scheduleIndex/{scheduleId}
  workflowPath: string               — workflow filename (e.g. "daily-report.yaml")
  cron: string                       — 5-field cron expression
  timezone: string                   — e.g. "Asia/Tokyo" (default: "UTC")
  enabled: boolean
  variables?: Record<string, string>
  retry: number                      — max retry count on failure (default: 0)
  timeoutSec: number                 — execution timeout in seconds (default: 300)
  concurrencyPolicy: "allow" | "forbid"
  missedRunPolicy: "skip" | "run-once"
  updatedAt: Timestamp
  sourceVersion: string              — hash of settings.json schedule entry for staleness check

hubwork-accounts/{accountId}/scheduleRuntime/{scheduleId}
  retryCount: number                 — current retry counter (0 = no pending retry, reset on success)
  lockedUntil?: Timestamp            — execution lock deadline for `forbid`
  lastRunAt?: Timestamp
  lastSuccessAt?: Timestamp
  lastError?: string
  updatedAt: Timestamp

hubwork-magic-tokens/{token}         — TTL policy auto-deletes expired docs
  accountId: string
  email: string
  type: string                         — account type (e.g. "talent", "company")
  expiresAt: Timestamp
  used: boolean
```

### Status Design

Status is split into three independent concerns:

| Field | Values | Controls | Set By |
|-------|--------|----------|--------|
| `billingStatus` | `active`, `past_due`, `canceled` | Feature access (with `plan`). `granted` accounts are always initialized to `"active"` and not modified by Stripe. | Stripe webhooks (paid) / always `"active"` (granted) |
| `accountStatus` | `enabled`, `disabled` | Master switch for the account | Admin panel |
| `domainStatus` | `none`, `pending_dns`, `provisioning_cert`, `active`, `failed` | Custom domain URL availability | Domain provisioning flow |

**Access rules:**
- **Hubwork features available:** `accountStatus == "enabled"` (single check). Stripe webhooks automatically set `accountStatus` to `"disabled"` on cancellation and re-enable on reactivation, so `billingStatus` is informational only (displayed in admin panel).
- **Schedule execution:** same as above. `domainStatus` is irrelevant
- **Built-in subdomain (`defaultDomain`):** always available when features are available
- **Custom domain:** only when `domainStatus == "active"`, but feature access is independent

This ensures "billing active but DNS pending" accounts can still use scheduled workflows, form actions, and the built-in subdomain.

### Account Plans

| Plan | How Created | Description |
|------|-------------|-------------|
| `lite` | Stripe Checkout → webhook | ¥300/month. Gmail node, PDF, no upload limit. |
| `pro` | Stripe Checkout → webhook | ¥2,000/month. All Lite features + Sheets nodes, web builder, subdomain, auth, scheduled workflows. |
| `granted` | Admin panel | Free account created by admin. Has Pro-level access. |

The `plan` field is required — accounts without a plan cannot use paid features. `granted` accounts have full Pro access.

### Account Resolution (Two-Tier URL)

All Hubwork routes resolve the account from the request's `Host` header:

1. Extract domain from `Host` header (strip port)
2. Try `customDomain` match: query Firestore where `customDomain == domain`
3. If no match, try `defaultDomain` match: query where `defaultDomain == domain`
4. Cache result in memory (60-second TTL)
5. Return 404 if no account matches, no plan set, or access rules fail

Initial public URL is always `https://{accountSlug}.gemihub.online`. After custom domain setup, both URLs serve the same content.

This is handled by `resolveHubworkAccount(request)` in `app/services/hubwork-account-resolver.server.ts`.

### Token Management

The admin's Google OAuth refresh token is encrypted (AES-256-GCM) and stored in Firestore. When a request arrives:

1. Resolve account from Host header
2. Check in-memory access token cache (5-minute refresh buffer)
3. If expired: decrypt refresh token from Firestore, call OAuth2 refresh
4. Cache new access token in memory

This allows contacts to access pages without the admin being logged in.

## Page System

### File-Based Routing

Pages are served via file-based routing, similar to Remix/Next.js. Files placed in `web/` on Drive are directly served by Cloud Run (with CDN caching) — no intermediate storage needed.

```
web/index.html           → /
web/about.html           → /about
web/styles.css           → /styles.css
web/images/logo.png      → /images/logo.png
web/users/index.html     → /users/
web/users/[id].html      → /users/123, /users/abc, ...
web/blog/[slug].html     → /blog/hello-world
```

**Dynamic routes** use `[param]` syntax in filenames. When a request doesn't match a static file, the proxy looks for a `[xxx].html` file in the same directory.

**Supported file types**: HTML, CSS, JS, images, fonts — any static asset. MIME types are auto-detected from file extensions.

### How It Works

1. User creates/edits files in `web/` in the GemiHub IDE, Obsidian, or any Drive-connected client (drag & drop supported)
2. On Push (from any client), files are updated on Drive. The page proxy reads directly from Drive on each CDN cache miss.
3. No publish step, no intermediate storage — files are live as soon as they're on Drive.
4. CDN caches responses (`s-maxage=600`), so Drive API is only called on cache miss.

### Page Serving Flow

```
Browser → LB → Cloud CDN (cache hit → return immediately)
                  ↓ (cache miss)
            Cloud Run → Drive API (via _sync-meta.json lookup) → Response with Cache-Control headers → CDN caches
```

**Resolution order** for a request like `/users/abc123`:
1. Try exact file: `{accountId}/users/abc123.html`
2. Try index: `{accountId}/users/abc123/index.html`
3. Try exact path (non-HTML): `{accountId}/users/abc123`
4. Try `[param]` pattern: `{accountId}/users/[id].html` (any `[xxx].html` in parent dir)
5. 404

The catch-all route returns responses with:
- `Cache-Control: public, max-age=300, s-maxage=600`
- Security headers (X-Content-Type-Options, X-Frame-Options)

### Account Types Configuration

Account types define multiple login identities (e.g., "talent", "company", "staff"). Each type has an `identity` (authentication source) and optional `data` (user data sources). Configured in `settings.json`:

```json
{
  "hubwork": {
    "spreadsheets": [{ "id": "...", "label": "My Sheet" }],
    "accounts": {
      "talent": {
        "identity": {
          "sheet": "Talents",
          "emailColumn": "email"
        },
        "data": {
          "profile": {
            "sheet": "Talents",
            "matchBy": "email",
            "fields": ["email", "name", "skills"],
            "shape": "object"
          }
        }
      },
      "company": {
        "identity": {
          "sheet": "Companies",
          "emailColumn": "contact_email"
        },
        "data": {
          "profile": {
            "sheet": "Companies",
            "matchBy": "contact_email",
            "fields": ["name", "industry"],
            "shape": "object"
          },
          "jobs": {
            "sheet": "Jobs",
            "matchBy": "company_email",
            "fields": ["title", "status"],
            "shape": "array"
          }
        }
      }
    }
  }
}
```

- `identity.sheet` — The sheet used for magic link authentication
- `identity.emailColumn` — Column header containing email addresses
- `data` — Optional map of named data sources. Each source queries a sheet by email match and returns field-filtered results.

### Client Helper (`/__gemihub/api.js`)

Include in HTML pages to access the Hubwork API:

```html
<script src="/__gemihub/api.js"></script>
```

Provides:
- `gemihub.get(path, params)` — GET `/__gemihub/api/{path}` with query params, returns JSON
- `gemihub.post(path, body)` — POST `/__gemihub/api/{path}` with JSON body, returns JSON
- `gemihub.auth.me(type)` — Get current user data (returns `null` if not authenticated)
- `gemihub.auth.login(type, email)` — Send magic link
- `gemihub.auth.logout(type)` — Destroy session
- `gemihub.auth.require(type, loginPath?)` — Guard: redirects to login if not authenticated

The user object returned by `auth.me` / `auth.require` contains:
- `type`, `email` — always present
- Identity sheet columns for the user's row (e.g. `name`, `created_at`), excluding `type` / `email`
- Keys from the account type's `data` sources (override identity columns on conflict)

**Protected page pattern** — start with loading state, render after auth:

```html
<div id="app">Loading...</div>
<script src="/__gemihub/api.js"></script>
<script>
  (async () => {
    const user = await gemihub.auth.require("talent");
    document.getElementById("app").innerHTML = `Welcome, ${user.email}`;
  })();
</script>
```

### Workflow API (`/__gemihub/api/*`)

Workflow YAML files placed in `web/api/` on Drive are exposed as API endpoints:

```
web/api/users/list.yaml     → GET/POST /__gemihub/api/users/list
web/api/users/[id].yaml     → GET/POST /__gemihub/api/users/abc123
web/api/contact.yaml        → POST /__gemihub/api/contact
```

**Input variables injected into workflow:**

| Variable | Source |
|----------|--------|
| `query.*` | URL query parameters |
| `params.*` | `[param]` pattern captures |
| `body.*` | POST JSON body or form fields |
| `body.{key}_name`, `body.{key}_type`, `body.{key}_size` | File metadata (multipart only) |
| `auth.type`, `auth.email` | Authenticated user (only if `requireAuth` is set) |
| `currentUser` | JSON string of user data (only if authenticated and `data` config exists) |
| `request.method` | `"GET"` or `"POST"` |

**Response behavior by Content-Type:**

| Request Content-Type | Response |
|---|---|
| `application/json` or GET | `__response` variable as JSON (or all non-`__` variables if unset) |
| `application/x-www-form-urlencoded` | Redirect to `__redirectUrl` / `body.__redirect` / Referer |
| `multipart/form-data` | Same as above (redirect) |

**`__response` convention:** Set this variable to a JSON string in the workflow. The API parses it and returns the result. Do NOT double-stringify — the variable already holds the JSON string.

**`__statusCode`:** Optional. Sets the HTTP status code for JSON responses only. Ignored for form redirects.

**`requireAuth`:** Set `trigger.requireAuth` to a single account type name (e.g., `"talent"`). Comma-separated values are invalid and return 400.

**Example workflow (`web/api/users/list.yaml`):**

```yaml
trigger:
  requireAuth: talent

nodes:
  - id: users
    type: sheet-read
    config:
      sheet: Talents
      filter: '{"status": "active"}'
      saveTo: users

  - id: respond
    type: set
    name: __response
    value: "{{users}}"
```

**Security notes:**

- GET APIs must be read-only (no side effects). Data changes must use POST.
- POST requests require Origin header validation (CSRF protection).
- Rate limit: 60 requests/minute per IP.
- File upload limits: 5MB per file, 10MB total. Exceeding returns 413.
- Timeout: 30 seconds default, configurable via `trigger.apiTimeoutSec` (max 60 seconds).

> **Authentication is not authorization.** `requireAuth` only verifies the user is logged in. Workflows with `requireAuth` MUST filter sheet data by `currentUser` — without filtering, `sheet-read` returns ALL rows regardless of who is logged in.

**HTML form integration** (no JavaScript required):

```html
<form action="/__gemihub/api/contact" method="POST">
  <input name="name">
  <input name="email" type="email">
  <input type="hidden" name="__redirect" value="/thanks">
  <button type="submit">Send</button>
</form>
```

## Admin Pages (IDE Preview)

Operator-facing screens — cancelling a booking, marking a no-show, replying to an inquiry — are kept entirely separate from the public site (`web/`) and live under `admin/`. The Hubwork serving layer only exposes `web/`, so anything under `admin/` is automatically 404 from the custom domain. The Drive owner opens these pages from the GemiHub IDE preview mode; there is no other entry point.

### File Layout

```
admin/
  index.html                 → Admin home, opened in IDE preview
  bookings.html              → Bookings list with active / cancelled / no_show tabs
  inquiries.html             → Inquiries list + inline detail/reply form on the same page
  api/
    bookings/list.yaml       → Read all rows (no auth filter)
    bookings/status.yaml     → Update status (cancel / no_show / restore)
    inquiries/list.yaml      → Read all rows
    inquiries/reply.yaml     → Send mail → mark status: replied
```

**Single-page-with-inline-detail convention**: the IDE preview renders HTML via an iframe `srcdoc`, which means `location.search` / `location.pathname` and `[id]` route params are not observable from inside the iframe. Admin screens therefore avoid splitting "list" and "detail" into separate files — instead, clicking a row opens the detail and action form inline (modal or split panel), with the selected id held in a JS `selectedId` variable.

### Execution Model

Public pages call `gemihub.get/post`, which is served by the Hubwork page proxy at `/__gemihub/api/*`. Admin iframes are different: the **parent IDE bridges every call via `postMessage` to `/api/hubwork/admin/*`**, which executes the workflow under the IDE-logged-in Drive owner's Google OAuth. The public `auth.*` namespace is unavailable; the IDE injects `session.*` instead:

| Variable | Value |
|----------|-------|
| `{{session.email}}` | Email of the Google account currently signed in to the IDE (= the operator) |

Workflow rules:

- **Do not set `trigger.requireAuth`** — admin workflows do not flow through Hubwork's auth layer. The IDE session cookie + same-origin check (`validateOrigin`) is the auth boundary.
- **Do not use `{{auth.email}}` / `{{auth.<col>}}`** — undefined in admin workflows. Use `{{session.email:json}}` for operator-identity columns (`cancelled_by`, `reply_by`, etc.).
- **Do not use `data:` config** — `data:` is the public "return only the logged-in user's own rows" feature. Admin pages need every row, so call `sheet-read` directly.

### Soft Delete Convention

Cancellations, no-shows, and inquiry archives **never use `sheet-delete`**. To preserve the audit trail, `sheet-update` flips the `status` column and stamps `cancelled_at` / `cancelled_by` / `cancel_reason` as state-change records. Restoring to `active` clears those columns to empty strings (so column name and content stay consistent).

### Bridge Security

The iframe ↔ parent `postMessage` channel verifies sender identity in both directions:

- Parent (`HtmlFileEditor.tsx`): only handles a request when `e.source === iframeRef.current.contentWindow` AND `e.origin === "null"` (the opaque origin produced by `sandbox="allow-scripts"`).
- Iframe (`html-preview-mock.ts` admin script): only accepts a response when `e.source === parent`.
- Path-traversal defense: segments containing `..` / empty / `\` / `%2e` are rejected with 400 (enforced on both bridge side and server side).
- CSRF: both `loader` and `action` call `validateOrigin(request)` — covers cases where a YAML accidentally puts a state change on GET.

### Related Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/hubwork/admin/*` | IDE session + same-origin | Executes `admin/api/*.yaml` under the IDE owner's OAuth |
| GET | `/api/session/me` | IDE session | Returns the signed-in email; used by the IDE preview's "signed in as" indicator |

### Skill Templates

Concrete templates (`admin/index.html`, `admin/bookings.html`, `admin/inquiries.html` and the matching YAML workflows) live in [`app/services/hubwork-skill-templates/references/admin-patterns.md`](../app/services/hubwork-skill-templates/references/admin-patterns.md) and are scaffolded via the Webpage Builder skill.

## Authentication

### Account Type Sessions

Each account type has an independent session cookie (`__hubwork_{type}`). Users can be logged in as multiple types simultaneously (e.g., both `talent` and `company`). API endpoints determine the active principal solely from `trigger.requireAuth` — if `requireAuth: "talent"`, only the `__hubwork_talent` cookie is checked.

### Magic Link Flow

1. User submits email on login page → `POST /__gemihub/auth/login` with `{ type, email }`
2. Server validates email against `accounts[type].identity` sheet in Google Sheets
3. Token created in Firestore (`hubwork-magic-tokens` collection, 10-minute TTL, includes `type`)
4. Login link emailed via Gmail API
5. User clicks link → `GET /__gemihub/auth/verify/:token`
6. Server verifies token in Firestore (transactional, one-time use)
7. Session cookie (`__hubwork_{type}`) set, 7-day expiry
8. Redirect to target page

HEAD requests to the verify endpoint return 200 without consuming the token (prevents email client link scanners from invalidating tokens).

### Auth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/__gemihub/auth/login` | POST | Send magic link. Body: `{ type, email }`. Always returns `{ ok: true }` (prevents email/type enumeration). |
| `/__gemihub/auth/verify/:token` | GET | Verify token, set cookie, redirect. |
| `/__gemihub/auth/logout` | POST | Destroy session. Body: `{ type }`. |
| `/__gemihub/auth/me?type=talent` | GET | Get current user data. Returns `{ type, email, ...data }` or 401. |

### Rate Limiting

In-memory sliding window (per Cloud Run instance):
- Magic link by email: 3 requests / 10 minutes
- Magic link by IP: 10 requests / 10 minutes
- Workflow API by IP: 60 requests / 60 seconds

## Custom Domains

### Two-Tier URL Design

Every Hubwork account has two URL tiers:

| Tier | URL | Availability |
|------|-----|-------------|
| Built-in | `https://{accountSlug}.gemihub.online` | Immediately on account creation |
| Custom | `https://app.acme.com` | After DNS verification + SSL provisioning |

The admin panel displays both:
- **Preview URL**: `https://{accountSlug}.gemihub.online` (always working)
- **Production URL**: custom domain (shown only when `domainStatus == "active"`)

### Provisioning Flow

1. Admin enters domain in Settings > Premium Plan > Custom Domain
2. App creates Certificate Manager DNS authorization + certificate + map entry
3. App adds host rule to LB URL map (same Cloud Run backend for all domains)
4. DNS instructions displayed to admin (CNAME record)
5. Admin creates DNS record at their registrar
6. Google auto-verifies DNS → provisions SSL certificate (minutes to hours)
7. `domainStatus` transitions: `none` → `pending_dns` → `provisioning_cert` → `active`

### URL Map Structure

All domains (built-in + custom) point to the same Cloud Run backend:

```
*.gemihub.online     → Cloud Run (wildcard subdomain)
app.acme.com         → Cloud Run (host rule added dynamically)
app.other.com        → Cloud Run (host rule added dynamically)
```

Cloud Run identifies the account from the `Host` header — no path-based routing needed.

## Scheduled Workflows

### Source of Truth

`settings.json` on Google Drive is the single source of truth for schedule configuration. Firestore `scheduleIndex` stores desired schedule configuration derived from settings, and Firestore `scheduleRuntime` stores mutable execution state such as retries and locks.

**Update flow:**
1. Settings UI updates `settings.json` on Drive
2. On save, Firestore writes a new `scheduleRevision` on the account doc and upserts `scheduleIndex` entries for that revision
3. After all new entries are written, the account's `activeScheduleRevision` is switched atomically to the new revision
4. Old `scheduleIndex` entries from previous revisions are deleted asynchronously
5. Cloud Scheduler reads only Firestore for schedule matching/runtime state, and reads Drive only when loading workflow YAML for execution
6. Workflow YAML is loaded from Drive at execution time

**Consistency rules:**
- The `scheduleIndex` rebuild is a best-effort operation. If it fails, settings are still saved to Drive (source of truth) and the UI shows a warning.
- Each `scheduleIndex` entry has a `sourceVersion` (MD5 hash of the settings.json entry at save time). The rebuild process writes `sourceVersion` into Firestore; Scheduler trusts the active Firestore revision and does not re-read Drive settings for verification.
- Scheduler only reads schedules from the account's `activeScheduleRevision`, so partial rebuilds never expose an empty or half-written schedule set.
- Admins can trigger a manual index rebuild from the admin panel to recover from failures.

### Configuration (settings.json)

```json
{
  "hubwork": {
    "schedules": [
      {
        "workflowPath": "daily-report.yaml",
        "cron": "0 9 * * *",
        "timezone": "Asia/Tokyo",
        "enabled": true,
        "variables": { "recipient": "admin@example.com" },
        "retry": 3,
        "timeoutSec": 300,
        "concurrencyPolicy": "forbid",
        "missedRunPolicy": "skip"
      }
    ]
  }
}
```

### Schedule Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `workflowPath` | (required) | Workflow filename (e.g. `daily-report.yaml`) |
| `cron` | (required) | 5-field cron expression |
| `timezone` | `"UTC"` | IANA timezone (e.g. `"Asia/Tokyo"`) |
| `enabled` | `true` | Enable/disable toggle |
| `variables` | `{}` | Variables passed to workflow execution |
| `retry` | `0` | Max retry count on transient failure. Retries are deferred to subsequent Scheduler ticks (not in-request), tracked in Firestore `scheduleRuntime`. |
| `timeoutSec` | `300` | Execution timeout in seconds (max 600) |
| `concurrencyPolicy` | `"allow"` | `allow` = run anyway, `forbid` = skip if previous still running |
| `missedRunPolicy` | `"skip"` | `skip` = ignore missed runs after Scheduler downtime, `run-once` = execute once on recovery |

### Execution Flow

1. Cloud Scheduler calls `POST /hubwork/api/workflow/scheduled` every minute (OIDC auth)
2. Endpoint reads all accounts from Firestore where features are available
3. For each account: reads `scheduleIndex` entries from the account's `activeScheduleRevision` and corresponding `scheduleRuntime` state
4. Scheduler matches cron expressions against current time (respecting timezone), plus pending retries from `scheduleRuntime.retryCount`
5. For matching schedules: acquires or updates runtime lock according to `concurrencyPolicy`
6. Scheduler loads workflow YAML from Drive, builds ServiceContext, and executes
7. On failure: increments `scheduleRuntime.retryCount`. On next tick, if `retryCount > 0` and `retryCount <= retry`, the schedule is re-executed regardless of cron match. Retries are deferred to subsequent ticks — no in-request retry loops — to avoid Cloud Run request timeout conflicts.
8. On success or `retryCount > retry`: resets `retryCount` to 0 and clears runtime lock
9. Each account is processed sequentially; one account's failure does not block others

### Cron Expression Format

5-field format: `minute hour dayOfMonth month dayOfWeek`

| Syntax | Meaning |
|--------|---------|
| `*` | Any value |
| `*/n` | Every n |
| `n` | Exact value |
| `n-m` | Range |
| `n,m` | List |

## AI Web Builder Skill

When the Pro plan is enabled, a built-in Agent Skill ("Webpage Builder") is automatically provisioned to `skills/webpage-builder/` on Drive. This skill enables building web pages and API endpoints through AI chat.

### Auto-Provisioning

The skill is created on the first visit to the Settings page after Pro plan activation. It includes:

```
skills/webpage-builder/
  SKILL.md                           ← AI instructions + workflow declarations
  references/
    api-reference.md                 ← Client helper, routing, workflow API docs
    page-patterns.md                 ← Login page, protected page, API workflow templates
  workflows/
    save-page.yaml                   ← Save HTML to web/ (drive-save)
    save-api.yaml                    ← Save workflow YAML to web/api/ (drive-save)
```

If `SKILL.md` already exists, provisioning is skipped (idempotent). Users can customize the skill files after creation.

### Usage

1. Open Chat and activate the "Webpage Builder" skill from the Skills dropdown
2. Describe what you want to build:
   - "Partnerのログインページとチケット一覧ページを作って。Ticketsシートからpartner_emailでフィルタして"
   - "問い合わせフォームを作って。送信したらContactsシートに書き込み"
   - "商品一覧APIを作って。Productsシートから全件取得"
3. AI generates HTML pages and workflow YAML files, then saves them to Drive using the `save-page` / `save-api` workflows
4. Push to publish

### What the AI Knows

The skill's reference materials include:
- `gemihub.get()` / `gemihub.post()` / `gemihub.auth.*` client helper API
- File routing rules (`web/*.html` → pages, `web/api/*.yaml` → APIs)
- Login page, protected page, and API workflow templates
- Authentication vs authorization rules (must filter by `auth.email`)
- Available workflow nodes (`sheet-read`, `sheet-write`, `gmail-send`, etc.)

### Skill Templates (Source)

The template files are embedded in the server build at `app/services/hubwork-skill-templates/`. Changes to these files are reflected in newly provisioned skills but do not update existing ones.

## Form Submissions via Workflow API

HTML forms POST directly to `/__gemihub/api/*` endpoints. The server detects `Content-Type` (form-data or urlencoded) and redirects after execution instead of returning JSON.

### Trigger Configuration

Form-specific options are set in the workflow YAML trigger block:

```yaml
trigger:
  requireAuth: talent
  idempotencyKeyField: "submissionId"
  honeypotField: "_hp_field"
  successRedirect: "/thanks"
  errorRedirect: "/error"
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `requireAuth` | (none) | Single account type name. Comma-separated values are invalid (returns 400). |
| `idempotencyKeyField` | (none) | Form field name for idempotency key (Firestore-based, 5-minute TTL) |
| `honeypotField` | (none) | Hidden field name for bot detection; if filled, silently accepted but not executed |
| `successRedirect` | Referer or `/` | Redirect URL on success |
| `errorRedirect` | Referer or `/` | Redirect URL on error |

Redirect priority: `__redirectUrl` variable > `body.__redirect` field > `trigger.successRedirect` > Referer > `/`

## Server-Side Script Execution

The `script` workflow node executes JavaScript server-side using [`isolated-vm`](https://github.com/laverdet/isolated-vm):

- Each execution creates a fresh V8 isolate (no state leakage)
- Memory limit: 128 MB per isolate
- Configurable timeout (default 10 seconds)
- No network, filesystem, or module access
- `input` variable available if provided

Client-side execution (iframe sandbox) remains unchanged.

## Workflow Nodes (Paid Only)

### sheet-read

Read rows from a Google Sheets tab.

| Property | Required | Description |
|----------|----------|-------------|
| `sheet` | Yes | Tab name |
| `filter` | No | JSON filter `{"status": "active"}` or `column == value` |
| `limit` | No | Maximum rows to return |
| `saveTo` | Yes | Variable name (receives JSON array of objects) |

### sheet-write

Append rows to a sheet.

| Property | Required | Description |
|----------|----------|-------------|
| `sheet` | Yes | Tab name |
| `data` | Yes | JSON object or array matching sheet headers |

### sheet-update

Update rows matching a filter.

| Property | Required | Description |
|----------|----------|-------------|
| `sheet` | Yes | Tab name |
| `filter` | Yes | JSON filter |
| `data` | Yes | JSON object with columns to update |
| `saveTo` | No | Variable for updated row count |

### sheet-delete

Delete rows matching a filter.

| Property | Required | Description |
|----------|----------|-------------|
| `sheet` | Yes | Tab name |
| `filter` | Yes | JSON filter |
| `saveTo` | No | Variable for deleted row count |

### gmail-send

Send an email via Gmail API.

| Property | Required | Description |
|----------|----------|-------------|
| `to` | Yes | Recipient email |
| `subject` | Yes | Subject line |
| `body` | No | HTML body |
| `saveTo` | No | Variable for message ID |

## Subscription & Billing

### Stripe Integration

¥2,000/month subscription via Stripe Checkout. The flow:

1. User clicks "Subscribe" in **Settings > Premium Plan** tab
2. `POST /hubwork/api/stripe/checkout` creates a Stripe Checkout Session with `metadata: { rootFolderId }`
3. User completes payment on Stripe's hosted page
4. Stripe webhook (`checkout.session.completed`) → creates/updates Firestore account with `plan: "lite"` or `"pro"`, `billingStatus: "active"`
5. User returns to Settings — Premium features are automatically enabled (no separate toggle needed)

Subscription lifecycle:
- `customer.subscription.deleted` → `billingStatus` set to `"canceled"`
- `customer.subscription.updated` → `billingStatus` set based on Stripe status (`active`/`trialing` → `"active"`, `past_due` → `"past_due"`, else → `"canceled"`)

Users manage their subscription (cancel, update payment) via Stripe Billing Portal (`POST /hubwork/api/stripe/portal`).

### Admin Panel

Admin dashboard at `/hubwork/admin` for managing accounts.

**Authentication:**
- Google OAuth email — must be in `HUBWORK_ADMIN_EMAILS` env var (comma-separated, default: `takesy.morito@gmail.com`)

**Capabilities:**
- List all accounts (email, domain, plan, statuses, created date)
- View/edit account details (plan, accountStatus, billingStatus, email)
- Create granted (free) accounts by email
- Delete accounts
- Test custom domain (DNS + SSL check)
- Send test magic link
- Preview currentUser payload for a contact email
- Run workflow now (manual trigger)
- Schedule next run preview (show next 5 execution times)
- Page publish history / rollback

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/__gemihub/auth/login` | None | Send magic link. Body: `{ type, email }` |
| GET | `/__gemihub/auth/verify/:token` | None | Verify magic link token, set cookie, redirect |
| POST | `/__gemihub/auth/logout` | None | Destroy session. Body: `{ type }` |
| GET | `/__gemihub/auth/me?type=` | Contact session | Get user data for account type (`type`, `email`, identity columns, `data` sources) |
| GET | `/__gemihub/api.js` | None | Client helper script |
| GET/POST | `/__gemihub/api/*` | Optional (`requireAuth`) | Workflow API (resolves `web/api/*.yaml`) |
| GET | `/*` (catch-all) | None | File-based page proxy (Drive → CDN, Hubwork domains only) |
| GET/POST | `/hubwork/api/domain` | Admin session | Domain management |
| POST | `/hubwork/api/workflow/scheduled` | OIDC (Cloud Scheduler) | Scheduled execution |
| POST | `/hubwork/api/stripe/checkout` | Google OAuth | Create Stripe Checkout Session |
| POST | `/hubwork/api/stripe/webhook` | Stripe signature | Handle Stripe events |
| POST | `/hubwork/api/stripe/portal` | Google OAuth | Create Stripe Billing Portal session |
| GET | `/hubwork/admin` | Basic Auth + OAuth email | Admin dashboard |
| GET/POST | `/hubwork/admin/accounts/:id` | Basic Auth + OAuth email | Account detail/edit/delete |
| GET/POST | `/hubwork/admin/accounts/create` | Basic Auth + OAuth email | Create granted account |

## Infrastructure

### GCP Services

| Service | Purpose |
|---------|---------|
| Cloud Run | Single instance serving all accounts |
| Firestore | Account data, tokens, schedule index |
| Certificate Manager | SSL certificates for custom domains |
| Cloud Scheduler | Triggers scheduled workflow execution every minute |
| Cloud CDN | Caches page proxy responses |
| Load Balancer | Routes all domains (wildcard + custom) to Cloud Run |

### Terraform Resources

| Resource | File | Purpose |
|----------|------|---------|
| `google_project_service` (Firestore, CertManager, Scheduler APIs) | `apis.tf` | Enable required APIs |
| `google_project_iam_member` (datastore.user, certmanager.editor, compute.loadBalancerAdmin) | `iam.tf` | Cloud Run SA permissions |
| `google_certificate_manager_certificate_map` | `networking.tf` | Certificate map for dynamic SSL |
| `google_certificate_manager_certificate` + `_map_entry` | `networking.tf` | Main domain + wildcard certificate |
| `google_cloud_scheduler_job` | `scheduler.tf` | Minute-by-minute schedule trigger |
| `google_service_account` (hubwork-scheduler) | `scheduler.tf` | Scheduler service account |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GCP_PROJECT_ID` | GCP project ID (for Certificate Manager and Compute API calls) |
| `HUBWORK_CERT_MAP_NAME` | Certificate Manager map name (default: `gemihub-map`) |
| `HUBWORK_URL_MAP_NAME` | LB URL map name (default: `gemini-hub-https`) |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_ID_LITE` | Stripe Price ID for the Lite plan (¥300/month) |
| `STRIPE_PRICE_ID_PRO` | Stripe Price ID for the Pro plan (¥2,000/month) |
| `HUBWORK_ADMIN_CREDENTIALS` | Basic Auth credentials (`user:password` format, Secret Manager) |
| `HUBWORK_ADMIN_EMAILS` | Comma-separated admin emails (Secret Manager) |

### Drive Data Structure

```
{rootDir}/
  settings.json        ← hubwork config (spreadsheets, accounts, schedules)
  web/                   ← static site files (served directly by Cloud Run via Drive API)
    index.html
    about.html
    styles.css
    users/[id].html    ← dynamic page route
    login/talent.html  ← login page (user-created)
    api/                 ← workflow API endpoints (served as /__gemihub/api/*)
      users/list.yaml  ← GET/POST /__gemihub/api/users/list
      users/[id].yaml  ← GET/POST /__gemihub/api/users/:id
      contact.yaml     ← POST /__gemihub/api/contact
  admin/                 ← IDE-only operator pages (NOT served on the custom domain)
    index.html         ← admin home, opened from the IDE preview
    bookings.html
    inquiries.html
    api/                 ← admin workflows (executed under the IDE owner's OAuth)
      bookings/list.yaml
      bookings/status.yaml
      inquiries/list.yaml
      inquiries/reply.yaml
  hubwork/
    history/
      {execId}.json    ← Workflow execution history
  workflows/
    *.yaml             ← Workflow definitions (may include trigger config)
```

## Key Files

| File | Purpose |
|------|---------|
| `app/services/firestore.server.ts` | Firestore client singleton |
| `app/services/hubwork-accounts.server.ts` | Account CRUD, token encryption/refresh, schedule index sync |
| `app/services/hubwork-account-resolver.server.ts` | Resolve account from Host header (defaultDomain + customDomain, 60s cache) |
| `app/services/hubwork-admin-auth.server.ts` | Admin panel auth (OAuth email check, Basic Auth handled at HTTP level) |
| `app/services/stripe.server.ts` | Stripe client singleton |
| `app/services/hubwork-magic-link.server.ts` | Magic link tokens in Firestore (transactional verify, includes account type) |
| `app/services/hubwork-rate-limiter.server.ts` | In-memory sliding window rate limiter |
| `app/services/hubwork-session.server.ts` | Per-type session cookie management (`__hubwork_{type}`) |
| `app/services/hubwork-page-renderer.server.ts` | buildCurrentUser (field-filtered Sheets data from account type config) |
| `app/services/hubwork-api-resolver.server.ts` | Resolve `web/api/*.yaml` workflow files from sync meta |
| `app/services/admin-api-resolver.server.ts` | Resolve `admin/api/*.yaml` workflow files from sync meta (IDE-only admin path) |
| `app/services/hubwork-skill-provisioner.server.ts` | Auto-provision "Webpage Builder" skill to Drive |
| `app/services/hubwork-skill-templates/` | Embedded skill content (SKILL.md, references, workflows) |
| `app/services/hubwork-domain.server.ts` | Certificate Manager + URL map management |
| `app/services/isolated-vm-executor.server.ts` | Server-side JS execution (V8 isolate) |
| `app/types/settings.ts` | HubworkAccountType, HubworkDataSource, HubworkSettings definitions |
| `app/types/hubwork.ts` | Firestore document type definitions |
| `app/engine/handlers/hubworkSheets.ts` | Sheet read/write/update/delete handlers |
| `app/engine/handlers/hubworkGmail.ts` | Gmail send handler |
| `app/routes/hubwork.internal.auth.login.tsx` | `POST /__gemihub/auth/login` — magic link with account type |
| `app/routes/hubwork.internal.auth.verify.$token.tsx` | `GET /__gemihub/auth/verify/:token` — verify + set cookie |
| `app/routes/hubwork.internal.auth.logout.tsx` | `POST /__gemihub/auth/logout` — destroy session |
| `app/routes/hubwork.internal.auth.me.tsx` | `GET /__gemihub/auth/me` — currentUser data by type |
| `app/routes/hubwork.internal.api.$.tsx` | `GET/POST /__gemihub/api/*` — workflow API execution |
| `app/routes/hubwork.internal.api-js.tsx` | `GET /__gemihub/api.js` — client helper script |
| `app/routes/api.hubwork.admin.$.tsx` | `GET/POST /api/hubwork/admin/*` — admin workflow execution under the IDE owner's OAuth |
| `app/routes/api.session.me.tsx` | `GET /api/session/me` — IDE session email for the admin preview "signed in as" indicator |
| `app/components/ide/editors/HtmlFileEditor.tsx` | HTML editor + preview iframe; hosts the parent side of the admin postMessage bridge |
| `app/components/ide/editors/html-preview-mock.ts` | Builds the inline `gemihub` shim injected into the preview iframe (mock mode for `web/`, live bridge for `admin/`) |
| `app/routes/hubwork.site.$.tsx` | Catch-all page proxy (Drive → CDN) |
| `app/components/settings/HubworkTab.tsx` | Settings UI (subscription, domain, schedules) |
| `app/routes/hubwork.admin.tsx` | Admin dashboard (account list + operational tools) |
| `app/routes/hubwork.api.stripe.webhook.tsx` | Stripe webhook handler |
