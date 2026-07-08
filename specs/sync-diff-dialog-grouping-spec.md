# Spec: Group SyncDiffDialog entries by parent folder

## Background / Problem

GemiHub's Push/Pull confirmation UI (`SyncDiffDialog`) renders **one row per changed file**, with no grouping. Widgets like `kanban` and `base` store each "entry"/"card"/"row" as a **separate Markdown file** in a folder (see `app/dashboard/data-widget/folder-source.ts`, `app/dashboard/data-widget/KanbanWidget.tsx`). This is intentional and shared with the rest of the app's file-centric architecture (IndexedDB caching, editHistory, RAG indexing all operate per-file) — it is **not** being changed by this spec.

The pain point: when a user edits several cards on one kanban/base board (e.g. drags 8 cards to a new column), Push shows 8 separate rows in the confirmation dialog, one per card file. This is noisy and doesn't read as "one board changed" — it reads as 8 unrelated file changes.

## Goal

Purely visual: when 2+ changed files share the same parent folder, collapse them into a single **group row** in `SyncDiffDialog` (both Push and Pull variants), expandable to reveal the existing per-file rows unchanged. Files that are alone in their folder (or at the Drive root, no folder) keep rendering as individual rows exactly as today.

## Explicit non-goals

- **No change to the storage model.** Kanban/base cards remain one file each. This is a dialog-rendering change only.
- **No change to push/pull data flow, diffing, Drive API calls, or `useSync.ts`.** `filesToPush`/`filesToPull` computation, `_sync-meta.json` writes, batching (`parallelProcess`, concurrency 5) — all untouched.
- **No new reverse index from file → owning dashboard widget.** Grouping is purely "same parent folder path", determined from the existing `name` string. It does not need to know whether that folder happens to back a kanban/base widget — grouping by folder achieves the same declutter effect naturally, more generally, and without new lookup machinery.
- **No group-level bulk actions in v1** (e.g. "ignore whole folder" for Pull). Noted as a future idea at the end; do not implement unless asked.
- **No new i18n strings required.** The folder path itself is the label; reuse existing icons/colors.

## Relevant existing code (read before implementing)

- `app/components/ide/SyncDiffDialog.tsx` — the component to modify. Currently `files.map((f) => <row>)` at line ~196.
  - `FileListItem` type (line 12-16): `{ id: string; name: string; type: "new" | "modified" | "deleted" | "editDeleted" | "conflict" }`.
  - `diffStates: Record<string, DiffState>` keyed by file id — per-file diff fetch/expand state. **Unaffected by this change.**
  - `ignoredIds: Set<string>` — Pull-only per-file ignore toggle. **Unaffected.**
  - Per-file row currently renders: type icon, filename (truncated, `title=` tooltip), optional "Open" button (push only), optional "Ignore" toggle (pull, `modified` only), "Diff" toggle + expandable diff panel.
- `app/components/ide/SyncStatusBar.tsx:58-142` (`openDiffDialog`) — builds the `files` array passed into the dialog. Confirms `f.name` is always the **full Drive-relative path** (e.g. `cached.fileName || remoteFiles[id]?.name || id`), not a basename — GemiHub stores all files flat under one Drive root folder and uses `/`-delimited `name` strings as a path convention (see `app/services/google-drive.server.ts` — basename is extracted via `name.slice(lastIndexOf("/") + 1)` elsewhere in the codebase, e.g. for tree display).
- No `parentFolderId` field exists on `FileSyncMeta` (`app/services/sync-diff.ts:7-21`) or `LocalSyncMeta` entries (`app/services/indexeddb-cache.ts:25-29`) — folder membership must be derived from `name` via string splitting, not looked up.

## Design

### 1. Folder derivation (pure, testable)

Add a new small module: **`app/utils/sync-diff-grouping.ts`**

```ts
export interface FileListItem {
  id: string;
  name: string;
  type: "new" | "modified" | "deleted" | "editDeleted" | "conflict";
}

export type DialogRow =
  | { kind: "file"; item: FileListItem }
  | { kind: "group"; folderPath: string; items: FileListItem[] };

const MIN_GROUP_SIZE = 2;

/** Parent folder path derived from a `/`-delimited Drive path-as-name. Returns null for root-level files (no "/"). */
export function dirnameOf(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? null : path.slice(0, idx);
}

/**
 * Groups files that share a parent folder (>= MIN_GROUP_SIZE members) into a
 * single collapsible row; everything else stays an individual row. Order is
 * stable: each row appears at the position of its first-occurrence file in
 * the input array.
 */
export function buildDialogRows(files: FileListItem[]): DialogRow[] {
  const folderOf = new Map<string, string | null>();
  const countByFolder = new Map<string, number>();
  for (const f of files) {
    const dir = dirnameOf(f.name);
    folderOf.set(f.id, dir);
    if (dir) countByFolder.set(dir, (countByFolder.get(dir) ?? 0) + 1);
  }

  const rows: DialogRow[] = [];
  const emittedFolders = new Set<string>();
  for (const f of files) {
    const dir = folderOf.get(f.id) ?? null;
    if (dir && (countByFolder.get(dir) ?? 0) >= MIN_GROUP_SIZE) {
      if (emittedFolders.has(dir)) continue; // already emitted as part of its group
      emittedFolders.add(dir);
      rows.push({
        kind: "group",
        folderPath: dir,
        items: files.filter((x) => folderOf.get(x.id) === dir),
      });
    } else {
      rows.push({ kind: "file", item: f });
    }
  }
  return rows;
}
```

Import `FileListItem` from this new module in `SyncDiffDialog.tsx` instead of (or in addition to) redeclaring it locally — keep it a single source of truth. (`SyncDiffDialog.tsx` currently exports `FileListItem` itself at line 12; either move the interface into `sync-diff-grouping.ts` and re-export it from `SyncDiffDialog.tsx` for existing callers, or keep the declarations structurally identical — check all import sites of `FileListItem` before deciding, e.g. `grep -rn "FileListItem" app/` — and update them if you relocate it.)

### 2. Test file

Add **`app/utils/sync-diff-grouping.test.ts`** using `node:test` (see existing test files for the pattern, e.g. `npm run test:sync-diff`). Cover:

1. Empty input → `[]`.
2. All files in distinct folders (or root) → every item is a `"file"` row, original order preserved.
3. Mixed case: folder `A` has 3 files, folder `B` has 1 file, plus 1 root-level file → one `"group"` row for `A` (containing all 3, in original relative order) at the position of `A`'s first occurrence, and two `"file"` rows for `B`'s file and the root file at their own positions.
4. Exactly `MIN_GROUP_SIZE` (2) files in a folder → grouped. Exactly 1 → not grouped.
5. Interleaved input order (`A1, B1, A2, A3`) → group `A` emitted at index 0 containing `[A1, A2, A3]` in that relative order; `B1` remains an individual row at its own position, not swallowed into `A`'s group.
6. Root-level files (`name` has no `"/"`) are never grouped even if there happen to be several of them with otherwise-matching structure — `dirnameOf` returns `null`, and `null` folders are excluded from grouping by the `if (dir && ...)` check.

### 3. UI changes in `SyncDiffDialog.tsx`

- Compute `const rows = useMemo(() => buildDialogRows(files), [files]);` and replace the current `files.map((f) => ...)` with `rows.map((row) => row.kind === "file" ? <FileRow .../> : <GroupRow .../>)`.
- **Refactor the existing per-file card JSX (lines ~203-300) into its own local component/function**, e.g. `function FileRow({ f, ds, diffable, ignored, type, onDiffToggle, onIgnoreToggle, onSelectFile, onClose, diffViewMode, setDiffViewMode, t }: ...)`. Behavior must be **byte-for-byte identical** to today — same icon/color logic, same Open/Ignore/Diff buttons, same diff panel. This lets it be reused both for standalone rows and for rows nested inside an expanded group.
- **New `GroupRow` component**, rendered as a bordered card matching the existing row style (`rounded-lg border ... p-3`):
  - Local expand/collapse state: `const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>({})`. **Default collapsed** (i.e. treat a missing key as `false`) — the whole point is decluttering.
  - Header (always visible, clickable to toggle): folder icon (`Folder` from `lucide-react`) + chevron (`ChevronRight` collapsed / `ChevronDown` expanded, reusing the icons already imported) + the `folderPath` text (`truncate`, `title={folderPath}` tooltip for long paths) + a count badge `({items.length})`.
  - Next to the count badge, a compact per-type breakdown reusing the existing icon/color mapping from the current per-file row (`Plus`/green, `Pencil`/blue, `Trash2`/red, `AlertTriangle`/amber for both `editDeleted` and `conflict`), each shown only if count > 0, e.g. `+3` `✎2` `-1`. Small size (`size={12}` or the existing `ICON.SM`), no new copy text needed (icons + numbers only, consistent with the rest of the dialog which is icon-driven).
  - When expanded: render each item in `items` via the same `FileRow` component used for standalone rows, indented (e.g. wrap in a `div` with `pl-4 border-l border-gray-200 dark:border-gray-700 ml-1.5 mt-2 space-y-2` or similar — match existing spacing conventions in the file).
  - Clicking the header toggles `groupExpanded[folderPath]`; do **not** let clicks on nested `FileRow` buttons (Open/Ignore/Diff) bubble up and toggle the group — nested rows already stop propagation implicitly via being separate button elements, but double check with `e.stopPropagation()` on the header's own click handler area if needed. (The existing per-file "Diff" button already lives inside its own row's click scope, not the group header's, so this should be naturally fine — just verify when implementing.)
- Everything else in the dialog (header count, footer buttons, `onSync`/`ignoredIds` wiring, `Push`/`Pull` labels) is **unchanged** — grouping is purely a rendering concern between the file list and the existing per-file behavior.

### 4. What must NOT change

- `ignoredIds` semantics — still per-file id, computed and passed to `onSync(ignoredIds)` exactly as today. A `GroupRow` does not aggregate or override per-file ignore state in v1.
- Diff fetching (`handleDiffToggle`) — still triggered per file id, lazy, same caching in `diffStates`.
- The dialog's top count (`title (N)`) and footer summary text — still counts all `files`, not groups.

## Acceptance criteria

1. Pushing/pulling changes touching only files in distinct folders (or root) looks **identical** to current behavior — no groups appear.
2. Pushing/pulling 2+ changed files that share a parent folder (e.g. several kanban cards from the same board folder) shows **one collapsed group row** instead of N separate rows, with correct count and type breakdown.
3. Expanding a group reveals the same per-file rows as before (same icons, Open/Ignore/Diff buttons, diff panel), functioning identically to standalone rows.
4. A folder with exactly 1 changed file still renders as a normal standalone row (not a group of 1).
5. `npm run typecheck`, `npm run lint`, and `npm run test` (including the new `sync-diff-grouping.test.ts`) all pass.
6. Manual check in the running app (`npm run dev`): edit several cards on a kanban board, open Push confirmation, verify grouping and that Push still succeeds and clears the badge correctly (confirms the visual change didn't regress the underlying `push()` flow, which reads from `files`/`useSync` state independently of this dialog's rendering).

## Out of scope / future ideas (do not implement unless separately requested)

- Group-level "ignore all" / "open board" convenience actions.
- Remembering per-folder expand/collapse state across dialog open/close or across sessions.
- Deeper-than-one-level grouping (e.g. collapsing nested subfolder groups within a group).
- Making `MIN_GROUP_SIZE` user-configurable.
