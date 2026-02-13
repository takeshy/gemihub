# Utils

Context menus, trash, and slash commands.

## Features

- **Context Menu**: Action menu for files and folders in the file tree
- **Trash**: Soft-delete file deletion with restore capability
- **Slash Commands**: Custom command definitions and management for chat

---

## Context Menu

Right-click a file or folder in the file tree (or tap the `⋯` button on mobile) to open the context menu.

### File Menu Items

| Menu Item | Description |
|-----------|-------------|
| Encrypt / Decrypt | Encrypt (appends `.encrypted`) or decrypt the file |
| Edit History | View local edit history and restore any version |
| Download | Download file locally (cache-first, falls back to API) |
| Convert to PDF | Convert Markdown/HTML file to PDF, saved to `temporaries/` |
| Convert to HTML | Convert Markdown file to HTML, saved to `temporaries/` |
| Publish | Make the file publicly accessible via a shareable link (URL auto-copied) |
| Copy Link | Copy the public URL of a published file to clipboard |
| Unpublish | Revoke public sharing for the file |
| Clear Cache | Delete the IndexedDB cache (warns if there are unsaved changes) |
| Duplicate | Duplicate the file as `name (copy).ext` |
| Rename | Rename the file |
| Trash | Move the file to the Drive `trash/` folder (soft delete) |

### Folder Menu Items

| Menu Item | Description |
|-----------|-------------|
| Clear Cache | Bulk-delete cache for all files in the folder (warns if modified files exist) |
| Rename | Rename the folder |
| Trash | Move all files in the folder to `trash/` |

### Visibility Conditions

- **Encrypt / Decrypt**: Toggled based on presence of `.encrypted` extension
- **Convert to PDF/HTML**: Shown only for Markdown or HTML files
- **Publish / Unpublish / Copy Link**: Shown for non-encrypted files, based on current publish state
- **Clear Cache (file)**: Shown only when a cache entry exists for the file

---

## Trash

File deletion uses a soft-delete approach. Deleted files are moved to the `gemihub/trash/` folder on Google Drive, and their entries are removed from `_sync-meta.json`.

### Deletion Flow

1. Select "Trash" from the context menu
2. A confirmation dialog appears
3. The file is moved to the `trash/` folder
4. The entry is removed from `_sync-meta.json`
5. Local cache (IndexedDB) and local sync meta are also cleaned up
6. RAG tracking is removed on a best-effort basis

### Deleting Unsaved Files

Files created locally but not yet pushed (IDs with `new:` prefix) are deleted from local cache only, without any Drive API request.

### Trash Management

Open the trash dialog from the Settings screen to view deleted files.

| Action | Description |
|--------|-------------|
| Restore | Move selected files back from `trash/` to the root folder and re-add to `_sync-meta.json` |
| Permanent Delete | Permanently delete selected files from Google Drive (irreversible) |
| Select All | Select all files at once |

### API Actions

| Action | Endpoint | Description |
|--------|----------|-------------|
| `delete` | `/api/drive/files` | Move file to `trash/` and update `_sync-meta.json` |
| `listTrash` | `/api/sync` | List files in the `trash/` folder |
| `restoreTrash` | `/api/sync` | Move files back to root folder and re-add to `_sync-meta.json` (supports rename) |
| `deleteUntracked` | `/api/sync` | Permanently delete files from Google Drive |

---

## Slash Commands

Type `/` in the chat input to open the autocomplete popup and select a registered command.

### Command Fields

| Field | Description |
|-------|-------------|
| Name | Command name (string after `/`, e.g. `summarize`) |
| Description | Command description text |
| Prompt Template | Message template to be sent |
| Model Override | Specify a model for this command (uses default model if omitted) |
| Search Setting Override | Specify Web Search or a specific RAG store |
| Drive Tool Mode Override | Specify `all` / `noSearch` / `none` |
| MCP Server Override | Specify which MCP servers to enable |

### Template Variables

| Variable | Description |
|----------|-------------|
| `{content}` | Full content of the currently active file |
| `{selection}` | Currently selected text in the editor |
| `@filename` | Reference Drive file content (file reference when Drive tools enabled, inlined when disabled) |

### Command Management

Add, edit, and delete commands from Settings > Commands tab. Commands are stored in the `slashCommands` array in `settings.json`.

### Auto File Context

When no explicit context (`{content}`, `{selection}`, `@file`) is included, the name and ID of the currently open file are automatically appended to the message.

---

## Key Files

| File | Description |
|------|-------------|
| `app/components/ide/ContextMenu.tsx` | Generic context menu component |
| `app/components/ide/DriveFileTree.tsx` | File tree (context menu item definitions and handlers) |
| `app/components/settings/TrashDialog.tsx` | Trash dialog (restore / permanent delete UI) |
| `app/components/settings/CommandsTab.tsx` | Commands management tab (Settings screen) |
| `app/routes/api.drive.files.tsx` | File CRUD API (includes delete action) |
| `app/routes/api.sync.tsx` | Sync API (listTrash / restoreTrash / deleteUntracked) |
| `app/types/settings.ts` | `SlashCommand` type definition |
| `app/hooks/useAutocomplete.ts` | Autocomplete logic (slash commands, file references) |
