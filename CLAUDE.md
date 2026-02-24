# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GemiHub is a web application that integrates Google Gemini AI with Google Drive, with support for self-hosting. It provides visual workflow building, AI chat with streaming/function calling, Drive file management with a WYSIWYG editor, and offline-first caching with push/pull sync.

## Documentation

`docs/` ディレクトリに各機能の詳細ドキュメントがある（`_ja` 付きは日本語版なので参照不要）。機能の仕様や挙動を確認する際は適宜参照すること。

- `docs/chat.md` — チャット・AI機能（ストリーミング、ファンクションコール、スラッシュコマンド等）
- `docs/sync.md` — Push/Pull同期とオフラインキャッシュの仕組み
- `docs/workflow_nodes.md` — ワークフローノード全種のリファレンス
- `docs/rag.md` — RAG（Retrieval-Augmented Generation）の設定と動作
- `docs/mcp.md` — MCPサーバー連携
- `docs/encryption.md` — ハイブリッド暗号化（RSA+AES）
- `docs/plugins.md` — プラグイン開発ガイド
- `docs/infrastructure.md` — インフラ構成（Cloud Run等）
- `docs/editor.md` — エディタシステム（WYSIWYG、ワークフロー編集、ファイルタイプ別表示等）（`editor_ja.md` は日本語版）
- `docs/history.md` — 編集履歴の仕組み
- `docs/utils.md` — 右クリックメニュー、ゴミ箱、スラッシュコマンド等のユーティリティ
- `docs/workflow_execution.md` — ワークフロー実行エンジン（パーサー、エグゼキューター、SSE、プロンプト、AI生成）
- `docs/search.md` — 検索機能（ローカル/Drive/RAG検索、Quick Open）

## Commands

```bash
npm run dev          # Dev server on http://localhost:8132
npm run build        # Production build (react-router build)
npm run start        # Serve production build (port 8080)
npm run typecheck    # Type generation + TypeScript check (react-router typegen && tsc)
npm run lint         # ESLint check (eslint app/)
npm run lint:fix     # ESLint auto-fix
```

Tests use Node's built-in `node:test` runner via `tsx`. Run `npm run test` for all tests, `npm run test:sync-diff` for sync diff tests, or `npm run test:parser` for parser tests. To run a single test file: `npx tsx --test path/to/file.test.ts`.

## Environment

Requires Node.js 22+. Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `SESSION_SECRET`. The dev server port (8132) is set in `vite.config.ts`.

## Architecture

**Stack:** React 19 + React Router 7 (SSR) + Tailwind CSS v4 + Vite. All data stored in Google Drive (no database). Browser IndexedDB for client-side caching.

**Path alias:** `~/*` maps to `./app/*` (configured in tsconfig.json).

### Layer Structure

1. **Routes** (`app/routes/`) — React Router pages and API endpoints. Page routes use loaders for server data; API routes handle POST/GET via `action`/`loader` exports.
2. **Services** (`app/services/`) — Server-side business logic. Files ending in `.server.ts` are server-only (never bundled to client). Key services: `gemini-chat.server.ts` (streaming AI), `google-drive.server.ts` (Drive API), `google-auth.server.ts` (OAuth), `mcp-client.server.ts` (MCP JSON-RPC).
3. **Components** (`app/components/`) — React UI organized by feature: `chat/` (chat panel), `flow/` (Mermaid-based workflow diagram), `execution/` (workflow execution), `editor/` (markdown editor), `ide/` (main layout and panels).
4. **Engine** (`app/engine/`) — Workflow execution engine. `parser.ts` converts YAML to AST, `executor.ts` runs it via a handler-per-node-type pattern in `handlers/`. Supports 24 node types (variable, set, if, while, command, http, json, drive-file, drive-read, drive-search, drive-list, drive-folder-list, drive-file-picker, drive-save, drive-delete, dialog, prompt-value, prompt-file, prompt-selection, workflow, mcp, rag-sync, sleep, gemihub-command).
5. **Hooks** (`app/hooks/`) — `useSync.ts` (push/pull with conflict resolution), `useFileWithCache.ts` (IndexedDB cache-first reads), `useWorkflowExecution.ts` (execution state via SSE), `useAutocomplete.ts` (slash command and @file autocomplete).
6. **Contexts** (`app/contexts/`) — `EditorContext.tsx` (shared file content, selection, file list for template resolution), `PluginContext.tsx` (plugin lifecycle and API management).
7. **Utils** (`app/utils/`) — Workflow-to-Mermaid diagram conversion (`workflow-to-mermaid.ts`), node property definitions, and connection helpers.

### Key Patterns

- **Streaming:** Chat (`/api/chat`) and workflow execution (`/api/workflow/:id/execute`) use SSE (Server-Sent Events). Chunk types include text, thinking, tool_call, tool_result, image_generated, rag_used, web_search_used.
- **Function Calling:** Gemini calls Drive tools (read/search/list/create/update), Google Search, RAG/File Search, and dynamically-discovered MCP tools (prefixed `mcp_{server}_{tool}`).
- **Cache-First Sync:** Files cached in IndexedDB. MD5 hash comparison detects changes. Manual push/pull with conflict resolution dialog.
- **Local-First File Updates:** ファイルを更新する機能（チャットの `update_drive_file`、ワークフローの `drive-save` ノード等）は、Google Driveに直接書き込まず、IndexedDB のキャッシュと editHistory のみを更新する。Drive への反映は Push フローで行う。詳細は `docs/sync.md`「Chat-Initiated File Operations」を参照。
- **Encryption:** Optional hybrid RSA+AES encryption for chat history and workflow logs (`crypto.server.ts`).
- **Auth Flow:** Google OAuth 2.0 → session cookies (httpOnly, 30-day). Tokens stored in session, refreshed automatically.
- **Settings:** Stored as `settings.json` in the user's Drive (`gemihub/` folder). Six tab categories: General, MCP Servers, RAG, Plugins, Commands, Encryption.

### Route Configuration

Routes are explicitly defined in `app/routes.ts` (not file-based). Page routes: `/` (IDE dashboard), `/settings`, `/auth/*`. API routes: `/api/chat`, `/api/drive/*`, `/api/workflow/*`, `/api/settings/*`, `/api/sync`, `/api/mcp/*`, `/api/plugins/*`. Public: `/public/file/:fileId/:fileName`.

### Main IDE Layout

The index route (`_index.tsx`) renders the IDE with: Header (sync controls), LeftSidebar (Drive file tree), MainViewer (Mermaid workflow diagram or markdown editor based on file type), RightSidebar (chat panel, workflow properties panel, or plugin sidebar views). Workflow diagrams are rendered via the Mermaid library (no React Flow).

### Plugin System

Plugins extend the app via GitHub Release installation. Plugin files (`manifest.json`, `main.js`, optional `styles.css`) are stored in `gemihub/plugins/{id}/` on Drive and cached in IndexedDB. Plugins receive a `PluginAPI` with access to language, UI registration (views, slash commands, settings tabs), Gemini AI, Drive operations, and scoped storage. See `docs/plugins.md` for the full developer guide.

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

### Adding a Workflow Node Type

1. Add the type to `WorkflowNodeType` union and properties to `WorkflowNode` in `app/engine/types.ts`
2. Add a `case` in `app/engine/executor.ts` (handler logic lives in `app/engine/handlers/`)
3. Add node label in `app/utils/workflow-to-mermaid.ts`
4. Add property definitions in `app/utils/workflow-node-properties.ts`

### Adding i18n Strings

1. Add key to `TranslationStrings` interface in `app/i18n/translations.ts`
2. Add the key to BOTH `en` and `ja` objects — they must stay in sync (only `en` and `ja` are supported)
