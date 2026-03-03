# Chat

AI chat with Gemini streaming, function calling, RAG, image generation, and MCP integration.

## Features

- **Streaming Responses**: Real-time text generation via Server-Sent Events (SSE)
- **Function Calling**: Gemini calls Drive tools, MCP tools, RAG/File Search, and Google Search
- **Drive Tool Integration**: Read, search, list, create, update, and rename Drive files from chat
- **MCP Tools**: Dynamically-discovered tools from MCP servers (prefixed `mcp_{serverId}_{tool}`)
- **RAG / Web Search**: Retrieval-Augmented Generation via Gemini File Search, or Google Search mode
- **Extended Thinking**: Collapsible thinking/reasoning display for supported models
- **Image Generation**: Generate images with Imagen-capable models
- **Chat History**: Auto-saved to Google Drive with optional encryption
- **Slash Commands**: `/command` with template variables and per-command overrides
- **File References**: `@filename` to reference Drive files in messages
- **Attachments**: Image, PDF, and text file attachments via drag-and-drop or file picker

---

## Streaming Protocol

Chat uses SSE-compatible chunk types. By default, chat executes locally in the browser via `executeLocalChat` (calling the Gemini API directly with a cached API key). The server-side `/api/chat` SSE endpoint exists as a fallback. Both paths produce the same chunk types.

### Chunk Types

| Type | Description |
|------|-------------|
| `text` | Incremental text content |
| `thinking` | Extended thinking / reasoning content |
| `tool_call` | Function call (name + args) |
| `tool_result` | Function call result |
| `rag_used` | RAG sources used in response |
| `web_search_used` | Web search sources used |
| `image_generated` | Base64-encoded generated image |
| `mcp_app` | MCP tool UI metadata |
| `drive_file_created` | Drive file was created (triggers file tree refresh) |
| `drive_file_updated` | Drive file was updated locally (triggers editor refresh) |
| `error` | Error message |
| `done` | Stream complete |

### Client Handling

1. Call `executeLocalChat` which streams from Gemini API directly in the browser (or fall back to `POST /api/chat` SSE stream)
2. Parse chunks, accumulate text/thinking/toolCalls
3. On `drive_file_created` → update local sync meta, dispatch `sync-complete` (refreshes file tree)
4. On `drive_file_updated` → save to local cache + edit history, dispatch `file-modified`/`file-restored` (refreshes editor)
5. On `done` → build final `Message` object and save to history

---

## Function Calling

When enabled, Gemini can call tools during chat. Tool execution happens within the local chat executor (or server-side for the SSE fallback).

### Drive Tools

| Tool | Description |
|------|-------------|
| `read_drive_file` | Read file content by ID |
| `search_drive_files` | Search by name or content, with optional folder filter |
| `list_drive_files` | List files and virtual folders |
| `create_drive_file` | Create a new file (path separators for virtual folders) |
| `update_drive_file` | Update existing file content |
| `rename_drive_file` | Rename a file by ID |
| `bulk_rename_drive_files` | Rename multiple files at once |

After `create_drive_file`, the file is created on Drive (an ID is needed), and a `drive_file_created` chunk is emitted. The client seeds the local cache and sync meta so the file tree refreshes.

After `update_drive_file`, the file is **not** written to Drive. A `drive_file_updated` chunk returns the new content to the client, which saves it to the local cache and edit history. The change is pushed to Drive on the next manual push.

### Drive Tool Modes

| Mode | Tools Available |
|------|----------------|
| `all` | All 7 drive tools |
| `noSearch` | Read, create, update, rename, bulk rename only (no search/list) |
| `none` | No drive tools |

Mode is auto-constrained by model and RAG settings:
- **Gemma models**: forced to `none` (no function calling support)
- **Web Search mode**: forced to `none` (incompatible with other tools)
- **RAG enabled**: function calling tools disabled (fileSearch + functionDeclarations not supported by Gemini API)

### MCP Tools

MCP tools are dynamically discovered from configured MCP servers. Tool names use the format `mcp_{serverId}_{toolName}`. MCP server selection is persisted to `localStorage` as server IDs.

### Function Call Limits

| Setting | Default | Description |
|---------|---------|-------------|
| `maxFunctionCalls` | 20 | Maximum tool calls per response |
| `functionCallWarningThreshold` | 5 | Warn when remaining calls drop to this count |

When the limit is reached, Gemini receives a system message requesting a summary of gathered information.

---

## Models

Models are determined by the user's API plan (Free or Paid). Each model has different capabilities:

- **Standard models**: Streaming text + function calling + thinking
- **Image models**: Image generation (no function calling)
- **Gemma models**: Text only (no function calling, no thinking)
- **Flash Lite**: When thinking is enabled, uses `thinkingBudget: -1` (no explicit limit)
- **gemini-3-pro / gemini-3.1-pro models**: Thinking is required and cannot be disabled (thinkingBudget cannot be set to 0)

Model selection is per-chat via the dropdown. Slash commands can override the model.

---

## RAG & Web Search

### RAG (File Search)

Select a RAG store from the dropdown. Gemini uses Gemini File Search with configured store IDs. Results include source attribution displayed as badges.

### Web Search

Select "Web Search" from the dropdown. Uses `googleSearch` tool. Incompatible with function calling and MCP tools (auto-disabled).

### RAG Top-K

Configurable in settings (1-20, default 5). Controls how many search results are considered.

---

## Slash Commands

Type `/` to open command autocomplete. Commands provide:

| Feature | Description |
|---------|-------------|
| `promptTemplate` | Text template sent as message |
| Template variables | `{content}` (active file), `{selection}` (editor selection) |
| Model override | Use a specific model for this command |
| Search setting override | Use specific RAG store or Web Search |
| Drive tool mode override | Control tool access per command |
| MCP server override | Enable specific MCP servers per command |

### File References

Type `@` to open file mention autocomplete. `@filename` references are resolved before sending:
- **Drive tools enabled**: replaced with `[file: name, fileId: id]` (Gemini can read via tools)
- **Drive tools disabled**: file content is fetched and inlined

### Active File Context

When no explicit context (`{content}`, `{selection}`, `@file`) is provided, the currently open file's name and ID are appended automatically so Gemini can use `read_drive_file` if needed.

---

## Attachments

Drag-and-drop or click the paperclip button to attach files.

| Type | Formats |
|------|---------|
| Image | `image/*` — sent as inline Base64 data |
| PDF | `application/pdf` — sent as inline Base64 data |
| Text | Other file types — sent as inline text data (fallback) |

Attachments are included in the Gemini API request as `inlineData` parts.

---

## Image Generation

When an image-capable model is selected (e.g., `gemini-3.1-flash-image-preview`), the chat switches to image generation mode:
- Uses `generateContent` (not streaming chat)
- Response can contain both text and images
- Images displayed inline with download and save-to-Drive buttons
- Save-to-Drive dispatches `sync-complete` to refresh file tree

---

## Chat History

### Storage

Chat histories are stored as JSON files in `history/chats/` on Google Drive, named `chat_{id}.json`. Each chat has:
- `id`: Unique chat identifier
- `title`: First message content (truncated to 50 chars)
- `messages`: Array of `Message` objects
- `createdAt` / `updatedAt`: Timestamps

A `_meta.json` file in the chat history folder indexes all chats for fast listing.

### Encryption

When `encryptChatHistory` is enabled in settings, new chats are encrypted before saving to Drive. Encrypted chats are decrypted client-side using cached credentials or a password prompt.

### Operations

| Action | Description |
|--------|-------------|
| New Chat | Clear messages and start fresh |
| Select Chat | Load messages from Drive (decrypt if needed) |
| Delete Chat | Remove from Drive and history list |
| Auto-save | Saves after each assistant response (`done` chunk) |

---

## Architecture

### Data Flow

```
Browser (ChatPanel)                                  Gemini API
┌──────────────────┐                           ┌──────────────┐
│ messages state    │  executeLocalChat         │ generateContent│
│ streaming state   │◄────────────────────────►│ Stream       │
│ tool call display │  (direct API call         │ Function calls│
│ autocomplete      │   with cached API key)    └──────────────┘
│ chat history      │
│                   │──► Drive tools (IndexedDB local-first)
│                   │──► MCP tools (/api/workflow/mcp-proxy)
└──────────────────┘
         │
   ┌─────▼──────┐
   │ IndexedDB  │
   │ cache      │
   │ editHistory│
   └─────┬──────┘
         │ Push
   ┌─────▼──────┐
   │ Google Drive│
   │ _sync-meta │
   │ history/   │
   └────────────┘
```

### Key Files

| File | Role |
|------|------|
| `app/routes/api.chat.tsx` | Chat SSE API (server-side fallback) — streaming, tool dispatch |
| `app/routes/api.chat.history.tsx` | Chat history CRUD (list, save, delete) |
| `app/hooks/useLocalChat.ts` | Browser-side chat execution — calls Gemini API directly with cached API key |
| `app/services/gemini-chat-core.ts` | Browser-compatible Gemini API client (streaming, function calling, RAG, thinking, image generation) |
| `app/services/gemini-chat.server.ts` | Server-only re-export of gemini-chat-core.ts |
| `app/services/drive-tools.server.ts` | Drive tool definitions and execution |
| `app/services/drive-tool-definitions.ts` | Drive tool schema definitions (7 tools) |
| `app/services/chat-history.server.ts` | Chat history persistence (Drive + `_meta.json`) |
| `app/services/mcp-tools.server.ts` | MCP tool discovery and execution |
| `app/components/ide/ChatPanel.tsx` | Chat panel — state management, local chat execution, history UI |
| `app/components/chat/ChatInput.tsx` | Input area — model/RAG/tool selectors, autocomplete, attachments |
| `app/components/chat/MessageList.tsx` | Message list with streaming partial message |
| `app/components/chat/MessageBubble.tsx` | Message display — thinking, tool badges, images, markdown |
| `app/components/chat/AutocompletePopup.tsx` | Autocomplete popup UI |
| `app/hooks/useAutocomplete.ts` | Autocomplete logic (slash commands, file mentions, variables) |
| `app/types/chat.ts` | Chat type definitions (Message, StreamChunk, ToolCall, etc.) |

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/chat` | POST | Chat SSE stream with function calling |
| `/api/chat/history` | GET | List chat histories |
| `/api/chat/history` | POST | Save chat history |
| `/api/chat/history` | DELETE | Delete chat history |
