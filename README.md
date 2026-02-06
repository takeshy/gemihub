# Gemini Hub IDE

A self-hosted web application that integrates Google Gemini AI with Google Drive. Build visual workflows, chat with AI, manage Drive files with a rich editor, and more — all from a single interface.

[日本語版 README](./README_ja.md)

## Features

- **AI Chat** — Streaming conversations with Gemini models, function calling, thinking display, image generation, file attachments, per-message model/tool overrides
- **Slash Commands & Autocomplete** — User-defined `/commands` with template variables (`{content}`, `{selection}`), `@file` mentions, per-command model and tool overrides
- **Visual Workflow Editor** — Drag-and-drop node-based workflow builder (React Flow), YAML import/export, real-time execution with SSE
- **AI Workflow Generation** — Create and modify workflows via natural language with AI (streaming generation with thinking display, visual preview, diff view, iterative refinement)
- **Google Drive Integration** — All data (workflows, chat history, settings, edit history) stored in your own Google Drive
- **Rich Markdown Editor** — WYSIWYG file creation and editing powered by wysimark-lite
- **RAG (Retrieval-Augmented Generation)** — Sync Drive files to Gemini File Search for context-aware AI responses
- **MCP (Model Context Protocol)** — Connect external MCP servers as tools for the AI chat
- **Encryption** — Optional hybrid encryption (RSA + AES) for chat history and workflow logs
- **Edit History** — Unified diff-based change tracking for workflows and Drive files
- **Offline Cache & Sync** — IndexedDB-based file caching with Push/Pull synchronization across devices using md5 hash comparison. Temp file staging for faster saves (1-2 API calls instead of ~9)
- **Multi-Model Support** — Gemini 3, 2.5, Flash, Pro, Lite, Gemma; paid and free plan model lists
- **Image Generation** — Generate images via Gemini 2.5 Flash Image / 3 Pro Image models
- **i18n** — English and Japanese UI

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 19, React Router 7, Tailwind CSS v4, React Flow |
| Backend | React Router server (SSR + API routes) |
| AI | Google Gemini API (`@google/genai`) |
| Storage | Google Drive API |
| Auth | Google OAuth 2.0 → session cookies |
| Editor | wysimark-lite (Slate-based WYSIWYG) |

### Project Structure

```
app/
├── routes/           # Pages and API endpoints
│   ├── _index.tsx              # IDE dashboard
│   ├── settings.tsx            # Settings (6-tab UI)
│   ├── api.chat.tsx            # Chat SSE streaming
│   ├── api.chat.history.tsx    # Chat history CRUD
│   ├── api.drive.files.tsx     # Drive file operations
│   ├── api.drive.tree.tsx      # Drive file tree
│   ├── api.drive.temp.tsx      # Temp file save/apply/delete
│   ├── api.drive.upload.tsx    # File upload
│   ├── api.sync.tsx            # Push/Pull sync
│   ├── api.workflow.*.tsx      # Workflow execution & AI generation
│   ├── api.settings.*.tsx      # Settings APIs
│   ├── auth.*.tsx              # OAuth login/logout/callback
│   └── ...
├── services/         # Server-side business logic
│   ├── gemini-chat.server.ts    # Gemini streaming client
│   ├── gemini.server.ts         # Core Gemini client
│   ├── google-drive.server.ts   # Drive API operations
│   ├── google-auth.server.ts    # OAuth 2.0
│   ├── chat-history.server.ts   # Chat CRUD (Drive)
│   ├── user-settings.server.ts  # Settings CRUD (Drive)
│   ├── drive-tools.server.ts    # Drive function calling tools
│   ├── mcp-client.server.ts     # MCP protocol client
│   ├── mcp-tools.server.ts      # MCP → Gemini integration
│   ├── file-search.server.ts    # RAG / File Search
│   ├── crypto.server.ts         # Hybrid encryption
│   ├── edit-history.server.ts   # Diff-based history
│   ├── workflow-history.server.ts # Workflow execution logs
│   ├── sync-meta.server.ts      # Push/Pull sync metadata
│   ├── temp-file.server.ts      # Temp file staging
│   ├── execution-store.server.ts # Workflow execution state
│   ├── indexeddb-cache.ts       # Browser-side IndexedDB cache
│   └── session.server.ts       # Session management
├── hooks/            # React hooks
│   ├── useFileWithCache.ts    # Cache-first file read/write
│   ├── useSync.ts             # Push/Pull sync logic
│   ├── useAutocomplete.ts     # Slash command & @file autocomplete
│   ├── useWorkflowExecution.ts # Workflow execution via SSE
│   ├── useFileUpload.ts       # File upload handling
│   └── useApplySettings.ts   # Settings application
├── components/       # React components
│   ├── chat/             # Chat UI (messages, input, autocomplete popup)
│   ├── editor/           # Markdown editor wrapper
│   ├── flow/             # Workflow canvas (Mermaid preview)
│   ├── execution/        # Workflow execution panel, prompt modal
│   ├── ide/              # IDE layout, sync UI, dialogs, file tree
│   └── settings/         # CommandsTab, TempFilesDialog
├── contexts/         # React contexts
│   └── EditorContext.tsx  # Shared editor state (file content, selection, file list)
├── i18n/             # Internationalization
│   ├── translations.ts   # TranslationStrings interface + en/ja translations
│   └── context.tsx        # I18nProvider + useI18n hook
├── types/            # TypeScript type definitions
│   ├── settings.ts       # Settings, models, MCP, RAG, encryption, slash commands
│   └── chat.ts           # Messages, streaming, history
├── utils/            # Workflow utilities
│   ├── workflow-to-mermaid.ts       # Workflow → Mermaid diagram
│   ├── workflow-node-summary.ts     # Node property summaries
│   ├── workflow-node-properties.ts  # Node property get/set
│   └── workflow-connections.ts      # Node connection management
└── engine/           # Workflow execution engine
    ├── parser.ts         # YAML → AST
    ├── executor.ts       # Handler-per-node-type execution
    └── handlers/         # Node type handlers (variable, if, while, command, drive, http, mcp, prompt, ...)
```

## Getting Started

### Prerequisites

- Node.js 22+
- Google Cloud project (see setup below)
- Gemini API key

### 1. Google Cloud Setup

Go to [Google Cloud Console](https://console.cloud.google.com/) and perform the following steps:

#### Create a project
1. Click "Select a project" at the top left → "New Project" → name it and create

#### Enable Google Drive API
1. Go to "APIs & Services" → "Library"
2. Search for "Google Drive API" and click "Enable"

#### Configure OAuth consent screen
1. Go to "APIs & Services" → "OAuth consent screen"
2. User Type: **External**
3. Fill in App name (e.g., Gemini Hub), support email, and developer contact
4. Add scope: `https://www.googleapis.com/auth/drive`
5. Add your Gmail address as a test user (only your account can access before publishing)

#### Create OAuth credentials
1. Go to "APIs & Services" → "Credentials" → "+ Create Credentials" → "OAuth client ID"
2. Application type: **Web application**
3. Name: anything (e.g., Gemini Hub Local)
4. Add **Authorized redirect URI**: `http://localhost:5170/auth/google/callback`
5. Copy the **Client ID** and **Client Secret**

### 2. Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Left menu → "API keys" → "Create API key"
3. Copy the key (you'll enter it in the app's Settings page later)

### 3. Clone and install

```bash
git clone <repository-url>
cd gemini-hub
npm install
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5170/auth/google/callback
SESSION_SECRET=<random string>
```

To generate `SESSION_SECRET`:

```bash
ruby -rsecurerandom -e 'puts SecureRandom.hex(32)'
# or
openssl rand -hex 32
```

### 5. Start development server

```bash
npm run dev
```

### 6. First-time setup

1. Open `http://localhost:5170` in your browser
2. Click "Sign in with Google" → authorize with your Google account
3. Click the gear icon (Settings) in the top right
4. In the **General** tab, enter your Gemini API Key and click Save

Chat, workflows, and file editing are now ready to use.

> **Note:** The dev server port is configured to `5170` in `vite.config.ts`. To change it, update both the config and the redirect URI in `.env` and Google Cloud Console.

## Production

### Build

```bash
npm run build
npm run start
```

### Docker

```bash
docker build -t gemini-hub .
docker run -p 8080:8080 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GOOGLE_REDIRECT_URI=https://your-domain/auth/google/callback \
  -e SESSION_SECRET=... \
  gemini-hub
```

## Settings

All settings are stored in `settings.json` in your Google Drive root folder (`gemini-hub/`).

| Tab | What you can configure |
|-----|----------------------|
| **General** | API key, paid/free plan, default model, system prompt, chat history saving, language (en/ja), font size, temp file management |
| **MCP Servers** | Add/remove external MCP servers, test connections, enable/disable per server |
| **RAG** | Enable/disable, top-K, manage multiple RAG settings, sync Drive files to File Search |
| **Encryption** | Set up RSA key pair, toggle encryption for chat history and workflow logs |
| **Edit History** | Enable/disable, retention policy (age/count), diff context lines, prune/stats |
| **Commands** | Create/edit/delete slash commands with prompt templates, per-command model and tool overrides |

## Slash Commands

Define custom slash commands in the **Commands** settings tab. Each command has:

- **Prompt template** — Supports `{content}` (current file content), `{selection}` (selected text), and `@filename` (Drive file content) placeholders
- **Model override** — Use a specific model for this command
- **Tool overrides** — Control search setting, Drive tool mode, and MCP server availability per command

Type `/` in the chat input to trigger autocomplete and select a command. Type `@` to mention and insert a file.

## AI Tools (Function Calling)

During chat, Gemini can use the following tools via Function Calling. Tool availability is controlled per-message from the chat input toolbar.

### Drive Tools

Built-in tools for reading and writing files in your Google Drive. Controlled by the "Drive Tools" setting (`all` / `noSearch` / `none`).

| Tool | Description |
|------|-------------|
| `read_drive_file` | Read file content by file ID |
| `search_drive_files` | Search files by name or content within a folder (Google Drive API `fullText contains` / `name contains`) |
| `list_drive_files` | List files and subfolders in a folder |
| `create_drive_file` | Create a new file |
| `update_drive_file` | Update an existing file's content (with edit history tracking) |

### Gemini Built-in Tools

| Tool | Description |
|------|-------------|
| Google Search | Web search powered by Gemini's built-in `googleSearch` tool. Mutually exclusive with RAG. |
| RAG (File Search) | Retrieval-augmented generation using files synced to Gemini File Search. Configurable `topK`. |

### MCP Tools (Dynamic)

Tools dynamically discovered from configured MCP servers. Each tool is prefixed as `mcp_{serverName}_{toolName}` and executed via JSON-RPC 2.0 over HTTP. Configure MCP servers in the Settings page.

## Data Storage

Everything is stored in your Google Drive under the `gemini-hub/` folder:

```
gemini-hub/
├── settings.json        # User settings
├── workflows/           # Workflow YAML files
│   └── _sync-meta.json  # Push/Pull sync metadata
├── chats/               # Chat history JSON files
├── edit-history/        # Edit snapshots and diff history
└── __TEMP__/            # Staged file saves (applied on Push)
```

### Browser Cache & Sync

Files are cached in the browser's IndexedDB for instant loading. The sync system uses md5 hash comparison to detect changes:

- **Cache-first reads** — Files load instantly from IndexedDB, then validate against Drive's md5Checksum in the background
- **Temp file staging** — File saves are first written to a `__TEMP__/` folder on Drive (1-2 API calls), then applied to the real files during Push
- **Push** — Apply staged temp files to real Drive files, update remote sync metadata (`_sync-meta.json`), then push any remaining locally changed files
- **Pull** — Download remotely changed files to the local cache. Staged temp files are preserved and will be applied on the next Push
- **Conflict resolution** — When both local and remote copies changed, choose "Keep Local" or "Keep Remote" per file

The sync status bar in the header shows pending push/pull counts and provides manual sync controls. Temp files can be managed (downloaded or deleted) from the General settings tab.

## License

MIT
