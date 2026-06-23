# Dashboard

The dashboard is a grid of configurable **widgets** rendered on the IDE home view. It is authored visually (drag/resize/configure in edit mode) and persisted as a `.dashboard` YAML file in the user's Drive. Everything is local-first: edits update the IndexedDB cache and are reflected to Drive via the normal Push flow.

> Implementation lives under `app/dashboard/`. The Japanese mirror of this doc is `dashboard_ja.md`.

## File format & storage

- A dashboard is a YAML file with the `.dashboard` extension.
- New dashboards are **always** created under `dashboards/` (`dashboards/{name}.dashboard`, the starter from the empty state is `dashboards/home.dashboard`) — mirroring how workflows live under `workflows/`. A legacy single dashboard may still be **read** from the root as `home.dashboard`, but new ones are never written there.
- Workflow result data is stored at `dashboards/data/<dashboardFileId>.json` as a **normal synced file** — it pushes/pulls and appears in the file tree and the push/pull diff like any other file (so a device that never ran the workflow still gets the output via Pull). It is regenerable last-write-wins data; the widget also lazy-fetches the latest copy on load (`loadCacheFile`).
- Trashed/history copies (`trash/…`, `history/…`) are excluded from the dashboard listing.

The schema (version 1):

```yaml
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: <uuid>
    type: markdown | file-list | web | card | table | workflow
    layout:
      lg: { x: 0, y: 0, w: 6, h: 3 }
      sm: { x: 0, y: 0, w: 12, h: 3 }   # auto-derived if omitted
    config: { ... }                      # per-widget-type config (see below)
```

Unknown top-level keys and unknown widget config keys are **preserved on round-trip** (plugin widgets, future extensions). Unknown widget *types* fall back to `UnknownWidget`, which keeps their config intact so they can be deleted or saved back losslessly.

Key files: `dashboardFile.ts` (parse/serialize/load/save/list/rename/delete), `types.ts` (schema types).

## Layout, grid & edit mode

- Two breakpoints: `lg` (wide) and `sm` (narrow, threshold `BREAKPOINT_THRESHOLD = 768px`). Missing `sm` layouts are auto-derived (full width, stacked) by `deriveSmLayout`.
- **Edit mode** enables drag (move), resize, per-widget Settings and Delete, plus undo/redo with config-edit coalescing.
- The canvas (`DashboardCanvas.tsx`) renders the grid; each widget lives in a `GridCell.tsx` that owns drag/resize. `DashboardHost.tsx` owns the dashboard lifecycle (create / rename / delete / switch, home pinning via `settings.homeDashboard`) and debounced save.

Adding a widget opens the `WidgetPalette` modal, which lists every registered widget type.

## Widget types

Widgets are registered in `widgets/registry.ts` via `registerWidget(def)`. Each `WidgetDef` supplies a `type`, palette `label`/`icon`, `defaultConfig`, `defaultSize`, a `render(config, ctx)` function, and an optional `ConfigEditor`.

| Type | Purpose | Source |
|------|---------|--------|
| `markdown` | Edit an existing Drive markdown file inline (preview/wysiwyg/code) | Drive file |
| `file-list` | A compact list of files in a folder (header path + filter/sort) | folder |
| `web` | Embed an external URL (with embeddability check + fallback card) | URL |
| `card` | Card grid over a folder of markdown files | folder |
| `table` | Editable table over a folder of markdown files | folder |
| `workflow` | Run a workflow and render its output | workflow |

`web` is unchanged from the initial dashboard release. `markdown` and `file-list` (below) and the data-oriented widgets — `card`, `table`, `workflow` — are described below.

### Markdown widget

References an **existing** Drive markdown file (no inline content) and renders the normal markdown editor inline via `MarkdownFileEditor` — the same **preview / wysiwyg / code** toggle, frontmatter, and wiki links as the main editor, with local-first saving (`useFileWithCache`). The editor toolbar is trimmed to *path + mode toggle* (`hideToolbarActions`); the file path on the left is a `MarkdownFilePicker` (@-mention-style search over `editorCtx.fileList`) that switches the referenced file **even outside edit mode** — the choice is persisted via `ctx.onConfigChange({ fileId, fileName })`. This makes 2-column layouts (e.g. a `file-list` next to a `markdown` editor) practical. The view mode defaults to **preview** on the first view of a session, then a session-scoped variable remembers the user's last explicit toggle across file switches (so opening another file keeps wysiwyg/code). Config: `{ fileId, fileName }`.

### File List widget

A folder file list with a header showing the folder path plus two header icons that work in view mode: a **filter** (filename substring) and a **sort** (the six mtime/ctime/name options). Both are ephemeral view-time overlays — the filter is applied client-side over the loaded list and the sort overrides the configured `sort` (re-fetched via `listFilesLocal`); neither is written back to the `.dashboard`. Popovers reuse the portal `Popover` from `data-widget/ViewControls.tsx`.

Clicking a file does **not** open it immediately — it opens a `FilePreviewModal` (portal overlay) showing the content (markdown rendered via `GfmMarkdownPreview`, other files as plain text). The modal header has a navigate icon (open the file in the editor) and a close icon; only the navigate icon performs the actual `plugin-select-file` navigation.

> **History.** Earlier builds had a single generalized `data` widget (`source` folder|workflow × `view` table|cards) and a `file-table` widget. These were replaced by the three explicit widgets here. Because the dashboard feature had not shipped, there is **no migration shim** — `data` / `file-table` types are gone and old test `.dashboard` files should be recreated with the new types.

### Shared building blocks

`card`, `table`, and `workflow` reuse a common pipeline:

- **Row model** — `DataRow` (`data-widget/types.ts`): `{ id, fileName?, fileId?, mtime?, ctime?, cells }`. `cells` holds property values keyed by name (frontmatter keys plus `file.*` attributes).
- **Folder source** — `loadFolderRows(folder)` / `scanFolderFields(folder)` (`folder-source.ts`) read markdown files in a folder and expose their frontmatter + file attributes as rows/fields.
- **Post-source pipeline** — `applyPostSource(rows, { filter, sort, limit })` (`filter.ts`): filter conditions → sort → limit. Helpers: `getCellValue`, `formatCell`, `detectFields`.
- **Views** — `CardsView.tsx` (field-mapped cards) and `TableView.tsx` (table with optional inline cell editing).
- **Config parts** — `data-widget/config-parts/` holds the reusable editor pieces (`FilterEditor`, `SortLimitFields`, `CardMappingEditor`, `ColumnsEditor`, `useFolderFields`) shared by the three config editors.

### View-time filter & sort (header controls)

`card`/`table` folder widgets and `card`/`table` workflow output show two separate header icons — a **filter** icon (opens the `FilterEditor` popover) and a **sort** icon (opens a sort-option list). These are implemented by `ViewControls.tsx` and work in **view mode without entering edit mode**:

- The state is **ephemeral**: the view-time filter is ANDed on top of the widget's configured `filter`, and the view-time sort overrides the configured `sort`. Nothing is written back to the `.dashboard` file, and both reset when the dashboard reloads.
- Each icon shows a small blue dot when active; the sort popover has a "Reset" entry to clear the override.
- Popovers render through a portal (widget cells are `overflow-hidden`, which would otherwise clip them). The filter popover is wider (`w-80`) and the property selector can shrink (`min-w-0`) so the condition row never overflows the panel.

## Card & Table (folder widgets)

Both read markdown files from a folder and run them through filter → sort → limit. They differ only in how rows are rendered. Implemented by a shared `FolderWidget` (the registry picks the view per type).

**`card` config**

```yaml
config:
  folder: projects        # folder to read (empty = root)
  filter: [ ... ]         # optional FilterCondition[]
  sort: "-mtime"          # -mtime | mtime | -ctime | ctime | name | -name | <prop> | -<prop>
  limit: 50
  card:                   # field-to-property mapping
    title: file.name      # defaults to file.name so cards are never blank
    subtitle: status
    image: cover
    body: summary
    badges: [tags]
  cols: 3                 # cards per row (collapses to 1 on very narrow widgets)
```

Cards map row fields to structured slots (title/subtitle/image/body/badges) — there are no free-form template strings. If `title` is unmapped, `CardsView` falls back to the row's file name, so a freshly added card always shows something (this fixes the "blank card" symptom). `image` accepts an Obsidian internal embed/link (`![[folder/cover.png]]` / `[[cover.png]]`, resolved via `findFileByNameLocal`), a Drive path (`folder/cover.png`), a Drive file ID, a full URL, or an inline data URI (`data:image/...;base64,...`, the format images take in the IndexedDB cache). Prefer references (`![[…]]` / path) over base64 — the AI generation guidance instructs the model to reference existing Drive images and only inline base64 when it actually generates a new image. Clicking a card opens the underlying file.

**`table` config**

```yaml
config:
  folder: projects
  filter: [ ... ]
  sort: "-mtime"
  limit: 50
  columns: [file.name, status, tags]   # column keys (file.* attrs or frontmatter keys)
```

In edit mode, frontmatter cells are editable inline; edits are written back to the source file with order/body preservation (`frontmatter-writeback.ts`) and broadcast via the `dashboard-data-changed` event so other widgets refresh. `file.*` attribute columns are read-only. Cells whose value is an inline data URI (`data:image/...`) render as a thumbnail image instead of text and are never editable.

## Workflow widget

The `workflow` widget runs a GemiHub workflow headlessly and renders its output. Implemented by `WorkflowWidget.tsx` + `workflow-runner.ts`.

```yaml
config:
  workflow: reports/weekly.yaml       # workflow file path (.yaml / .yml)
  outputVariable: result              # optional; which variable holds the output
  output: table                       # card | table | markdown | html
  # output-specific:
  card: { title: name, body: summary }   # when output=card
  cols: 3
  columns: [name, status]                # when output=table
  # post-processing (card/table only):
  filter: [ ... ]
  sort: "-name"
  limit: 50
  refreshInterval: 60                 # minutes; 0/omitted = manual only
```

### Output contract

- **`card` / `table`** — the workflow must produce a **JSON array of objects** (one object per row), stored in the output variable (`result` by default). A `script` node returning the array is the simplest form. Each object's keys become the row's columns / card fields. After a test run the config editor auto-seeds the field mapping (table columns, or a card title/image/subtitle/body/badges guess from the field names and sampled values — `image`/`cover`/… or any cell holding a data URI, image URL, `![[…]]` embed, or image-extension path is mapped to the card image). If a row object carries a `fileId` (or `file.fileId`) key, that card/table row becomes clickable and opens the referenced note — same as folder-source rows.
- **`markdown` / `html`** — the workflow must produce a **string** in the output variable. It is rendered with `GfmMarkdownPreview` (markdown) or in a sandboxed `<iframe sandbox="allow-scripts">` via `buildHtmlPreviewSrcDoc` (html, reused from the HTML file editor).

The config editor appends this contract to the AI workflow-generation prompt (`buildFormatGuidance`, varied by output format) so generated workflows emit the right shape. Workflows run **unattended** — they must not use interactive nodes (`prompt-value`, `prompt-file`, `prompt-selection`, `dialog`, `drive-file-picker`); the runner surfaces a specific error if they do.

### Config editor

- **Workflow picker** — lists `.yaml`/`.yml` files, **excluding** `skills/…` (skill-bundled) and `web/…` (web-published) workflows.
- **AI button** — when no workflow is selected it creates one (`mode=create`); when one is selected it opens the dialog in `mode=modify` with the workflow's YAML + fileId, so the **execution-history picker** can feed a failed run's steps back to the model (same flow as editing a workflow in the IDE). The accepted YAML overwrites the existing file.
- **Run** — the `Run` button executes the selected workflow to preview output and detect fields. Detected fields are seeded from the last cached run on open (so the mapping dropdowns show their current values without re-running); the dropdown options are also unioned with whatever the saved config already references.
- Every run (Run button, header refresh, interval auto-run) is also saved to Drive **execution history**, keyed by the workflow's fileId — that is what makes the failure feedback above available.

### Execution model & caching

Results are cached in the per-dashboard file (`dashboards/data/<dashboardFileId>.json`) as a `WorkflowCacheRecord` (`{ widgetId, ranAt, status, rows?, fields?, text?, error? }`, last-write-wins). On mount, the widget reads from the cache and renders. This file is a normal synced file (see "File format and storage" above), so a machine that never ran the workflow still renders the latest results — `loadCacheFile` also lazy-fetches the content from Drive when it is missing locally or the remote copy is newer.

Execution is triggered by:

1. **Manual refresh** — the refresh button in the widget header (cancellable).
2. **Config editor "Run"** — on creation / config change, to preview output and detect fields.
3. **Interval auto-run** — on mount, if `refreshInterval > 0` and `now - cacheRecord.ranAt > refreshInterval * 60_000` (or there is no cache yet), the widget auto-executes **once**. A `useRef` guard prevents repeated runs across re-renders / breakpoint changes. There is no periodic timer while the dashboard stays open — staleness is only evaluated when the dashboard is (re)opened. This is the one deliberate exception to the "never execute from a render/effect path" rule that governs the manual/test-run paths.

A failed run preserves the previous rows/text and shows a "stale" indicator alongside the error.

## Extensibility

Plugins add custom widget types with `registerWidget(def)` (`widgets/registry.ts`, exposed to plugins via `PluginAPI.registerWidget`). The `WidgetDef` contract (`types.ts`) is the extension point: provide a `render` and optional `ConfigEditor`. Unknown types degrade gracefully to `UnknownWidget`, which preserves the widget's config/unknown keys on save.

**Late registration.** Plugins load asynchronously, often after a dashboard has already rendered. `registerWidget` dispatches a `dashboard-widgets-changed` event and `DashboardCanvas` re-renders on it, so a widget whose plugin loads late swaps from `UnknownWidget` to the real renderer without a reload.

**`base` widget (plugin-provided, e.g. Obsidian Bases).** Reading/creating/rendering `.base` files is intended to live in a plugin, not core. The convention is a widget `{ type: "base", config: { base: "dashboards/xx.base", view: "<view name>" } }`: the plugin registers `type: "base"` and renders the named view of the referenced `.base`. Core needs no special import machinery — the `.dashboard` just stores the widget, `WidgetContext` (size/editMode/widgetId/dashboardFileId/`onConfigChange`) is passed through, and when the plugin is absent the widget shows `UnknownWidget` with its config intact. (Note: `drive-local.ts`'s `EXCLUDED_PREFIXES` includes `dashboards/`, so a plugin discovering `.base` files should use `readFile`/`searchFiles` rather than `listFiles`.)

**View-mode config.** `WidgetContext.onConfigChange(config)` lets a widget persist its own config from view mode (wired through `GridCell` → `DashboardCanvas` → the dashboard save). Used by the markdown widget's header file picker.

## Key files

- `app/dashboard/DashboardHost.tsx` — lifecycle (create/rename/delete/switch, home pinning), save.
- `app/dashboard/DashboardCanvas.tsx`, `GridCell.tsx`, `useGridLayout.ts`, `useBreakpoint.ts` — grid & interaction.
- `app/dashboard/dashboardFile.ts`, `types.ts` — file I/O & schema.
- `app/dashboard/widgets/registry.ts`, `WidgetPalette.tsx`, `WidgetRenderer.tsx`, `WidgetSettingsPanel.tsx` — registration & UI.
- `app/dashboard/widgets/` — `MarkdownWidget`, `FileListWidget`, `WebWidget`, `UnknownWidget` (+ their config editors).
- `app/dashboard/data-widget/` — `FolderWidget`, `WorkflowWidget`, `CardsView`, `TableView`, `folder-source.ts`, `filter.ts`, `workflow-runner.ts`, the `Card`/`Table`/`Workflow` config editors, and shared `config-parts/`.
- `app/dashboard/frontmatter-writeback.ts`, `frontmatter-cache.ts` — table cell writeback.
