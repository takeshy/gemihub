# Bases Views Reference

## View Types

| Type | Description |
|------|-------------|
| `table` | Rows in a table; columns come from `order` / properties |
| `cards` | Grid of cards, gallery-like (supports a cover image property) |
| `list` | Bulleted or numbered list |

> The Obsidian `map` view is **not** supported in GemiHub. An unknown `type` falls back to `table`.

## View Configuration

| Field | Description |
|-------|-------------|
| `type` | View layout type (`table` / `cards` / `list`) |
| `name` | Display name (required, unique); the first view in the list loads by default |
| `limit` | Max number of rows |
| `filters` | View-level filters, concatenated with `AND` alongside global filters |
| `groupBy` | Object with `property` and `direction` (`ASC`/`DESC`); only one group property is supported |
| `order` | List of property names — **column display order only** (does not sort) |
| `sort` | List of `{ property, direction }` — the actual **sort keys** (`direction` = `ASC`/`DESC`) |
| `summaries` | Map of property name → summary name (built-in or custom) |

## Sort and Group

- **Sort:** use `sort` with one or more `{ property, direction }` entries. (`order` only sets the column order — it does not sort.)
- **Group:** `groupBy` organizes rows into sections by a single property.

Sort direction by property type:
- Text: A→Z (`ASC`) or Z→A (`DESC`)
- Number: low→high (`ASC`) or high→low (`DESC`)
- Date: old→new (`ASC`) or new→old (`DESC`)

```yaml
views:
  - type: table
    name: "By due date"
    order:
      - file.name
      - note.due
      - note.status
    sort:
      - property: note.due
        direction: ASC
    groupBy:
      property: note.status
      direction: ASC
```

## Cards View — Cover Image

The `cards` view can show a cover image. Map a property to the image via a view option (e.g. `image: cover`). The value may be:
- An internal embed/link: `![[folder/cover.png]]` or `[[cover.png]]`
- A Drive path: `folder/cover.png`
- A full URL: `https://…`
- An inline data URI: `data:image/png;base64,…`

GemiHub resolves vault file names/paths to the cached file and fetches it; external URLs and data URIs are used directly.

## Summaries

A view's `summaries` maps a property to a summary name; the value appears in the view's footer (and per-group when `groupBy` is set).

### Built-in Summary Names

| Name | Input Type | Description |
|------|-----------|-------------|
| `Average` | Number | Mathematical mean |
| `Min` | Number | Smallest value |
| `Max` | Number | Largest value |
| `Sum` | Number | Sum of all numbers |
| `Range` | Number | Max − Min |
| `Range` | Date | Latest − Earliest (a duration) |
| `Median` | Number | Median |
| `Stddev` | Number | Population standard deviation |
| `Earliest` | Date | Earliest date |
| `Latest` | Date | Latest date |
| `Checked` | Boolean | Count of `true` values |
| `Unchecked` | Boolean | Count of `false` values |
| `Empty` | Any | Count of empty values |
| `Filled` | Any | Count of non-empty values |
| `Unique` | Any | Count of unique values |

### Custom Summaries

Define custom summaries at the top level under `summaries:` and reference them by name in a view. In a custom summary formula, `values` is the list of all values for that property across the result set:

```yaml
summaries:
  customAverage: 'values.mean().round(3)'
views:
  - type: table
    name: "Stats"
    summaries:
      note.price: customAverage
```

A custom summary name must not collide with a built-in name.

## Using a Base

- Open the `.base` file in GemiHub to see its rendered views (Display / Raw toggle; a view switcher appears when there are multiple views).
- Embed a view in a dashboard with the `base` widget: set `config.base` to the `.base` file's vault path and `config.view` to a view name (see the dashboard skill).
