# GemiHub Base Expression Reference

This reference documents functions implemented by GemiHub's Base evaluator. It is a capability list for authoring GemiHub-compatible files, not a description of another application's internals.

## Global Functions

| Name | Typical use |
|------|-------------|
| `date(text)` | Parse a date or date-time |
| `duration(text)` | Parse a duration |
| `if(test, yes, no?)` | Conditional value |
| `now()` / `today()` | Current date-time / current day |
| `number(value)` | Convert to a number |
| `list(value)` | Wrap one value as a list |
| `min(...numbers)` / `max(...numbers)` | Numeric extrema |
| `random()` | Number from zero up to, but not including, one |
| `file(path)` | Resolve a workspace file |
| `link(path, label?)` | Create a link value |
| `image(value)` | Create a renderable image value |
| `icon(name)` | Create a Lucide icon value |
| `html(text)` / `escapeHTML(text)` | Explicit HTML / escaped text |

## Strings

String values expose `length` plus these methods:

- Search: `contains`, `containsAll`, `containsAny`, `startsWith`, `endsWith`
- Transform: `lower`, `upper`, `title`, `trim`, `reverse`, `repeat`
- Extract: `slice`, `split`
- Replace: `replace`
- State: `isEmpty`

Example:

```
note.customer.trim().lower().contains("studio")
```

## Numbers

Available numeric methods are `abs()`, `ceil()`, `floor()`, `round(digits?)`, `toFixed(precision)`, and `isEmpty()`.

```
(note.completed / note.total * 100).round(1)
```

## Dates and Durations

Date fields: `year`, `month`, `day`, `hour`, `minute`, `second`, and `millisecond`.

Date methods: `date()`, `time()`, `format(pattern)`, `relative()`, and `isEmpty()`.

Duration strings accept years, months, weeks, days, hours, minutes, and seconds in long or abbreviated form:

```
file.mtime >= now() - "48 hours"
date(note.deadline) < today() + "1 week"
```

Subtracting two dates yields an elapsed duration represented by the evaluator. Check the rendered result when combining it with numeric operations.

## Lists

Lists support indexed access and a `length` field. Methods include:

- Membership: `contains`, `containsAll`, `containsAny`
- Reshaping: `flat`, `reverse`, `slice`, `sort`, `unique`
- Output: `join`
- Numeric aggregation: `mean`
- Expression transforms: `filter`, `map`, `reduce`
- State: `isEmpty`

Callbacks used by `filter`, `map`, and `reduce` can refer to `value` and `index`; `reduce` also exposes `acc`.

## Files

The active file is available through `file`. Supported helpers:

| Method | Result |
|--------|--------|
| `hasTag(...tags)` | Whether any requested tag is present |
| `hasLink(other)` | Whether the file links to another file |
| `hasProperty(name)` | Whether metadata contains the named property |
| `inFolder(path)` | Whether the file is inside the folder tree |
| `asLink(label?)` | Link value for display |

## Links, Objects, and Regular Expressions

- Links: `asFile()`, `linksTo(file)`
- Objects: `keys()`, `values()`, `isEmpty()`
- Regular expressions: `matches(value)`

All value types also support `isTruthy()`, `isType(name)`, and `toString()`.

## Authoring Advice

- Guard optional metadata with `if()`.
- Quote YAML expressions containing colons, hashes, or nested quotes.
- Prefer short formulas and give them descriptive names.
- Test file resolution and date arithmetic in Display mode before reusing a formula broadly.
