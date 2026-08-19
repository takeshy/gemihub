# GemiHub Business to GemiHub adaptation map (reverse lookup)

The inverse of `../gemihub-business/.agents/skills/port-gemihub-updates/references/adaptation-map.md`.
Read this before absorbing fork code that touches AI, files, sync, auth,
settings, plans, uploads, hosted pages, or server routes.

The target model is **coexistence**, not substitution: a session always has a
Drive mount (`mountKey: drive:{rootFolderId}`); an organization member
additionally gets a GCS project mount (`mountKey: gcs:{projectId}`) while a
project is selected. Fork code assumed GCS/Vertex was the only world — every
such assumption must become a provider branch, not a replacement.

## Storage: Cloud Storage code arrives, Drive stays the default

| Fork (`gemihub-business`) | This repo (unified) |
| --- | --- |
| `gcs-storage.server.ts` with `ProjectAccessContext` | Becomes the GCS provider under `app/services/storage/`; Drive provider wraps `google-drive.server.ts` behind the same path-based `StorageProvider` interface |
| Tenant-relative paths as the only identity | Paths stay canonical; Drive is adapted via a path→fileId index extracted from `_sync-meta.json` (`sync-meta.server.ts`) into `storage/drive-path-index.server.ts` |
| GCS `generation` / `ifGenerationMatch`, 412 conflicts | Abstract to `revision: string` (Drive: `headRevisionId` + `md5Checksum`); both normalize to `StorageConflictError` |
| `/api/storage/*` requiring `projectId` + `requireProjectAccess` | Canonical routes take a `mount` param (`project:{id}` \| `drive`); ACL applies only to `gcs-project` mounts. `/api/drive/*` survives only for Picker, resumable upload, Docs conversion, publish/unpublish, temp-file fast path |
| `storage-cache.ts` keyed by `tenantProjectId` | Key by `mountKey`; bump IndexedDB version, discard old cache (no migration) |
| `sync-diff-storage.ts`, `storage-sync.ts` | Generalize over `revision`; this repo's `sync-diff.ts` / `sync-meta.server.ts` become Drive-provider internals |
| `/api/storage/move-between-projects` | Generalize to `/api/storage/move-between-mounts`; same-provider = rename, Drive↔GCS = explicit byte transfer |
| `PersonalStorageShelf.tsx` + personal projects | Personal projects are **deleted**; the shelf becomes `DriveShelf.tsx` showing the user's My Drive (`mount=drive`) |
| "This account was created before enterprise mode" hard requirements | A Hubwork account without an org serves from its Drive mount; nothing may require `projectId` on the default path |

Preserve tenant isolation, path normalization, excluded paths
(`gemibiz/` prefix → `gemihub/`), byte-safe binary handling, checksums,
generation preconditions, audit metadata, and cache invalidation from the fork.
Preserve this repo's conflict dialog, conflict backups, untracked detection,
push guard, trash, and pending-file (`new:` id) migration as provider-neutral
layers.

## AI: Vertex arrives, the user's own Gemini key stays the default

| Fork | This repo (unified) |
| --- | --- |
| `createVertexClient(tenant)`, ADC / per-org OAuth, server-side only | Becomes the `vertex` provider under `app/services/ai/`, selected **only** when the active mount is `gcs-project` |
| No API-key path at all | `genai-key` provider (this repo's `gemini-chat-core.ts`, browser-side with the user's key) is the default for every other situation. Keep all no-key affordances: `api-key-cache.ts`, `settings-api-key.ts`, `api.auth.unlock.tsx`, `PasswordPromptDialog.tsx`, settings key validation |
| `VERTEX_MODELS` + `assertModelAllowed` | One registry `app/services/ai/models.ts` (`{id, provider, capabilities, price}`); folds in `MODEL_PRICING` from `gemini-chat-core.ts`. `assertModelAllowed` = provider support × project `allowedModels`. `settings.apiPlan` keeps governing `genai-key` model permission |
| `chat-stream-client.ts` SSE client | Adopt as the single SSE client; `useLocalChat.ts` shrinks to an adapter emitting the same `StreamChunk` shapes — do not delete it. `useInteractionsChat.ts` + `/api/chat/interactions` stay as the genai-key paid path |
| Firestore vector RAG (`ragChunks`, gemini-embedding-2, 2048 dims) | One `RagProvider.search(query, ctx)` at `/api/rag/search`: `gcs-project` → Firestore vector search; `drive` → Gemini File Search (`file-search.server.ts`; move the API key from URL query to header while here) |

UI copy rule: the key is unnecessary **inside a project**, never "unnecessary
for organization members" — a member still needs a key in their Drive mount.

## Product model: plans stay, fork's "everything is paid" does not

| Fork | This repo (unified) |
| --- | --- |
| No consumer plans; `hasPremium={true}` unconditionally | Stripe billing stays. Plans: `lite` \| `business` (replaces `pro`) \| `granted`. No production `pro` data exists — rename directly, no read-normalization needed |
| Org creation restricted to `SUPER_ADMIN_EMAILS` | A completed Stripe `business` checkout is a second authorization: the webhook provisions the org (Owner = purchaser) + one default shared project |
| `ProjectVisibility: "personal"`, `personalOwnerUid`, personal auto-creation | Deleted. The My Drive mount takes the personal slot in the FileTree shelf |
| Vertex/GCS-only publishing (`hubwork.site.$.tsx` calling `listObjects`/`readObject` directly) | Published pages read `web/**` through the StorageProvider so Drive-backed accounts and GCS org projects serve from the same code. Keep `X-Robots-Tag` and CDN cache headers |

## Cross-cutting

- Settings: fork's `getSettingsForTenant`/`saveSettingsForTenant` become the
  gcs-mount branch; Drive-mount settings keep this repo's path
  (`gemihub/settings.json` on Drive).
- Tenancy gating: org features gate on `isFirestoreAvailable()`; with no Google
  Cloud credentials (self-hosting) the app is Drive + API key only, silently.
- Naming: fork's user-facing "Cloud Storage" wording does NOT come across
  as-is; storage labels take a `{storageName}` i18n variable resolved from the
  active mount.
- Workflow nodes: re-point `drive-*` node handlers at the provider **without
  renaming node types** — saved workflows must keep working. `gemibiz-command`
  → `gemihub-command` (this repo's existing name).
- Routes: register in `app/routes.ts` and regenerate route types; never copy
  only the route file.

## Review questions before declaring a slice done

1. Does an ordinary gemihub.net user (no org) see zero behavior change?
2. Does every fork-sourced code path branch on the active mount rather than
   assuming GCS/Vertex?
3. Did any `gemibiz` literal, `gemihub.online` URL, mandatory `projectId`, or
   "no API key needed" assumption leak in?
4. Are this repo's stored contracts (node types, settings paths, localStorage
   keys, `/__gemihub/api.js`) untouched?
5. Do `npm run precommit` and `npm run test` pass, and is the phase
   independently deployable?
