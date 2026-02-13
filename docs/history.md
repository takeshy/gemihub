# Edit History

Edit history has two independent layers — local (IndexedDB) and remote (Drive) — that track file changes separately.

## Overview

| Layer | Storage | How Diffs Are Created | Lifetime |
|-------|---------|----------------------|----------|
| **Local** | IndexedDB `editHistory` store | Client auto-save computes diffs from base to current content | Per-file: cleared on Push; all cleared on Full Pull |
| **Remote** | Drive `.history.json` per file | Server computes diff between old Drive content and newly pushed content | Retained per edit history settings |

The two layers are independent: local diffs are **not** uploaded to Drive. On Push, the server independently computes its own diff from the Drive-side old content vs the pushed new content and appends it to `.history.json`.

---

## Local Edit History (IndexedDB)

Each file has one `CachedEditHistoryEntry` with a `diffs[]` array. Each array element represents one diff session (commit point).

### Auto-Save (every 3s)

1. Read old content from IndexedDB cache (before cache update)
2. If last diff exists: reverse-apply it to old content to reconstruct the base
3. Compute cumulative diff from base to new content
4. Overwrite the last `diffs[]` entry (same session updates accumulate into one diff)

If reverse-apply fails (e.g. patch mismatch due to external content change), a commit boundary is inserted to seal the corrupted diff, and a new session starts from the current old cache content.

Because the last diff is continuously overwritten during a session, a single active session always has exactly **one non-empty diff** entry representing `base → current content`.

### Commit Boundary

Explicit save events insert a commit boundary (empty diff entry) into `diffs[]`. This causes the next auto-save to **append** a new diff rather than overwriting the previous one, starting a new session.

`addCommitBoundary(fileId)` checks if the last diff is non-empty and appends an empty boundary if so.

Triggered by:
- File open, file reload, after pull updates editor content (`useFileWithCache`)
- Pull (per downloaded file), resolve conflict (remote), Full Pull (`useSync`)
- Temp diff accept (`MainViewer`, `WorkflowEditor`)
- `restoreToHistoryEntry` adds boundaries directly around the restore diff entry

### Data Model

Since `saveLocalEdit` always **replaces** the last `diffs[]` entry, a commit boundary is consumed by the next auto-save. The three states that actually occur:

```
Case 1: Single session (no commits)
  [0] { diff: "base → current" }               ← continuously updated

Case 2: After commit + editing in session 2
  [0] { diff: "base → end_of_session1" }       ← sealed
  [1] { diff: "end_of_session1 → current" }    ← replaced the boundary, continuously updated

Case 3: After commit, no further edits yet
  [0] { diff: "base → end_of_session1" }       ← sealed
  [1] { diff: "" }                              ← boundary (replaced on next edit)
```

- The **last entry** is always the one being updated by auto-save
- Earlier entries are sealed and never modified
- Commit boundaries are transient — they exist only between sessions and are replaced by the next auto-save

### Memory Efficiency

- Only stores cache (latest content) + diffs (no full base content copy)
- Base content is reconstructed via reverse-apply when needed
- Reverse-apply: swap `+`/`-` lines and hunk header counts, then apply patch

---

## Remote Edit History (Drive)

Remote edit history is computed entirely on the server, independent of local edit history. When a file is updated on Drive, the server:
1. Reads the old file content from Drive before overwriting
2. Computes diff (old Drive content → new content)
3. Appends the diff entry to the file's `.history.json` on Drive

This happens in two paths:
- **Push** (`api.sync.tsx` `pushFiles` action): saves history in background (fire-and-forget, best-effort)
- **Direct file update** (`api.drive.files.tsx` `update` action): saves history inline (awaited, best-effort)

After Push, local edit history in IndexedDB is cleared for the pushed files (the local diffs are no longer needed since the cache now matches Drive). Files that failed to push retain their local edit history.

Remote entries include metadata: `id`, `timestamp`, `source` (workflow/propose_edit/manual/auto), optional `workflowName` and `model`.

---

## Viewing History

Right-click a file in the tree → "History" to open the Edit History modal.

The modal shows:
- **Local entries** (IndexedDB) by default — editing session diffs with Restore button
- **Remote entries** (Drive) on demand — click "Show remote history" to load past diffs from Drive (read-only)

Each entry displays: timestamp, origin badge (local/remote), addition/deletion stats, and an expandable diff view.

---

## Restore

Restore reverts a file to the state **before** the selected history entry by reverse-applying diffs from the most recent entry back through the selected one.

### How It Works

`restoreToHistoryEntry` (steps 1-4) computes the restored content and updates edit history. The caller (`EditHistoryModal.handleRestore`) performs steps 5-6.

1. Read current content from IndexedDB cache
2. For each non-empty diff from the most recent down to (and including) the target entry:
   - Reverse-apply the diff (swap `+`/`-` lines, invert hunk headers, apply patch)
3. Record the restore as a new history entry: `diff(current → restored)`
4. Add commit boundaries around the restore entry
5. Update IndexedDB cache with restored content *(caller)*
6. Dispatch `file-restored` event to update the editor *(caller)*

### Example: Single Entry Restore

When there is only one non-empty diff (active session, no commits):

```
diffs: [{ diff: "base → current" }]
cache: current

Restore (filteredIndex=0):
  reverse-apply diff[0] on "current" → "base"
  result: "base"
```

The file is restored to its state before any edits in the current session.

### Example: Multi-Entry Restore

```
diffs: [
  { diff: "base → v1" },       ← index 0 (sealed)
  { diff: "v1 → current" },    ← index 1 (active)
]
cache: current

Restore to index 0 (filteredIndex=0):
  reverse-apply diff[1] on "current" → "v1"
  reverse-apply diff[0] on "v1" → "base"
  result: "base"

Restore to index 1 (filteredIndex=1):
  reverse-apply diff[1] on "current" → "v1"
  result: "v1"
```

### Limitations

- If `reverseApplyDiff` fails (patch mismatch), restore returns null and nothing changes
- After restore, the editor immediately reflects the restored content; the change is local-only until the next Push

---

## Settings

Located in Settings → Sync → Edit History:

| Action | Description |
|--------|-------------|
| Prune | Remove old edit history entries to free Drive storage |
| Stats | View edit history storage usage and entry counts |

Retention settings (per user):
- `maxEntriesPerFile`: Maximum entries per file (0 = unlimited)
- `maxAgeInDays`: Maximum age in days (0 = unlimited)

Diff settings:
- `contextLines`: Number of context lines in remote diffs (default: 3). Local diffs use a hardcoded value of 3.

---

## Key Files

| File | Role |
|------|------|
| `app/services/edit-history-local.ts` | Client-side edit history: auto-save (`saveLocalEdit`), commit boundary (`addCommitBoundary`), restore (`restoreToHistoryEntry`), reverse-apply diff |
| `app/services/edit-history.server.ts` | Server-side edit history: save to Drive `.history.json` on Push, load history, retention policy |
| `app/services/indexeddb-cache.ts` | IndexedDB stores: `editHistory` CRUD, `CachedEditHistoryEntry` / `EditHistoryDiff` types |
| `app/hooks/useFileWithCache.ts` | Cache-first file reads, auto-save integration (`saveToCache` calls `saveLocalEdit`), `file-restored` event handler |
| `app/components/ide/EditHistoryModal.tsx` | History modal UI: display local/remote entries, restore handler, clear remote history |
| `app/components/shared/DiffView.tsx` | Unified diff visualization component |
| `app/routes/api.settings.edit-history.tsx` | API: GET remote history, DELETE remote history |
| `app/routes/api.settings.edit-history-stats.tsx` | API: GET history stats |
| `app/routes/api.settings.edit-history-prune.tsx` | API: POST prune old history |
