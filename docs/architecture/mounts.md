---
type: Architecture
title: Storage Mounts & AI Providers
description: "Coexistence model: the default Drive mount (user's own Drive + own Gemini API key) and the org project mount (GCS + Vertex AI), selected per user and per mount."
tags:
  - architecture
  - storage
  - organizations
  - vertex
---
# Storage Mounts & AI Providers

GemiHub runs on a *coexistence* model, not a deployment switch. Every session
has a **Drive mount** — the user's own Google Drive. Its AI provider is chosen
independently: the user's Gemini API key (default), GemiHub Vertex AI against a
personal prepaid balance, or the user's own Vertex AI connection. A member of
an organization additionally gets a **GCS project mount**
while an org project is selected. An ordinary user (or a self-hosted install
with no Google Cloud credentials) never sees any of the organization surface.

## Mounts

| | Drive mount (default) | GCS project mount |
| --- | --- | --- |
| Who | everyone | org members with a project selected |
| Files | the user's Drive `gemihub/` folder (flat layout: the Drive file NAME is the relative path; folders are virtual) | per-project prefix in the shared tenant GCS bucket |
| Identity | relative path (fileId on Drive resolves via `_sync-meta.json`) | relative path |
| Concurrency | `revision` = md5Checksum | `revision` = GCS `generation` (412 on mismatch) |
| Local cache | `gemihub-cache` IndexedDB (fileId keys) | `gemihub-storage` IndexedDB, namespaced by `mountKey` (`gcs:{orgId}/{projectId}`) |
| Sync | `useSync` (push/pull, conflict dialog) | `useStorageSync` (same UI contract) |
| AI | `genai-key` (default), personal prepaid `vertex`, or customer-owned `vertex` | organization `vertex` or customer-owned `vertex`; server SSE, no Gemini API key |
| RAG | Gemini File Search with `genai-key`; unavailable with personal Vertex | Firestore vector search (`ragChunks`) |

Key modules: `app/services/storage/` (providers, `resolveMount`,
`drive-compat.server.ts`), `app/services/indexeddb-cache.ts` (mount-aware
dispatcher), `app/services/ai/` (Vertex handlers, `models.ts` registry),
`app/hooks/chat-stream-client.ts` (project-mount chat orchestrator).

## Route dispatch

- `/api/storage/*` take `mount = "drive" | "project:{id}"` and speak paths +
  `ifRevisionMatch`.
- `/api/drive/files` and `/api/drive/tree` transparently serve the project
  mount when the session has one selected (fileId = path there), so legacy
  client call sites work on both mounts. An explicit `mount=drive` forces the
  Drive path.
- AI routes (`/api/chat`, chat history/compact, workflow/base/timeline AI,
  `/api/rag/*`, `/api/settings/rag-sync`, history routes) dispatch to Vertex/
  tenant handlers when the request carries a `projectId`.

## The My Drive shelf

While an organization is selected, the IDE's main FileTree shows the organization;
`DriveShelf` (amber strip above the tree) shows the user's Drive. Dragging
between the shelf and the tree copies files across mounts through
`/api/storage/move-between-mounts` (GCS↔GCS is a native copy; Drive↔GCS is a
byte transfer). Clicking a Drive file opens a read-only preview modal without
changing the active organization. The main IDE, its cache and edit history,
and all Pull/Push operations remain scoped to the organization. Internally a
single compatibility `default` project ID still namespaces storage and ACLs;
it is not exposed as a selectable workspace level.

## Organizations & plans

Organizations/projects/members/ACL live in Firestore (`organizations` with
`projects`/`members` subcollections), gated on `isFirestoreAvailable()` so
self-hosting silently stays Drive-only. Plans are `lite | pro | business | granted`
— buying **Business** (¥7,500 / $50 per month, billed per organization)
provisions an organization for the purchaser (Stripe webhook →
`business-provisioning.server.ts`) with a default shared project, a
$30/month Vertex AI budget (top-ups ¥1,500 per unit, $9 credited —
`VERTEX_TOPUP_UNIT_USD` charged / `VERTEX_TOPUP_UNIT_CREDIT_USD` credited — idempotent via `addAiBudgetTopUp`), and 100 GB of project storage — expandable in 500 GB
units ($30/¥5,000 per month, add-on subscriptions recorded in
`Organization.storageAddons` and enforced by `storage-quota.server.ts`
inside `gcs-storage.writeObject`).
Published `web/**` pages serve through the storage provider
(`hubwork-site.server.ts`) from whichever mount the account is linked to.

### Cancellation lifecycle

One helper decides what an organization's data may still be used for:
`organizationLifecycle()` in `app/types/hubwork.ts`, enforced for every
project API by `requireProjectAccess` / `requireOrgAccess`.

| Lifecycle | Condition | Effect |
|-----------|-----------|--------|
| `active` | not canceled, `accountStatus: "enabled"` | normal operation |
| `read-only` | `billingStatus: "canceled"`, `now < deleteAfter` | reads and exports only |
| `expired` | `billingStatus: "canceled"`, `now >= deleteAfter` | 403 — data pending deletion |
| `disabled` | `accountStatus: "disabled"` without cancellation | 403 — no export grace |

`past_due` is a payment-recovery grace period and does not remove paid
features. When a Business subscription becomes `canceled`, hosted and paid AI
features stop and its organization project becomes read-only for 30 days
(`BUSINESS_CANCELLATION_RETENTION_DAYS`). Members may read and export files
during that window, but cannot write, delete, move, run organization AI (every
organization model is metered against the tenant, so all of them are blocked),
or change organization configuration. The IDE shows a banner with the export
deadline; the server answers writes with `OrganizationReadOnlyError` (403), not
a generic model or storage error.

Once `deleteAfter` passes the organization stops being served altogether and
its data waits for deletion. **Deletion is not automatic**: a service
administrator sees each account's lifecycle and deadline in the admin console
(`/admin/enterprise` → accounts). The billing record cannot be deleted on its
own because that would orphan and reopen the retained organization; tenant-data
purging is a separate operator procedure. A super
administrator is exempt from the 403 gates — support can still open a canceled
or expired organization to export it or transfer ownership — but the data
stays read-only in the app either way.

The subscription owner cannot leave or be demoted through self-service. The
owner holds the Stripe subscription, so a service administrator must move
ownership (add the new owner, then remove the old one), including after
cancellation.
