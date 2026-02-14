# Sync

Manual push/pull synchronization between the browser (IndexedDB) and Google Drive.

## Features

- **Manual Sync**: Push and pull changes when you want
- **Offline-First**: Files are cached in IndexedDB for instant access
- **Soft Delete**: Deleted files are moved to a `trash/` folder on Drive (recoverable)
- **Conflict Resolution**: Choose local or remote version with automatic backup
- **Full Push / Full Pull**: Bulk sync for initial setup or recovery
- **Untracked File Management**: Detect, restore, or delete orphaned remote files
- **Trash & Conflict Backup Management**: Restore or permanently delete trashed files and conflict backups

## Commands

| Command | Description |
|---------|-------------|
| **Push** | Upload local changes (incremental) |
| **Pull** | Download remote changes (incremental) |
| **Full Push** | Upload all modified files + merge metadata into remote |
| **Full Pull** | Download entire remote vault (skip matching hashes) |

Header buttons: Push and Pull buttons are always visible. Badge shows count of pending changes.
- **Push Badge**: Count of locally modified files, excluding system/history files and files whose content was reverted to the synced state (no net change).
- **Pull Badge**: Count of remote changes, including new files, updates, and files deleted on remote (`localOnly`).
- **Nature of Change**: Clicking a badge shows a file list with icons indicating the change type:
  - <kbd>+</kbd> (Green): New file
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

The client polls for remote changes every 5 minutes while the app is active and idle. If remote changes are detected by comparing `_sync-meta.json` with local metadata, the Pull badge is updated automatically.

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
- `remoteChanged = localMeta.md5Checksum !== remoteMeta.md5Checksum` — remote meta diverges from local meta when another device has pushed changes

No live Drive API listing is needed: the `drive.file` scope ensures only GemiHub can modify these files, so `_sync-meta.json` is always authoritative.

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
   └─ Remote has any pending changes (conflicts, toPull, or remoteOnly) → error "Pull first"

2. BATCH UPLOAD: Update all files via single API call
   ├─ Get modified file IDs from IndexedDB editHistory
   ├─ Filter to only files tracked in any known meta (remoteMeta or localMeta)
   ├─ Filter out system files and excluded paths (history/, plugins/, etc.)
   ├─ Filter out binary files (base64-encoded, already uploaded directly to Drive)
   ├─ Filter out reverted files (hasNetContentChange = false)
   ├─ Read all modified file contents from IndexedDB cache
   ├─ POST /api/sync { action: "pushFiles", files, remoteMeta, syncMetaFileId }
   │   └─ Server:
   │       ├─ Use client-provided remoteMeta (skip re-reading _sync-meta.json)
   │       ├─ For each file (parallel, max 5 concurrent):
   │       │   ├─ Read old content from Drive (for edit history)
   │       │   ├─ Skip upload if content is identical to remote (optimization)
   │       │   └─ Update file on Drive
   │       ├─ Write _sync-meta.json once via syncMetaFileId (skip findFileByExactName)
   │       ├─ Save remote edit history in background (best-effort)
   │       └─ Return results + updated remoteMeta
   ├─ Update IndexedDB cache with new md5/modifiedTime
   └─ Update LocalSyncMeta directly from returned remoteMeta

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
- Push does **NOT** delete remote files. Deletion is handled separately (see Soft Delete below).
- After a successful push, local edit history in IndexedDB is cleared for the pushed files and for reverted files (files whose content was edited then reverted to the synced state).

---

## Pull Changes (Incremental)

Downloads only remotely-changed files to local cache.

### Flow

1. **Compute diff** using local meta vs remote meta (with `locallyModifiedFileIds`)
2. **Check conflicts** — if any, stop and show conflict UI
3. **Clean up `localOnly` files** — files that exist locally but were deleted on remote (moved to trash on another device) are removed from IndexedDB cache, edit history, and local sync meta
4. **Combine** `toPull` + `remoteOnly` arrays
5. **Mobile Optimization**: On mobile devices, binary file contents (images, PDF, etc.) are NOT downloaded to save storage. Metadata is updated so they appear in the file tree, but content is fetched only when opened.
6. **Download file contents** in parallel (max 5 concurrent)
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
| - | A | **remoteOnly** → Download |

---

## Full Pull

Downloads all remote files, skipping those with matching hashes.

### Flow

1. **Build `skipHashes`** from all IndexedDB cached files (`fileId → md5Checksum`)
2. **Rebuild remote meta** from Drive API (full scan)
3. **Filter out** system files (`_sync-meta.json`, `settings.json`)
4. **Skip** files where `skipHashes[fileId] === remoteMeta.md5Checksum`
5. **Download** all non-skipped files in parallel (max 5 concurrent)
6. **Update IndexedDB cache** with downloaded files
7. **Delete stale cache** — remove cached files that no longer exist on remote
8. **Clear all local edit history** (remote is authoritative)
9. **Replace local sync meta** entirely with remote meta
10. **Fire "sync-complete" event** and update localModifiedCount

### When to Use

- Initial setup on a new device/browser
- Recovery after cache corruption
- When you want remote to be authoritative

---

## Full Push

Uploads all locally modified files directly to Drive and merges metadata. **This is a destructive operation** — it does not check for conflicts or remote changes before overwriting. Remote files will be overwritten without warning.

### Flow

1. **Batch upload** — all modified files are sent in a single `pushFiles` API call; server updates Drive files in parallel (max 5 concurrent), reads/writes `_sync-meta.json` once, and saves remote edit history in background
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

The unselected version is always backed up for manual merging if needed.

### Backup Naming

```
{filename}_{YYYYMMDD_HHmmss}.{ext}
```

Example: `notes/daily.md` → `sync_conflicts/notes_daily_20260207_143000.md`

---

## Soft Delete (Trash)

File deletion uses a soft delete model. Deleted files are moved to a `trash/` subfolder on Google Drive instead of being permanently destroyed.

### Flow

1. User deletes a file (context menu → Trash)
2. Server moves the file to `trash/` subfolder via Drive API (`moveFile`)
3. File is removed from `_sync-meta.json`
4. Local caches (IndexedDB file cache) are cleaned up
5. File tree updates to reflect the removal

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
| Detect Untracked Files | Find remote files not tracked in local cache |
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
| `app/routes/api.sync.tsx` | Server-side sync API (16 POST actions + GET loader) |
| `app/routes/api.drive.files.tsx` | Drive file CRUD (used by push to update files directly; delete moves to trash/) |
| `app/services/sync-meta.server.ts` | Sync metadata read/write/rebuild/diff |
| `app/services/indexeddb-cache.ts` | IndexedDB cache (files, syncMeta, fileTree, editHistory, remoteMeta) |
| `app/services/edit-history-local.ts` | Client-side edit history (reverse-apply diffs, revert detection, net change check) |
| `app/services/edit-history.server.ts` | Server-side edit history (Drive `.history.json` read/write) |
| `app/components/settings/TrashDialog.tsx` | Trash file management dialog (restore/delete) |
| `app/components/settings/ConflictsDialog.tsx` | Conflict backup management dialog (restore/rename/delete) |
| `app/services/history-meta.server.ts` | History listing metadata (`_meta.json`) read/write/rebuild for chat, execution, and request history folders |
| `app/services/sync-diff.ts` | `computeSyncDiff` implementation (re-exported from `sync-meta.server.ts`) |
| `app/services/sync-client-utils.ts` | `isSyncExcludedPath`, `isBinaryMimeType`, binary temp file upload |
| `app/services/google-drive.server.ts` | Google Drive API wrapper |
| `app/utils/parallel.ts` | Parallel processing utility (concurrency limit) |
| `app/components/ide/SyncStatusBar.tsx` | Push/Pull badges, diff dialog trigger |
| `app/components/ide/SyncDiffDialog.tsx` | Push/Pull file list with diff preview |
| `app/components/ide/ConflictDialog.tsx` | Conflict resolution UI |

### API Actions

| Action | Method | Description |
|--------|--------|-------------|
| *(loader)* | GET | Return `remoteMeta`, `syncMetaFileId`, and file list |
| `pullDirect` | POST | Download file contents for specified IDs (no meta read/write) |
| `resolve` | POST | Resolve conflict (backup loser, update Drive file and meta) |
| `fullPull` | POST | Download all remote files (skip matching) |
| `pushFiles` | POST | Batch update multiple files on Drive in parallel; accepts `remoteMeta` and `syncMetaFileId` from client to skip redundant meta reads/lookups |
| `clearConflicts` | POST | Delete all files in conflict folder |
| `detectUntracked` | POST | Find files on Drive not in sync meta |
| `deleteUntracked` | POST | Delete specified untracked files |
| `restoreUntracked` | POST | Add specified files back to sync meta |
| `listTrash` | POST | List files in the `trash/` folder |
| `restoreTrash` | POST | Move files from `trash/` back to root, re-add to sync meta |
| `listConflicts` | POST | List files in the `sync_conflicts/` folder |
| `restoreConflict` | POST | Create new file from conflict backup, delete backup |
| `ragRegister` | POST | Register a single file in the RAG store during push |
| `ragSave` | POST | Batch save RAG tracking info after push completes |
| `ragDeleteDoc` | POST | Delete a document from the RAG store |
| `ragRetryPending` | POST | Retry previously failed RAG registrations |
