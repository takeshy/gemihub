# Webpage Builder Skill History

## v1.1.7 - 2026-04-26

- Dropped the "Protected pages must show a logout button" rule from the webpage-review prompt and SKILL.md Pre-Save Checklist. It produced false positives on narrow-purpose protected pages (e.g. a single-action confirmation like `web/reservation.html` with a Cancel link) where adding a logout button is unnecessary or visually awkward. Logout / user-email display is now explicitly optional — sample templates still include it as a convenience but it is not enforced.
- Mock-file rule clarified: `web/__gemihub/api/{path}.json` is required only for **GET** endpoints (paths the page reads via `gemihub.get(...)`). POST endpoints (`gemihub.post(...)`, HTML form submissions) intentionally do NOT need a mock — they are no-ops in IDE preview. The webpage-review prompt, SKILL.md Pre-Save Checklist, Planning example, page-patterns.md, and api-reference.md all spell this out so the automated review stops flagging missing POST mocks as a high-severity issue. (The previous wording said "one per API endpoint", which made GET-vs-POST ambiguous.)
- Replaced the initial-provisioned `web/__gemihub/schema.md` with a sample `web/sample.html` landing page so the user can verify DNS / SSL / custom-domain routing immediately after Pro provisioning (the previous bootstrap file lived under `web/__gemihub/` and never produced a visible page). The placeholder is served at `/sample` rather than `/` so it never collides with the user's real homepage at `web/index.html`. The page is rendered in the user's UI language (Japanese / English) at provision time and includes a short overview of what the Webpage Builder skill is and the first steps to use it, so the page itself acts as the welcome / orientation. `schema.md` is now created on demand by the skill the first time any sheet beyond `accounts` is needed; SKILL.md updated to spell out the create-vs-update branch.

## v1.1.6 - 2026-04-26

- Added explicit anti-pattern warnings to `references/api-reference.md` based on real review feedback. Two LLM-invented mistakes are now called out by name: (1) wrapping a placeholder in single quotes inside a `script` `code:` (e.g., `JSON.parse('{{events}}')`) — the apostrophe in any string value (`Bob's Meeting`, `it's`) closes the JS literal early, even with `:json`; (2) using JS template-literal syntax (`${var}`) in any field outside a `script` `code:` (e.g., a `gmail-send` body) — the workflow engine does not evaluate `${...}`, so the user receives the literal four characters.
- Added a new **Placeholder Syntax — `{{var}}` Only, Never `${var}`** section showing correct vs wrong gmail-send bodies side-by-side, plus an extra Single-Quote-Banned bullet on the existing `script` rules list.
- Schema migration now runs **automatically** as a side effect of `update_drive_file` whenever the path is `web/__gemihub/schema.md`. The file-write response carries a `schemaMigration` field with `created` / `updated` / `unchanged` lists (or `error`). The previous workflow required the LLM to explicitly call `migrate_spreadsheet_schema` after saving schema.md, which it routinely forgot — leaving sheets out of sync. The explicit tool is still available as a retry / dry-run path. SKILL.md and the interview sample reference were updated to describe the new flow.
- `create_drive_file` no longer silently overwrites an existing path — it now returns a hard error pointing at the existing fileId so the LLM is forced through `update_drive_file` for edits. Previously the underlying writer was upsert-by-path, so the LLM kept editing schema.md (and other existing files) via `create_drive_file`, which made tool calls look like creations and bypassed any update-side hooks. Picking the wrong tool is now a hard error instead of a silent overwrite.
- The `webpage_builder` spreadsheet is now relocated into the `gemihub/` Drive folder both on first creation and on rediscovery (it used to land in My Drive root because the Sheets API ignores parent folders on create). Existing root-level spreadsheets are migrated on the next provision call.

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
