# Spec: `.kanban` board definition files + editable card modal

> **Implemented 2026-07-09, with two follow-up changes beyond this spec (user-requested):**
> 1. A dedicated `.kanban` editor (`KanbanFileEditor`, Display / Edit / Raw) replaced the v1 "plain YAML in the main viewer" plan — the future idea shipped immediately.
> 2. **Inline config support was removed from the UX.** The widget config is now always `{ kanban, cardOrder }`; the config editor creates/imports a `.kanban` (mirroring `BaseConfigEditor`) and edits the file directly, and legacy inline configs are force-converted to a generated file when their settings panel opens. (The widget's internal ability to render a definition object remains — the file editor's Display mode uses it.)

## Background / Problem

The dashboard's `kanban` widget stores its whole board definition (folder, status property, columns, display fields, filters…) **inline in the `.dashboard` widget config**. That means a board cannot be reused across dashboards, opened as its own file in the main viewer, tracked in edit history as a document, or targeted by the dashboard toolbar's Open button (`filePathOf`).

Decision (2026-07-09): move the board definition into a dedicated **`.kanban` file** (YAML, schema ≈ today's `KanbanWidgetConfig`), which the widget references by path — the same relationship the `base` widget has to `.base` files.

**Rejected alternative — kanban as a `.base` view type** (a full draft spec existed and was superseded by this one): `.base` is a read-only *query* format backed by an Obsidian-Bases-compatible engine, while kanban is an interactive board with frontmatter **writeback** and **card creation**. Fitting it in required mutation plumbing inside the presentational `BaseViewRenderer`, an unnatural `newCardFolder` key (a filter tree can't be inverted into a creation target), a split-brain home for `cardOrder`, and a rewrite of the working 586-line `KanbanWidget` against `BaseEntry`. The `.kanban` approach keeps `KanbanWidget` almost as-is and only changes where its config comes from. (Obsidian has the same split: Bases for queries, the Kanban plugin's own file format for boards.)

This spec also includes two card-flow UX changes requested at the same time:

1. **New Card should not navigate away.** Today `createCard` opens the new file in the main viewer via `plugin-select-file`; it should instead open the same modal that clicking an existing card opens (`FilePreviewModal`).
2. **The card modal should be an editor, not just a preview.** For Markdown files, `FilePreviewModal` should offer the same preview / wysiwyg / raw mode buttons as the file widget and allow editing (local-first saves).

## Goals

1. A `.kanban` YAML file format holding the board definition; parse/serialize helpers with tests.
2. `kanban` widget config gains `kanban?: string` (file path). When set, the definition is loaded from the file; inline config keeps working unchanged when it is not set.
3. `.kanban` is treated as a text/YAML file everywhere `.base` already is (editor, diff, push), so v1 board editing is plain YAML in the main viewer.
4. Dashboard toolbar Open button for kanban widgets via `filePathOf` (one line in the registry).
5. A "save definition as `.kanban` file" conversion action for existing inline-config widgets.
6. `FilePreviewModal`: Markdown files render in `MarkdownFileEditor` with the preview/wysiwyg/raw toolbar, editable, local-first.
7. New Card opens that modal instead of navigating; full-page open stays one click away (the modal's navigate icon).

## Explicit non-goals

- **No change to card storage** (one Markdown file per card, status in frontmatter, local-first writes).
- **No `.base` involvement** — see the rejected alternative above.
- **No dedicated visual `.kanban` board editor in MainViewer** in v1 (YAML text editing is enough; a board editor à la `BaseFileEditor` is a future idea).
- **No forced migration.** Inline config remains fully supported; conversion is opt-in per widget.
- **Modal editing is Markdown-only.** Non-Markdown text files keep the read-only `<pre>`, media files keep their current preview.
- `cardOrder` (manual card ordering) stays in the **widget config**, not in the `.kanban` file — it is per-dashboard presentation state, and a drag should not churn a shared definition file through sync/edit history.

## Relevant existing code (read before implementing)

- `app/dashboard/data-widget/KanbanWidget.tsx` — the widget. Config read at ~line 97 (`cfg = config as KanbanWidgetConfig`); `createCard` (~line 305) currently dispatches `plugin-select-file` after `writeFileLocal`; card click sets `previewRow` → `FilePreviewModal` (~line 562). Tolerant normalization already exists (`normalizeColumns`).
- `app/dashboard/data-widget/types.ts:70` — `KanbanWidgetConfig` (folder, title, statusProperty, titleProperty, columns, showUnspecified, cardOrder, displayFields, filter, limit, `[key: string]: unknown`).
- `app/dashboard/widgets/BaseWidget.tsx` ~lines 99–140 and `app/dashboard/widgets/base-events.ts` — the pattern for loading a definition file from the local cache and refreshing on a `dashboard-base-file-updated` event (dispatched by `BaseConfigEditor` after AI edits). Mirror this, don't reinvent it.
- `.base`-as-text special cases to mirror for `.kanban`:
  - `app/services/sync-client-utils.ts:60` — `"base"` in `TEXT_FILE_EXTENSIONS`.
  - `app/routes/api.sync.tsx:42` — `.base` → `text/yaml` in `guessMimeType`.
  - `app/utils/media-utils.ts` — `base: "text/yaml"` in `guessMimeType`.
  - `app/components/ide/MainViewer.tsx:87-93` — `.canvas` / `.dashboard` / `.base` forced-text exception.
  - Sweep with `grep -rn '"base"\|\.base' app/ --include='*.ts*'` for any remaining extension special-cases (e.g. QuickOpenDialog/SyncDiffDialog mime guessers) and mirror where relevant.
- `app/dashboard/widgets/registry.ts` — `filePathOf` on the base/workflow/file defs (precedent for goal 4); kanban registration at ~line 96.
- `app/dashboard/legacyFolderWidgetConversion.ts` + `app/dashboard/WidgetSettingsPanel.tsx:40` — conversion precedent. Note the settings-panel gate is `!ConfigEditor && isLegacyFolderWidget(...)`; kanban **has** a ConfigEditor, so its conversion action lives inside `KanbanConfigEditor` instead (see Design §5).
- `app/dashboard/widgets/FilePreviewModal.tsx` — currently read-only: `TextPreviewBody` renders `GfmMarkdownPreview` for Markdown (via `useFileWithCache`, which already returns `saveToCache`), `<pre>` for other text, `BinaryPreviewBody` for media. **Call sites (all inherit the editable modal):** `KanbanWidget`, `FileListWidget`, `TimelineWidget`, `BaseWidget`, `BaseFileEditor`.
- `app/components/ide/editors/MarkdownFileEditor.tsx` — `MdEditMode = "preview" | "wysiwyg" | "raw"`, props `fileId/fileName/initialContent/saveToCache/initialMode/onModeChange/hideToolbarActions/hideProperties`. The mode buttons live in its own toolbar.
- `app/dashboard/widgets/file-widget/FileWidget.tsx` ~line 47 — the module-scoped `sessionMode` pattern (session-remembered mode, preview-first) to replicate for the modal.

## Design

### 1. `.kanban` file format

YAML document; the schema is today's `KanbanWidgetConfig` minus widget-only keys (`kanban` itself, `cardOrder`):

```yaml
version: 1
title: Sprint Board
folder: projects/tasks
statusProperty: status
titleProperty: title
columns:
  - value: todo
    label: To Do
  - in-progress          # bare strings allowed, same as inline config
showUnspecified: true
displayFields: [priority, due]
filter: []               # FilterCondition[], same shape as inline config
sort: ""
limit: 100
```

New module **`app/dashboard/data-widget/kanban-file.ts`** (pure, testable):

- `parseKanbanFile(content: string): KanbanBoardDefinition | null` — `js-yaml` load, tolerant (missing keys fall back to the same defaults the widget already applies; non-object/broken YAML → `null`). Unknown keys are preserved.
- `serializeKanbanFile(def: KanbanBoardDefinition): string` — `yaml.dump` (used by conversion).
- `KanbanBoardDefinition` = `Omit<KanbanWidgetConfig, "kanban" | "cardOrder">` (+ optional `version`).

### 2. Widget loading

- `KanbanWidgetConfig` gains `kanban?: string`.
- In `KanbanWidget`, when `cfg.kanban` is set: load the file content from the local cache (resolve path → id → `getCachedFile`, same as `BaseWidget`'s `.base` loading), parse with `parseKanbanFile`, and use the result as the effective board definition. Inline keys other than `kanban` / `cardOrder` are ignored in file mode (no merging — one source of truth).
- Missing or unparseable file → render the existing centered-note pattern with a new "board definition file not found / invalid" message.
- Refresh: add `app/dashboard/data-widget/kanban-events.ts` with `DASHBOARD_KANBAN_FILE_UPDATED_EVENT` mirroring `base-events.ts`; `KanbanWidget` bumps a refresh key when the event's `detail.fileName` matches `cfg.kanban`, and the config editor / conversion dispatch it after writing. (Parity with `.base`: edits made in the main-viewer text editor show up on the next widget refresh, same as `.base` edits do for the base widget.)

### 3. Open button

`registry.ts` kanban def gains `filePathOf: (config) => ((config as { kanban?: string })?.kanban ?? "").trim() || undefined`. GridCell needs no changes.

### 4. `.kanban` as text

Mirror every `.base` special case listed above (`TEXT_FILE_EXTENSIONS`, both `guessMimeType`s, MainViewer forced-text exception). Result: `.kanban` opens in the plain text editor from the file tree / Open button, shows diffs in the sync dialog, and pushes as `text/yaml`.

### 5. Conversion (inline → file) and config editor

- `KanbanConfigEditor` gains, at the top, a **board definition source** row:
  - *Inline* (default, current form unchanged), or
  - *File*: a `.kanban` file picker (follow `BaseConfigEditor`'s file-picker pattern). In file mode the inline form fields are hidden; editing happens by opening the file (hint text + the toolbar Open button).
  - A **"Save as .kanban file"** button, shown in inline mode: writes `serializeKanbanFile(current inline definition)` to `Dashboards/Kanbans/<sanitized title || kanban-id8>.kanban` via `writeFileLocal` (dedupe with a numeric suffix like `createCard` does), then swaps the config to `{ kanban: path, cardOrder }` and dispatches the update event. `cardOrder` is preserved as-is.
- New i18n strings (interface + **both** `en`/`ja`, per CLAUDE.md) for: source-row labels, the save-as-file button, and the file-missing error.

### 6. Editable `FilePreviewModal`

- In `TextPreviewBody`, replace the Markdown branch (`GfmMarkdownPreview`) with **`MarkdownFileEditor`**:
  - `fileId` / `fileName` (full path, for wiki-link resolution) / `initialContent` from the existing `useFileWithCache` call; `saveToCache` from the same hook (local-first: IndexedDB + editHistory, Drive on Push — unchanged model).
  - `hideToolbarActions` (no diff/history/upload buttons in a modal), keep the frontmatter properties panel visible (status/title live there — useful for cards).
  - `initialMode` from a module-scoped session variable defaulting to `"preview"`, updated via `onModeChange` — the `FileWidget` `sessionMode` pattern, so the modal reopens in the user's last mode.
  - `key={fileId}` to remount per file.
- Wrap `saveToCache` so each save also dispatches `dashboard-data-changed` with `detail.folder` = the file's parent folder (derived from the path) — the kanban board (and file-list/timeline widgets) refresh to reflect title/status edits. `KanbanWidget` already listens and debounces reloads.
- Escape/backdrop close must not lose a pending debounced save — verify `MarkdownFileEditor` flushes on unmount (the `TextFileEditor` in FileWidget shows the flush-on-unmount pattern if it doesn't).
- Non-Markdown text and media bodies are untouched. All five call sites get the editable modal with no per-site changes.

### 7. New Card opens the modal

In `KanbanWidget.createCard`, after `writeFileLocal` + `loadData()` + the `dashboard-data-changed` dispatch, **replace** the `plugin-select-file` dispatch with `setPreviewRow({ id: result.fileId, fileId: result.fileId, fileName: path, cells: {} })` — the modal only reads `fileId`/`fileName`. The modal opens in the session mode (typically wysiwyg/raw right after creating, since the user just chose to edit); its navigate icon still performs the old full-page open.

### 8. What must NOT change

- Inline-config kanban widgets: identical behavior end to end.
- Drag/drop writeback, `cardOrder` persistence, `dashboard-data-changed` contract, push/pull flow.
- `FilePreviewModal` behavior for media and non-Markdown text files.

## Tests

**`app/dashboard/data-widget/kanban-file.test.ts`** (`node:test`):

1. `parseKanbanFile`: full document → all keys; empty/partial → defaults match the widget's; broken YAML / non-object → `null`; unknown keys preserved.
2. Round-trip: `parseKanbanFile(serializeKanbanFile(def))` is deep-equal to `def` (including bare-string columns normalizing identically to inline config).
3. Conversion path (extract the pure part of "inline config → definition + target path" into `kanban-file.ts` so it's testable): widget-only keys (`cardOrder`, `kanban`) excluded from the file; filename sanitization/dedupe inputs covered.

## Acceptance criteria

1. A kanban widget with `kanban: path` renders identically to the same definition inline; a missing/broken file shows the error note instead of a broken board.
2. Editing the `.kanban` YAML in the main viewer and returning to the dashboard shows the updated board after the update event / next refresh.
3. The widget toolbar shows Open for file-backed kanban widgets and navigates to the `.kanban` file page.
4. "Save as .kanban file" writes the file, swaps the config, preserves `cardOrder`, and the board is visually unchanged.
5. Clicking a card opens the modal with preview/wysiwyg/raw buttons; edits save locally (no direct Drive write) and the board reflects title/status changes after save; Push sends them to Drive.
6. New Card opens the same modal (no page navigation); the modal's navigate icon opens the file page.
7. Existing inline-config widgets and all non-kanban `FilePreviewModal` call sites behave as before (except Markdown now being editable, which applies everywhere by design).
8. `npm run typecheck`, `npm run lint`, `npm run test` (incl. new tests), `npm run build` all pass.
9. Manual check (`npm run dev`): create a board, convert to file, edit the file, drag cards, create a card via New Card and edit it in the modal in all three modes, Push, and verify Drive contents.

## Out of scope / future ideas (do not implement unless separately requested)

- A visual `.kanban` board editor in MainViewer (route `.kanban` to a dedicated editor like `BaseFileEditor`).
- Referencing one `.kanban` from multiple dashboards with shared `cardOrder` (would move ordering into the file).
- AI generation of `.kanban` files (à la `AIBaseDialog`).
- A palette preset that creates a new board pre-converted to a file.
- Kanban-specific validation diagnostics surfaced in the YAML editor.
