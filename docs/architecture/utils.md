---
type: Guide
title: Utils
description: "Utilities: context menu, trash, slash commands, and other helpers."
tags:
  - utils
---
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
| Edit History | View local edit history and restore any version |
| Download | Download file locally (cache-first, falls back to API) |
| Convert to PDF | Convert Markdown/HTML file to PDF, saved to `temporaries/` |
| Convert to HTML | Convert Markdown file to HTML, saved to `temporaries/` |
| Publish | Make the file publicly accessible via a signed shareable link (URL auto-copied) |
| Copy Link | Copy the public URL of a published file to clipboard (minted server-side) |
| Unpublish | Revoke public sharing for the file |
| Encrypt / Decrypt | Encrypt (appends `.encrypted`) or decrypt the file |
| Clear Cache | Delete the IndexedDB cache (warns if there are unsaved changes) |
| Duplicate | Duplicate the file as `name (copy).ext` |
| Rename | Rename the file |
| Trash | Move the file to the Drive `trash/` folder (soft delete) |

### Folder Menu Items

| Menu Item | Description |
|-----------|-------------|
| Cache folder (N) | Download and cache every uncached file under the folder (excluding local-only `new:` placeholders). The `(N)` suffix shows how many files will be fetched. Shown only when uncached files exist in the subtree. See [Sync → Lazy-Fetch](../features/sync.md#lazy-fetch-uncached-files) |
| Download as ZIP | Bundle every file in the folder into a ZIP and download |
| Clear Cache | Bulk-delete cache for all files in the folder. If any files have unsaved changes, a confirmation dialog warns that changes will be lost; confirming deletes all cached files including modified ones. Shown only when cached files exist in the folder |
| Rename | Rename the folder |
| Trash | Move all files in the folder to `trash/` |

### FILES Header Actions

Icons on the right side of the FILES sidebar header:

| Icon | Action |
|------|--------|
| 🗑 Trash | Delete all selected files (shown only when files are selected) |
| 🔍 Search | Open the Quick Open / Drive search panel |
| ＋ File | Create a new file at the current location |
| ＋ Folder | Create a new folder at the current location |
| ⬆ Upload | Upload local files to Drive |
| 🗄 Cache all | Bulk-download every uncached file in the workspace. Disabled when all files are already cached or a bulk cache is in progress; the tooltip shows the pending count or live progress |

### Visibility Conditions

- **Encrypt / Decrypt**: Toggled based on presence of `.encrypted` extension
- **Convert to PDF/HTML**: Shown only for Markdown or HTML files
- **Publish / Unpublish / Copy Link**: Shown for non-encrypted files, based on current publish state
- **Clear Cache (file)**: Shown only when a cache entry exists for the file

---

## Public Links

**Publish** grants Drive's `anyone with the link` reader permission and hands
back a link served by GemiHub itself:

```
/public/file/{fileId}/{fileName}?s={signature}
```

The route (`public.file.$fileId.$fileName.tsx`) is unauthenticated — that is the
point of publishing, and anyone holding the link opens it without signing in.
The `s` parameter is not viewer authentication; it is an HMAC over the file id
(`public-link.server.ts`, keyed by `SESSION_SECRET`) proving GemiHub minted the
link for a file its owner published. Without it the route would proxy ANY Drive
file id, which lets a third party serve their own HTML or JS from this app's
origin and reach the IDE's IndexedDB cache and same-origin APIs.

| Request | Result |
|---------|--------|
| Signed | Served with its own content type and `CSP: sandbox allow-scripts …` |
| Unsigned, passive content (images, PDF, CSS, text) | Served with `CSP: sandbox` and `nosniff` — keeps links published before signing working |
| Unsigned, script-capable (`.html`, `.htm`, `.js`, `.mjs`, `.svg`) | 403, asking the owner to re-publish |

Published pages still render and run their own scripts; the sandbox CSP only
denies them `allow-same-origin`, so they cannot read this app's storage or call
`/api/*` with the viewer's cookies.

The signed path is stored as `publicPath` on the file's `_sync-meta.json` entry
when it is published (`setFileSharedInMeta`), so every device can show and copy
the link offline. Files published before links were signed have no `publicPath`;
**Copy Link** mints one through `/api/drive/files` (`action: "publicLink"`).
Rotating `SESSION_SECRET` invalidates every published link.

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

When no explicit context (`{content}`, `{selection}`, `@file`) is included, the name and ID of the currently open file are automatically appended to the message, subject to the following conditions:

- The currently open file differs from the file referenced in the most recent message in the conversation
- The user has not dismissed the file context chip in the chat input

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
