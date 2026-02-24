# Workflow Node Reference

This document provides detailed specifications for all workflow node types.

## Node Types Overview

| Category | Nodes | Description |
|----------|-------|-------------|
| Variables | `variable`, `set` | Declare and update variables |
| Control | `if`, `while`, `sleep` | Conditional branching, loops, pausing |
| LLM | `command` | Execute prompts via Gemini API |
| Data | `http`, `json` | HTTP requests and JSON parsing |
| Drive | `drive-file`, `drive-read`, `drive-search`, `drive-list`, `drive-folder-list`, `drive-save`, `drive-delete` | Google Drive file operations |
| Prompts | `prompt-value`, `prompt-file`, `prompt-selection`, `dialog`, `drive-file-picker` | User input dialogs |
| Composition | `workflow` | Execute another workflow as a sub-workflow |
| External | `mcp` | Call remote MCP servers |
| RAG | `rag-sync` | Sync files to RAG stores |
| Commands | `gemihub-command` | Execute GemiHub file operations |

---

## Node Reference

### variable

Declare and initialize a variable.

```yaml
- id: init
  type: variable
  name: counter
  value: "0"
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `name` | Yes | No | Variable name |
| `value` | No | Yes | Initial value (default: empty string) |

Numeric values are auto-detected: if the value parses as a number, it's stored as a number.

---

### set

Update a variable with an expression.

```yaml
- id: increment
  type: set
  name: counter
  value: "{{counter}} + 1"
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `name` | Yes | No | Variable name to update |
| `value` | Yes | Yes | Expression to evaluate |

Supports arithmetic operators: `+`, `-`, `*`, `/`, `%`. Variables are resolved first, then the result is evaluated as arithmetic if it matches the pattern `number operator number`.

> **Note:** Only a single binary operation is supported (e.g., `{{counter}} + 1`). Compound expressions like `5 + 3 * 2` are treated as a plain string because they don't match the `number operator number` pattern.

---

### if

Conditional branching.

```yaml
- id: branch
  type: if
  condition: "{{count}} > 10"
  trueNext: handleMany
  falseNext: handleFew
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `condition` | Yes | Yes | Expression with comparison operator |

**Supported operators:** `==`, `!=`, `<`, `>`, `<=`, `>=`, `contains`

**Edge routing:** `trueNext` / `falseNext` (defined in YAML, not as properties)

The `contains` operator works with both strings and JSON arrays:
- String: `{{text}} contains error`
- Array: `{{dialogResult.selected}} contains Option A`

---

### while

Loop with condition.

```yaml
- id: loop
  type: while
  condition: "{{counter}} < {{total}}"
  trueNext: processItem
  falseNext: done
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `condition` | Yes | Yes | Loop condition (same format as `if`) |

**Edge routing:** `trueNext` (loop body) / `falseNext` (exit)

Maximum iterations per while node: 1000 (global limit).

---

### sleep

Pause workflow execution.

```yaml
- id: wait
  type: sleep
  duration: "2000"
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `duration` | Yes | Yes | Sleep duration in milliseconds |

---

### command

Execute an LLM prompt via Gemini API.

```yaml
- id: ask
  type: command
  prompt: "Summarize: {{content}}"
  model: gemini-2.5-flash
  ragSetting: __websearch__
  driveToolMode: all
  mcpServers: "mcp_server_id_1,mcp_server_id_2"
  attachments: "imageVar"
  saveTo: summary
  saveImageTo: generatedImage
  systemPrompt: "You are a helpful assistant."
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `prompt` | Yes | Yes | Prompt text to send to the LLM |
| `model` | No | Yes | Model name (default: user's selected model) |
| `ragSetting` | No | No | RAG setting name, `__websearch__` for web search, or `__none__` (default) |
| `driveToolMode` | No | No | `none` (default), `all`, `noSearch` — enables Drive tool calling |
| `mcpServers` | No | No | Comma-separated MCP server IDs to enable |
| `attachments` | No | Yes | Comma-separated variable names containing FileExplorerData |
| `saveTo` | No | No | Variable to store text response |
| `saveImageTo` | No | No | Variable to store generated image (FileExplorerData JSON) |
| `systemPrompt` | No | Yes | System prompt for the LLM |

`command` node uses the same tool constraints as chat:
- Gemma models force function tools (Drive/MCP) off
- Web Search mode forces function tools (Drive/MCP) off

---

### http

Make HTTP requests.

```yaml
- id: fetch
  type: http
  url: "https://api.example.com/data"
  method: POST
  contentType: json
  headers: '{"Authorization": "Bearer {{token}}"}'
  body: '{"query": "{{searchTerm}}"}'
  saveTo: response
  saveStatus: statusCode
  throwOnError: "true"
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `url` | Yes | Yes | Request URL |
| `method` | No | Yes | `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE` |
| `contentType` | No | Yes | `json` (default), `form-data`, `text`, `binary` |
| `headers` | No | Yes | JSON object or `Key: Value` format (one per line) |
| `body` | No | Yes | Request body (for POST/PUT/PATCH) |
| `responseType` | No | Yes | `auto` (default), `text`, `binary` — override Content-Type auto-detection |
| `saveTo` | No | No | Variable for response body |
| `saveStatus` | No | No | Variable for HTTP status code |
| `throwOnError` | No | Yes | `"true"` to throw error on 4xx/5xx responses |

**Response type detection:** By default (`auto`), binary vs text is auto-detected from the Content-Type header. Use `responseType: text` to force text processing (e.g., when a server returns `application/octet-stream` for JSON), or `responseType: binary` to force binary handling.

**Binary responses** are automatically detected and stored as FileExplorerData JSON (Base64 encoded).

**binary contentType:** Sends FileExplorerData as raw binary with its original mimeType. Use with `drive-file-picker` or image generation results.

**form-data example:**
```yaml
- id: upload
  type: http
  url: "https://example.com/upload"
  method: POST
  contentType: form-data
  body: '{"file": "{{fileData}}"}'
  saveTo: response
```

For `form-data`:
- FileExplorerData (from `drive-file-picker` / `drive-save`) is auto-detected and sent as binary
- Use `fieldName:filename` syntax for text file fields (e.g., `"file:report.html": "{{htmlContent}}"`)

---

### json

Parse a JSON string into an object for property access.

```yaml
- id: parseResponse
  type: json
  source: response
  saveTo: data
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `source` | Yes | Yes | Variable name or template containing JSON string |
| `saveTo` | Yes | No | Variable for parsed result |

After parsing, access properties using dot notation: `{{data.items[0].name}}`

**JSON in markdown code blocks:** Automatically extracted from `` ```json ... ``` `` fences.

**Template support:** The `source` property resolves `{{variable}}` templates first, then tries variable lookup (backward compat for `source: myVar`), then uses the resolved string directly as JSON.

---

### drive-file

Write content to a Google Drive file.

```yaml
- id: save
  type: drive-file
  path: "output/{{filename}}.md"
  content: "{{result}}"
  mode: overwrite
  confirm: "true"
  history: "true"
  open: "true"
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `path` | Yes | Yes | File path (`.md` extension auto-appended if missing) |
| `content` | No | Yes | Content to write (default: empty string) |
| `mode` | No | No | `overwrite` (default), `append`, `create` (skip if exists) |
| `confirm` | No | No | `"true"` (default) to show diff review dialog when updating existing files; `"false"` to write without confirmation |
| `history` | No | No | `"true"` to save edit history |
| `open` | No | No | `"true"` to open the file in the editor after workflow completes |

---

### drive-read

Read content from a Google Drive file.

```yaml
- id: read
  type: drive-read
  path: "notes/config.md"
  saveTo: content
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `path` | Yes | Yes | File path or Drive file ID |
| `saveTo` | Yes | No | Variable to store file content |

**Smart path resolution:**
- If path looks like a Drive file ID (no extension, >20 chars): reads directly
- Otherwise: searches by file name, tries with `.md` extension as fallback

---

### drive-search

Search for files on Google Drive.

```yaml
- id: search
  type: drive-search
  query: "{{searchTerm}}"
  searchContent: "true"
  limit: "10"
  saveTo: results
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `query` | Yes | Yes | Search query string |
| `searchContent` | No | No | `"true"` to search file contents (default: name only) |
| `limit` | No | Yes | Maximum results (default: 10) |
| `saveTo` | Yes | No | Variable for results |

**Output format:**
```json
[
  {"id": "abc123", "name": "notes/todo.md", "modifiedTime": "2026-01-01T00:00:00Z"}
]
```

---

### drive-list

List files with filtering.

```yaml
- id: list
  type: drive-list
  folder: "Projects"
  limit: "20"
  sortBy: modified
  sortOrder: desc
  modifiedWithin: "7d"
  saveTo: fileList
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `folder` | No | Yes | Virtual folder prefix (e.g., `"Projects"`) |
| `limit` | No | Yes | Maximum results (default: 50) |
| `sortBy` | No | Yes | `modified` (default), `created`, `name` |
| `sortOrder` | No | Yes | `desc` (default), `asc` |
| `modifiedWithin` | No | Yes | Time filter (e.g., `"7d"`, `"24h"`, `"30m"`) |
| `createdWithin` | No | Yes | Time filter (e.g., `"30d"`) |
| `saveTo` | Yes | No | Variable for results |

**Output format:**
```json
{
  "notes": [
    {"id": "abc123", "name": "Projects/todo.md", "modifiedTime": "...", "createdTime": "..."}
  ],
  "count": 5,
  "totalCount": 12,
  "hasMore": true
}
```

Uses sync metadata for fast listing (no per-file API calls). "Folders" are virtual — derived from path prefixes in file names.

---

### drive-folder-list

List virtual folders.

```yaml
- id: listFolders
  type: drive-folder-list
  folder: "Projects"
  saveTo: folderList
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `folder` | No | Yes | Parent virtual folder path |
| `saveTo` | Yes | No | Variable for results |

**Output format:**
```json
{
  "folders": [{"name": "Active"}, {"name": "Archive"}],
  "count": 2
}
```

Returns only immediate subfolders (one level deep), sorted alphabetically.

---

### drive-save

Save FileExplorerData as a file on Google Drive.

```yaml
- id: saveImage
  type: drive-save
  source: imageData
  path: "images/output"
  savePathTo: savedPath
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `source` | Yes | Yes | Variable name or template containing FileExplorerData JSON |
| `path` | Yes | Yes | Target file path (extension auto-added from source data) |
| `savePathTo` | No | No | Variable to store final file name |

> **Note:** `drive-save` always creates a new file, even if a file with the same path already exists. This differs from `drive-file`, which supports `overwrite` and `append` modes. Running the same workflow repeatedly may create duplicate files.

---

### drive-delete

Soft-delete a file by moving it to the `trash/` subfolder.

```yaml
- id: cleanup
  type: drive-delete
  path: "notes/old-file.md"
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `path` | Yes | Yes | File path to delete (`.md` extension auto-appended if missing) |

The file is moved to `trash/` (not permanently deleted) and removed from sync metadata. Supports the same path resolution as `drive-file` (companion `_fileId` variables, exact name fallback).

---

### prompt-value

Show a text input dialog.

```yaml
- id: input
  type: prompt-value
  title: "Enter a value"
  default: "{{defaultText}}"
  multiline: "true"
  saveTo: userInput
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `title` | No | Yes | Prompt label (default: `"Input"`) |
| `default` | No | Yes | Default value |
| `multiline` | No | No | `"true"` for multi-line textarea |
| `saveTo` | Yes | No | Variable to store user input |

Throws error if user cancels.

---

### prompt-file

Show a file picker and read the selected file's content.

```yaml
- id: pickFile
  type: prompt-file
  title: "Select a file"
  saveTo: fileContent
  saveFileTo: fileInfo
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `title` | No | Yes | Picker dialog title (default: `"Select a file"`) |
| `saveTo` | No | No | Variable to store file content (text) |
| `saveFileTo` | No | No | Variable to store file info JSON (`{path, basename, name, extension}`) |

At least one of `saveTo` or `saveFileTo` is required. Unlike `drive-file-picker`, this node reads the file content automatically.

Throws error if user cancels.

---

### prompt-selection

Show a multiline text input dialog.

```yaml
- id: getText
  type: prompt-selection
  title: "Enter your text"
  saveTo: selection
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `title` | No | Yes | Prompt label (default: `"Enter text"`) |
| `saveTo` | Yes | No | Variable to store user input |

Always shows a multiline textarea. Throws error if user cancels.

---

### dialog

Display a dialog with options, buttons, and/or text input.

```yaml
- id: ask
  type: dialog
  title: Select Options
  message: "Choose items to process"
  markdown: "true"
  options: "Option A, Option B, Option C"
  multiSelect: "true"
  inputTitle: "Additional notes"
  multiline: "true"
  defaults: '{"input": "default text", "selected": ["Option A"]}'
  button1: Confirm
  button2: Cancel
  saveTo: dialogResult
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `title` | No | Yes | Dialog title (default: `"Dialog"`) |
| `message` | No | Yes | Message content |
| `markdown` | No | No | `"true"` renders message as Markdown |
| `options` | No | Yes | Comma-separated list of choices |
| `multiSelect` | No | No | `"true"` for checkboxes, `"false"` for radio |
| `inputTitle` | No | Yes | Label for text input field (shows input when set) |
| `multiline` | No | No | `"true"` for multi-line textarea |
| `defaults` | No | Yes | JSON with `input` and `selected` initial values |
| `button1` | No | Yes | Primary button label (default: `"OK"`) |
| `button2` | No | Yes | Secondary button label |
| `saveTo` | No | No | Variable for result |

**Result format** (`saveTo` variable):
```json
{
  "button": "Confirm",
  "selected": ["Option A", "Option B"],
  "input": "some text"
}
```

> **Important:** When checking selected value in an `if` condition:
> - Single option: `{{dialogResult.selected[0]}} == Option A`
> - Array contains (multiSelect): `{{dialogResult.selected}} contains Option A`

---

### drive-file-picker

Show a file picker dialog to select a Drive file. When `saveTo` is used, the file content is automatically loaded — binary files (PDF, images, etc.) are Base64-encoded, text files are read as-is.

```yaml
- id: selectFile
  type: drive-file-picker
  title: "Select a file"
  mode: select
  extensions: "pdf,doc,md"
  saveTo: fileData
  savePathTo: filePath
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `title` | No | Yes | Picker dialog title (default: `"Select a file"`) |
| `mode` | No | No | `select` (default) to pick existing file, `create` to enter a new path |
| `default` | No | Yes | Default file path (used as initial value in `create` mode) |
| `extensions` | No | No | Comma-separated allowed extensions |
| `path` | No | Yes | Direct file path (bypasses picker when set) |
| `saveTo` | No | No | Variable for FileExplorerData JSON (includes file content) |
| `savePathTo` | No | No | Variable for file name/path |

At least one of `saveTo` or `savePathTo` is required.

**FileExplorerData format:**
```json
{
  "id": "abc123",
  "path": "notes/report.pdf",
  "basename": "report.pdf",
  "name": "report",
  "extension": "pdf",
  "mimeType": "application/pdf",
  "contentType": "binary",
  "data": "JVBERi0xLjQg..."
}
```

- `contentType`: `"binary"` for binary files (PDF, images, etc.), `"text"` for text files
- `data`: Base64-encoded content for binary files, plain text for text files
- In `create` mode, `data` is empty (file does not exist yet)

**Example — image analysis:**
```yaml
- id: select-image
  type: drive-file-picker
  title: "Select an image to analyze"
  extensions: "png,jpg,jpeg,gif,webp"
  saveTo: imageData
- id: analyze
  type: command
  prompt: "Describe this image in detail"
  attachments: imageData
  saveTo: analysis
```

**Example — load file without dialog:**
```yaml
- id: load-pdf
  type: drive-file-picker
  path: "{{pdfPath}}"
  saveTo: pdfData
```

---

### workflow

Execute another workflow as a sub-workflow.

```yaml
- id: runSub
  type: workflow
  path: "workflows/summarize.yaml"
  name: "Summarizer"
  input: '{"text": "{{content}}"}'
  output: '{"result": "summary"}'
  prefix: "sub_"
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `path` | Yes | Yes | Path to workflow file |
| `name` | No | Yes | Workflow name (for multi-workflow files) |
| `input` | No | Yes | JSON or `key=value` mapping for sub-workflow input |
| `output` | No | Yes | JSON or `key=value` mapping for output variables |
| `prefix` | No | No | Prefix for all output variables (when `output` not specified) |

**Input mapping:** `'{"subVar": "{{parentValue}}"}'` or `subVar={{parentValue}},x=hello`

**Output mapping:** `'{"parentVar": "subResultVar"}'` or `parentVar=subResultVar`

If neither `output` nor `prefix` is specified, all sub-workflow variables are copied directly.

---

### mcp

Call a remote MCP (Model Context Protocol) server tool via HTTP.

```yaml
- id: search
  type: mcp
  url: "https://mcp.example.com/v1"
  tool: "web_search"
  args: '{"query": "{{searchTerm:json}}"}'
  headers: '{"Authorization": "Bearer {{apiKey}}"}'
  saveTo: searchResults
  saveUiTo: uiData
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `url` | Yes | Yes | MCP server endpoint URL |
| `tool` | Yes | Yes | Tool name to call |
| `args` | No | Yes | JSON object with tool arguments |
| `headers` | No | Yes | JSON object with HTTP headers |
| `saveTo` | No | No | Variable for result |
| `saveUiTo` | No | No | Variable for UI resource data (when server returns `_meta.ui.resourceUri`) |

Uses JSON-RPC 2.0 protocol (`tools/call` method). Text content parts from the response are joined with newlines.

---

### rag-sync

Sync a Drive file to a Gemini RAG store (File Search).

```yaml
- id: sync
  type: rag-sync
  path: "notes/knowledge-base.md"
  ragSetting: "myRagStore"
  saveTo: syncResult
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `path` | Yes | Yes | File path on Drive |
| `ragSetting` | Yes | Yes | RAG setting name (from Settings > RAG) |
| `saveTo` | No | No | Variable for sync result |

Uploads the specified Drive file to the RAG store. Creates the store if it doesn't already exist. The result contains `{path, ragSetting, fileId, storeName, mode, syncedAt}`.

Use this to prepare files for RAG-powered `command` nodes (set `ragSetting` on the command node to the same setting name).

---

### gemihub-command

Execute GemiHub file operations (encrypt, publish, rename, etc.) as workflow nodes.

```yaml
- id: pub
  type: gemihub-command
  command: publish
  path: "notes/readme.md"
  saveTo: url
```

| Property | Required | Template | Description |
|----------|:--------:|:--------:|-------------|
| `command` | Yes | Yes | Command name (see table below) |
| `path` | Yes | Yes | File path, Drive file ID, or `{{variable}}` |
| `text` | No | Yes | Additional text argument (usage depends on command) |
| `saveTo` | No | No | Variable to store the result |

**Available commands:**

| Command | `text` usage | `saveTo` result |
|---------|-------------|-----------------|
| `encrypt` | — | New file name (with `.encrypted` suffix) |
| `publish` | — | Public URL |
| `unpublish` | — | `"ok"` |
| `duplicate` | Custom name (optional; default: `"name (copy).ext"`) | New file name |
| `convert-to-pdf` | — | PDF file name (saved to `temporaries/`) |
| `convert-to-html` | — | HTML file name (saved to `temporaries/`) |
| `rename` | New name (**required**) | New file name |

**Path resolution** follows the same pattern as `drive-read`:
- Direct Drive file ID (20+ alphanumeric chars)
- Companion `_fileId` variable from `drive-file-picker`
- Search by file name → `findFileByExactName` fallback

**Examples:**

```yaml
# Encrypt a file
- id: enc
  type: gemihub-command
  command: encrypt
  path: "notes/secret.md"
  saveTo: encryptedName

# Duplicate with custom name
- id: dup
  type: gemihub-command
  command: duplicate
  path: "templates/report.md"
  text: "reports/2026-report.md"
  saveTo: newFile

# Rename a file picked by user
- id: pick
  type: drive-file-picker
  title: "Select file to rename"
  savePathTo: filePath
- id: ren
  type: gemihub-command
  command: rename
  path: "{{filePath}}"
  text: "{{filePath}}-archived.md"
  saveTo: renamedName

# Convert markdown to PDF
- id: pdf
  type: gemihub-command
  command: convert-to-pdf
  path: "notes/report.md"
  saveTo: pdfName

# Convert markdown to HTML
- id: html
  type: gemihub-command
  command: convert-to-html
  path: "notes/report.md"
  saveTo: htmlName
```

---

## Variable Expansion

Use `{{variable}}` syntax to reference variables:

```yaml
# Basic
path: "{{folder}}/{{filename}}.md"

# Object/Array access
url: "https://api.example.com?id={{data.id}}"
content: "{{items[0].name}}"

# Dynamic index (for loops)
path: "{{parsed.notes[counter].path}}"
```

### JSON Escape Modifier

Use `{{variable:json}}` to escape the value for embedding in JSON strings. This properly escapes newlines, quotes, and other special characters.

```yaml
# Without :json - breaks if content has newlines/quotes
args: '{"text": "{{content}}"}'       # ERROR if content has special chars

# With :json - safe for any content
args: '{"text": "{{content:json}}"}'  # OK - properly escaped
```

---

## Workflow Termination

Use `next: end` to explicitly terminate the workflow:

```yaml
- id: save
  type: drive-file
  path: "output.md"
  content: "{{result}}"
  next: end    # Workflow ends here

- id: branch
  type: if
  condition: "{{cancel}}"
  trueNext: end      # End workflow on true branch
  falseNext: continue
```

---

## Practical Examples

### 1. Drive File Summary

```yaml
name: Summarize File
nodes:
  - id: select
    type: drive-file-picker
    title: "Select a file to summarize"
    extensions: "md,txt"
    savePathTo: filePath
  - id: read
    type: drive-read
    path: "{{filePath}}"
    saveTo: content
  - id: summarize
    type: command
    prompt: "Summarize this text:\n\n{{content}}"
    saveTo: summary
  - id: save
    type: drive-file
    path: "summaries/{{filePath}}"
    content: "# Summary\n\n{{summary}}"
```

### 2. API Integration

```yaml
name: Weather Report
nodes:
  - id: city
    type: dialog
    title: City name
    inputTitle: City
    saveTo: cityInput
  - id: geocode
    type: http
    url: "https://geocoding-api.open-meteo.com/v1/search?name={{cityInput.input}}&count=1"
    method: GET
    saveTo: geoResponse
  - id: parseGeo
    type: json
    source: geoResponse
    saveTo: geo
  - id: weather
    type: http
    url: "https://api.open-meteo.com/v1/forecast?latitude={{geo.results[0].latitude}}&longitude={{geo.results[0].longitude}}&current=temperature_2m"
    method: GET
    saveTo: weatherData
  - id: report
    type: command
    prompt: "Create a weather report:\n{{weatherData}}"
    saveTo: summary
  - id: save
    type: drive-file
    path: "weather/{{cityInput.input}}.md"
    content: "# Weather: {{cityInput.input}}\n\n{{summary}}"
```

### 3. Batch Processing with Loop

```yaml
name: Tag Analyzer
nodes:
  - id: init
    type: variable
    name: counter
    value: "0"
  - id: initReport
    type: variable
    name: report
    value: "# Tag Suggestions\n\n"
  - id: list
    type: drive-list
    folder: "Clippings"
    limit: "5"
    saveTo: notes
  - id: parse
    type: json
    source: notes
    saveTo: parsed
  - id: loop
    type: while
    condition: "{{counter}} < {{parsed.count}}"
    trueNext: read
    falseNext: finish
  - id: read
    type: drive-read
    path: "{{parsed.notes[counter].name}}"
    saveTo: content
  - id: analyze
    type: command
    prompt: "Suggest 3 tags for:\n\n{{content}}"
    saveTo: tags
  - id: append
    type: set
    name: report
    value: "{{report}}## {{parsed.notes[counter].name}}\n{{tags}}\n\n"
  - id: increment
    type: set
    name: counter
    value: "{{counter}} + 1"
    next: loop
  - id: finish
    type: drive-file
    path: "reports/tag-suggestions.md"
    content: "{{report}}"
```

### 4. Sub-Workflow Composition

**File: `workflows/translate.yaml`**
```yaml
name: Translator
nodes:
  - id: translate
    type: command
    prompt: "Translate to {{targetLang}}:\n\n{{text}}"
    saveTo: translated
```

**File: `workflows/main.yaml`**
```yaml
name: Multi-Language Export
nodes:
  - id: input
    type: dialog
    title: Enter text to translate
    inputTitle: Text
    multiline: "true"
    saveTo: userInput
  - id: toJapanese
    type: workflow
    path: "workflows/translate.yaml"
    name: "Translator"
    input: '{"text": "{{userInput.input}}", "targetLang": "Japanese"}'
    output: '{"japaneseText": "translated"}'
  - id: toSpanish
    type: workflow
    path: "workflows/translate.yaml"
    name: "Translator"
    input: '{"text": "{{userInput.input}}", "targetLang": "Spanish"}'
    output: '{"spanishText": "translated"}'
  - id: save
    type: drive-file
    path: "translations/output.md"
    content: |
      # Original
      {{userInput.input}}

      ## Japanese
      {{japaneseText}}

      ## Spanish
      {{spanishText}}
```

### 5. MCP with RAG Server

```yaml
name: RAG Search
nodes:
  - id: query
    type: mcp
    url: "http://localhost:8080"
    tool: "query"
    args: '{"store_name": "mystore", "question": "How does auth work?", "show_citations": true}'
    headers: '{"X-API-Key": "mysecretkey"}'
    saveTo: result
  - id: show
    type: dialog
    title: "Search Result"
    message: "{{result}}"
    markdown: "true"
    button1: "OK"
```
