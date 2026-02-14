# Editor

File editing system with a WYSIWYG markdown editor, visual workflow editor, HTML preview, and binary file viewer.

## Features

- **File-Type-Specific Editors**: Automatically selects the best editor based on file extension
- **Markdown 3-Mode Editing**: Switch between Preview / WYSIWYG / Raw
- **Visual Workflow Editing**: Display and edit YAML as a Mermaid flowchart
- **Auto-Save**: Debounced (3 seconds) auto-save to IndexedDB cache
- **Edit History**: Maintain local change history with restore to any version
- **Diff View**: Compare with any file and view unified diffs
- **Temp File Sharing**: Generate shareable temporary edit URLs via Temp Upload
- **Encrypted File Support**: Decrypt, edit, and re-encrypt `.encrypted` files
- **Plugin Extensions**: Add custom editor views via plugins
- **Image Insertion**: Insert images from Drive file picker into markdown

---

## File-Type-Specific Editors

`MainViewer` switches the display component based on file extension and MIME type.

### Text Files

| Extension | Editor | Modes |
|-----------|--------|-------|
| `.md` | MarkdownFileEditor | Preview / WYSIWYG / Raw |
| `.yaml`, `.yml` | WorkflowEditor | Visual / YAML |
| `.html`, `.htm` | HtmlFileEditor | Preview / Raw |
| Other (`.txt`, `.js`, `.json`, etc.) | TextFileEditor | Raw only |

### Binary Files

Binary files are detected by file extension (case-insensitive), with MIME type as a fallback.

| Type | Extensions | Display |
|------|-----------|---------|
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico` | `<img>` image display |
| Video | `.mp4`, `.webm`, `.ogg`, `.mov`, `.avi`, `.mkv` | `<video>` player |
| Audio | `.mp3`, `.wav`, `.flac`, `.aac`, `.m4a`, `.opus` | `<audio>` player |
| PDF | `.pdf` | iframe preview |

Binary files show Temp Download / Temp Upload buttons for local editing and download.

### Encrypted Files

Files with the `.encrypted` extension are handled by `EncryptedFileViewer`. After entering a password for decryption, the content can be edited as plain text. The password is cached for the session, enabling auto-decryption.

A **Permanent Decrypt** button is available after decryption. This sends the plaintext to the server, removes the `.encrypted` extension from the file name, and stores the file unencrypted on Drive. A confirmation dialog is shown before proceeding.

### Plugin Extensions

Plugins can register extensions and components in `mainViews` to add custom editors for new file types. Plugin views are checked **before** the built-in editors, so a plugin can override the default editor for any extension (e.g., `.md`, `.yaml`).

---

## Markdown Editor

Markdown files (`.md`) have three editing modes.

### Preview Mode

Read-only rendering via `GfmMarkdownPreview`.

- GitHub Flavored Markdown (tables, checklists, strikethrough)
- Code block syntax highlighting (`rehype-highlight`)
- Inline Mermaid diagram rendering

### WYSIWYG Mode

Rich text editing powered by the `wysimark-lite` library.

- Rich text operations: bold, italic, lists, code blocks, etc.
- Editing while preserving markdown syntax
- Image insertion (via Drive file picker)
- Lazy-loaded (dynamic import via `useEffect`)

### Raw Mode

Direct markdown source editing in a plain `<textarea>` with monospace font.

---

## Workflow Editor

Workflow files (`.yaml`, `.yml`) have two editing modes.

### Visual Mode

- Parses YAML via `engine/parser.ts` and converts to a Mermaid flowchart via `workflow-to-mermaid.ts`
- Displayed as an interactive SVG diagram
- Click a node to open the properties panel (right sidebar)

### YAML Mode

- Direct YAML editing in a raw textarea
- Auto-save with 3-second debounce

---

## Auto-Save

All editors use a common auto-save pattern.

1. Save to IndexedDB cache after a **3-second** debounce from content change
2. Flush unsaved content when the editor loses focus (blur)
3. Emit a `file-modified` event on save to update the file tree badge
4. Record changes in the `editHistory` store (for Sync)

Changes are reflected on Drive via a manual Push operation.

---

## Toolbar

A mode switcher and action buttons are displayed at the top of the editor.

### Mode Switcher

Mode toggle buttons depending on file type (e.g., Preview / WYSIWYG / Raw for markdown).

### Action Buttons (`EditorToolbarActions`)

| Button | Description |
|--------|-------------|
| **Edit History** | Open the edit history modal to view and restore past versions |
| **Diff** | Select a file to compare and display the difference in unified format |
| **Temp Upload** | Generate a temporary edit URL and copy it to clipboard |
| **Temp Download** | Fetch temporary changes and merge them into the editor |

---

## Edit History

Manages local edit history.

- Records a snapshot boundary when a file is opened
- Open the history modal via the Edit History button
- Select any version to restore
- Emits a `file-restored` event on restore to update the editor

Related service: `app/services/edit-history-local.ts`

---

## Diff View

Compare with any file to view differences.

1. Click the Diff button
2. Select the target file with `QuickOpenDialog`
3. Top: editable textarea (current file), Bottom: unified diff display
4. Uses `createTwoFilesPatch()` from the `diff` package

---

## Temp Edit (Temporary File Sharing)

Enables temporary editing from external tools.

### Temp Upload

1. Click the Temp Upload button in the editor
2. Upload current file content to `/api/drive/temp`
3. A confirm dialog asks whether to generate a shareable URL
4. If confirmed, a temporary edit URL is generated and copied to clipboard
5. If declined, only an "Uploaded" message is shown (no URL generated)

### Temp Download

1. Click the Temp Download button
2. Check if the temporary file has changes
3. If changes exist, merge them into the editor

---

## Image Insertion

Image insertion flow in WYSIWYG mode:

1. Click the image button in the wysimark editor
2. Select an image file with `QuickOpenDialog` (supported extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`)
3. Upload to Drive (`/api/drive/files`, action: `create-image`)
4. Insert the returned Drive file URL as a markdown image link

---

## EditorContext

Context for managing shared editor state (`app/contexts/EditorContext.tsx`).

### Provided Values

| Field | Type | Description |
|-------|------|-------------|
| `activeFileId` | `string \| null` | ID of the currently open file |
| `activeFileContent` | `string \| null` | Current file content |
| `activeFileName` | `string \| null` | Current file name |
| `fileList` | `FileListItem[]` | All files from the file tree |
| `getActiveSelection` | `() => SelectionInfo \| null` | Get the current text selection |
| `hasActiveSelection` | `boolean` | Whether a file with content is open (not whether text is selected) |

### Selection Tracking

Tracks editor text selection for use with chat panel slash commands (`{selection}`).

- **Raw textarea**: Records `{text, start, end}` on `onSelect` event
- **WYSIWYG**: Monitors DOM selection via `selectionchange` event (`WysiwygSelectionTracker`)
- **Chat access**: Retrieved via `editorCtx.getActiveSelection()`

---

## Keyboard Shortcuts

| Shortcut | Function |
|----------|----------|
| `Ctrl/Cmd+Shift+F` | Open search panel |
| `Ctrl/Cmd+P` | Open quick file picker |

---

## Mobile Support

- Swipe navigation to switch between file/editor/chat panels
- `visualViewport` support for iOS Safari (layout adjustment when soft keyboard appears)
- Responsive toolbar (dropdown menu on mobile)
- Touch swipe in HTML preview forwarded to parent via `postMessage`

---

## Key Files

| File | Description |
|------|-------------|
| `app/components/editor/MarkdownEditor.tsx` | WYSIWYG markdown editor (wysimark-lite) |
| `app/components/ide/MainViewer.tsx` | Editor routing by file type |
| `app/components/ide/WorkflowEditor.tsx` | Visual workflow + YAML editor |
| `app/components/ide/EncryptedFileViewer.tsx` | Encrypted file decryption and editing |
| `app/components/ide/GfmMarkdownPreview.tsx` | GFM markdown preview (Mermaid support) |
| `app/components/ide/EditorToolbarActions.tsx` | Toolbar actions (Diff, History, Temp) |
| `app/contexts/EditorContext.tsx` | Editor shared state context |
| `app/hooks/useFileWithCache.ts` | Cache-first loading + auto-save |
| `app/services/edit-history-local.ts` | Local edit history management |
