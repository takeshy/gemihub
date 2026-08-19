# Known defects — do not import; fix on the way in

All verified against the working trees on 2026-08-19.

## In the fork (`../gemihub-business`) — fix while absorbing

1. **Terraform prod stack cannot init.**
   `terraform/environments/prod/main.tf:75` declares
   `module "gemibiz" { source = "../../modules/gemibiz" }` but only
   `terraform/modules/gemihub` exists. Fix during the Phase 6 import by
   normalizing to this repo's module naming.
2. **`EnterpriseTab.tsx:215` hardcodes the fork's domain and bypasses i18n.**
   Error message embeds `https://gemihub.online/auth/vertex/callback` as a
   Japanese string literal. On import: derive the callback URL from the request
   origin and add proper `en`/`ja` translation keys.
3. **Unused Google Cloud deps.** `@google-cloud/{billing,iam,resource-manager,service-usage}`
   in the fork's `package.json` are leftovers from an abandoned tenant
   provisioner. Do not add them to this repo; keep only
   `@google-cloud/firestore` and `@google-cloud/storage`.
4. **`vite.config.ts` dev admin Basic auth silently disables itself.**
   When `HUBWORK_ADMIN_CREDENTIALS` is unset it calls `next()` (no auth), and
   the comparison is a non-constant-time `===`. The fork's `server.js` 401s
   correctly. If this middleware is adopted, mirror the `server.js` behavior
   (401 when unset) and use a timing-safe compare.
5. **`hubwork-gcs-context.server.ts:43` `getHubworkProjectContext` throws for
   any account without `projectId`** ("created before enterprise mode —
   re-provision"). In the unified design a Hubwork account without an org is a
   Drive mount; this function is superseded by the StorageProvider in Phase 5
   (publishing reads `web/**` through the provider). Do not carry the throw
   into any default-path code.
6. **Scheduled workflows silently lose the Gemini key.**
   `hubwork.api.workflow.scheduled.tsx:88-99` calls `decryptGeminiApiKey`,
   catches the (in the fork, unconditional) throw, and proceeds with
   `geminiApiKey: undefined`. In the unified design, scheduled workflows on a
   project mount use Vertex; on a Drive mount they must have a working key path
   or fail loudly, not silently.

6b. **Owner privilege escalation in member routes** (also present in the fork's
   `api.members.{update-role,remove}.tsx`): an org `admin` could demote or
   remove an `owner`. Fixed in this repo on import (2026-08-19) — changing or
   removing a member whose role is `owner` now requires a service super admin.
   Do not re-import the unguarded fork versions; the fork itself still has the
   flaw.

6c. **Stored XSS via raw storage reads** (also present in the fork's
   `api.storage.read.tsx`): `format=raw` served user-uploaded bytes inline on
   the app origin with the stored Content-Type — an uploaded HTML/SVG file
   would execute script with session cookies in scope. Fixed in this repo on
   import (2026-08-19): inline rendering is limited to a safe-type allowlist
   (images/pdf/plain text/audio/video — never text/html or image/svg+xml),
   everything else downgrades to application/octet-stream + attachment, and
   raw responses carry `X-Content-Type-Options: nosniff` and
   `Content-Security-Policy: sandbox; default-src 'none'`. The fork itself
   still has the flaw — do not re-import its version of the route.

## In this repo — expired/pending items to clear before Phase 6

7. **`gemihub.online` 301-redirect block expired.** `server.js:11-47`
   (TODO says remove after 2026-06-25). Caution: `gemihub.online` is the
   fork's current production domain — coordinate removal with the Phase 6
   domain consolidation and the retirement of the fork's GCP project.
8. **`legacy_*` Terraform resources expired.**
   `terraform/modules/gemihub/{variables.tf:24,outputs.tf:22,networking.tf:104}`
   and `environments/prod/main.tf:42` — same 2026-06-25 TODO; remove together
   with item 7.
9. **No remote Terraform backend.** Neither repo commits tfstate/tfvars
   (spec's claim of committed state is **incorrect** — verified via
   `git ls-files`), but neither declares a `backend` block either: prod state
   is local-only. Move state to a GCS backend before consolidating stacks in
   Phase 6.
10. **`cloudbuild.yaml` project mismatch.** `_PROJECT_ID` defaults to
    `takeshy-work-b94f7` (line 64) while Terraform targets `geminihub-486523`.
    Also confirm whether the `gemihub-hw-*` Cloud Run services deployed in
    step 5 exist anywhere (Terraform does not define them) and keep or drop
    the loop.
11. **API key in URL query string.** `app/services/file-search.server.ts:100`
    appends `?key={apiKey}` to Gemini File Search requests. Move to the
    `x-goog-api-key` header during the Phase 3 RAG consolidation.

## Spec corrections discovered during Phase 0 verification

- The spec's "unported backlog" is partially stale — see
  `unported-backlog.md` (MCP 2026 transport/OAuth and timeline/calendar
  launcher are already in the fork).
- No tfstate/tfvars/provider binaries are committed in either repo (item 9).
