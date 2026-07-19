---
name: base
description: Author and maintain GemiHub .base compatibility files for filtered table, card, and list views over workspace files.
---

# GemiHub Base Authoring

Use this skill to create or edit a `.base` YAML file consumed by GemiHub. The format is GemiHub's portable query-and-view interchange format and is designed to remain compatible with the supported subset of Base files.

## Authoring Contract

- Produce valid YAML, never tabs.
- Preserve keys you do not understand when editing an existing file.
- Keep file paths relative to the workspace.
- Use `order` to choose displayed fields and `sort` to order rows.
- Limit new views to `table`, `cards`, or `list`.
- Validate expressions and referenced formula names before saving.

## Recommended Workflow

1. Identify the files that should participate in the result.
2. Add global filters only when every view shares the same scope.
3. Define reusable computed values under `formulas`.
4. Give each view a unique name and its own presentation settings.
5. Save the file, open Display mode, and resolve every diagnostic.

Create files with `create_drive_file`; update existing files with `update_drive_file`. `Dashboards/Bases/` is the conventional location, but any workspace folder is valid.

## Minimal Example

This example lists active project notes and gives the same data two presentations:

```yaml
filters:
  and:
    - 'file.inFolder("Projects")'
    - 'note.archived != true'

formulas:
  age_days: '((today() - file.mtime) / 86400000).round(0)'

properties:
  note.owner:
    displayName: Owner
  formula.age_days:
    displayName: "Days since update"

views:
  - type: table
    name: "Active projects"
    order:
      - file.name
      - note.owner
      - note.stage
      - formula.age_days
    sort:
      - property: file.mtime
        direction: DESC

  - type: cards
    name: "Project cards"
    order:
      - file.name
      - note.owner
      - note.summary
    groupBy:
      property: note.stage
      direction: ASC
```

## Top-Level Sections

| Key | Purpose |
|-----|---------|
| `filters` | Scope shared by every view |
| `formulas` | Named computed properties |
| `properties` | Labels and display metadata for properties |
| `summaries` | Named aggregate expressions |
| `views` | One or more rendered views |

All sections are optional, though a useful file normally has at least one view.

## Filters

A filter may be a quoted expression or a recursive object containing one logical key:

```yaml
filters:
  or:
    - 'file.hasTag("priority")'
    - and:
        - 'file.inFolder("Clients")'
        - 'note.status == "active"'
    - not:
        - 'file.hasTag("hidden")'
```

Global filters and view filters are combined with AND. Supported comparison operators are `==`, `!=`, `>`, `<`, `>=`, and `<=`; boolean expressions use `&&`, `||`, and `!`.

Quote expressions containing punctuation or nested string literals. Prefer single-quoted YAML strings around expressions that contain double quotes.

## Property Names

| Namespace | Example | Meaning |
|-----------|---------|---------|
| `note` | `note.status` | Markdown frontmatter property |
| `file` | `file.mtime` | Workspace file metadata |
| `formula` | `formula.age_days` | Value declared in `formulas` |

A bare name such as `status` is treated as a note property. Explicit `note.status` is clearer in generated files.

Common file fields include `name`, `basename`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags`, `links`, `backlinks`, `embeds`, and `properties`.

## Formulas

Formula values are expressions stored as YAML strings:

```yaml
formulas:
  estimate_label: 'if(note.hours, note.hours.toString() + " h", "Unestimated")'
  stale: 'file.mtime < today() - "30 days"'
```

Reference them as `formula.estimate_label` and `formula.stale`. Do not create circular dependencies. See `references/functions.md` for the supported function surface.

## Display Metadata

Use `properties` to rename fields without changing expression identifiers:

```yaml
properties:
  note.stage:
    displayName: Stage
  formula.stale:
    displayName: Needs review
```

## Views

Every view should have a unique `name`. GemiHub supports:

- `table`: rows with selected columns.
- `cards`: a responsive card grid with optional image selection.
- `list`: a compact list.

The first view is used when no view name is selected. Key distinction:

- `order` selects fields and their display order.
- `sort` controls row ordering.

```yaml
views:
  - type: list
    name: "Recently changed"
    filters: 'file.ext == "md"'
    order:
      - file.name
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC
    limit: 25
```

See `references/views.md` for grouping, card images, and summaries.

## Dashboard Use

A dashboard Base widget references the file and optionally a named view:

```yaml
widgets:
  - id: project-index
    type: base
    config:
      base: Dashboards/Bases/projects.base
      view: "Active projects"
```

The same `.base` file can back several widgets. Older inline `card`, `table`, and `file-list` widgets can be migrated to this file-backed representation.

## Compatibility Boundaries

GemiHub deliberately implements a supported compatibility subset:

- Supported view types: `table`, `cards`, `list`.
- GemiHub uses an explicit `sort` list; `order` remains display order.
- Unsupported view types fall back to table rendering.
- Unknown configuration keys should be retained during edits so another application can still use them.

## Final Checks

- YAML parses without errors.
- Each view has a distinct name.
- Every `formula.X` reference has a matching formula.
- Every summary name is built in or declared under `summaries`.
- Sort and group directions are `ASC` or `DESC`.
- Filters are placed at the intended global or per-view scope.
- Dashboard widgets reference the exact file path and view name.
