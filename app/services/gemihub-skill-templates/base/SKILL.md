---
name: base
description: Create and edit GemiHub Bases (.base files) with views, filters, formulas, and summaries. Use when working with .base files, building database-like views of notes, or when the user mentions Bases, table/card/list views, filters, or formulas.
---

# GemiHub Bases Skill

Create GemiHub Bases (`.base`) files that display dynamic, filtered views of vault content. A `.base` file is YAML. GemiHub renders it in a dedicated editor (Display / Raw toggle) and it can also be embedded in a dashboard via the `base` widget.

Always output valid YAML when creating or modifying a `.base` file.

## Workflow

1. **Clarify the use case** — what notes to show, how to filter, and how to group/sort.
2. **Create the file** — use `create_drive_file` (or `update_drive_file` to edit) with a path like `dashboards/bases/<Name>.base`. Any folder works; `dashboards/bases/` mirrors how dashboards live under `dashboards/`.
3. **Define filters** — narrow down which notes appear (by tag, folder, property, or date).
4. **Add formulas** (optional) — compute derived values in the `formulas` section.
5. **Configure views** — add one or more views (`table`, `cards`, or `list`).
6. **Validate YAML** — valid YAML, no tabs, proper quoting.

## File Structure

A `.base` file is YAML with these top-level sections (all optional):

```yaml
filters:    # Global filters applied to all views
formulas:   # Computed properties reusable across views
properties: # Display configuration per property
summaries:  # Custom summary formula definitions
views:      # List of view configurations
```

## Complete Example

```yaml
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
    - not:
        - file.hasTag("book")
        - file.inFolder("Required Reading")
formulas:
  formatted_price: 'if(price, price.toFixed(2) + " dollars")'
  ppu: "(price / age).toFixed(2)"
properties:
  status:
    displayName: Status
  formula.formatted_price:
    displayName: "Price"
  file.ext:
    displayName: Extension
summaries:
  customAverage: 'values.mean().round(3)'
views:
  - type: table
    name: "My table"
    limit: 10
    groupBy:
      property: note.age
      direction: DESC
    filters:
      and:
        - 'status != "done"'
        - or:
            - "formula.ppu > 5"
            - "price > 2.1"
    order:
      - file.name
      - file.ext
      - note.age
      - formula.ppu
    sort:
      - property: note.age
        direction: DESC
    summaries:
      formula.ppu: Average
```

## Filters

By default a base includes **every file in the vault** (there is no `from`/`source` like SQL or Dataview). Use `filters` to narrow down.

Filters can be applied at two levels:
1. **Global `filters`** — apply to all views in the base.
2. **View-level `filters`** — apply only to a specific view.

Both are concatenated with `AND` when evaluating a view.

### Filter Structure

A filter is either a single string statement, or a recursively defined object with `and`, `or`, or `not` keys containing lists of filter objects or string statements.

```yaml
# Simple
filters:
  and:
    - file.hasTag("tag")

# Complex nested
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
    - not:
        - file.hasTag("book")
        - file.inFolder("Required Reading")
```

### Filter Statements

A filter statement is a string that evaluates to truthy/falsey. It can be:
- A basic comparison using arithmetic/comparison operators.
- A function call (e.g., `file.hasTag("book")`).

## Formulas

Formula properties are computed values displayed across views. Stored as strings in YAML; output type depends on data and functions used.

```yaml
formulas:
  formatted_price: 'if(price, price.toFixed(2) + " dollars")'
  ppu: "(price / age).toFixed(2)"
```

### Property References

| Kind | Prefix | Example |
|------|--------|---------|
| Note properties (frontmatter) | `note.` or none | `note.price`, `price` |
| File properties | `file.` | `file.size`, `file.ext` |
| Formula properties | `formula.` | `formula.formatted_price` |

- Formulas can reference other formulas as long as there is no circular reference.
- Use nested quotes for text literals: `'if(status, "Done")'`.

## Properties

Stores display configuration per property. Used by views (e.g., table column headers use `displayName`).

```yaml
properties:
  status:
    displayName: Status
  formula.formatted_price:
    displayName: "Price"
  file.ext:
    displayName: Extension
```

Display names are NOT used in filters or formulas.

## Summaries

### Custom Summary Formulas

```yaml
summaries:
  customAverage: 'values.mean().round(3)'
```

In a summary formula, `values` is a list of all values for that property across every note in the result set. The formula returns a single value. A custom summary name must NOT collide with a built-in name.

### Built-in Summary Names

`Average`, `Min`, `Max`, `Sum`, `Range`, `Median`, `Stddev`, `Earliest`, `Latest`, `Checked`, `Unchecked`, `Empty`, `Filled`, `Unique`. See `references/views.md` for the full table.

## Views

Each entry in `views` defines a separate view of the same data. The **first** view loads by default.

```yaml
views:
  - type: table
    name: "My table"
    limit: 10
    groupBy:
      property: note.age
      direction: DESC
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - note.age
    sort:
      - property: note.age
        direction: DESC
    summaries:
      formula.ppu: Average
```

### View Fields

| Field | Description |
|-------|-------------|
| `type` | View layout: `table`, `cards`, or `list` |
| `name` | Display name (required, unique); first view in the list loads by default |
| `limit` | Max number of rows |
| `filters` | View-level filters (same syntax as global, concatenated with AND) |
| `groupBy` | Object with `property` and `direction` (`ASC`/`DESC`) |
| `order` | List of property names — the **column display order** (does not sort) |
| `sort` | List of `{ property, direction }` objects — the actual **sort keys** (`direction` is `ASC` or `DESC`) |
| `summaries` | Map of property name → summary name (built-in or custom) |

> **GemiHub note:** `order` only controls which columns appear and their order — it does **not** sort. To sort, use `sort` with `{ property, direction }` entries. (Obsidian's Bases overloads `order` for sorting; GemiHub separates the two.)

### View Types

| Type | Description |
|------|-------------|
| `table` | Rows in a table, columns from `order`/properties |
| `cards` | Grid of cards, gallery-like (supports a cover image property) |
| `list` | Bulleted or numbered list |

> Obsidian's `map` view is **not** supported in GemiHub; an unknown `type` falls back to `table`.

## File Properties

Available for all file types:

| Property | Type | Description |
|----------|------|-------------|
| `file.backlinks` | List | Files linking to this note |
| `file.ctime` | Date | Created time |
| `file.embeds` | List | Embeds in the note |
| `file.ext` | String | File extension |
| `file.folder` | String | Path of the file's folder |
| `file.links` | List | Internal links in the note |
| `file.mtime` | Date | Modified time |
| `file.name` | String | File name (with extension) |
| `file.basename` | String | File name without extension |
| `file.path` | String | Full path of the file |
| `file.properties` | Object | All frontmatter properties |
| `file.size` | Number | File size |
| `file.tags` | List | Tags from frontmatter |

### The `this` Object

`this` refers to the display context — when a base is shown standalone it is the `.base` file itself; when embedded it is the embedding context. Use case: `file.hasLink(this.file)` replicates a backlinks pane.

## Operators

### Arithmetic
`+` plus · `-` minus · `*` multiply · `/` divide · `%` modulo · `( )` grouping

### Date Arithmetic

Add/subtract durations using `+`/`-` with duration strings:

| Unit | Duration |
|------|----------|
| `y`, `year`, `years` | year |
| `M`, `month`, `months` | month |
| `d`, `day`, `days` | day |
| `w`, `week`, `weeks` | week |
| `h`, `hour`, `hours` | hour |
| `m`, `minute`, `minutes` | minute |
| `s`, `second`, `seconds` | second |

Examples:
- `now() + "1 day"` — 24 hours from now
- `file.mtime > now() - "1 week"` — modified within the last week
- `date("2024-12-01") + "1M" + "4h" + "3m"` — 2025-01-01 04:03:00
- `now() - file.ctime` — millisecond difference (a duration)

### Comparison
`==` · `!=` · `>` · `<` · `>=` · `<=`

### Boolean
`!` not · `&&` and · `||` or

## Types

- **Strings**: `"message"` (single or double quotes)
- **Numbers**: `1`, `2.5`
- **Booleans**: `true` / `false` (no quotes)
- **Dates**: `date("2025-01-01 12:00:00")`, `now()`, `today()`
- **Lists**: `list()` function, access via `[index]`
- **Objects**: access via `.prop` or `["prop"]`
- **Links**: auto-recognized from wikilinks in frontmatter; `link("filename")`
- **Files**: via `file()`; `file.asLink()` to convert

## Common Patterns

**Active tasks** (notes tagged `task`, grouped by status):
```yaml
filters:
  and:
    - file.hasTag("task")
    - 'status != "done"'
views:
  - type: table
    name: "Active tasks"
    order:
      - file.name
      - note.priority
      - note.due
    sort:
      - property: note.due
        direction: ASC
    groupBy:
      property: note.status
      direction: ASC
```

**Recently modified notes**:
```yaml
filters:
  and:
    - 'file.mtime > now() - "7 days"'
    - 'file.ext == "md"'
views:
  - type: table
    name: "Recently modified"
    order:
      - file.name
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC
    limit: 20
```

**Library cards by progress**:
```yaml
filters:
  and:
    - file.hasTag("book")
formulas:
  progress: '(pages_read / pages * 100).round(1)'
properties:
  formula.progress:
    displayName: "Progress %"
views:
  - type: cards
    name: "Library"
    order:
      - file.name
      - note.author
      - formula.progress
```

## YAML Quoting Rules

- Use single quotes for formulas/filter statements containing double quotes: `'if(done, "Yes", "No")'`.
- Use double quotes for simple strings: `"My View Name"`.
- Strings containing `:`, `{`, `}`, `[`, `]`, `#`, etc. must be quoted.
- No tabs — use consistent spaces for indentation.

## Reference Files

- `references/functions.md` — full function/method reference (global, date, string, number, list, file, link, object, regexp).
- `references/views.md` — view types, configuration fields, sort/group behavior, and the built-in summaries table.

## Validation Checklist

- [ ] Valid YAML (no tabs, consistent indentation)
- [ ] Filter statements are quoted strings
- [ ] Formula strings properly quoted with nested quotes for literals
- [ ] Property references use the correct prefix (`note.`, `file.`, `formula.`)
- [ ] Each view has a unique non-empty `name` and a `type` of `table`/`cards`/`list`
- [ ] `sort` entries are `{ property, direction }` with `direction` = `ASC`/`DESC` (use `sort`, not `order`, to actually sort)
- [ ] `groupBy.direction` is `ASC` or `DESC`
- [ ] No circular formula references
- [ ] Custom summary names don't collide with built-in names
