# Backlog: this repo's recent work vs the fork

Verified 2026-08-19 against `business/main` (fork HEAD `21d847c`). Because the
merge direction is fork → this repo and this repo wins for engine / editor /
dashboard / plugins, most gemihub-only work survives automatically. It matters
only for **fork-winning files**, where this repo's behavior must be re-landed
on top of the adopted fork version.

## Spec backlog items, verified status

| Item (gemihub commits) | Status in fork | Consequence for the merge |
| --- | --- | --- |
| MCP 2026 transport/OAuth (`270d583`, `7edcc4e`) | **Already ported** (fork `225cb97`; `MCP_PROTOCOL_VERSION = "2026-07-28"` present in both) | None — but diff `mcp-client.server.ts` / `mcp-oauth.server.ts` at merge time; fork adds tenant scoping |
| Timeline tools + calendar launcher (`60a4ca8`, `026c68d`, `8f1ddb5`) | **Already ported** (fork `d5a4279`, 2026-07-27; `ToolLauncher.tsx`, `CalendarWidget.tsx`, `system-timeline.ts` present) | None for the base feature |
| Later timeline fixes (`936824e` "Reload only today's Timeline file", `acfef7e` PR #15, both 2026-08-02) | Unverified (after fork's 07-27 sync; possibly in `338aff5`) | This repo wins for `app/dashboard/**` — survives automatically |
| Mobile layout fixes (`08a55b0`, `aec56e4`) | Unverified | This repo wins for UI components — survives; re-check fork-winning `_index.tsx` |
| Drive sync repairs (`3c7b3d1`, `39b1cab` "Harden Drive push preflight and recovery", `11fe89f` "Fix stale Drive IDs in full push") | **Deliberate fork skips** (Drive-specific) | Must be collected by the Drive provider in Phase 2 — this is the main backlog item |
| Conflict backups (`8287726`) + pending pull changes (`00975ca`) | Possibly covered by fork `338aff5` "Sync recent Gemini and conflict recovery updates" (2026-08-17) | Must survive the Phase 2 `useSync.ts` re-land regardless — diff both versions |
| Markdown editor loading stalls (`eb61e17`) | Fork has equivalent-looking fixes (`fc5e9f4`, `a548bf8`, 2026-08-19) | This repo wins for editor — verify no regression when touching shared chunk-loading code |
| Gemini Flash model update (`6d9dce8`) | Fork did its own (`e94a7ef`, "Migrate Gemini 3.5 Flash to 3.6") | Reconcile in the Phase 3 model registry (`app/services/ai/models.ts`) |
| Agent Plugins v1 (`f50f510`, `a895c68`) | **Already ported** (`9fb3343`, `e62ea59`, tenant-scoped) | This repo wins for plugins; fork's tenant scoping folds into the provider |

## Re-land checklist per fork-winning file (Phase 2–4)

When adopting the fork's version of these files, re-land this repo's behavior:

- `app/hooks/useSync.ts` — conflict backups (`8287726`), pending ignored pull
  changes (`00975ca`), push preflight/recovery (`39b1cab`), stale-ID full push
  fix (`11fe89f`), `sync-push-guard.ts`, `pending-file-migration.ts`,
  untracked detection.
- `app/services/indexeddb-cache.ts` — timeline cache additions (`60a4ca8`)
  and any schema fields added since 2026-07; then bump DB version for mount
  keying.
- `app/components/ide/ChatPanel.tsx` — tool-launcher hook (`60a4ca8`),
  Gemini mixed-tool interaction fix (`c8537fd`), current model list.
- `app/routes/_index.tsx` — mobile layout fixes (`08a55b0`, `aec56e4`),
  timeline/pending-dashboard wiring (`60a4ca8`).
- `useTreeFileOperations.ts` / `useTreeFileCreate.ts` / `useTreeDragDrop.ts` —
  any gemihub-side fixes after 2026-07-27; recover Drive behavior via the
  provider, not by re-introducing IDs.
- Settings tabs (`GeneralTab`, `SyncTab`, `RagTab`, `settings.tsx`) — API-key
  autofill-ignore fix (`a9bef4c`) and everything key-related must survive.

## Verification method

Subject matching is unreliable — the fork squashes ports into
"Sync recent ..." commits (`338aff5`, `d5a4279`, `4d2a6e9`, `7f8a447`) and
records only 4 `Source-Commit` trailers. At merge time, diff file contents
(`git diff HEAD..business/main -- <path>`), not history.
