# `gemibiz` → `gemihub` rename table

Apply when absorbing any fork file. This repo already defines the target names
(right column verified present in this repo where noted "existing"); fork code
must land using them. 156 fork files contain `gemibiz` identifiers.

Data-migration status: no production Stripe subscribers exist (product
decision, 2026-08-19). If the fork's GCP project
(`project-6a1b8e8e-da95-4616-96e`) also holds no production data — confirm once
before Phase 4/5 — every row is a pure code rename with no migration script.

## Stored-data contracts (would need one-way migration only if fork data exists)

| Fork identifier | Occurrences | Rename to | Where / notes |
| --- | --- | --- | --- |
| `gemibiz-command` workflow node type | 26 | `gemihub-command` (existing) | Saved-workflow contract; this repo's name wins |
| `gemibizCommand` handler ids | 2 | `gemihubCommand` | Engine handlers |
| `gemibiz/` settings prefix (`gemibiz/settings.json`, `gemibiz/history/{chats,edit,execution,requests}`, `gemibiz/plugins`, `gemibiz/uploads`, `gemibiz/_sync-meta.json`, `gemibiz/_encrypted-auth.json`) | ~30 | `gemihub/` | GCS object paths: `user-settings.server.ts`, `*-tenant.server.ts`, `plugin-manager.server.ts`, `storage-tools.server.ts`, `rag-sync.server.ts`, `sync-client-utils.ts` (+ tests), `FileTree.tsx` hidden-folder set, `api.storage.upload.tsx` |
| `DEFAULT_RAG_STORE_KEY = "gemibiz"` / rag `settingName = "gemibiz"` | 3 | `"gemihub"` | `types/settings.ts:417`, `rag-sync.server.ts:461`, `api.settings.rag-sync.tsx:51`; also the Firestore `ragChunks` `settingName` field values |

## External contracts embedded in customers' published site HTML

| Fork identifier | Occurrences | Rename to | Where / notes |
| --- | --- | --- | --- |
| `/__gemibiz/api.js`, `/__gemibiz/auth/*` route paths | ~53 (`__gemibiz`) | `/__gemihub/...` (existing) | `routes.ts:111-118`, `hubwork.internal.*`, `webpage-review.server.ts`, `hubwork-ide-mock.server.ts`, html-preview mocks |
| `window.gemibiz` API (`gemibiz.get/post`, `gemibiz.auth.{require,login,logout,me,register}`, `gemibiz.normalizeLoginPath`) | ~35 | `window.gemihub` (existing) | `hubwork.internal.api-js.tsx`, tool definitions, manual chapter |
| `__gemibizNav` | 12 | `__gemihubNav` (existing) | Published-page nav shim |
| `__gemibiz_root` | 3 | `__gemihub_root` (existing) | Host-rewrite target in `server.js` / `vite.config.ts` |
| Route ids `gemibiz-auth-{login,logout,me,register,verify,register-verify}`, `gemibiz-api`, `gemibiz-api-js` | 8 | `gemihub-auth-*`, `gemihub-api*` | `app/routes.ts` route ids (internal, but keep consistent) |

## Browser-side keys (client cache/state; discard-and-refetch, no migration)

| Fork identifier | Occurrences | Rename to | Where / notes |
| --- | --- | --- | --- |
| `gemibiz-active-tenant-project` (localStorage) | 7 | `gemihub-active-tenant-project` | Project selection persistence |
| `gemibiz-language`, `gemibiz-theme`, `gemibiz-fontSize` (localStorage) | 3/2/2 | `gemihub-language`, `gemihub-theme`, `gemihub-font*` (existing) | This repo already has these keys — adopt this repo's exact names |
| `gemibiz-loader-cache`, `gemibiz-chunk-reload-at`, `gemibiz-open-home-dashboard` | 2/1/1 | `gemihub-*` | |
| `gemibiz-plugins` (IndexedDB DB name) | 1 | this repo's existing plugin DB name | `plugin-loader.ts:13` — check this repo's `PLUGIN_DB_NAME` and keep it |
| `gemibiz-sw-*` (service worker cache) | 1 | `gemihub-sw-*` (existing) | Keep this repo's current SW cache version counter |
| postMessage types: `gemibiz-request-navigate`, `gemibiz-admin-{request,response}`, `gemibiz-iframe-{navigate,touch}`, `gemibiz-preview` | 4/5/7/1 | `gemihub-*` | Cross-frame messages between app and published-page iframes |
| `STORAGE_DRAG_MIME = "application/x-gemibiz-storage-move"` | 1 | `application/x-gemihub-storage-move` | `types/storage-drag.ts` (fork-only file, rename on import) |

## Protocol / client identifiers

| Fork identifier | Occurrences | Rename to | Where / notes |
| --- | --- | --- | --- |
| MCP `CLIENT_INFO name: "gemibiz"` | 1 (+test) | `"gemihub"` | `mcp-client.server.ts:94` — this repo's value wins |
| MCP OAuth `clientId = "gemibiz"` / `gemibiz-oauth-probe` | 3 | this repo's values | `api.settings.mcp-test.tsx`, `mcp-oauth.server.ts` |

## Infrastructure names (Terraform / GCP resources — Phase 6)

| Fork identifier | Rename to | Where / notes |
| --- | --- | --- |
| `module "gemibiz"` sourcing `../../modules/gemibiz` | `module "gemihub"` → `../../modules/gemihub` | `terraform/environments/prod/main.tf:75` — also a defect (module dir doesn't exist in the fork) |
| `gemibiz-{main,wildcard,net-main,net-wildcard}-{cert,entry}`, `gemibiz-dns-auth`, `gemibiz-net-dns-auth`, `gemibiz-cert` | `gemihub-*` per this repo's `networking.tf` conventions | Certificate Manager / cert map entries |
| `gemibiz-online`, `gemibiz-net` (DNS zones) | fold into this repo's DNS setup | `modules/gemihub/dns.tf`; `gemihub.online` domain itself is retired in Phase 6 |
| `gemibiz-control-plane`, `gemibiz-dev`, `gemibiz-local-dev`, `gemibiz-app-logs-to-bigquery` | `gemihub-*` | `control-plane/`, `environments/dev/`, BigQuery sink; only relevant if those stacks are imported |
| `gemibiz-company`, `gemibiz-team-*`, `gemibiz-abc123`, `gemibiz.example.com` | `gemihub-*` | Docs/test fixtures — rename for consistency |
| tf outputs `gemibiz.{nameservers,load_balancer_ip,cloud_run_url}` | `gemihub.*` | environment outputs |

## Explicitly NOT renamed

- This repo's existing `gemihub-command`, `gemihub/` folder, `/__gemihub/api.js`,
  localStorage keys, SW cache names — they are the targets.
- Fork route *file* names under `app/routes/hubwork.internal.*` may keep their
  filenames; only URL paths, ids, and emitted identifiers must say `gemihub`.
