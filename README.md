# GemiHub

**Your AI secretary, powered by Gemini and your own Google Drive.**

GemiHub is a self-hostable web application that turns Google Gemini into a personal AI assistant deeply integrated with your Google Drive. Chat with AI that can read, search, and write your files. Build automated workflows with a visual editor. All your data stays in your own Google Drive — no external database required.

[日本語版 README](./README_ja.md)

![GemiHub](./public/images/cap.png)

## Why GemiHub?

### AI That Knows Your Data

Unlike generic AI chat, GemiHub connects directly to your Google Drive. The AI can read your files, search across them, create new documents, and update existing ones — all through natural conversation. Ask questions about your notes, generate summaries of your documents, or have the AI organize your files for you.

### Search by Meaning, Not Just Keywords (RAG)

With built-in RAG (Retrieval-Augmented Generation), you can sync your Drive files to Gemini's semantic search. Instead of matching exact keywords, the AI understands the **meaning** of your question and finds relevant information from your personal knowledge base. Store product manuals, meeting notes, or research papers — then just ask questions in natural language.

### Connect Any External Tool (MCP & Plugins)

Through the Model Context Protocol (MCP), GemiHub can talk to external services. Connect web search, databases, APIs, or any MCP-compatible server — and the AI automatically discovers and uses these tools during conversation. You can also extend GemiHub with **plugins** — install from GitHub or develop locally — to add custom sidebar views, slash commands, and settings panels.

### No-Code Workflow Automation

Build complex automation pipelines with a visual editor. Chain together AI prompts, Drive file operations, HTTP requests, user input dialogs, and more. Workflows are stored as YAML, support loops and conditionals, and run in real-time with streaming output.

![Visual Workflow Editor](./public/images/visual_workflow.png)

### Your Data, Your Control

All data — chat history, workflows, settings, edit history — is stored in your own Google Drive under a `gemihub/` folder. No proprietary database, no vendor lock-in. Optional hybrid encryption (RSA + AES) protects sensitive files. A Python decryption script is provided so you can always access your encrypted data independently.

### Works Offline, Syncs on Your Terms

GemiHub is offline-first. All your files are cached in the browser's IndexedDB, so they load instantly — even without an internet connection. Create and edit files offline, and your changes are tracked automatically. When you're back online, push your changes to Google Drive with one click. If someone else edited the same file, GemiHub detects the conflict and lets you choose which version to keep, with the other safely backed up.

![Push/Pull Sync](./public/images/push_pull.png)

## Screenshots

### Workflow Node Editing

Edit workflow nodes with a form-based UI. Configure LLM prompts, models, Drive file operations, and more.

![Edit Workflow Node](./public/images/edit_workflow.png)

### Workflow Execution

Run workflows and see real-time streaming output with execution logs.

![Workflow Execution](./public/images/workflow_execution.png)

### AI Workflow Generation

Create and modify workflows using natural language. AI generates the YAML with streaming preview and thinking display.

![AI Workflow Generation](./public/images/ai_generate_workflow.png)

### File Management

Manage Drive files with a context menu — publish to web, view history, encrypt, rename, download, and more.

![File Management](./public/images/pubish_web.png)

## Features

- **AI Chat** — Streaming conversations with Gemini, function calling, thinking display, image generation, file attachments
- **Slash Commands** — User-defined `/commands` with template variables (`{content}`, `{selection}` with file ID & position), `@file` mentions (resolved to Drive file IDs for tool access), per-command model/tool overrides. `/run @workflow.yaml` executes workflows directly from chat with inline streaming logs
- **Visual Workflow Editor** — Visual node-based builder (24 node types), YAML import/export, real-time SSE execution
- **AI Workflow Generation** — Create and modify workflows via natural language with streaming preview and diff view
- **Keyboard Shortcuts** — Configurable shortcuts with modifier key support (Ctrl/Cmd, Shift, Alt) via Settings
- **RAG** — Sync Drive files to Gemini File Search for context-aware AI responses
- **MCP** — Connect external MCP servers as tools for AI chat, with OAuth support and rich UI rendering (MCP Apps)
- **Plugins** — Install from GitHub or develop locally; API for custom views, slash commands, settings panels, custom file icons, and file extension handling
- **Google Drive Integration** — All data stored in your own Drive, no external database
- **Rich Markdown Editor** — WYSIWYG file editing powered by wysimark-lite
- **Offline Cache & Sync** — Offline-first with IndexedDB caching. Edit files without internet, then Push/Pull to sync with Drive. Automatic conflict detection and resolution with backup. Soft delete with trash recovery. Temp UP/DL lets you preserve specific files across a Pull — upload before pulling, then download to restore. Backup token for external migration tools
- **Encryption** — Optional hybrid RSA + AES encryption for individual files, chat history, and workflow logs
- **Edit History** — Unified diff-based change tracking for workflows and Drive files
- **Multi-Model Support** — Gemini 3.1 Pro, Gemini 3, 2.5, Flash, Pro, Lite, Gemma; paid and free plan model lists
- **Image Generation** — Generate images via Gemini image models
- **i18n** — English and Japanese UI

## Documentation

Detailed documentation is available in the [`docs/`](./docs/) directory:

| Topic | English | 日本語 |
|-------|---------|--------|
| Chat & AI | [chat.md](./docs/chat.md) | [chat_ja.md](./docs/chat_ja.md) |
| Sync & Offline Cache | [sync.md](./docs/sync.md) | [sync_ja.md](./docs/sync_ja.md) |
| Workflow Node Reference | [workflow_nodes.md](./docs/workflow_nodes.md) | [workflow_nodes_ja.md](./docs/workflow_nodes_ja.md) |
| RAG | [rag.md](./docs/rag.md) | [rag_ja.md](./docs/rag_ja.md) |
| MCP | [mcp.md](./docs/mcp.md) | [mcp_ja.md](./docs/mcp_ja.md) |
| Encryption | [encryption.md](./docs/encryption.md) | [encryption_ja.md](./docs/encryption_ja.md) |
| Plugins | [plugins.md](./docs/plugins.md) | [plugins_ja.md](./docs/plugins_ja.md) |
| Infrastructure | [infrastructure.md](./docs/infrastructure.md) | [infrastructure_ja.md](./docs/infrastructure_ja.md) |
| Editor | [editor.md](./docs/editor.md) | [editor_ja.md](./docs/editor_ja.md) |
| Edit History | [history.md](./docs/history.md) | [history_ja.md](./docs/history_ja.md) |
| Utils (Context Menu, Trash, Commands) | [utils.md](./docs/utils.md) | [utils_ja.md](./docs/utils_ja.md) |
| Workflow Execution Engine | [workflow_execution.md](./docs/workflow_execution.md) | [workflow_execution_ja.md](./docs/workflow_execution_ja.md) |
| Search | [search.md](./docs/search.md) | [search_ja.md](./docs/search_ja.md) |

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
3. Fill in App name (e.g., GemiHub), support email, and developer contact
4. Add scope: `https://www.googleapis.com/auth/drive.file`
5. Add your Gmail address as a test user (only your account can access before publishing)

> **Important: Google Drive File Access**
>
> This app uses the `drive.file` scope, which means it can **only access files created by the app itself**. Files you upload directly to the `gemihub/` folder via the Google Drive web UI or other apps will **not** be visible to GemiHub. To add files, use the upload feature within the app or create them through AI chat.

#### Create OAuth credentials
1. Go to "APIs & Services" → "Credentials" → "+ Create Credentials" → "OAuth client ID"
2. Application type: **Web application**
3. Name: anything (e.g., GemiHub Local)
4. Add **Authorized redirect URI**: `http://localhost:8132/auth/google/callback`
5. Copy the **Client ID** and **Client Secret**

### 2. Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Left menu → "API keys" → "Create API key"
3. Copy the key (you'll enter it in the app's Settings page later)

> **Free vs. Paid API:** The free Gemini API tier has strict rate limits and restricted model access — enough for a quick test, but not for regular use. For the full experience, you'll need a paid plan. [Google AI Pro](https://one.google.com/about/ai-premium) ($19.99/month) is a great option: it includes $10/month in Google Cloud credits that cover extensive Gemini API usage, plus 2 TB Google One storage, Gemini Code Assist, and more. See [Gemini API Pricing](https://ai.google.dev/pricing) for details.

### 3. Clone and install

```bash
git clone <repository-url>
cd gemihub
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
GOOGLE_REDIRECT_URI=http://localhost:8132/auth/google/callback
SESSION_SECRET=<random string>
```

To generate `SESSION_SECRET`:

```bash
openssl rand -hex 32
```

### 5. Start development server

```bash
npm run dev
```

### 6. First-time setup

1. Open `http://localhost:8132` in your browser
2. Click "Sign in with Google" → authorize with your Google account
3. Click the gear icon (Settings) in the top right
4. In the **General** tab, enter your Gemini API Key and click Save

Chat, workflows, and file editing are now ready to use.

> **Note:** The dev server port is configured to `8132` in `vite.config.ts`. To change it, update both the config and the redirect URI in `.env` and Google Cloud Console.

## Production

### Build

```bash
npm run build
npm run start
```

### Docker

```bash
docker build -t gemihub .
docker run -p 8080:8080 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GOOGLE_REDIRECT_URI=https://your-domain/auth/google/callback \
  -e SESSION_SECRET=... \
  gemihub
```

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 19, React Router 7, Tailwind CSS v4, Mermaid |
| Backend | React Router server (SSR + API routes) |
| AI | Google Gemini API (`@google/genai`) |
| Storage | Google Drive API |
| Auth | Google OAuth 2.0 → session cookies |
| Infrastructure | Cloud Run, Cloud Build, Artifact Registry, Cloud DNS, Secret Manager, Global HTTPS LB |
| Editor | wysimark-lite (Slate-based WYSIWYG) |

## License

MIT
