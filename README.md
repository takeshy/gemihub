# GemiHub

**Read your documents, mark them up, and ask Gemini about them — all inside your own Google Drive.**

Open a PDF, EPUB, or Markdown note from your Drive, highlight a passage, and pin a memo to it. Highlights, memos, dashboards, chat history, and workflows are all plain files in *your* Drive — so the AI can read every one of them, and you can walk away with everything at any time. No external database. Self-hostable.

**[Try GemiHub at gemihub.net →](https://gemihub.net)** · [日本語版 README](./README_ja.md)

![GemiHub](./public/images/cap.png)

## Why GemiHub?

### Documents you read, with the notes you took

Open a PDF, EPUB, Markdown, text, or image file — in the main viewer or in a dashboard **File widget** — select a passage, right-click, and **Add to memo**. Every document gets its own memo timeline.

- **Quote-anchored highlights** — the quote is captured with its surrounding context and painted into the document via the CSS Custom Highlight API. Anchors are quote-first, so highlights survive document edits and EPUB reflow.
- **Jump both ways** — click a highlight to reach its memo; click the quote inside a memo to jump back to the exact passage.
- **A real timeline** — WYSIWYG or raw Markdown composer, pin/edit/delete, wiki links that open in the IDE, and a collapsible rail so highlights stay visible while you read.
- **Plain Markdown storage** — memos are ordinary files under `Dashboards/Memos/` in your Drive. Portable, searchable, syncable — and because they are just files, chat and RAG can use them too.

A built-in pdf.js viewer (selectable text, page navigation, zoom) and a client-side EPUB reader (font size, page width) make GemiHub a comfortable place to actually read what you annotate.

![Document Memos](./public/images/memo.png)

### A dashboard assembled from your own files

The home screen is a drag-and-drop widget grid: file viewers with their memos, a memo list, Obsidian-style **Base** queries over a folder of notes, kanban boards that write status changes back into the source Markdown, a timeline microblog, an encrypted secret manager, live workflow output, and web embeds. Build several dashboards, pin one as home — each is saved as a `.dashboard` file in your Drive, editable as a rendered view or as raw YAML.

![Dashboard](./public/images/dashboard.png)

### AI that already has the context

Chat streams from Gemini with function calling, thinking display, and image generation, and it reaches straight into your files: read, search, create, and update. Add semantic search over your Drive with **RAG**, curated Markdown knowledge bases with **OKF bundles**, external tools over **MCP**, and reusable **Agent Skills** — then automate the whole thing with visual **workflows** that run in the browser and stream their output live.

![Visual Workflow Editor](./public/images/visual_workflow.png)

### Your data, your control

Everything lives in a `gemihub/` folder in your own Google Drive: chat history, workflows, settings, edit history. No proprietary database, no lock-in. Optional hybrid RSA + AES encryption protects sensitive files, and a standalone Python decryption script ships with the repo so you can always read your own data without GemiHub.

GemiHub is offline-first: files are cached in IndexedDB and load instantly, edits work with no connection, and Push/Pull syncs on your terms — with MD5 conflict detection, a diff-based resolution dialog, and a backup of whatever you did not keep. The same `_sync-meta.json` format is spoken by the [Obsidian plugin](https://github.com/takeshy/obsidian-gemihub), so a vault and GemiHub can share one Drive folder.

![Push/Pull Sync](./public/images/push_pull_en.png)

## Features

**Reading & annotation** — Per-document memo timelines on Markdown, PDF, EPUB, text, and image files, with quote-anchored two-way highlights, stored as plain Markdown · pdf.js PDF viewer · client-side EPUB reader · Memo List widget across every annotated document

**Dashboard** — Drag-and-drop grid with undo/redo, one-click column/row alignment, multiple dashboards and a pinned home · File, Memo List, Base (Obsidian `.base` queries as table/cards/list), Kanban (`.kanban` YAML, drag-to-restatus written back to Markdown), Secret Manager, Timeline, Workflow output (with auto-refresh), and Web widgets

**AI chat** — Streaming Gemini chat with function calling, thinking display, image generation, and attachments · user-defined slash commands with `{content}` / `{selection}` / `@file` templates and per-command model and tool overrides · `/run @workflow.yaml` from chat

**Knowledge** — RAG semantic search over Drive files · OKF knowledge bundles selectable per chat · MCP servers as tools (OAuth support, interactive MCP Apps) · Agent Skills, including one-click external skills from the catalog · plugins installed from GitHub or developed locally

**Editing** — WYSIWYG Markdown editor (wysimark-lite) · Obsidian-compatible JSON Canvas · unified-diff edit history for files and workflows · publish any document to a public URL · encrypted files, chat history, and workflow logs

**Automation** — Visual workflow editor with 25 node types that run in the browser (plus Gmail, Calendar, and Sheets nodes on paid plans), YAML import/export, and real-time SSE execution · AI workflow generation from natural language with streaming diff preview

**Teams** — Organization projects on managed Cloud Storage and Vertex AI, with member roles, per-member AI budgets, and project-scoped dashboards and workflows

**Also** — Configurable keyboard shortcuts · curated Gemini and Gemma model selection, kept current in-app · encrypted secret storage · trash with recovery · English and Japanese UI

<details>
<summary>More screenshots</summary>

**Dashboard widgets** — kanban boards, workflow output, the timeline microblog, and Base view settings.

![Dashboard Kanban Board](./public/images/dashboard_kanban.png)
![Dashboard Workflow Widget](./public/images/dashboard_workflow.png)
![Timeline Widget](./public/images/timeline_edit.png)
![Base Widget Settings](./public/images/base_setting.png)
![Dashboard Editing](./public/images/dashboard_edit.png)

**Secret Manager** — RSA + AES encrypted values as self-contained `.encrypted` files in a Drive folder, searchable by name and visible metadata before unlocking.

![Secret Manager Widget](./public/images/secret_manager.png)
![New Secret Dialog](./public/images/secret_manager_new.png)

**Knowledge & skills** — OKF bundles in chat, AI-authored bundles, and one-click external skills.

![OKF Knowledge Bundle in Chat](./public/images/okf_sample.png)
![AI Authoring an OKF Bundle](./public/images/okf_skill.png)
![External Skills](./public/images/external_skills.png)

**Workflows** — node editing, live execution logs, and AI generation.

![Edit Workflow Node](./public/images/edit_workflow.png)
![Workflow Execution](./public/images/workflow_execution_en.png)
![AI Workflow Generation](./public/images/ai_generate_workflow.png)

**Organizations** — shared projects with member management and project dashboards.

![Organization Project](./public/images/organization_general.png)
![Organization Settings](./public/images/organization_settings.png)
![Shared Project Dashboard](./public/images/organization_dashboard.png)

**Files** — context menu with publishing, history, encryption, and downloads; canvas editing.

![File Management](./public/images/publish_web.png)
![Canvas Editor](./public/images/canvas.png)

</details>

## Getting Started

The fastest path is the hosted app: **[gemihub.net](https://gemihub.net)** — sign in with Google and add your Gemini API key in Settings.

To run it yourself:

```bash
git clone <repository-url>
cd gemihub
npm install
cp .env.example .env   # fill in OAuth credentials and SESSION_SECRET
npm run dev            # http://localhost:8132
```

You need Node.js 24+, a Google Cloud OAuth client, and a Gemini API key. The full walkthrough — creating the Cloud project, the OAuth consent screen, the `drive.file` scope and what it implies, environment variables, and Docker/production builds — is in **[docs/architecture/self-hosting.md](./docs/architecture/self-hosting.md)**.

## Plans

GemiHub is MIT-licensed and fully usable for free with your own Gemini API key. The hosted service adds three paid plans; see [docs/architecture/premium.md](docs/architecture/premium.md) for details.

| | Free | Premium — ¥300/month (≈$2) | Pro — ¥3,000/month (≈$20) | Business — ¥7,500/month (≈$50), per organization |
|---|---|---|---|---|
| Everything above | ✓ | ✓ | ✓ | ✓ |
| Upload limit | 20 MB/file | 5 GB/file | 5 GB/file | 5 GB/file |
| Gmail send and Google Calendar workflow nodes | — | ✓ | ✓ | ✓ |
| PDF generation, external sync token, temp edit URL | — | ✓ | ✓ | ✓ |
| Interactions API chat (function tools + RAG + Web Search together) | — | ✓ | ✓ | ✓ |
| Scheduled workflows + page hosting from `web/` (`{slug}.gemihub.net`) | — | — | ✓, served from your own Drive | ✓, plus CDN, custom domains, workflow APIs |
| Google Sheets workflow nodes | — | — | — | ✓ |
| Shared organization on Cloud Storage + Vertex AI | — | — | — | 100 GB, $30/month AI budget included |

Don't want to manage a Gemini API key? Turn on **personal Vertex AI** in Settings and chat runs on GemiHub's Vertex connection against a prepaid balance you top up in $10 (¥1,500) units — no expiry, available on any plan. A Business organization's included $30/month AI budget can be topped up the same way.

Business is the one exception to "everything stays in your Drive": a shared project's files live in managed Cloud Storage with Firestore metadata, and its chat runs on Vertex AI. Personal My Drive work is unaffected. See [docs/architecture/mounts.md](docs/architecture/mounts.md).

## Documentation

Documentation lives in [`docs/`](./docs/) as an OKF bundle — [docs/index.md](./docs/index.md) is the table of contents.

| Topic | Document |
|-------|----------|
| Chat & AI | [features/chat.md](./docs/features/chat.md) |
| Dashboard (widgets, memos) | [features/dashboard.md](./docs/features/dashboard.md) |
| Editor | [features/editor.md](./docs/features/editor.md) |
| Search | [features/search.md](./docs/features/search.md) |
| Sync & Offline Cache | [features/sync.md](./docs/features/sync.md) |
| Edit History | [features/history.md](./docs/features/history.md) |
| MCP | [integrations/mcp.md](./docs/integrations/mcp.md) |
| Plugins | [integrations/plugins.md](./docs/integrations/plugins.md) |
| RAG | [integrations/rag.md](./docs/integrations/rag.md) |
| Agent Skills | [integrations/skill.md](./docs/integrations/skill.md) |
| OKF Knowledge Sources | [references/OKF.md](./docs/references/OKF.md) |
| Workflow Execution Engine | [workflows/workflow_execution.md](./docs/workflows/workflow_execution.md) |
| Workflow Node Reference | [workflows/workflow_nodes.md](./docs/workflows/workflow_nodes.md) |
| Self-Hosting | [architecture/self-hosting.md](./docs/architecture/self-hosting.md) |
| Storage Mounts & AI Providers | [architecture/mounts.md](./docs/architecture/mounts.md) |
| Infrastructure | [architecture/infrastructure.md](./docs/architecture/infrastructure.md) |
| Paid Plans | [architecture/premium.md](./docs/architecture/premium.md) |
| Encryption | [architecture/encryption.md](./docs/architecture/encryption.md) |
| Utils (Context Menu, Trash, Commands) | [architecture/utils.md](./docs/architecture/utils.md) |

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 19, React Router 7, Tailwind CSS v4, Mermaid |
| Backend | React Router server (SSR + API routes) |
| AI | Google Gemini API (`@google/genai`); Vertex AI for organization projects |
| Storage | Google Drive API (default mount), Cloud Storage (organization projects), Firestore |
| Auth | Google OAuth 2.0 → session cookies |
| Infrastructure | Cloud Run, Cloud Build, Artifact Registry, Cloud DNS, Certificate Manager, Cloud Scheduler, Global HTTPS LB + CDN |
| Editor | wysimark-lite (Slate-based WYSIWYG) |

## Acknowledgments

GemiHub's built-in Markdown, Base, and Canvas Agent Skills were initially informed by [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills). The corresponding file-format support was independently implemented from publicly described formats and behavior and does not incorporate Obsidian source code. Base is described as a compatibility format rather than an independently standardized open format; Canvas follows the open [JSON Canvas specification](https://jsoncanvas.org/).

The WYSIWYG Markdown editor uses [takeshy/wysimark-lite](https://github.com/takeshy/wysimark-lite), a lightweight fork of [portive/wysimark](https://github.com/portive/wysimark). We are grateful to Steph Ango (@kepano), the Wysimark authors and contributors, and the maintainers of JSON Canvas. See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for copyright and license details.

GemiHub is an independent project and is not affiliated with, endorsed by, or sponsored by Obsidian.

## License

MIT
