# Merge progress log

## Storage quota round — DONE (2026-08-19)

User decision: Business includes **100 GB** project storage per org,
expandable in **500 GB units at ¥5,000 / $30 per month** (recurring add-on
subscriptions, independently cancellable via the Stripe portal).

- `storage-quota.server.ts`: quota = 100 GB + Σ(storageAddons units) × 500 GB;
  usage = lazily recomputed Firestore counter
  (`organizations/{orgId}/meta/storageUsage`, 10-min TTL, pages every
  project prefix) + 30 s in-memory cache with optimistic per-write bumps.
  Enforcement inside `gcs-storage.writeObject` (the single choke point for
  ALL project writes incl. chat tools/history/uploads) →
  `StorageQuotaExceededError` (413), mapped in storage-route-utils and
  drive-compat. Fails open on accounting errors (billing guard, not a
  security boundary).
- `Organization.storageAddons: Record<subscriptionId, units>` +
  `setOrgStorageAddon`/`removeOrgStorageAddon` (idempotent by sub id).
- Stripe: checkout `plan=storage-addon` (mode=subscription, quantity 1-8,
  `STRIPE_PRICE_ID_STORAGE_ADDON{,_USD}`, subscription_data.metadata stamped
  for lifecycle routing). Webhook: checkout.completed records units;
  subscription.updated syncs quantity; subscription.deleted removes units —
  and CRITICALLY both lifecycle handlers branch on
  metadata.type === "storage-addon" BEFORE the account logic, otherwise an
  add-on cancellation would disable the whole account.
- EnterpriseTab: storage section (usage bar, quota, active add-ons,
  purchase form) fed by an extended api.orgs.ai-settings response; 7 new
  en/ja keys.
- Copy: tokushoho (storage line), manual, READMEs, docs/architecture/mounts.
- **Upgrade-path bug fixed**: Lite→Business upgrades (subscriptions.update)
  never fire checkout.session.completed, so the checkout route now calls
  provisionBusinessOrganization directly after the plan switch.
  NOTE (open decision): upgrades still use proration_behavior:
  "create_prorations" — prorated difference bills on the NEXT invoice, not
  immediately; switch to "always_invoice" if immediate charging is wanted.
- Ops additions: create Stripe Prices ¥5,000 + $30/mo recurring →
  STRIPE_PRICE_ID_STORAGE_ADDON{,_USD}.
- Verified: precommit + 484 tests green.

## Phase 6/7 follow-up round — DONE (2026-08-19, user decisions applied)

User decisions: fork GCP project is empty (tests only); unify cloudbuild to
geminihub-486523 and drop the hw loop; **Business = ¥7,500/$50 per month,
billed PER ORGANIZATION, includes a $30/mo Vertex budget, top-ups $10/¥1,500
per unit**; do all four UI-polish items.

- **Expired legacy removed**: server.js gemihub.online 301 block (www→apex
  redirect kept); Terraform legacy_* resources + moved blocks + legacy_domain
  variable/output (apply will DESTROY the old gemihub.online certs/DNS zone —
  intended). cloudbuild `_PROJECT_ID` → geminihub-486523; `gemihub-hw-*`
  deploy loop deleted.
- **Pricing/top-ups**: business-provisioning sets org monthlyBudgetUsd=30;
  `addAiBudgetTopUp` (idempotent via checkout session id, transaction over
  aiUsage/{month}/topupEvents) + `topUpMicros` extends the org limit for the
  current month; checkout route `plan=vertex-topup` (mode=payment,
  org owner/admin only, units 1-20, envs
  STRIPE_PRICE_ID_VERTEX_TOPUP{,_USD}); webhook handles
  metadata.type=vertex-topup before account logic. EnterpriseTab AI section
  shows the top-up balance + purchase form. Price copy updated everywhere
  (HubworkTab priceFor, lp, tokushoho incl. top-up line, manual, admin,
  subscribeButton translations, READMEs).
- **UI polish**: ChatPanel model list is mount-aware (VERTEX_MODELS ∩
  allowedModels on project mounts + auto-reselect guard);
  `MountSwitcher` in the IDE Header (org/project selects + My Drive,
  hidden for users without orgs via new `hasOrganizations` context flag —
  threaded from both loaders so self-hosted installs never fetch org APIs);
  EnterpriseTab + DriveShelf fully i18n-ized (~85 new en/ja keys,
  0 hardcoded Japanese left); login/invite pages bilingual via
  Accept-Language loaders; DriveShelf fetch gated to active project mounts.
- **Ops checklist for the user** (before enabling Business in prod):
  create Stripe Prices — subscription ¥7,500 JPY + $50 USD → secrets/envs
  STRIPE_PRICE_ID_BUSINESS{,_USD}; one-time ¥1,500 JPY + $10 USD →
  STRIPE_PRICE_ID_VERTEX_TOPUP{,_USD}; create the ragChunks composite vector
  index; register /auth/vertex/callback + /auth/oidc/callback on the OAuth
  client; set GCS_BUCKET_NAME/GCP_PROJECT_ID/DEFAULT_TENANT_REGION/
  SUPER_ADMIN_EMAILS; terraform apply (destroys legacy gemihub.online
  resources); move TF state to a GCS backend; retire the fork's GCP project.

## Phase 7 — Documentation — PARTIAL (2026-08-19)

- CLAUDE.md: Architecture section rewritten for the mount/provider model
  (storage mounts, AI providers, streaming per mount, plans, tenant
  settings).
- `docs/architecture/mounts.md` added (OKF frontmatter, registered in
  docs/index.md + docs/log.md).
- Still open: full i18n of EnterpriseTab / DriveShelf / login / invite
  (currently hardcoded Japanese, matching the fork), `{storageName}` i18n
  variable for storage-facing labels, README, ChatPanel model picker per
  mount, Org/ProjectSwitcher in the IDE Header, fork's `hubwork_admin.tsx`
  admin replacement.

## Phase 6 — Infrastructure — NOT DONE (needs GCP access / user decisions)

Code-side already done: Terraform STRIPE env renames (secrets themselves
still `stripe-price-id-pro*` — see secrets.tf comment), .env.example union.
Remaining (ops): import fork's firestore.tf/module resources under gemihub
naming; tenant GCS bucket TF (uniform access, versioning, public access
prevention); create the `ragChunks` composite vector index by hand (RAG
returns 503 without it); move TF state to a GCS backend; reconcile
cloudbuild `_PROJECT_ID` (defaults `takeshy-work-b94f7` vs TF
`geminihub-486523`) and the undefined `gemihub-hw-*` deploy loop; OAuth
client redirect URIs (`/auth/vertex/callback`, `/auth/oidc/callback`);
remove the expired `gemihub.online` 301 block + `legacy_*` TF resources
(coordinate with retiring the fork's GCP project
`project-6a1b8e8e-da95-4616-96e` — check whether it holds data first).

## Phase 0 — Preparation and freeze — DONE (2026-08-19)

- `business` remote added (`git fetch business`; fork HEAD `21d847c`).
- This skill + references created (adaptation-map, rename-table, known-defects,
  unported-backlog).
- Spec corrections recorded: no tfstate/tfvars committed in either repo;
  MCP 2026 transport and timeline/calendar launcher already ported to the fork.
- Product decision: **no production Stripe subscribers** → no `pro`→`business`
  data migration, no subscriber backfill (Phase 5 simplification).

## Phase 1 — Tenancy foundation — DONE except deferred slices (2026-08-19)

Ported (with `gemibiz`→`gemihub` rename):

- Services: `organizations`, `projects`, `project-acl`, `enterprise-context`,
  `invites`, `super-admin`, `audit-log`, `ai-budget`, `default-project`,
  `project-guide` (+`project-initial-files/`), `notify`,
  `hubwork-spreadsheet-sharing`, `gcs-storage` (+utils), `timeline-author`,
  fork `user-settings.server.ts` → **`user-settings-tenant.server.ts`**
  (this repo's Drive `user-settings.server.ts` untouched).
- `types/enterprise.ts`, `contexts/EnterpriseContext.tsx`,
  `components/enterprise/{OrgSwitcher,ProjectSwitcher}.tsx` (not yet mounted
  in the IDE — Phase 2), `components/settings/EnterpriseTab.tsx`.
- Routes registered: `/login`, `/invite/:token`, `/admin/enterprise`,
  `/api/session/select`, `/api/orgs/{list,create,idp,ai-settings}`,
  `/api/audit-logs`, `/api/projects/{list,create,delete}`,
  `/api/members/{list,add,remove,update-role,ai-budget,invite}`.
- Merges (union, both behaviors kept):
  - `firestore.server.ts`: kept `isFirestoreAvailable()` guard; added org
    collection constants + `GCP_PROJECT_ID` support.
  - `session.server.ts`: kept geminiApiKey/apiPlan encryption and
    `/auth/google` requireAuth redirect; added
    currentOrgId/currentProjectId/authMethod/oidcSub, tokenless-session
    support, `setCurrentSelection`.
  - `sync-client-utils.ts`: **collision** — restored this repo's version and
    added the fork's `isProjectInternalPath` + `gemihub/` managed-root
    prefix handling. (First copy overwrote it; caught by typecheck.)
- `settings.tsx`: enterprise tab added, visible only when the user belongs to
  ≥1 org (or is super admin); loader resolves enterprise context gated on
  `isFirestoreAvailable()`; wrapped in `EnterpriseProvider`.
- i18n: `settings.tab.enterprise` added to interface + en + ja.
  EnterpriseTab itself ships the fork's hardcoded-Japanese UI — full i18n in
  Phase 7.
- `.env.example`: added SUPER_ADMIN_EMAILS, GCP_PROJECT_ID, GCS_BUCKET_NAME,
  DEFAULT_TENANT_REGION (commented, credential-gated).
- Defects fixed on import: EnterpriseTab hardcoded `gemihub.online` callback →
  `window.location.origin`; fork's gcs-storage GoogleAuth/Headers-proxy
  workaround dropped (only needed under the fork's `gaxios ^7` override, which
  this repo doesn't have — comment marks how to restore); fork's unused
  `@google-cloud/{billing,iam,resource-manager,service-usage}` deps not added.
- New deps: **none** (google-auth-library usages swapped to
  `google.auth.*` via googleapis).
- Adjusted for Phase 1 semantics: `invite.$token.tsx` action now adds the org
  member, stores the org/project selection on the session cookie, and routes
  through `/auth/google` instead of creating a tokenless email session (the
  IDE is Drive-backed until Phase 2; fork behavior restored with the
  OIDC/email-login slice).
- Verified: `npm run precommit` (typecheck+lint+build) green; 460 tests pass
  including the ported test files; forbidden-assumption scan clean.
- Security hardening on import (flagged by automated review, valid, also
  present in the fork): `api.members.update-role` / `api.members.remove` let
  an org `admin` demote/remove an `owner`. Both now require a service super
  admin to touch an owner (see known-defects.md item 6b).

### OIDC slice — DONE (2026-08-19, follow-up with user consent)

- `jose@^6.2.9` installed (no known advisories for v6; audit's 18 findings are
  pre-existing transitive deps — gaxios among them, same issue the fork's
  `gaxios ^7` override addresses).
- Ported `oidc-auth.server.ts`, `auth.oidc.{start,callback}` routes; registered.
- **Tokenless-session guards** (Phase 1 semantics until the GCS mount lands):
  `_index` and `settings` loaders redirect sessions without an accessToken to
  `/login?workspace=pending`; `login.tsx` shows a "workspace preparing —
  use Google login for now" banner. Without the guard, a tokenless session
  hitting getValidTokens gets its session destroyed with a raw 401.
  REMOVE these guards in Phase 2 when a project mount can serve tokenless
  sessions (grep: "workspace=pending").

### Deferred out of Phase 1
- **Per-org Vertex OAuth** (`vertex-oauth.server.ts`, `auth.vertex.*`,
  `api.orgs.vertex-oauth`): → Phase 3. `api.orgs.ai-settings` carries a
  local stub returning the ADC-fallback status (TODO(phase-3) marker).
- **`api.projects.update-slug`**: → Phase 5 (depends on the fork's
  Hubwork-account↔project provisioning model: `getAccountByProject`,
  `HubworkAccount.orgId/projectId`, `encryptOAuthRefreshToken`).
- `hubwork_admin.tsx` (fork's admin) replacing `hubwork.admin.*`: → later
  phase; this repo's admin untouched.
- `VERTEX_MODELS` seeded into `app/services/ai/models.ts` (Phase 3 will fold
  in `MODEL_PRICING` from `gemini-chat-core.ts`).

## Phase 5 — Plan rework + org provisioning + publishing — LANDED (2026-08-19)

- **Plans renamed** `lite | business | granted` (`HubworkAccountPlan`,
  settings type). `hasProFeatures` → `hasBusinessFeatures`; every inline
  `plan === "pro" || "granted"` gate updated (site serving, internal auth,
  scheduled workflows, execute-node/full, settings, HubworkTab, ChatPanel,
  api.auth.unlock, admin). Defensive read-normalization in `docToAccount`
  ("pro" → "business" — protects leftover test docs; no production
  subscribers existed). Labels updated in lp/tokushoho/manual/translations
  (both en+ja). Price env vars renamed `STRIPE_PRICE_ID_BUSINESS{,_USD}`
  with checkout fallback to the old PRO names; Terraform cloud-run env names
  renamed while still reading the existing `stripe-price-id-pro*` Secret
  Manager secrets (proper secret rename = Phase 6).
- **Stripe webhook provisions the org**: on a Business
  checkout.session.completed, `business-provisioning.server.ts` creates (or
  reuses) the buyer's organization (Owner = purchaser; orgId derived from
  the account slug, uid-hash fallback), ensures the "default" shared
  project, and links `HubworkAccount.orgId/projectId` (fields added +
  updateAccount allowlist). Idempotent for webhook retries; never throws.
- **Publishing through the StorageProvider**:
  `storage/account-mount.server.ts` maps a HubworkAccount to a MountContext
  (orgId+projectId → GCS service context; else the owner's Drive via the
  stored refresh token); `hubwork-site.server.ts` resolves `web/**` pages
  (exact/.html/index.html/[param] fallback, same order) over
  listObjectsForSync + readObject. `hubwork.site.$.tsx` and
  `hubwork-page.server.ts` rewritten on top of it — X-Robots-Tag and CDN
  cache headers preserved. Drive-backed accounts and Business org projects
  now serve from the same code.
- `api.projects.update-slug` restored (deferred from Phase 1): binds an org
  project to a published-site slug; hubwork-accounts gained
  `HUBWORK_DOMAIN` (env-driven, replaces two hardcoded gemihub.net),
  `encryptOAuthRefreshToken`, `getAccountByProject`, and createAccount
  orgId/projectId params.
- `pdf-lib` installed (user consent); RAG PDF chunking stub removed.
- `.env.example`: Vertex OAuth / RAG embedding / Hubwork token secret vars.
- Verified: precommit + 484 tests green. Runtime verify still pending
  (Stripe test-mode checkout for both plans, webhook idempotency, publishing
  from both mounts, scheduled workflows).

## Phase 4 — My Drive shelf + personal projects retired — LANDED (2026-08-19)

- `components/ide/DriveShelf.tsx` (converted from the fork's
  PersonalStorageShelf): shows My Drive (`/api/storage/tree?mount=drive`)
  above the project FileTree while a project is selected; expands/collapses;
  drag files both ways; "開く" / double-click deselects the project
  (session select projectId=null → Drive IDE). Sessions without a Drive
  grant (OIDC) get a "Googleでログイン" re-consent prompt instead.
- Cross-mount drag&drop: `types/storage-drag.ts` generalized to
  `{sourceMount, moves}`; DriveFileTree dragstart adds the payload on
  project mounts (tree ids are paths); dropping a shelf payload anywhere on
  the tree area imports into the project at original relative paths via
  `/api/storage/move-between-mounts`; the shelf accepts project payloads
  and clears the project mount's local cache entries after the move.
  Refresh via existing `sync-complete` + new `drive-shelf-changed` events.
- **Personal projects removed**: `ProjectVisibility` = `"shared"` only;
  `AppProject.personalOwnerUid` and `EnterpriseSelectionView.visibility`
  deleted; `personalProjectId`/`ensurePersonalProject` deleted; personal
  branches removed from project-acl (super-admin now spans all projects),
  enterprise-context, api.projects.list, ProjectSwitcher, EnterpriseTab,
  default-project. **Legacy guard**: Firestore docs with stored
  `visibility: "personal"` are treated as absent (getProject → null,
  listProjectsInOrg filters) so stale fork data can never surface as a
  shared project.
- Verified: precommit green; 484 tests pass (an emptied
  default-project.server.test.ts was removed with its 2 personal-id tests).

## Phase 3 — AIProvider — LANDED (2026-08-19), needs runtime verify

Same centralizing-seam strategy as 2c: AI server routes dispatch on an
explicit `projectId` (body/query) to Vertex handlers; no session inference.

- **Vertex engine ported**: `gemini-vertex.server.ts` (streamCompact/
  streamWithTools/generateCompact/generateStructured), `vertex-ai.server.ts`
  (VERTEX_MODELS re-exported from ai/models.ts; GoogleAuth via googleapis),
  `vertex-retry/vertex-schema/gemini-content-builders`, `vertex-oauth.server`
  (CodeChallengeMethod → "S256" literal cast; per-org OAuth routes
  `auth/vertex/*` + `api/orgs/vertex-oauth` registered; ai-settings stub
  replaced with the real status).
- **Chat**: `/api/chat` action peeks the body — `projectId` present →
  `ai/vertex-chat-route.server.ts` (fork's Vertex SSE handler; storage tools
  under this repo's `*_drive_*` protocol names via `storage-tools.server.ts`;
  tokenless-session tolerant). Legacy key path untouched.
- **Dispatched with request.clone() peek guards**: api.chat.history (tenant
  chats via `chat-history-tenant`), api.chat.compact,
  api.workflow.{ai-generate,ai-prompt}, api.base.ai-generate,
  api.timeline.ai-rewrite → `ai/vertex-*.server.ts`; api.workflow.history,
  api.workflow.request-history, api.settings.edit-history,
  api.settings.rag-sync → `ai/tenant-*-route.server.ts` (tenant history
  services ported).
- **RAG**: Firestore vector stack ported (`rag-embeddings/rag-store/
  rag-sync-tenant`), `/api/rag/{search,refine}` registered (project-gated).
  **pdf-lib NOT installed** (consent pending) — PDF page-chunking lazily
  imports it and throws a clear error until installed. Drive RAG (File
  Search) untouched; its API key moved from URL query to `x-goog-api-key`
  header (spec defect #11 fixed).
- **Client**: `chat-stream-client.ts` ported (mountKey/revision/mount-param
  renames; `*_drive_*` tool names; watch out — a blanket generation→Revision
  rename mangled `isImageGenerationModel` once, fixed). ChatPanel: third
  generator branch (project mount → executeChatStream, no API key needed —
  key gate skipped), history list/save/delete/load per mount.
  `useLocalChat`/`useInteractionsChat` untouched (genai-key paths).
- `models.ts` now holds MODEL_PRICING + SEARCH_GROUNDING_COST (re-exported
  from gemini-chat-core for existing importers) + VERTEX_MODELS.
- Additive type changes: RagSetting.chunkSize/chunkOverlap;
  SkillWorkflowExecOptions.mountKey/projectId; GMAIL_SEND_TOOL_NAME + gmail
  tool definition added to hubwork-tool-definitions (fork feature).
- Gaps: ChatPanel's model picker still shows the genai-key list on project
  mounts (server rejects disallowed models with a clear 4xx);
  api.workflow.execute-node's 3 server nodes not yet tenant-aware;
  `useLocalChat`→adapter consolidation deferred (spec allows).
- Verified: precommit + 486 tests green. Runtime verify still needed
  (Vertex streaming, tool continuation, budget, RAG 503-on-missing-index).

## Phase 2 — StorageProvider — IN PROGRESS

### Slice 2a — server storage foundation — DONE (2026-08-19)

- **Key discovery: this repo's Drive layout is FLAT** — a file's Drive NAME is
  its relative path ("web/index.html" is one file under the gemihub root;
  folders are virtual, `vfolder:` ids in api.drive.tree). So Drive already has
  path identity and the Drive provider needs no hierarchy mapping; the path
  index is just the inversion of `_sync-meta.json` (fileId → name=path).
- New `app/services/storage/`:
  - `types.ts` — MountContext (`gcs:{orgId}/{projectId}` | `drive:{rootFolderId}`
    mountKeys), ObjectMeta with `revision`, StorageConflictError (412) /
    StorageNotFoundError (404), cleanRelativePath.
  - `gcs-provider.server.ts` — adapter over gcs-storage.server.ts
    (generation→revision, Gcs errors→Storage errors).
  - `drive-path-index.server.ts` — sync-meta inversion (no new index built).
  - `drive-provider.server.ts` — path-identity Drive ops; **revision =
    md5Checksum** (content-hash surrogate; headRevisionId upgrade deferred);
    writes/renames/deletes keep `_sync-meta.json` fresh via
    upsertFileInMeta/removeFileFromMeta; delete is hard-delete (trash/ soft
    delete stays a client-side flow decision).
  - `resolve-mount.server.ts` — `mount` param ("drive" | "project:{id}") →
    server-trusted MountContext; project mounts gate through
    requireProjectAccess (read=viewer, write=editor); drive mount requires a
    Google session with Drive tokens.
  - `provider.server.ts` — dispatch by mount kind.
- Unified routes registered (fork contracts, `mount` + `ifRevisionMatch`
  naming): `/api/storage/{read,write,delete,list,tree,rename,upload}` and
  `/api/storage/move-between-mounts` (generalized from the fork's
  move-between-projects: GCS↔GCS same-org native copy; Drive↔GCS explicit
  byte transfer; personal-project restriction dropped per the unified design).
- `storage-route-utils.server.ts` (provider-neutral errors) and
  `rate-limiter.server.ts` ported. Audit + rate limit apply to gcs mounts only
  (Firestore-backed).
- Precommit + tests green. NOT yet manually verified against a real bucket —
  Phase 2 verify list still applies.

### Slice 2b — client storage stack — DONE (2026-08-19)

- **Key discovery #2: the fork's storage cache is a SEPARATE IndexedDB
  database** (fork: `gemihub-ent-storage`; here renamed `gemihub-storage`),
  and the fork's `indexeddb-cache.ts` is only a compatibility facade over it.
  So this repo's Drive cache (`gemihub-cache` DB, `indexeddb-cache.ts`) stays
  completely untouched — **no union merge, no DB version bump needed**
  (deviation from the spec's "bump and discard" instruction, which presumed a
  shared DB; separate DBs are strictly safer for Drive users).
- Ported with a coordinated rename table
  (`tenantProjectId`→`mountKey` with `gcs:{orgId}/{projectId}` /
  `drive:{rootFolderId}` values, `*ForTenant`→`*ForMount`,
  `generation`→`revision`, `ifGenerationMatch`→`ifRevisionMatch`,
  fetch param `projectId`→`mount` = "project:{id}", server responses are
  ObjectMeta so client-side objectPath is derived via
  objectPathForCachedFile):
  - `services/storage-cache.ts` (IndexedDB, mount-keyed)
  - `services/sync-diff-storage.ts` (+test) — pure diff over `revision`
  - `services/storage-sync.ts` — client push/pull engine for storage mounts
  - `services/tree-storage-mutations.ts`, `services/edit-history-storage.ts`
    (fork's edit-history-local, renamed — this repo's Drive
    `edit-history-local.ts` untouched)
  - `types/tree.ts`, `types/storage-drag.ts` (+test),
    `hooks/sync-conflict-mapper.ts` (+test)
  - fork `useSync` → **`hooks/useStorageSync.ts`**, fork `useFileWithCache` →
    **`hooks/useStorageFileWithCache.ts`** (side-by-side with this repo's
    Drive hooks — deliberate deviation: the spec's single generalized useSync
    is deferred until both stacks are proven; Drive regression-risk wins).
  - `EnterpriseContext.useTenantProjectId` → `useProjectMountKey`
    (returns `gcs:{orgId}/{projectId}`).
- `storage-cache.test.ts` NOT ported yet — needs devDep `fake-indexeddb`
  (install consent pending). Re-add it right after install.
- Precommit green; 476 tests pass.

### Slice 2c — IDE mount switching — LANDED (2026-08-19), needs runtime verify

Architecture (much smaller than feared, via two centralizing seams):

1. **Client cache dispatcher.** `indexeddb-cache.ts` is now a mount-aware
   dispatcher: Drive impl moved to `indexeddb-cache-drive.ts` (untouched
   logic, "gemihub-cache" DB, fileId identity); project impl in
   `indexeddb-cache-mount.ts` (fork facade adapted; storage-cache-backed,
   path identity). Active mount comes from localStorage
   `gemihub-active-tenant-project`, written by EnterpriseProvider's layout
   effect. `loaderData` and Drive-push-specific fns
   (applyPushedFileMetadata, saveLocalConflictBackup) always use the Drive
   impl. `CachedFile` gained optional contentType/revision/dirty fields.
   Edit history flows through the dispatcher automatically
   (edit-history-local uses it), so `edit-history-storage.ts` and
   `useStorageFileWithCache.ts` are currently UNUSED (kept for later).
2. **Server route compat.** Every IDE client call goes through
   `/api/drive/files` (23 actions) and `/api/drive/tree`. Both now resolve
   the session's project selection (`resolveProjectMountFromSession`;
   explicit `mount` param overrides, "drive" forces legacy) BEFORE
   getValidTokens (tokenless org sessions have no Drive tokens) and delegate
   to `storage/drive-compat.server.ts`, where fileId = mount-relative path
   and responses keep Drive shapes ({file, files, meta piggyback keyed by
   path}). Supported: list/metadata/read/search/raw (with the same XSS-safe
   raw headers)/upsertChecked (md5 compare + revision-guarded write)/
   findByName/create/create-image/update/updateBinary/rename/bulkRename/
   delete/bulkDelete (trash/ rename semantics). 501: export,
   import-google-workspace, create-markdown-pdf/html, encrypt/decrypt,
   publish/unpublish (later phases).

Other pieces:
- `_index.tsx`: loader resolves enterprise in parallel (isFirestoreAvailable-
  gated, never throws), auto-selects the single-org default project
  (persisted only when token refresh produced no cookie — a second commit
  from the stale request cookie would revert refreshed tokens), serves
  tokenless sessions when a project selection is ready (else
  /login?workspace=pending stays), and wraps the IDE in EnterpriseProvider.
- `useSyncUI` runs both `useSync` (Drive) and `useStorageSync` and selects by
  mount; Drive `useSync`, `pending-file-migration` pinned to
  `indexeddb-cache-drive` and gated (effects + every callback via
  projectActiveRef) so Drive push/pull is inert on a project mount.
- `useFileWithCache`: Drive temp-file upload skipped on project mounts
  (would leak project content to personal Drive); reads/saves work
  unchanged through the dispatcher + route compat.
- `useFileUpload`: project mounts upload via one `/api/storage/upload`
  batch; Drive resumable + File Search RAG registration skipped.

Verified: precommit + 486 tests green; forbidden-assumption scan clean.
NOT yet runtime-verified (needs GCS bucket + org): the whole Phase 2 verify
list still applies.

Known gaps / follow-ups for 2c polish:
- Org/ProjectSwitcher not yet mounted in the IDE Header (switch via
  settings > 組織管理 tab). 
- settings.tsx still redirects tokenless sessions (tenant settings = Phase 3).
- `/api/search`, temp-edit URLs, publish, encrypt are Drive-only for now
  (501/graceful).
- Sign-out does not clear `gemihub-active-tenant-project`; a stale key on a
  shared browser exposes the previous user's mount-cache reads until _index
  renders (fork has the same issue) — clear it in the logout flow later.
- Offline fallback drops enterprise context (NO_ENTERPRISE) — offline
  project work falls back to the Drive cache view.
