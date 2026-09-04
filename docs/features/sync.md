---
type: Guide
title: Sync
description: Push/pull sync between the IndexedDB cache and Google Drive with MD5 change detection and conflict resolution.
tags:
  - sync
---
# Sync

Manual push/pull synchronization between the browser (IndexedDB) and Google Drive.

## Features

- **Manual Sync**: Push and pull changes when you want
- **Offline-First**: Files are cached in IndexedDB for instant access
- **Local-first Soft Delete**: Deleted files disappear locally immediately and are queued for the next Push, which moves them to a recoverable `trash/` folder on Drive
- **Conflict Resolution**: Choose local or remote version with automatic backup
- **Full Push / Full Pull**: Bulk sync for initial setup or recovery
- **Untracked File Management**: Detect, restore, or delete orphaned remote files (since 2026-09-04, `GET /api/sync` also registers untracked root files automatically — see below)
- **Trash & Conflict Backup Management**: Restore or permanently delete trashed files and conflict backups

## Commands

| Command | Description |
|---------|-------------|
| **Push** | Upload local changes (incremental) |
| **Pull** | Download remote changes (incremental) |
| **Full Push** | Upload every cached file whose checksum differs from Drive + merge metadata into remote |
| **Full Pull** | Download entire remote vault (skip matching hashes) |

Header buttons: Push and Pull buttons are always visible. Badge shows count of pending changes.
- **Push Badge**: Count of locally modified files (excluding system/history files and files whose content was reverted to the synced state) plus queued soft deletions. The Push dialog lists the same set: modified/new files and, as <kbd>🗑</kbd> rows, the files the push is about to move to `trash/` (their diff shows the Drive content being removed; there is no "Open" button since the local copy is already gone).
- **Pull Badge**: Count of pending remote work — updates to already-cached files (`toPull`), conflicts, and files deleted on remote (`localOnly`). Brand-new remote files are **not** counted here; they are auto-registered as uncached entries during background polling and surface directly in the file tree.
- **Stale-change warning**: An amber triangle with a day count appears next to the badges when the oldest unpushed edit is more than 7 days old (`useStalePendingEdits.ts`, `STALE_PUSH_WARNING_DAYS`). Local edits live only in IndexedDB until a Push, and `editHistory` is the *only* record that a file changed — the checksum in sync meta still describes the last-synced state. If that store is evicted (storage pressure, Safari's ITP, "clear site data"), the edits stop looking modified and the next Pull overwrites them silently. Clicking the warning opens the Push list.
- **Nature of Change**: Clicking a badge shows a file list with icons indicating the change type:
  - <kbd>✎</kbd> (Blue): Modified file
  - <kbd>🗑</kbd> (Red): Deleted on remote

---

## How Sync Works

### Overview

The system tracks file states using metadata:
- **Local Meta**: Stored in IndexedDB (`syncMeta` store, key `"current"`)
- **Remote Meta**: `_sync-meta.json` file on Google Drive

Each metadata contains:
- `lastUpdatedAt`: Timestamp of last sync
- `files`: MD5 checksum and modification time for each file (keyed by file ID)

File contents are cached in the IndexedDB `files` store. All edits update this cache directly (no Drive API call). The MD5 checksum in the metadata is only updated during sync operations (Push/Pull) and file reads — it reflects the last-synced state, not the current local content. Local modifications are tracked separately via the `editHistory` store.

### Background Polling

The client polls for remote changes every 5 minutes while the app is active and idle, and additionally re-checks when the tab becomes visible again (throttled to once per 30 s) or the browser comes back online — the Pull button is disabled while the badge reads 0, so a user returning to the tab would otherwise wait a full interval. When a fresh `_sync-meta.json` is fetched:

1. **Queued deletions that lost to a remote edit are cancelled.** A soft-deleted file whose Drive checksum (or name) no longer matches the local baseline was modified on another device after the deletion was queued. The reservation is dropped, the file re-enters the cached remote meta (and therefore the tree) as an ordinary pending pull, and a persistent toast lists the affected paths. Push applies the same rule before its pre-check, so the pull dialog opened from a "Pull first" rejection actually lists the file. Without this the file was hidden from the badge and dialog (pending-deleted ids are filtered out of the cached remote meta) while the push pre-check, which reads the raw remote meta, kept rejecting.
2. **Cached remote meta is refreshed** (preserving any local-only `new:` entries).
3. **New remote files are auto-registered** into local sync meta as metadata-only (uncached) entries. The tree picks them up on the next `tree-meta-updated` event; content is fetched lazily the first time the user opens the file. This is what keeps the Pull badge from inflating just because another device added files.
4. **A persistent toast is shown** whenever new entries are auto-registered and a prior sync exists. It lists every new file path (sorted) and stays until the user manually dismisses it, so additions buried deep in the tree are not missed. First-ever fetches skip the toast since every file would otherwise qualify as "new".
5. **`tree-meta-updated` is dispatched** when the remote meta's `lastUpdatedAt` changed, new entries were registered, or a deletion was cancelled, so remote-side renames/deletions/additions appear without requiring a manual Pull.
6. **Pull / Push counts are recomputed.**

Local sync meta is updated as a **delta** through `patchLocalSyncMeta` (one IndexedDB readwrite transaction that reads the current record, applies the mutation, and writes it back). Polling and Pull used to read the meta once, await per-file cache reads or downloads, then write the whole snapshot back — any entry written in between (a `new:` → Drive migration, a file created from the tree) was lost, and the migrated file was later re-registered as uncached. Push already merged against a fresh read; all three now do.

### Sync Diff

The diff algorithm compares two metadata snapshots plus a set of locally edited file IDs:

| Input | Description |
|-------|-------------|
| **Local Meta** | Client's last-synced snapshot (IndexedDB) |
| **Remote Meta** | Server's current snapshot (`_sync-meta.json`, read-only during diff) |
| **locallyModifiedFileIds** | File IDs from IndexedDB `editHistory` (tracks local edits) |

Detection logic per file:

| Local Changed | Remote Changed | Result |
|:-------------:|:--------------:|--------|
| No | No | Skip (unchanged) |
| Yes | No | **toPush** |
| No | Yes | **toPull** |
| Yes | Yes | **Conflict** |
| Local only | - | **localOnly** (Remotely deleted) |
| - | Remote only | **remoteOnly** (New remote) |

Where:
- `localChanged = locallyModifiedFileIds.has(fileId)` — the `editHistory` store tracks which files have been edited locally since the last sync
- `remoteChanged = localMeta.md5Checksum !== remoteMeta.md5Checksum || localMeta.name !== remoteMeta.name` — remote meta diverges from local meta when another device has pushed changes (detects both content and name changes)

No live Drive API listing is needed during the diff: the `drive.file` scope ensures only GemiHub-family clients can modify these files, so `_sync-meta.json` is treated as authoritative. `GET /api/sync` keeps it that way by reconciling the meta against one root listing before returning it: entries whose file is gone, trashed, or moved out of the root are removed (verified by id, so a partial listing cannot manufacture deletions), and root files missing from the meta are added (`addUntrackedFilesToSyncMeta`). The latter covers an external client (Desktop/Obsidian plugin) that uploaded files but crashed before writing the meta; such files used to stay invisible until the user ran "Detect untracked files".

---

## Push Changes (Incremental)

Uploads locally-changed files to remote.

### Flow

```
1. PRE-CHECK: Diff check before writing anything
   ├─ Read LocalSyncMeta from IndexedDB (may be null on first sync)
   ├─ GET /api/sync → { remoteMeta, syncMetaFileId }
   │   └─ Server: find + read _sync-meta.json, return meta and its file ID
   ├─ Compute diff client-side (localMeta vs remoteMeta + locallyModifiedFileIds)
   └─ Remote has blocking changes (conflicts, edit-delete conflicts, toPull, or remote-deleted entries still cached locally) → error "Pull first".
       The check applies the same filters as the Pull badge (`filterActionablePull`): sync-excluded paths, files whose cached content already
       matches the remote checksum, and stale uncached deletions do not block. Pure new remote files (`remoteOnly`) do not block push.

2. COMBINED MUTATION: Apply queued deletions and file updates via one API call
   ├─ Get modified file IDs from IndexedDB editHistory (tracked and new/untracked files alike; `new:` placeholders excluded)
   ├─ Filter out system files and excluded paths (history/, plugins/, etc.)
   ├─ Include binary files (base64-encoded) with encoding flag (skip hasNetContentChange)
   ├─ Filter out reverted text files (hasNetContentChange = false)
   ├─ Read all modified file contents from IndexedDB cache
   ├─ Reconstruct each text file's last-synced content from local edit-history diffs
   │   └─ Send only the resulting compact `historyDiff`, avoiding both a Drive read and a duplicate full-content upload
   ├─ Include persistent deletion reservations as `deleteFileIds`
   ├─ POST /api/sync { action: "pushFiles", files, deleteFileIds, remoteMeta }
   │   └─ Server:
   │       ├─ Use client-provided remoteMeta (skip re-reading _sync-meta.json)
   │       ├─ Move reserved deletions to trash while uploads run
   │       ├─ For each file (parallel, max 5 concurrent):
   │       │   ├─ Use the client-supplied diff for edit history (Drive-read fallback only when unavailable)
   │       │   ├─ Skip upload if content is identical to remote (optimization)
   │       │   └─ Update file on Drive
   │       ├─ Re-read the latest _sync-meta.json, merge only this push's entries, write once
   │       ├─ Save remote edit history in background (best-effort)
   │       └─ Return results + updated remoteMeta
   ├─ Update IndexedDB cache with new md5/modifiedTime
   └─ Merge only the pushed files' entries into LocalSyncMeta from the returned remoteMeta
       (concurrent changes from other devices stay pending and surface on the next Pull)

3. CLEANUP
   ├─ Clear IndexedDB editHistory for pushed files only
   ├─ Clear IndexedDB editHistory for reverted files (no net change)
   ├─ Update localModifiedCount
   └─ Fire "sync-complete" event (UI refresh)

4. RAG (background, non-blocking)
   ├─ Register eligible files in RAG store
   │   └─ Failures recorded as "pending" in RAG tracking meta
   ├─ Save RAG tracking info
   └─ Retry previously pending RAG registrations
```

### Preconditions

| Local Meta | Remote Meta | Remote Newer | Action |
|:----------:|:-----------:|:------------:|--------|
| - | - | - | Nothing to push |
| - | exists | - | Nothing to push |
| any | any | Yes (with pending pulls) | Error: "Pull required" |
| any | any | No | Proceed with Push |

### Important Notes

- Push checks for conflicts and remote-newer **before** writing any files to Drive. If the check fails, nothing is written.
- Push drains local deletion reservations in the same request as file updates (see Soft Delete below).
- After a successful push, local edit history in IndexedDB is cleared for the pushed files and for reverted files (files whose content was edited then reverted to the synced state).

---

## Pull Changes (Incremental)

Downloads remotely-changed files to local cache. Brand-new remote files are registered as metadata-only (uncached) entries and are fetched lazily when opened.

### Flow

1. **Compute diff** using local meta vs remote meta (with `locallyModifiedFileIds`)
2. **Collect conflicts** (including edit-delete conflicts) — they are shown in the conflict UI after the non-conflict work below completes
3. **Clean up `localOnly` files** — files tracked in local sync meta but deleted on remote (moved to trash on another device) are removed from IndexedDB cache, edit history, and local sync meta. Entries that exist only in editHistory (new local files awaiting push) and `new:` placeholders are left untouched.
4. **Combine** `toPull` + `remoteOnly` arrays
5. **Skip download for entries that need no content**: `remoteOnly` (new remote files), binary files on mobile, files larger than 20 MB (`LARGE_FILE_CACHE_THRESHOLD`), sync-excluded paths, and files whose cached content already matches the remote checksum (lazy-fetched while local meta was stale). Their metadata is still written to local sync meta so the tree displays them and they stop counting as pending. When a binary-on-mobile or over-limit file **already has a stale cached copy, that copy is deleted** — reads trust the cache unconditionally, so it would otherwise be served forever; the file lazy-fetches on next open, as after Full Pull. For an already-current file whose remote name changed, the cache record's `fileName` is updated so the push dialog and exclusion checks see the new path.
6. **Download remaining files** in parallel (max 5 concurrent)
7. **Update IndexedDB cache** with downloaded files (for text files, `addCommitBoundary` is called before updating to preserve edit history session boundaries)
8. **Update local sync meta** with new checksums
9. **Fire "sync-complete" and "files-pulled" events** and update localModifiedCount

### Decision Tables

#### Files in Both Metas

| Local Meta | Remote Meta | Action |
|:----------:|:-----------:|--------|
| A | A | Skip (unchanged) |
| B | A | Skip (local-only change, uploads on next Push) |
| A | B | **Download** (remote changed) |
| B | C | **Conflict** (both changed) |

#### Files Only in Local Meta (Remote Deleted)

| Local Meta | Remote Meta | Action |
|:----------:|:-----------:|--------|
| A | - | **localOnly** → Remove from local cache (remote deletion synced) |

#### Files Only in Remote (New Remote)

| Local Meta | Remote Meta | Action |
|:----------:|:-----------:|--------|
| - | A | **remoteOnly** → Register metadata only (uncached); content fetched on first open |

---

## Lazy-Fetch (Uncached Files)

A file is **uncached** when its metadata is tracked in local sync meta but no entry exists in the IndexedDB `files` store. Three paths produce uncached entries:

| Source | Reason |
|--------|--------|
| Background polling auto-register | New remote files discovered between syncs |
| Incremental Pull | `remoteOnly` entries from the diff |
| Mobile / large-file skip | Binary files on mobile, files over 20 MB |

When the user opens an uncached file, `useFileWithCache` fetches the content from Drive, writes it into the cache, and dispatches a `file-cached` event that the file tree uses to update its indicator. No additional sync work is required.

### Bulk Caching

Uncached files can be downloaded on demand without waiting for first-open:

- **Folder right-click → "Cache folder (N)"**: Caches every uncached file under the selected folder (`new:` placeholders excluded). Only shown when uncached files exist in that subtree.
- **FILES header → Cache icon**: Caches every uncached file in the workspace. Disabled when all files are already cached or a bulk cache is in progress; the tooltip shows the pending count or current progress.

Both paths route through `useSync.cacheFilesByIds`, which chunks the IDs (200 per request), calls the `pullDirect` API, and writes each response into the cache. `cachingProgress` is exposed on the hook for UI feedback and the shared sync lock prevents concurrent bulk operations.

---

## Full Pull

Downloads all remote files, skipping those with matching hashes.

### Flow

1. **Rebuild remote meta** from Drive API (full scan)
2. **Filter out** system files (`_sync-meta.json`, `settings.json`) and Google Workspace native files
3. **Skip** binary content on mobile and files over 20 MB (the client deliberately sends no `skipHashes`: a cached checksum is the last remote baseline and can still match after the local bytes were edited, so every eligible file is fetched before edit history is cleared)
4. **Download** all non-skipped files in parallel (max 5 concurrent)
5. **Update IndexedDB cache** with downloaded files
6. **Delete stale cache** — remove cached files that no longer exist on remote, plus mobile-binary / over-limit entries
7. **Clear all local edit history** (remote is authoritative)
8. **Replace local sync meta** entirely with remote meta
9. **Fire "sync-complete" event** and update localModifiedCount

### When to Use

- Initial setup on a new device/browser
- Recovery after cache corruption
- When you want remote to be authoritative

---

## Full Push

Uploads every eligible file currently present in the local cache directly to Drive and merges metadata. **This is a destructive operation** — it does not check for conflicts or remote changes before overwriting. Cached copies replace their remote counterparts without conflict detection.

Files that are clean (no edit history) **and** whose last-synced checksum still matches the cached remote meta are skipped: their bytes are identical to Drive, and re-uploading them only bumped `modifiedTime`, which every other device then saw as a spurious pull. Files missing from the remote meta (trashed or moved outside the root) are still sent and recreated with a new id.

### Flow

1. **Batch upload** — all eligible cached files are sent in a single `pushFiles` API call with `forceRecreate: true`; server updates Drive files in parallel (max 5 concurrent), reads/writes `_sync-meta.json` once, and saves remote edit history in background
2. **Update IndexedDB** — cache and LocalSyncMeta updated with new md5/modifiedTime from server response
3. **Clear edit history** — if all eligible files were pushed, clear all edit history; otherwise clear per-file for successfully pushed files only
4. **Fire "sync-complete" event** and update localModifiedCount
5. **RAG registration (background)** — register eligible files, save tracking info, retry pending registrations

### When to Use

- Force remote metadata to match local state
- After bulk local edits that bypassed normal sync
- **Caution:** Unlike incremental Push, Full Push skips conflict detection and may overwrite remote changes made on other devices

---

## Conflict Resolution

Conflicts occur during Push or Pull when both local and remote versions of a file have changed since the last sync.

| Choice | What Happens |
|--------|--------------|
| **Keep Local** | Back up remote to `sync_conflicts/`, upload local content to Drive, update remote meta |
| **Keep Remote** | Back up local to `sync_conflicts/`, download remote content to IndexedDB |

After resolution:
- The resolved file's edit history entry is cleared
- Local sync meta is partially merged — only the resolved file's entry is updated from the server's remote meta (other remote changes are not applied until the next Pull)
- localModifiedCount is updated

The unselected version is always backed up for manual merging if needed. Binary files round-trip through base64: the winning content is uploaded with a binary update/create, and binary backups are written as real binary files (not base64 text).

### Backup Naming

```
{filename}_{YYYYMMDD_HHmmss}.{ext}
```

Example: `notes/daily.md` → `sync_conflicts/notes_daily_20260207_143000.md`

---

## Soft Delete (Trash)

File deletion uses a local-first soft delete model. The file is hidden locally and persisted in an IndexedDB deletion queue immediately, including while offline. The next incremental Push moves it to a `trash/` subfolder on Google Drive instead of permanently destroying it.

### Flow

1. User deletes a file (context menu → Trash)
2. The local cache and file tree are cleaned up, and a persistent deletion reservation is added
3. The Push badge includes the reservation
4. On the next Push, remote-change checks run before any deletion
5. If unchanged remotely, the server moves the file to `trash/` and removes it from `_sync-meta.json`
6. If it changed remotely, Push is rejected and Pull restores the remote version while cancelling that deletion reservation

### Cross-Device Sync

When a file is deleted on one device:
- The file is moved to `trash/` and removed from remote sync meta
- Other devices detect it as `localOnly` during their next Pull
- Pull automatically removes the file from their local cache

### Recovery

Trashed files can be managed from Settings → Sync → Trash:
- **Restore**: Moves the file back from `trash/` to the root folder and re-adds it to sync meta
- **Permanently Delete**: Removes the file from Drive entirely (irreversible)

---

## Temporary Sync

Quick file sharing without full sync overhead. Use when:
- You want to quickly share a single file across devices
- You need a backup before making risky edits
- You want to preserve specific files across a Pull (see tip below)

Files are stored with `__TEMP__/` prefix on Google Drive. **No metadata is updated** — equivalent to making the same edit on both devices manually.

Temp files can be managed from Settings → Sync → Temporary Files.

### Edit URL

After "Temp UP" saves the file, a confirmation dialog asks whether to generate an edit URL. If confirmed, the URL is copied to the clipboard. The edit URL allows editing the file from other apps (valid for 1 hour).

### Preserving Files Across a Pull

If you have local files that you don't want overwritten by a Pull, you can use Temp UP / Temp DL as a workaround:

1. **Before Pull**: Click "Temp UP" on the files you want to preserve
2. **Pull**: Perform the Pull — remote versions will overwrite local cache
3. **After Pull**: Click "Temp DL" on those files to restore your saved versions

---

## Renames

Renames are **not** local-first. Push uploads content by file id and never renames, and background polling rewrites the cached remote meta from Drive's name, so a cache-only rename would silently revert on the next poll or push. Every rename path therefore goes to Drive immediately and mirrors the returned `_sync-meta.json` entry into both the cached remote meta and local sync meta:

| Caller | Path |
|--------|------|
| File tree rename / folder rename / drag-move | `bulkRename` API → `updateTreeFromMeta` |
| Chat `rename_drive_file` / `bulk_rename_drive_files` | `renameRemoteFiles` + `applyRemoteMetaForFiles` (`drive-local.ts`) |
| Kanban card title, Secret Manager move, dashboard rename (`renameFileLocal`) | Same helpers as the chat tools; throws when Drive rejects the rename |

The one exception is a `new:` placeholder that has not been migrated yet: it is renamed in the cache only, and the pending migration uploads it under the current cached name.

## Chat-Initiated File Operations

When Gemini AI uses `update_drive_file` or `create_drive_file` tools in chat, file operations follow a local-first pattern to stay consistent with push/pull sync.

### update_drive_file (Local-First)

The server does **not** write to Drive. Instead, it reads file metadata only and returns the new content to the client via an SSE `drive_file_updated` chunk.

```
Chat → Server (getFileMetadata only, no Drive write)
     → SSE: drive_file_updated { fileId, fileName, content }
     → Client:
         1. addCommitBoundary(fileId)         — separate previous session
         2. saveLocalEdit(fileId, content)     — record diff in editHistory
         3. setCachedFile(content, old md5)    — update cache, keep last-synced md5
         4. addCommitBoundary(fileId)          — isolate chat edit as own session
         5. dispatch "file-modified"           — update sync badge count
         6. dispatch "file-restored"           — refresh editor if file is open
```

**Sync behavior after update:**
- `localMeta.md5` = old value (unchanged), `remoteMeta.md5` = old value (Drive untouched)
- `editHistory` has the fileId → `locallyModifiedFileIds` includes it
- Diff result: `localChanged = true`, `remoteChanged = false` → **toPush**
- Normal push uploads the new content to Drive

### create_drive_file (Drive + Local Seed)

The server creates the file on Drive (an ID is needed) and returns content + metadata via an SSE `drive_file_created` chunk.

```
Chat → Server (createFile on Drive + upsertFileInMeta)
     → SSE: drive_file_created { fileId, fileName, content, md5Checksum, modifiedTime }
     → Client:
         1. setCachedFile(content, Drive md5)  — seed cache with Drive checksum
         2. setLocalSyncMeta(fileId, Drive md5) — local meta matches remote
         3. dispatch "sync-complete"            — refresh file tree
```

**Sync behavior after create:**
- `localMeta.md5` = Drive value, `remoteMeta.md5` = same Drive value
- Diff result: `localChanged = false`, `remoteChanged = false` → **already synced**
- No push needed

### New-File Migration (`new:` Placeholder IDs)

Widgets/editors that create a file via `writeFileLocal(fileName, content)` with no `existingFileId` get a local-only `new:${fileName}` placeholder id immediately; `app/services/pending-file-migration.ts` uploads it to Drive in the background (on `pending-files-created`, on mount, or when coming back online) and swaps the cache/`CachedRemoteMeta`/`LocalSyncMeta` entries from the placeholder id to the real Drive id, dispatching `file-id-migrated` (`{ oldId, newId, fileName, mimeType }`) so open-file state elsewhere (`useActiveFile.ts`, `DashboardHost.tsx`) can follow the swap.

If a caller edits the file again (via `writeFileLocal(fileName, content, { existingFileId })`) using the stale placeholder id **after** migration has already deleted that cache entry — a real race when the edit happens moments after creation — `writeFileLocal` resolves the current id by name (`findFileByNameLocal`) instead of resurrecting a cache entry under the dead `new:` id. Without this, the resurrected entry has no `CachedRemoteMeta` record but `getPendingNewFiles()` scans the raw cache directly, so the next migration pass would re-upload it as a genuine second Drive file with the same name — visible as two duplicate entries (the original, and one carrying whatever was written during the race).

---

## File Recovery

### Scenario 1: Conflict — Need Both Versions

When a conflict occurs, you choose Keep Local or Keep Remote, but the other version is always saved to `sync_conflicts/`.

**To merge manually:**
1. Settings → Sync → Conflict Backups → Manage
2. Select the backup file, edit the restore name if needed
3. Click Restore — the backup is created as a new file in the root folder

### Scenario 2: Recover a Deleted File

Deleted files are moved to the `trash/` folder on Google Drive.

**To recover:**
1. Settings → Sync → Trash → Manage
2. Select the file you need
3. Click Restore — the file is moved back to the root folder and re-tracked

### Scenario 3: Restore from Remote

If you accidentally changed or deleted files locally and want to restore from remote.

**To recover:** Use **Full Pull** — this downloads all remote files, skipping only those with matching hashes. Your local cache is replaced entirely, stale cache files are deleted, and all local edit history is cleared.

---

## Settings

Located in Settings → Sync tab, organized into sections:

### Sync Status
- Last synced timestamp

### Data Management
| Action | Description |
|--------|-------------|
| Manage Temp Files | Browse and manage temporary files on Drive |
| Detect Untracked Files | Find remote files not tracked in `_sync-meta.json` (normally empty now that `GET /api/sync` registers them; still useful to permanently delete strays) |
| Trash | Restore or permanently delete trashed files |
| Conflict Backups | Manage conflict backup files from sync resolution |

### Edit History
| Action | Description |
|--------|-------------|
| Prune | Remove old edit history entries to free storage |
| Stats | View edit history storage usage and entry counts |

### Danger Zone
| Action | Description |
|--------|-------------|
| Full Push | Upload all modified files and merge metadata (overwrites remote) |
| Full Pull | Download all remote files (overwrites local cache) |

### System Files & Folders (Always Excluded from Sync)

Excluded by name filter in `computeSyncDiff`:
- `_sync-meta.json` — Sync metadata
- `settings.json` — User settings
- `_encrypted-auth.json` — Encrypted authentication data

Excluded by folder structure — these are actual Google Drive subfolders created via `ensureSubFolder()`. Files inside subfolders are not returned by `listUserFiles(rootFolderId)`. As a safety net, `isSyncExcludedPath()` also filters these prefixes on the client side:
- `history/` — Chat, execution, and request history (including `_meta.json` and `.history.json` files)
- `trash/` — Soft-deleted files (managed via Trash dialog)
- `sync_conflicts/` — Conflict backup files (managed via Conflict Backups dialog)
- `__TEMP__/` — Temporary sync files (managed via Temp Files dialog)
- `plugins/` — Installed plugin files

---

## Architecture

### Data Flow

```
Browser (IndexedDB)          Server                Google Drive
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ files store   │      │ /api/sync    │      │ Root folder  │
│ syncMeta      │◄────►│ (diff/pull/  │◄────►│ _sync-meta   │
│ fileTree      │      │  resolve/    │      │ User files   │
│ editHistory   │      │  pushFiles/…)│      │ trash/       │
│               │      │ /api/drive/  │      │ sync_conflicts│
│               │      │  files       │      │ .history.json│
│               │      │              │      │ __TEMP__/    │
└──────────────┘      └──────────────┘      └──────────────┘
```

### Key Files

| File | Role |
|------|------|
| `app/hooks/useSync.ts` | Client-side sync hook (push, pull, resolveConflict, fullPull, localModifiedCount) |
| `app/hooks/useFileWithCache.ts` | IndexedDB cache-first file reads, auto-save with edit history |
| `app/routes/api.sync.tsx` | Server-side sync API (18 POST actions + GET loader) |
| `app/routes/api.drive.files.tsx` | Drive file CRUD (used by push to update files directly; delete moves to trash/) |
| `app/services/sync-meta.server.ts` | Sync metadata read/write/rebuild/diff |
| `app/services/indexeddb-cache.ts` | IndexedDB cache (files, syncMeta, fileTree, editHistory, remoteMeta) |
| `app/services/edit-history-local.ts` | Client-side edit history (reverse-apply diffs, revert detection, net change check) |
| `app/services/edit-history.server.ts` | Server-side edit history (Drive `.history.json` read/write) |
| `app/components/settings/TrashDialog.tsx` | Trash file management dialog (restore/delete) |
| `app/components/settings/ConflictsDialog.tsx` | Conflict backup management dialog (restore/rename/delete) |
| `app/services/history-meta.server.ts` | History listing metadata (`_meta.json`) read/write/rebuild for chat, execution, and request history folders |
| `app/services/sync-diff.ts` | `computeSyncDiff` implementation (re-exported by `sync-meta.server.ts`) |
| `app/services/sync-client-utils.ts` | `isSyncExcludedPath`, `isBinaryMimeType`, binary temp file upload |
| `app/services/google-drive.server.ts` | Google Drive API wrapper |
| `app/utils/parallel.ts` | Parallel processing utility (concurrency limit) |
| `app/components/ide/SyncStatusBar.tsx` | Push/Pull badges, diff dialog trigger |
| `app/components/ide/SyncDiffDialog.tsx` | Push/Pull file list with diff preview; files sharing an ancestor folder collapse into expandable group rows (`app/utils/sync-diff-grouping.ts`) |
| `app/components/ide/ConflictDialog.tsx` | Conflict resolution UI |

### API Actions

| Action | Method | Description |
|--------|--------|-------------|
| *(loader)* | GET | Return the reconciled `remoteMeta`, `syncMetaFileId`, and file list (one `_sync-meta.json` lookup serves both) |
| `pullDirect` | POST | Download file contents for specified IDs (no meta read/write) |
| `resolve` | POST | Resolve conflict (backup loser, update Drive file and meta) |
| `fullPull` | POST | Download all remote files (skip matching) |
| `pushFiles` | POST | Batch update multiple files on Drive in parallel; accepts the client's `remoteMeta` snapshot to skip a redundant meta read and to revalidate each file against Drive before uploading |
| `clearConflicts` | POST | Delete all files in conflict folder |
| `detectUntracked` | POST | Find files on Drive not in sync meta |
| `deleteUntracked` | POST | Delete specified untracked files |
| `restoreUntracked` | POST | Add specified files back to sync meta |
| `listTrash` | POST | List files in the `trash/` folder |
| `restoreTrash` | POST | Move files from `trash/` back to root, re-add to sync meta |
| `listConflicts` | POST | List files in the `sync_conflicts/` folder |
| `restoreConflict` | POST | Create new file from conflict backup, delete backup |
| `rebuildTree` | POST | Rebuild the file tree from Drive (full re-scan) |
| `migrateRootFolder` | POST | Migrate root folder name on Drive |
| `ragRegister` | POST | Register a single file in the RAG store during push |
| `ragSave` | POST | Batch save RAG tracking info after push completes |
| `ragDeleteDoc` | POST | Delete a document from the RAG store |
| `ragRetryPending` | POST | Retry previously failed RAG registrations |
