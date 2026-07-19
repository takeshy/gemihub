# GemiHub Base View Reference

## Supported Layouts

| `type` | Presentation |
|----------|--------------|
| `table` | One result per row; `order` selects columns |
| `cards` | Grid presentation suited to covers and summaries |
| `list` | Compact textual list |

Other view types are retained in the YAML but render using the table fallback.

## Common View Keys

| Key | GemiHub behavior |
|-----|------------------|
| `name` | Unique label used by editors and dashboard widgets |
| `filters` | Additional scope combined with global filters |
| `order` | Displayed property sequence |
| `sort` | Ordered list of property/direction rules |
| `groupBy` | One property and direction used to form groups |
| `limit` | Maximum result count |
| `summaries` | Property-to-summary mapping |

## Sorting Is Separate from Display Order

GemiHub does not overload `order` as a sort instruction:

```yaml
views:
  - type: table
    name: "Work queue"
    order:
      - file.name
      - note.priority
      - note.assignee
    sort:
      - property: note.priority
        direction: DESC
      - property: file.name
        direction: ASC
```

Sort and group directions must be `ASC` or `DESC`.

## Grouped Results

```yaml
groupBy:
  property: note.assignee
  direction: ASC
```

Only one grouping property is used. Summaries are calculated for the full result and for each group where the renderer supports group footers.

## Card Images

A cards view may name an image property:

```yaml
views:
  - type: cards
    name: "Reference library"
    image: note.cover
    order:
      - file.name
      - note.author
      - note.topic
```

GemiHub accepts workspace paths, wiki-style embeds or links, HTTP(S) URLs, and image data URIs. Prefer workspace-relative paths for portable files.

## Summaries

Built-in names:

- Numeric: `Average`, `Min`, `Max`, `Sum`, `Range`, `Median`, `Stddev`
- Date: `Earliest`, `Latest`, `Range`
- Boolean: `Checked`, `Unchecked`
- General: `Empty`, `Filled`, `Unique`

A custom summary is declared once and then assigned to a view property:

```yaml
summaries:
  rounded_mean: 'values.mean().round(1)'

views:
  - type: table
    name: "Effort report"
    order:
      - file.name
      - note.hours
    summaries:
      note.hours: rounded_mean
```

Do not reuse a built-in summary name for a custom definition.

## Opening and Embedding

- Opening a `.base` file shows Display mode, Raw mode, and a view selector.
- A Dashboard Base widget selects the file with `config.base` and the view with `config.view`.
- Leaving `config.view` empty selects the first declared view.
- Multiple widgets can reuse one file with different views.
