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

Header buttons: Push and Pull buttons are always visible. Badge shows count of pending changes (including locally modified files).

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

### Three-Way Diff

The diff algorithm compares three data sources:

| Source | Description |
|--------|-------------|
| **Local Meta** | Client's last-synced snapshot (IndexedDB) |
| **Remote Meta** | Server's last-synced snapshot (`_sync-meta.json`, read-only during diff) |
| **Current Remote** | Live Drive API file listing (queried on every diff) |

Detection logic per file:

| Local Changed | Remote Changed | Result |
|:-------------:|:--------------:|--------|
| No | No | Skip (unchanged) |
| Yes | No | **toPush** |
| No | Yes | **toPull** |
| Yes | Yes | **Conflict** |
| Local only | - | **localOnly** |
| - | Remote only | **remoteOnly** |

Where:
- `localChanged = local.md5Checksum !== remoteSynced.md5Checksum || locallyModifiedFileIds.has(fileId)`
- `remoteChanged = currentRemote.md5Checksum !== remoteSynced.md5Checksum`

`locallyModifiedFileIds` is the set of file IDs from the client's `editHistory` store, passed alongside `localMeta` in each diff request. This ensures local edits are detected even though the local meta's MD5 checksum is not updated on edit.

---

## Push Changes (Incremental)

Uploads locally-changed files to remote.

### Flow

```
1. PRE-CHECK: Diff check before writing anything
   ├─ Read LocalSyncMeta from IndexedDB
   ├─ POST /api/sync { action: "diff", localMeta, locallyModifiedFileIds }
   │   └─ Server: read _sync-meta.json + list Drive files → compute diff
   ├─ Conflicts found → abort (show conflict dialog)
   └─ Remote is newer & has pending pulls → error "Pull first"

2. UPLOAD: Update files directly on Drive
   ├─ Get modified file IDs from IndexedDB editHistory
   ├─ Filter to only files tracked in remoteMeta
   ├─ For each modified file:
   │   ├─ Read content from IndexedDB cache
   │   ├─ (Optional) RAG registration for eligible file types
   │   ├─ POST /api/drive/files { action: "update", fileId, content }
   │   │   └─ Server: update file on Drive, update _sync-meta.json
   │   │       → return new md5Checksum, modifiedTime
   │   ├─ Update LocalSyncMeta with new md5/modifiedTime
   │   └─ Update IndexedDB cache with new md5/modifiedTime

3. CLEANUP
   ├─ Clear IndexedDB editHistory for pushed files only
   ├─ Update localModifiedCount
   └─ Fire "sync-complete" event (UI refresh)

4. METADATA SYNC
   ├─ POST /api/sync { action: "diff", localMeta: null }
   │   └─ Server: return current remoteMeta
   └─ Rebuild LocalSyncMeta from server's remoteMeta
```

### Preconditions

| Local Meta | Remote Meta | Remote Newer | Action |
|:----------:|:-----------:|:------------:|--------|
| - | - | - | Nothing to push |
| - | exists | - | Nothing to push |
| exists | exists | Yes (with pending pulls) | Error: "Pull required" |
| exists | exists | No | Proceed with Push |

### Important Notes

- Push checks for conflicts and remote-newer **before** writing any files to Drive. If the check fails, nothing is written.
- Push does **NOT** delete remote files. Deletion is handled separately (see Soft Delete below).
- After a successful push, local edit history in IndexedDB is cleared for the pushed files only.

---

## Pull Changes (Incremental)

Downloads only remotely-changed files to local cache.

### Flow

1. **Compute diff** using three-way comparison (with `locallyModifiedFileIds`)
2. **Check conflicts** — if any, stop and show conflict UI
3. **Clean up `localOnly` files** — files that exist locally but were deleted on remote (moved to trash on another device) are removed from IndexedDB cache, edit history, and local sync meta
4. **Combine** `toPull` + `remoteOnly` arrays
5. **Download file contents** in parallel (max 5 concurrent)
6. **Update IndexedDB cache** with downloaded files
7. **Update local sync meta** with new checksums
8. **Update remote sync meta** with pulled files, and **prune `localOnly` entries** from `_sync-meta.json`
9. **Fire "sync-complete" event** and update localModifiedCount

### Decision Tables

#### Files in Both Metas

| Local Meta | Remote Meta | Action |
|:----------:|:-----------:|--------|
| A | A | Skip (unchanged) |
| B | A | Skip (local-only change, uploads on next Push) |
| A | B | **Download** (remote changed) |
| B | C | **Conflict** (both changed) |

#### Files Only in Local Meta (Remote Deleted)

| Local Meta | Remote Meta | Current Remote | Action |
|:----------:|:-----------:|:--------------:|--------|
| A | - | - | **localOnly** → Remove from local cache (remote deletion synced) |

#### Files Only in Remote (New Remote)

| Local Meta | Remote Meta | Current Remote | Action |
|:----------:|:-----------:|:--------------:|--------|
| - | - | exists | **remoteOnly** → Download |

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

Uploads all locally modified files directly to Drive and merges metadata.

### Flow

1. **Upload modified files** — each modified file is updated directly on Drive via `/api/drive/files`
2. **Update IndexedDB** — cache and LocalSyncMeta updated with new md5/modifiedTime
3. **Merge** all local meta entries into remote `_sync-meta.json` via `fullPush` action
4. **Clear all edit history**
5. **Fire "sync-complete" event** and update localModifiedCount

### When to Use

- Force remote metadata to match local state
- After bulk local edits that bypassed normal sync

---

## Conflict Resolution

Conflicts occur during Push or Pull when both local and remote versions of a file have changed since the last sync.

| Choice | What Happens |
|--------|--------------|
| **Keep Local** | Back up remote to `sync_conflicts/`, upload local content to Drive, update remote meta |
| **Keep Remote** | Back up local to `sync_conflicts/`, download remote content to IndexedDB |

After resolution:
- The resolved file's edit history entry is cleared
- Local sync meta is updated from the server's remote meta
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

Files are stored with `__TEMP__/` prefix on Google Drive. **No metadata is updated** — equivalent to making the same edit on both devices manually.

Temp files can be managed from Settings → Sync → Temporary Files.

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

- `_sync-meta.json` — Sync metadata
- `settings.json` — User settings
- `history/*/_meta.json` — History listing metadata (chat, execution, request folders)
- `trash/` — Soft-deleted files (managed via Trash dialog)
- `sync_conflicts/` — Conflict backup files (managed via Conflict Backups dialog)
- `__TEMP__/` — Temporary sync files (managed via Temp Files dialog)

---

## Edit History

Local edit tracking with reverse-apply diffs, persisted to Drive on Push.

### Overview

Edit history is split into two layers:

| Layer | Storage | Lifetime |
|-------|---------|----------|
| **Local** | IndexedDB `editHistory` store | Per-file: cleared on Push for that file; all cleared on Full Push / Full Pull |
| **Remote** | Drive `.history.json` per file | Retained per edit history settings |

### Local Edit History (IndexedDB)

Each file has one `CachedEditHistoryEntry` with a `diffs[]` array. Each array element represents one diff session (commit point).

**Auto-save (every 3s):**
1. Read old content from IndexedDB cache (before cache update)
2. If last diff exists: reverse-apply it to old content to reconstruct the base
3. Compute cumulative diff from base to new content
4. Overwrite the last `diffs[]` entry (same session updates accumulate into one diff)

**Commit boundary (explicit save events):**
- Adds an empty entry to `diffs[]` as a boundary marker
- Next auto-save starts a new diff session (appends instead of overwriting)
- Triggered by: file open/reload, Pull, temp download accept, workflow commands

**Memory efficiency:**
- Only stores cache (latest content) + diffs (no full base content copy)
- Base content is reconstructed via reverse-apply when needed
- Reverse-apply: swap `+`/`-` lines and hunk header counts, then apply patch

### Remote Edit History (Drive)

When Push updates a file on Drive, the server:
1. Reads the old file content from Drive before updating
2. Computes diff (old → new)
3. Appends the diff entry to the file's `.history.json` on Drive

After Push, IndexedDB edit history is cleared for the pushed files since diffs are now in Drive.

### Viewing History

The Edit History modal shows:
- **Local entries** (IndexedDB) by default — current editing session diffs
- **Remote entries** (Drive) on demand — click "Show remote history" to load past diffs from Drive

---

## Architecture

### Data Flow

```
Browser (IndexedDB)          Server                Google Drive
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ files store   │      │ /api/sync    │      │ Root folder  │
│ syncMeta      │◄────►│ (diff/pull/  │◄────►│ _sync-meta   │
│ fileTree      │      │  resolve/    │      │ User files   │
│ editHistory   │      │  fullPush/…) │      │ trash/       │
│               │      │ /api/drive/  │      │ sync_conflicts│
│               │      │  files       │      │ .history.json│
│               │      │              │      │ __TEMP__/    │
└──────────────┘      └──────────────┘      └──────────────┘
```

### Key Files

| File | Role |
|------|------|
| `app/hooks/useSync.ts` | Client-side sync hook (push, pull, resolveConflict, fullPush, fullPull, localModifiedCount) |
| `app/hooks/useFileWithCache.ts` | IndexedDB cache-first file reads, auto-save with edit history |
| `app/routes/api.sync.tsx` | Server-side sync API (17 POST actions) |
| `app/routes/api.drive.files.tsx` | Drive file CRUD (used by push to update files directly; delete moves to trash/) |
| `app/services/sync-meta.server.ts` | Sync metadata read/write/rebuild/diff |
| `app/services/indexeddb-cache.ts` | IndexedDB cache (files, syncMeta, fileTree, editHistory) |
| `app/services/edit-history-local.ts` | Client-side edit history (reverse-apply diffs in IndexedDB) |
| `app/services/edit-history.server.ts` | Server-side edit history (Drive `.history.json` read/write) |
| `app/components/settings/TrashDialog.tsx` | Trash file management dialog (restore/delete) |
| `app/components/settings/ConflictsDialog.tsx` | Conflict backup management dialog (restore/rename/delete) |
| `app/services/history-meta.server.ts` | History listing metadata (`_meta.json`) read/write/rebuild for chat, execution, and request history folders |
| `app/services/google-drive.server.ts` | Google Drive API wrapper |
| `app/utils/parallel.ts` | Parallel processing utility (concurrency limit) |

### API Actions

| Action | Method | Description |
|--------|--------|-------------|
| `diff` | POST | Three-way diff comparison |
| `pull` | POST | Download file contents for specified IDs, update/prune sync meta |
| `resolve` | POST | Resolve conflict (backup loser, update Drive file and meta) |
| `fullPull` | POST | Download all remote files (skip matching) |
| `fullPush` | POST | Merge all local meta into remote meta |
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
