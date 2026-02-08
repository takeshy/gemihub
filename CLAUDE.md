# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gemini Hub is a web application that integrates Google Gemini AI with Google Drive, with support for self-hosting. It provides visual workflow building, AI chat with streaming/function calling, Drive file management with a WYSIWYG editor, and offline-first caching with push/pull sync.

## Commands

```bash
npm run dev          # Dev server on http://localhost:5170
npm run build        # Production build (react-router build)
npm run start        # Serve production build (port 8080)
npm run typecheck    # Type generation + TypeScript check (react-router typegen && tsc)
npm run lint         # ESLint check (eslint app/)
npm run lint:fix     # ESLint auto-fix
```

No test framework is configured. There are no test files or test scripts.

## Environment

Requires Node.js 22+. Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `SESSION_SECRET`. The dev server port (5170) is set in `vite.config.ts`.

## Architecture

**Stack:** React 19 + React Router 7 (SSR) + Tailwind CSS v4 + Vite. All data stored in Google Drive (no database). Browser IndexedDB for client-side caching.

**Path alias:** `~/*` maps to `./app/*` (configured in tsconfig.json).

### Layer Structure

1. **Routes** (`app/routes/`) — React Router pages and API endpoints. Page routes use loaders for server data; API routes handle POST/GET via `action`/`loader` exports.
2. **Services** (`app/services/`) — Server-side business logic. Files ending in `.server.ts` are server-only (never bundled to client). Key services: `gemini-chat.server.ts` (streaming AI), `google-drive.server.ts` (Drive API), `google-auth.server.ts` (OAuth), `mcp-client.server.ts` (MCP JSON-RPC).
3. **Components** (`app/components/`) — React UI organized by feature: `chat/` (chat panel), `flow/` (React Flow workflow editor), `execution/` (workflow execution), `editor/` (markdown editor), `ide/` (main layout and panels).
4. **Engine** (`app/engine/`) — Workflow execution engine. `parser.ts` converts YAML to AST, `executor.ts` runs it via a handler-per-node-type pattern in `handlers/`. Supports 22 node types (variable, set, if, while, command, http, json, drive-file, drive-read, drive-search, drive-list, drive-folder-list, drive-file-picker, drive-save, preview, dialog, prompt-value, workflow, mcp, sleep).
5. **Hooks** (`app/hooks/`) — `useSync.ts` (push/pull with conflict resolution), `useFileWithCache.ts` (IndexedDB cache-first reads), `useWorkflowExecution.ts` (execution state via SSE), `useAutocomplete.ts` (slash command and @file autocomplete).
6. **Contexts** (`app/contexts/`) — `EditorContext.tsx` (shared file content, selection, file list for template resolution), `PluginContext.tsx` (plugin lifecycle and API management).
7. **Utils** (`app/utils/`) — Bidirectional conversion between React Flow graph and YAML workflow, plus Mermaid diagram generation.

### Key Patterns

- **Streaming:** Chat (`/api/chat`) and workflow execution (`/api/workflow/:id/execute`) use SSE (Server-Sent Events). Chunk types include text, thinking, tool_call, tool_result, image_generated, rag_used, web_search_used.
- **Function Calling:** Gemini calls Drive tools (read/search/list/create/update), Google Search, RAG/File Search, and dynamically-discovered MCP tools (prefixed `mcp_{server}_{tool}`).
- **Cache-First Sync:** Files cached in IndexedDB. MD5 hash comparison detects changes. Manual push/pull with conflict resolution dialog.
- **Encryption:** Optional hybrid RSA+AES encryption for chat history and workflow logs (`crypto.server.ts`).
- **Auth Flow:** Google OAuth 2.0 → session cookies (httpOnly, 30-day). Tokens stored in session, refreshed automatically.
- **Settings:** Stored as `settings.json` in the user's Drive (`gemini-hub/` folder). Six tab categories: General, MCP Servers, RAG, Plugins, Commands, Encryption.

### Route Configuration

Routes are explicitly defined in `app/routes.ts` (not file-based). Page routes: `/` (IDE dashboard), `/settings`, `/auth/*`. API routes: `/api/chat`, `/api/drive/*`, `/api/workflow/*`, `/api/settings/*`, `/api/sync`, `/api/mcp/*`, `/api/plugins/*`. Public: `/public/file/:fileId/:fileName`.

### Main IDE Layout

The index route (`_index.tsx`) renders the IDE with: Header (sync controls), LeftSidebar (Drive file tree), MainViewer (workflow canvas or markdown editor based on file type), RightSidebar (chat panel, workflow properties panel, or plugin sidebar views).

### Plugin System

Plugins extend the app via GitHub Release installation. Plugin files (`manifest.json`, `main.js`, optional `styles.css`) are stored in `GeminiHub/plugins/{id}/` on Drive and cached in IndexedDB. Plugins receive a `PluginAPI` with access to language, UI registration (views, slash commands, settings tabs), Gemini AI, Drive operations, and scoped storage. See `docs/plugins.md` for the full developer guide.

Key files: `app/types/plugin.ts` (types), `app/services/plugin-api.ts` (API factory), `app/services/plugin-loader.ts` (loading), `app/contexts/PluginContext.tsx` (lifecycle), `app/services/plugin-manager.server.ts` (Drive storage).

### Slash Commands & Template System

Slash commands (`/command`) support template variables: `{content}` (active file content), `{selection}` (editor selection), `@filename` (Drive file content). Per-command overrides for model, search settings, Drive tool mode, and enabled MCP servers are stored in `SlashCommand` type (`app/types/settings.ts`). Autocomplete logic is in `app/hooks/useAutocomplete.ts` with popup UI in `app/components/chat/AutocompletePopup.tsx`.

## Common Modification Patterns

### Adding a Settings Tab

1. Add to `TabId` union type in `app/routes/settings.tsx`
2. Add entry to `TABS` array
3. Add case to the action switch
4. Add render branch in `SettingsInner`

### Adding a New Settings Field

1. Add to `UserSettings` interface in `app/types/settings.ts`
2. Add default value to `DEFAULT_USER_SETTINGS`

### Adding i18n Strings

1. Add key to `TranslationStrings` interface in `app/i18n/translations.ts`
2. Add the key to BOTH `en` and `ja` objects — they must stay in sync
