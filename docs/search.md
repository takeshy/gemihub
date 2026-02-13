# Search

Multi-mode file search with Local, Drive, and RAG search, plus Quick Open for rapid file navigation.

## Features

- **Local Search**: Search IndexedDB cached files by name and content (offline-capable)
- **Drive Search**: Full-text search in Google Drive (name + content)
- **RAG Search**: Semantic search using Gemini File Search with AI-generated answers
- **Quick Open**: Rapid file navigation with keyboard shortcut (Cmd+P / Ctrl+P)

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+F (Ctrl+Shift+F) | Open Search Panel |
| Cmd+P (Ctrl+P) | Open Quick Open dialog |

---

## Search Panel

Accessible from the left sidebar. Replaces the file tree when active.

### Local Mode

Searches files cached in IndexedDB (offline-capable).

- **Multi-term search**: Splits query by whitespace, ALL terms must match (AND logic)
- **Matching**: Searches both file name and content (case-insensitive)
- **Snippets**: Shows 40 characters before/after the first matching term in content
- **Limitation**: Only searches locally cached files, not live Drive content

### Drive Mode

Full-text search via Google Drive API.

- Searches file names and content within the user's `gemihub/` folder
- Network-dependent, returns real-time results
- Returns file ID, name, and MIME type

### RAG Mode

Semantic search using Gemini's File Search tool.

- Requires configured RAG stores in Settings
- Uses multi-line textarea input (Ctrl+Enter / Cmd+Enter to search)
- Returns both matched file results and an AI-generated answer
- Binary file extensions are filtered from results

#### Model Selection

Available models depend on API plan:

| Plan | Models |
|------|--------|
| Free | gemini-2.5-flash-lite, gemini-2.5-flash |
| Paid | gemini-3-flash-preview, gemini-3-pro-preview |

#### RAG Result Matching

RAG results are matched against the local file list to provide file IDs for navigation. Unmatched results are displayed without navigation capability.

### Result Display

Each result shows:

- File type icon (YAML: orange, Markdown: blue, JSON: yellow, other: gray)
- File name
- File path (if available)
- Content snippet (Local mode only)

Clicking a result opens the file in the editor.

---

## Quick Open

Modal dialog for rapid file selection.

### Features

- **Substring matching**: Case-insensitive search against file name and path
- **Keyboard navigation**: Arrow keys to move selection, Enter to open, Escape to close
- **Real-time filtering**: Results update as you type
- **Auto-scroll**: Selected item scrolls into view
- **Max visible**: 10 items shown at a time (scrollable)

### Image Picker Mode

Quick Open is also used as an image picker in the WYSIWYG editor:

- Filters file list to image extensions (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`)
- Returns image URL via callback

---

## API

### Request

POST `/api/search`

```typescript
{
  query: string              // Search query (required)
  mode: "rag" | "drive"     // Search mode (required)
  ragStoreIds?: string[]    // RAG store IDs (required for RAG mode)
  topK?: number             // Result limit, 1-20 (default: 5, RAG mode only)
  model?: string            // Gemini model name (RAG mode only)
}
```

### Response

**Drive mode:**
```json
{
  "mode": "drive",
  "results": [
    { "id": "fileId", "name": "file.md", "mimeType": "text/markdown" }
  ]
}
```

**RAG mode:**
```json
{
  "mode": "rag",
  "results": [
    { "title": "file.md", "uri": "..." }
  ],
  "aiText": "AI-generated answer based on the matching files."
}
```

---

## Key Files

| File | Description |
|------|-------------|
| `app/routes/api.search.tsx` | Search API endpoint (Drive + RAG modes) |
| `app/components/ide/SearchPanel.tsx` | Search panel UI (Local / Drive / RAG tabs) |
| `app/components/ide/QuickOpenDialog.tsx` | Quick Open dialog (Cmd+P) |
| `app/routes/_index.tsx` | Keyboard shortcut registration |
