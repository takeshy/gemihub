# Webpage Builder Skill History

## v1.2.0 - 2026-04-24

- Added **`references/admin-patterns.md`** covering operator-facing management pages kept under `admin/` (never `web/admin/`). The Hubwork serving layer only exposes `web/*`, so `admin/*` is automatically 404 from the public web; the Drive owner opens these pages via the GemiHub IDE "admin preview" mode. Templates: admin dashboard, bookings list with cancel / no-show / restore tabs, and a single inquiries page that folds the list, detail, and reply form together (admin pages must not be split into `[id].html` files because the IDE iframe preview drops URL params/paths, so the selected id is kept in JS state instead). Matching YAML workflows: `admin/api/bookings/{list,status}.yaml` and `admin/api/inquiries/{list,reply}.yaml`. Uses a new `{{session.email}}` injected variable for operator identity (distinct from `{{auth.email}}` which is Hubwork-only).
- Added the **Soft Delete** convention: cancelling a booking or marking a no-show writes `sheet-update` with `status: "cancelled" | "no_show"` and records `cancelled_at` / `cancelled_by` / `cancel_reason`. `sheet-delete` is never used for bookings or inquiries — monitor audit trail preserved.
- Added **`inquiries` sheet schema** (id, submissionId, name, email, subject, message, status, created_at, reply_text, reply_at, reply_by) — single-reply model. `submissionId` is the client-generated idempotency key used by the public contact workflow's dedup step. `inquiry_replies` as a multi-turn extension is called out in admin-patterns.md "Future Extensions".
- Added **Public Contact Form** templates to `references/page-patterns.md`: `web/contact.html` + `web/api/contact.yaml`. Honeypot (`_hp`) and idempotency (`submissionId`) are implemented as in-workflow `script` + `if` + `sheet-read` nodes rather than `trigger.honeypotField` / `trigger.idempotencyKeyField`, because those trigger options only run for form-POST requests and are skipped when the page calls `gemihub.post()` (JSON).
- SKILL.md updates: new "Admin Pages (IDE-only)" section, six new Red Flags (admin path under `web/`, admin `requireAuth`, admin `{{auth.email}}`, admin `sheet-delete`, admin `data:` config, contact-form `requireAuth`, and contact-form `trigger.honeypotField`/`idempotencyKeyField` being silently ignored for JSON posts), new Pre-Save Checklist sections for Contact Form, Admin HTML, and Admin API.

## v1.1.3 - 2026-04-24

- Added **API Workflow Template (Public Register)** to `references/page-patterns.md` — the workflow side of the self-registration flow. Public endpoint (no `trigger.requireAuth`), duplicate-email short-circuit via an `if` node with `trueNext: respond` (silent success prevents account enumeration), `sheet-write` with `:json`-escaped fields, `gmail-send` welcome email. The Register Page Template and Pre-Save Checklist both reference it.

## v1.1.2 - 2026-04-24

- Added a **Register Page Template** to `references/page-patterns.md` covering the self-registration flow: public page, user enters email + profile fields, submits via `gemihub.post("register", body)`. Page does NOT use `gemihub.auth.require()` / `gemihub.auth.me()` — the user has no session yet.
- Added Red Flag in SKILL.md preempting the common "guard the register page with `gemihub.auth.require()`" mistake and a sibling Pre-Save Checklist section for register pages.
- IDE HTML preview now detects register pages by their `gemihub.post("register", ...)` call and forces `gemihub.auth.me()` to resolve to null regardless of `web/__gemihub/auth/me.json`. The same populated mock now serves both states: register pages always see "not logged in"; protected pages see the populated user.

## v1.1.1 - 2026-04-24

- Removed the redundant `name: create-article` line from the `skill-capabilities` block. One file is one workflow, so the tool name is now derived from the filename at runtime (`workflows/create-article.yaml` → `create-article`). This keeps the declaration as the single source of truth and removes drift potential if the file is ever renamed.

## v1.1.0 - 2026-04-24

- Restructured `SKILL.md` to follow the [obra/superpowers](https://github.com/obra/superpowers) `writing-skills` conventions: trigger-condition `description` field (not workflow summary), lowercase-hyphenated `name`, an explicit "Iron Law" near the top, a Before/After Core Pattern table, a Quick Reference, and a Red Flags / Rationalisations table consolidating the prior "Common Mistakes" list.
- No behavioural rule was removed — every existing guard (request.* prefix, `:json` modifier rules, script-node-for-UUIDs, no-frameworks, calendar event flat shape, auth-not-authorization) is preserved. The Pre-Save & Verification Checklist is unchanged so it remains in sync with `webpage-review.server.ts`.
- Lowered the manifest `name` from "Webpage Builder" to "webpage-builder" to match the convention used by the folder ID and superpowers' naming rule.

## v1.0.0 - 2026-04-23

- Added the `create-article` workflow for publishing dated blog posts and announcements from Drive notes.
- Article output paths now include the source note basename, so multiple posts can be published on the same day without overwriting each other.
- Added `manifest.json` versioning for update detection in settings.
