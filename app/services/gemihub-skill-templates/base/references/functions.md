# Bases Functions Reference

Functions and methods available in `.base` filter statements, formulas, and summaries. GemiHub implements the Obsidian Bases expression language.

## Global Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `date()` | `date(date: string): date` | Parse `YYYY-MM-DD HH:mm:ss` to a date |
| `duration()` | `duration(value: string): duration` | Parse a duration string |
| `escapeHTML()` | `escapeHTML(html: string): string` | Escape HTML special characters |
| `file()` | `file(path: string \| file \| url): file` | Get a file object from a path/link/url |
| `html()` | `html(html: string): html` | Render a string as HTML |
| `icon()` | `icon(name: string): icon` | Lucide icon for display |
| `if()` | `if(condition, trueResult, falseResult?): any` | Conditional; `false` branch defaults to null |
| `image()` | `image(path: string \| file \| url): image` | Image object for rendering |
| `link()` | `link(path: string, display?: value): Link` | Create a Link object |
| `list()` | `list(element: any): List` | Wrap a single value in a list |
| `max()` | `max(value1, value2, ...): number` | Largest of the provided numbers |
| `min()` | `min(value1, value2, ...): number` | Smallest of the provided numbers |
| `now()` | `now(): date` | Current date and time |
| `number()` | `number(input: any): number` | Convert to number |
| `random()` | `random(): number` | Random number in [0, 1) |
| `today()` | `today(): date` | Current date at midnight |

## Date Functions

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `.year` | number | Year |
| `.month` | number | Month (1–12) |
| `.day` | number | Day of the month |
| `.hour` | number | Hour (0–23) |
| `.minute` | number | Minute (0–59) |
| `.second` | number | Second (0–59) |
| `.millisecond` | number | Millisecond (0–999) |

### Methods

| Function | Description |
|----------|-------------|
| `.date()` | Date with time removed |
| `.format(format)` | Format using a Moment.js-style pattern |
| `.time()` | Time portion as a string |
| `.relative()` | Human-readable relative time (e.g. "3 days ago") |
| `.isEmpty()` | Returns false (a date is never empty) |

### Date Arithmetic

```
now() + "1 day"                          # Tomorrow
today() + "7d"                           # A week from today
now() - file.ctime                       # Milliseconds since created (duration)
file.mtime > now() - "1 week"            # Modified within the last week
date("2024-12-01") + "1M" + "4h" + "3m"  # 2025-01-01 04:03:00
```

Duration units: `y`/`year`/`years`, `M`/`month`/`months`, `d`/`day`/`days`, `w`/`week`/`weeks`, `h`/`hour`/`hours`, `m`/`minute`/`minutes`, `s`/`second`/`seconds`.

## String Functions

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `.length` | number | Character count |

### Methods

| Function | Description |
|----------|-------------|
| `.contains(value)` | Substring check |
| `.containsAll(...values)` | Contains all substrings |
| `.containsAny(...values)` | Contains at least one substring |
| `.startsWith(query)` | Prefix check |
| `.endsWith(query)` | Suffix check |
| `.isEmpty()` | True if empty |
| `.lower()` | To lowercase |
| `.upper()` | To uppercase |
| `.title()` | Title case (first letter of each word) |
| `.replace(pattern, replacement)` | Replace (string or Regexp; `$1`, `$2` for capture groups) |
| `.repeat(count)` | Repeat the string |
| `.reverse()` | Reverse the string |
| `.split(separator)` | Split into a list |
| `.slice(start, end?)` | Substring |
| `.trim()` | Remove surrounding whitespace |

## Number Functions

| Function | Description |
|----------|-------------|
| `.abs()` | Absolute value |
| `.ceil()` | Round up |
| `.floor()` | Round down |
| `.round(digits?)` | Round to digits |
| `.toFixed(precision)` | Fixed-point notation |
| `.isEmpty()` | True if the number is not present |

## List Functions

| Function | Description |
|----------|-------------|
| `[index]` | Access an element (0-based) |
| `.length` | List length (field) |
| `.contains(value)` | List contains the value |
| `.containsAll(...values)` | Contains all values |
| `.containsAny(...values)` | Contains at least one value |
| `.mean()` | Average of a numeric list |
| `.filter(expression)` | Filter by condition (uses `value`, `index`) |
| `.map(expression)` | Transform elements (uses `value`, `index`) |
| `.reduce(expression, acc)` | Reduce to a single value (uses `value`, `index`, `acc`) |
| `.flat()` | Flatten nested lists |
| `.join(separator)` | Join into a string |
| `.reverse()` | Reverse the list |
| `.slice(start, end?)` | Sublist [start, end) |
| `.sort()` | Sort the list |
| `.unique()` | Remove duplicates |
| `.isEmpty()` | True if the list has no elements |

## Any-Type Functions

| Function | Description |
|----------|-------------|
| `.isTruthy()` | Coerce to boolean |
| `.isType(type)` | Type check (e.g. `"string"`) |
| `.toString()` | String representation |

## File Functions

| Function | Description |
|----------|-------------|
| `file.hasTag(...tags)` | Has any of the tags |
| `file.hasLink(otherFile)` | Has a link to the file |
| `file.hasProperty(name)` | Has the property |
| `file.inFolder(folder)` | In the folder or a subfolder |
| `file.asLink(display?)` | Convert the file to a Link |

## Link Functions

| Function | Description |
|----------|-------------|
| `link.asFile()` | File object if the link refers to a valid local file |
| `link.linksTo(file)` | True if the link's file links to the given file |

## Object Functions

| Function | Description |
|----------|-------------|
| `object.isEmpty()` | True if the object has no own properties |
| `object.keys()` | List of keys |
| `object.values()` | List of values |

## Regular Expression Functions

| Function | Description |
|----------|-------------|
| `regexp.matches(value)` | True if the regexp matches the value string |
