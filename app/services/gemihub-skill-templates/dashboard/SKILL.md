---
name: dashboard
description: Create GemiHub Dashboards (.dashboard files) — a grid of widgets that embed Bases views, folder card/table/kanban views, notes, web pages, and workflow output. Use when the user asks for a dashboard, a home/overview page, or to arrange .base views and data widgets in a grid.
---

# GemiHub Dashboard Skill

Create `.dashboard` files: a grid of widgets rendered on the GemiHub home view. A `.dashboard` file is YAML. It is normally authored visually (drag/resize/configure in edit mode), but you can also write the YAML directly.

Always output valid YAML when creating or modifying a `.dashboard` file.

## Workflow

1. **Clarify the goal** — what should the dashboard show (tasks, notes, links, metrics)?
2. **Create the backing data first** — for a `base` widget, author a `.base` file (e.g. under `dashboards/bases/`) and note its view names. **You do not need to activate a separate skill: the full Base authoring guide is bundled here as `references/base.md`** (plus `references/base-functions.md` and `references/base-views.md`).
3. **Create the file** — use `create_drive_file` (or `update_drive_file` to edit) with a path like `dashboards/<Name>.dashboard`. New dashboards always live under `dashboards/`.
4. **Lay out widgets** — give each widget an `lg` layout on a 12-column grid.
5. **Validate YAML** — valid YAML; every widget has a unique `id`, a `type`, and `layout.lg`.

## File Structure

A `.dashboard` file is YAML (version 1):

```yaml
version: 1
grid:
  cols: 12        # column count (default 12)
  rowHeight: 80   # pixels per grid row (default 80)
  gap: 8          # pixels between cells (default 8)
widgets:
  - id: <uuid>
    type: base | card | table | kanban | file-list | web | workflow | markdown
    layout:
      lg: { x: 0, y: 0, w: 6, h: 4 }   # required: position on the wide grid
      sm: { x: 0, y: 0, w: 12, h: 4 }  # optional: auto-derived (full-width stack) if omitted
    config: { ... }                    # per-widget-type config (see below)
```

- `id` must be unique — use a UUID-like string.
- `layout.lg` is the position on the wide (≥768px) grid: `x`/`y` are the top-left cell (0-based), `w`/`h` are width/height in grid cells.
- `sm` (narrow screens) is auto-derived as a full-width stack if omitted.
- Place widgets so they don't overlap; stack vertically by increasing `y`.
- Unknown top-level keys and unknown widget config keys are preserved on save. An unknown widget `type` renders as a placeholder but is kept losslessly.

## Widget Types

### `base` — embed a Bases view (the primary data widget)

Renders a named view of a `.base` file (table / cards / list). **Use this for any list/table/card of notes** — author a `.base` and point a `base` widget at it.

```yaml
- id: tasks-1
  type: base
  layout: { lg: { x: 0, y: 0, w: 8, h: 6 } }
  config:
    base: dashboards/bases/Tasks.base   # vault path to the .base file
    view: Active                        # view name; omit/empty = the base's first view
```

> To author the backing `.base`, follow `references/base.md` (the full Base authoring guide bundled with this skill). The same `.base` can be referenced by multiple `base` widgets (e.g. one per view).

### `card` — card grid over a folder of markdown notes

```yaml
- id: projects-1
  type: card
  layout: { lg: { x: 0, y: 0, w: 6, h: 5 } }
  config:
    folder: projects              # folder to read (empty = root)
    filter: []                    # optional FilterCondition[]
    sort: "-mtime"                # -mtime | mtime | -ctime | ctime | name | -name | <prop> | -<prop>
    limit: 50
    card:                         # field → property mapping
      title: file.name            # defaults to file.name so cards are never blank
      subtitle: status
      image: cover                # embed/link, Drive path, file id, URL, or data URI
      body: summary
      badges: [tags]
    cols: 3
```

### `table` — editable table over a folder of markdown notes

```yaml
- id: table-1
  type: table
  layout: { lg: { x: 6, y: 0, w: 6, h: 5 } }
  config:
    folder: projects
    filter: []
    sort: "-mtime"
    limit: 50
    columns: [file.name, status, tags]   # file.* attributes or frontmatter keys
```

### `kanban` — drag-and-drop board grouped by a status property

```yaml
- id: board-1
  type: kanban
  layout: { lg: { x: 0, y: 0, w: 12, h: 6 } }
  config:
    title: Tasks                  # board title (shown in the header)
    folder: projects              # folder to read (empty = root)
    statusProperty: status        # frontmatter key used for columns
    titleProperty: title          # card title key; falls back to file name
    columns:
      - { value: todo, label: To Do }
      - { value: in-progress, label: In Progress }
      - { value: done, label: Done }
    showUnspecified: true         # show cards with empty/unknown status
    displayFields: [owner, due]
    filter: []
    limit: 100
```

### `file-list` — compact list of files in a folder

```yaml
- id: recent-1
  type: file-list
  layout: { lg: { x: 0, y: 0, w: 4, h: 4 } }
  config:
    folder: notes                 # folder to list (empty = root)
    sort: "-mtime"
    limit: 20
```

### `web` — embed a web page

```yaml
- id: web-1
  type: web
  layout: { lg: { x: 0, y: 6, w: 6, h: 4 } }
  config:
    url: https://example.com
```

### `workflow` — run a workflow and render its output

Runs a GemiHub workflow headlessly and renders the result. The workflow runs unattended (no interactive nodes).

```yaml
- id: digest-1
  type: workflow
  layout: { lg: { x: 0, y: 6, w: 6, h: 5 } }
  config:
    workflow: workflows/Daily Digest.yaml  # vault path to a .yaml/.yml workflow
    outputVariable: result                 # variable holding the output
    output: markdown                       # card | table | markdown | html
    # card: { title: name, body: summary }   # when output=card
    # columns: [name, status]                # when output=table
    # filter: []  sort: "-name"  limit: 50   # card/table post-processing
    refreshInterval: 60                    # minutes; 0/omit = manual refresh only
```

Output contract: `card`/`table` workflows must produce a JSON array of objects (one per row); `markdown`/`html` workflows must produce a string. A row object with a `fileId` key becomes clickable.

### `markdown` — embed an existing Drive markdown note

Renders an existing markdown file inline (preview / wysiwyg / code). It references the file by **id**, so it is best added via the UI picker; when authoring YAML, prefer `base`/folder widgets unless you already know the `fileId`.

```yaml
- id: notes-1
  type: markdown
  layout: { lg: { x: 8, y: 0, w: 4, h: 6 } }
  config:
    fileId: <drive-file-id>
    fileName: Home.md
```

## Importing a `.base` into a Dashboard

The `base` widget **is** the import mechanism: set `config.base` to the `.base` file's vault path and `config.view` to a view name. Recommended flow:

1. Author `dashboards/bases/Tasks.base` (defining views such as "Active", "Done"). The full `.base` authoring reference is bundled with this skill as `references/base.md` — no separate skill needs to be activated.
2. Add `base` widgets referencing `dashboards/bases/Tasks.base`, one per view.

## Complete Example

```yaml
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: tasks-active
    type: base
    layout: { lg: { x: 0, y: 0, w: 8, h: 6 } }
    config:
      base: dashboards/bases/Tasks.base
      view: Active
  - id: recent-files
    type: file-list
    layout: { lg: { x: 8, y: 0, w: 4, h: 6 } }
    config:
      folder: notes
      sort: "-mtime"
      limit: 15
  - id: docs
    type: web
    layout: { lg: { x: 0, y: 6, w: 12, h: 4 } }
    config:
      url: https://example.com
```

## Reference Files

- `references/base.md` — full Base (`.base`) authoring guide (mirrors the `base` skill).
- `references/base-functions.md` — Bases function/method reference.
- `references/base-views.md` — Bases view types, sort/group, and summaries.

## Validation Checklist

- [ ] Valid YAML (no tabs, consistent indentation)
- [ ] `version: 1`, and `grid` with `cols`/`rowHeight`/`gap`
- [ ] Every widget has a unique `id`, a `type`, and `layout.lg`
- [ ] `type` is one of `base`, `card`, `table`, `kanban`, `file-list`, `web`, `workflow`, `markdown`
- [ ] `base` widgets point at an existing `.base` path; `view` matches a view name
- [ ] folder widgets (`card`/`table`/`kanban`/`file-list`) point at a folder path
- [ ] `kanban` widgets define `statusProperty` and at least one column with `value` and `label`
- [ ] Widgets don't overlap (increase `y` to stack)
