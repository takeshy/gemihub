# Workflow Execution

Workflow execution engine with YAML parsing, handler-based node dispatch, client-side local execution, interactive prompts, and AI-powered workflow generation.

## Features

- **YAML Parser**: Converts YAML workflow definitions into an executable AST
- **Handler-Based Execution**: 24 node types dispatched to isolated handler functions
- **Local Execution**: 21/24 node types run in the browser; only 3 (mcp, rag-sync, gemihub-command) call the server
- **Interactive Prompts**: Pause execution to prompt users for input, then resume
- **Sub-Workflow Execution**: Recursive workflow calls with cycle detection
- **Variable Templating**: `{{var}}` syntax with nested access, array indexing, and JSON escaping
- **AI Workflow Generation**: Generate/modify workflows from natural language via Gemini
- **Execution History**: Records saved to Google Drive with per-step details
- **Shortcut Key Execution**: Configure custom keyboard shortcuts to execute specific workflows

---

## Parser

`parseWorkflowYaml(yamlContent)` converts YAML into a `Workflow` object.

### Workflow Structure

```typescript
Workflow {
  nodes: Map<string, WorkflowNode>   // Node ID → node definition
  edges: WorkflowEdge[]              // Connections between nodes
  startNode: string                  // Entry point node ID
  options?: WorkflowOptions          // { showProgress?: boolean } — show per-node progress logs in the UI during execution
  positions?: Record<string, { x: number; y: number }>  // Visual positions for diagram
}
```

### Edge Resolution

Edges are resolved in the following order:

1. Explicit `next` / `trueNext` / `falseNext` properties on node
2. Default to next node in sequential order if not specified
3. `"end"` keyword terminates the execution path

Conditional nodes (`if` / `while`) require `trueNext`, with optional `falseNext` (defaults to next node in sequence).

### Node ID Normalization

- Auto-generates IDs if missing
- Handles duplicates with `_2`, `_3` suffixes
- Validates node types against a set of valid types

---

## Executor

`executeWorkflow()` is the server-side executor, used only by `/api/workflow/execute-node` for the 3 server-requiring node types (mcp, rag-sync, gemihub-command). It runs a parsed workflow using a stack-based depth-first approach. For the primary client-side executor, see [Local Execution](#local-execution-client-side).

### Execution Flow

1. Push `startNode` onto the stack
2. Pop node from stack
3. Check abort signal
4. Dispatch to handler by `node.type`
5. Handler executes logic, modifies `context.variables`
6. Log results (success / error)
7. Get next nodes via `getNextNodes()`
8. Push next nodes to stack (in reverse order for left-to-right execution)
9. Repeat until stack is empty or error occurs

### Execution Limits

| Limit | Value | Description |
|-------|-------|-------------|
| `MAX_WHILE_ITERATIONS` | 1,000 | Maximum iterations per while loop |
| `MAX_TOTAL_STEPS` | 100,000 | Maximum total node executions |

### Execution Context

```typescript
ExecutionContext {
  variables: Map<string, string | number>  // Shared state across nodes
  logs: ExecutionLog[]                      // All node execution logs
  lastCommandInfo?: LastCommandInfo         // For command node introspection
}
```

### Service Context

External dependencies injected into handlers:

```typescript
ServiceContext {
  driveAccessToken: string
  driveRootFolderId: string
  driveHistoryFolderId: string            // Folder ID for edit history files
  geminiApiKey?: string
  abortSignal?: AbortSignal
  editHistorySettings?: EditHistorySettings  // Remote edit history config
  settings?: UserSettings
  onDriveFileUpdated?: (data) => void   // Broadcast to SSE
  onDriveFileCreated?: (data) => void   // Broadcast to SSE
  onDriveFileDeleted?: (data) => void   // Broadcast to SSE
}
```

### Error Handling

| Level | Behavior |
|-------|----------|
| Handler error | Caught, logged, execution stops with status `"error"` |
| Abort signal | Checked at each step, sets status `"cancelled"` |
| Prompt cancellation | Value is `null`, handler throws error |
| Sub-workflow error | Wrapped with "Sub-workflow execution failed" message |
| Max iteration/step limits | Prevents infinite loops, throws error |

### Execution Record

Saved to Drive after execution completes (including on error):

```typescript
ExecutionRecord {
  id: string
  workflowId: string
  workflowName: string
  startTime: string        // ISO timestamp
  endTime: string
  status: "running" | "completed" | "error" | "cancelled"
  steps: ExecutionStep[]   // Per-node input/output/status/error
  isEncrypted?: boolean    // Whether the record is encrypted
}
```

---

## Variable Templating

### Template Syntax

| Syntax | Description |
|--------|-------------|
| `{{varName}}` | Simple variable substitution |
| `{{varName.field.nested}}` | Nested object access |
| `{{arr[0]}}` | Array index (numeric literal) |
| `{{arr[idx]}}` | Array index (variable reference) |
| `{{varName:json}}` | JSON-escape for embedding strings in JSON |

### Resolution

- Iterative replacement (max 10 iterations for nested templates)
- Strips quotes from string literals
- Numeric type detection for number strings
- JSON parsing for stringified JSON values

### Condition Operators

Used in `if` and `while` nodes:

| Operator | Description |
|----------|-------------|
| `==` | Equal |
| `!=` | Not equal |
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal |
| `>=` | Greater than or equal |
| `contains` | String contains or JSON array includes |

---

## Local Execution (Client-Side)

By default, workflow execution runs in the browser. The execution loop runs client-side, and only server-requiring nodes call the server API.

### Architecture

```
Browser (client):
├── Parse workflow YAML locally (parser.ts)
├── Run executor loop locally (local-executor.ts)
│   ├── Local nodes (21 types) → execute directly in browser
│   │   ├── variable, set, if, while, sleep, json
│   │   ├── dialog, prompt-value, prompt-selection (UI shown directly)
│   │   ├── command (Gemini API called directly from browser via gemini-chat-core.ts)
│   │   │   ├── Drive tools → drive-tools-local.ts (IndexedDB)
│   │   │   └── MCP tools → /api/workflow/mcp-proxy (server proxy)
│   │   ├── http (fetch from browser; cross-origin routes through /api/workflow/http-fetch for CORS bypass — 60 req/min Premium, 2 req/min free)
│   │   ├── drive-file, drive-read, drive-search, drive-list, drive-folder-list,
│   │   │   drive-save, drive-delete (IndexedDB via drive-local.ts)
│   │   ├── drive-file-picker, prompt-file (UI shown locally, file read from IndexedDB)
│   │   └── workflow (sub-workflow loaded from IndexedDB, executed recursively)
│   └── Server-required nodes (3 types) → POST /api/workflow/execute-node
│       ├── mcp (MCP server calls)
│       ├── rag-sync (Gemini RAG API)
│       └── gemihub-command (encryption, publish, PDF/HTML export)
```

### Local Nodes

These 21 node types run entirely in the browser with no server call:

| Node Type | Description |
|-----------|-------------|
| `variable` | Set/initialize a variable |
| `set` | Arithmetic expression |
| `if` | Conditional branching |
| `while` | Loop with condition |
| `sleep` | Delay execution |
| `json` | Parse JSON string |
| `dialog` | Show dialog UI directly |
| `prompt-value` | Show text input UI directly |
| `prompt-selection` | Show multiline input UI directly |
| `command` | Gemini API called directly from browser; Drive tools use IndexedDB, MCP tools use `/api/workflow/mcp-proxy` |
| `http` | HTTP request via browser fetch. Same-origin and CORS-enabled cross-origin succeed directly; other cross-origin URLs route through the `/api/workflow/http-fetch` server proxy (60 req/min on Premium, 2 req/min on free) |
| `drive-file` | Create/update file in IndexedDB |
| `drive-read` | Read file from IndexedDB |
| `drive-search` | Search files in IndexedDB cache |
| `drive-list` | List files from IndexedDB cache |
| `drive-folder-list` | List folders from IndexedDB cache |
| `drive-file-picker` | Interactive file picker using cached file tree |
| `drive-save` | Save binary/text to IndexedDB |
| `drive-delete` | Soft-delete file in IndexedDB |
| `prompt-file` | Drive file picker + read from IndexedDB |
| `workflow` | Sub-workflow loaded from IndexedDB, executed recursively |

### Server-Required Nodes

These 3 node types call `POST /api/workflow/execute-node` per invocation:

| Node Type | Reason |
|-----------|--------|
| `mcp` | MCP server calls require server-side HTTP |
| `rag-sync` | Gemini RAG API requires server-side access |
| `gemihub-command` | Drive operations (encrypt, publish, PDF/HTML export) require server-side access |

### Node Execution API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workflow/execute-node` | Execute a single server-requiring node |

**Request body:**
```json
{
  "nodeType": "drive-read",
  "nodeId": "read-file",
  "properties": { "path": "example.md", "saveTo": "content" },
  "variables": { "content": "" },
  "workflowId": "abc123",
  "promptResponse": null
}
```

**Response (non-streaming):**
```json
{
  "variables": { "content": "file content here" },
  "logs": [],
  "driveEvents": []
}
```

**Response (prompt needed):**
```json
{
  "needsPrompt": true,
  "promptType": "diff",
  "promptData": { "title": "Confirm Write", "fileName": "example.md", "diff": "..." }
}
```

When the server returns `needsPrompt: true`, the client shows the prompt UI, collects the user response, and retries the API call with `promptResponse` set.

For the `command` node, the response is an SSE stream with `log`, `complete`, and `error` events.

### Client-Side Hook

`useLocalWorkflowExecution(workflowId)` manages local execution state:

```typescript
{
  status: "idle" | "running" | "completed" | "cancelled" | "error" | "waiting-prompt"
  logs: LogEntry[]
  promptData: Record<string, unknown> | null
  executeWorkflow(yamlContent, options?): Promise<LocalExecuteResult | null>
  stop(): void
  handlePromptResponse(value: string | null): void
}
```

### Prompt Handling

Prompts are handled directly in the browser without SSE round-trip:
1. Local executor encounters a prompt node (dialog, prompt-value, prompt-selection)
2. Hook sets `promptData` and pauses execution via a Promise
3. PromptModal shows, user responds
4. Hook resolves the Promise, execution continues

For server nodes that need prompts (drive-file with confirm, encrypted files):
1. Server returns `{needsPrompt: true, promptType, promptData}`
2. Client shows prompt UI
3. Client retries the API call with `promptResponse`

---

## Server API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workflow/execute-node` | Execute a single server-requiring node (mcp, rag-sync, gemihub-command) |
| POST | `/api/workflow/mcp-proxy` | Proxy for MCP tool definitions and execution (used by local command node) |
| GET/POST | `/api/workflow/history` | List/load/save/delete execution history records |

---

## Interactive Prompts

Workflows can pause to prompt users for input.

### Prompt Flow (Local Execution)

1. Local executor encounters prompt node (dialog, prompt-value, prompt-selection)
2. Hook sets `promptData` and status to `"waiting-prompt"`
3. Client shows PromptModal directly (no SSE)
4. User submits input
5. Hook resolves the Promise, execution continues

### Prompt Flow (Server Node with Prompt)

1. Client calls `POST /api/workflow/execute-node`
2. Server returns `{needsPrompt: true, promptType, promptData}`
3. Client shows PromptModal
4. User submits input
5. Client retries API call with `promptResponse` field

### Prompt Types

| Type | UI | Return Value |
|------|-----|-------------|
| `value` | Text input (single/multiline) | Raw string |
| `dialog` | Button choices + optional input | JSON: `{button, selected, input?}` |
| `drive-file` | Drive file picker | JSON: `{id, name, mimeType}` |
| `diff` | Side-by-side diff view | `"OK"` (accept) or `"Cancel"` (reject) |
| `password` | Password input | Raw password string |

### Cancellation

- If user cancels the prompt, value is `null`
- Handler throws an error, executor halts with `"error"` status
- The stop endpoint also resolves pending prompts with `null`

---

## Sub-Workflow Execution

The `workflow` node type executes another workflow file.

### Features

- Load workflow by file path or name from Drive
- Variable mapping: input/output bindings via JSON or `key=value` pairs
- Optional variable prefix for output isolation
- Cycle detection via `subWorkflowStack` (max depth: 20)
- Shares `serviceContext` and `promptCallbacks` with parent

---

## Handlers

All 24 node types are dispatched to isolated handler functions. Local handlers (21 types) live in `app/engine/local-handlers/`. Server-side handlers (3 types: mcp, rag-sync, gemihub-command) live in `app/engine/handlers/`. Some shared handlers (control flow, json) in `app/engine/handlers/` are also imported by the local executor.

### Control Flow

| Handler | Node Type | Description |
|---------|-----------|-------------|
| `handleVariableNode` | `variable` | Declare/initialize a variable |
| `handleSetNode` | `set` | Update variable with expression (arithmetic: `+`, `-`, `*`, `/`, `%`) |
| `handleIfNode` | `if` | Evaluate condition, return boolean for branch selection |
| `handleWhileNode` | `while` | Evaluate condition for loop continuation |
| `handleSleepNode` | `sleep` | Async sleep with abort signal support |

### LLM / AI

| Handler | Node Type | Description |
|---------|-----------|-------------|
| `handleCommandNode` | `command` | Stream Gemini chat with function calling, Drive/MCP/RAG/Web Search tools |

### Drive Operations

| Handler | Node Type | Description |
|---------|-----------|-------------|
| `handleDriveFileNode` | `drive-file` | Create/update Drive file (create/overwrite/append modes, diff review) |
| `handleDriveReadNode` | `drive-read` | Read Drive file content (text or binary as FileExplorerData) |
| `handleDriveSearchNode` | `drive-search` | Search Drive files by query |
| `handleDriveListNode` | `drive-list` | List files with sort/filter (by name, created, modified, time range) |
| `handleDriveFolderListNode` | `drive-folder-list` | List folders only |
| `handleDriveFilePickerNode` | `drive-file-picker` | Interactive Drive file picker dialog |
| `handleDriveSaveNode` | `drive-save` | Save FileExplorerData (binary/text) to Drive |
| `handleDriveDeleteNode` | `drive-delete` | Soft-delete file (move to trash/) |

### Interactive

| Handler | Node Type | Description |
|---------|-----------|-------------|
| `handlePromptValueNode` | `prompt-value` | Text input prompt |
| `handlePromptFileNode` | `prompt-file` | Drive file picker prompt, returns file content |
| `handlePromptSelectionNode` | `prompt-selection` | Multiline text input prompt |
| `handleDialogNode` | `dialog` | Button dialog with optional multiselect and input field |

### Integration

| Handler | Node Type | Description |
|---------|-----------|-------------|
| `handleWorkflowNode` | `workflow` | Execute sub-workflow with variable mapping |
| `handleJsonNode` | `json` | Parse JSON string variable (supports markdown code blocks) |
| `handleHttpNode` | `http` | HTTP request (json/form-data/binary/text content types) |
| `handleMcpNode` | `mcp` | Call MCP tool via HTTP with OAuth support |
| `handleRagSyncNode` | `rag-sync` | Sync Drive file to Gemini RAG store |
| `handleGemihubCommandNode` | `gemihub-command` | Special commands: encrypt, publish, unpublish, duplicate, convert-to-pdf, convert-to-html, rename |

### Handler Property Details

#### `drive-file` additional properties

| Property | Description |
|----------|-------------|
| `history` | Set to `"true"` to record edit history for the file (requires `editHistorySettings` in ServiceContext) |
| `open` | Set to `"true"` to open the file in the editor after writing (sets `__openFile` variable) |
| `confirm` | Set to `"false"` to skip the diff confirmation dialog before writing (default: `"true"`) |

#### `command` additional properties

| Property | Description |
|----------|-------------|
| `attachments` | Comma-separated variable names containing FileExplorerData. Files are sent as Gemini attachments (image/pdf/text). If the FileExplorerData has an `id` but no `data`, the file is read from Drive automatically |
| `systemPrompt` | System prompt passed to the Gemini model. Supports `{{variable}}` templates |
| `saveImageTo` | Variable name to save generated image data as FileExplorerData (for image generation models) |
| `enableThinking` | `"true"` (default) to enable thinking/reasoning, `"false"` to disable |

#### `drive-file-picker` modes

| Mode | Description |
|------|-------------|
| `select` (default) | Shows an interactive file picker to select an existing Drive file |
| `create` | Shows a text input for the user to enter a file path. Does not create the file; returns the path string. Useful with `drive-save` or `drive-file` nodes |

#### `http` contentType: `binary`

When `contentType` is `"binary"`, the body is parsed as FileExplorerData. The base64 `data` field is decoded and sent as a raw binary body. The `mimeType` from the FileExplorerData is used as `Content-Type` if not explicitly set in headers. Falls back to trying the body as a variable reference to FileExplorerData.

#### `gemihub-command` property notes

| Command | `text` property |
|---------|-----------------|
| `rename` | Required — specifies the new file name |
| `duplicate` | Optional — specifies the new file name (defaults to `"{stem} (copy){ext}"`) |

---

## AI Workflow Generation

Generate or modify workflows from natural language using Gemini.

### Endpoint

POST `/api/workflow/ai-generate` (SSE stream)

### Request

```typescript
{
  mode: "create" | "modify"
  name?: string                      // Workflow name (create mode)
  description: string                // Natural language description
  currentYaml?: string               // Existing YAML (modify mode)
  model?: ModelType                   // Model override
  history?: Array<{role, text}>      // Conversation history for regeneration
  executionSteps?: ExecutionStep[]   // Execution context for refinement
}
```

### SSE Events

| Type | Description |
|------|-------------|
| `thinking` | AI reasoning content |
| `text` | Generated workflow YAML |
| `error` | Error message |

### UI (AIWorkflowDialog)

1. **Input phase**: User enters name/description, selects model, optionally includes execution history
2. **Generating phase**: Shows streaming thinking + generated YAML
3. **Preview phase**: Shows final YAML with edit and regenerate options

Regeneration maintains conversation history of user/model turns.

---

## Execution UI

### WorkflowPropsPanel

Main workflow view in the IDE right sidebar:

- Node list with drag-and-drop reordering
- Run/Stop buttons with local execution
- Real-time execution log display with status icons
- MCP app modal for tool results
- Prompt modal when execution is waiting for input

### PromptModal

Renders different UI based on prompt type:

- `value`: Text input (single/multiline)
- `dialog`: Button choices with optional text input and multiselect
- `drive-file`: File browser using cached file tree
- `diff`: Side-by-side diff view
- `password`: Password input

---

## Shortcut Key Execution

Users can configure custom keyboard shortcuts in **Settings > Shortcuts** to execute specific workflows.

### Configuration

Each shortcut binding includes:

| Field | Description |
|-------|-------------|
| `action` | Action type (currently `executeWorkflow`) |
| `targetFileId` | Drive file ID of the target workflow |
| `targetFileName` | Display name of the target workflow |
| `key` | Key to press (e.g. `F5`, `e`, `r`) |
| `ctrlOrMeta` | Require Ctrl (Win/Linux) / Cmd (Mac) |
| `shift` | Require Shift |
| `alt` | Require Alt |

### Validation Rules

- **Modifier required**: Single character keys (a–z, 0–9, etc.) require Ctrl/Cmd or Alt. Shift alone is not sufficient. Function keys (F1–F12) can be used alone.
- **Built-in conflict protection**: Key combinations reserved by the application (Ctrl+Shift+F for search, Ctrl+P for Quick Open) cannot be assigned.
- **Duplicate detection**: The same key combination cannot be assigned to multiple shortcuts.

### Execution Flow

1. User presses configured shortcut key in the IDE
2. `_index.tsx` keydown handler matches the binding
3. If the target workflow is not already active, `handleSelectFile()` navigates to it
4. A `shortcut-execute-workflow` CustomEvent is dispatched with the target `fileId`
5. `WorkflowPropsPanel` receives the event:
   - If workflow is loaded and ready → executes immediately via `startExecution()`
   - If workflow is still loading (just navigated) → defers execution via `pendingExecutionRef`, which fires once the workflow finishes loading

### Settings Storage

Shortcut bindings are stored in `settings.json` on Drive as the `shortcutKeys` field (array of `ShortcutKeyBinding`). Saved via the `saveShortcuts` action in the Settings route.

---

## Key Files

| File | Description |
|------|-------------|
| `app/engine/parser.ts` | YAML parser, AST builder, edge resolution |
| `app/engine/executor.ts` | Stack-based server executor with handler dispatch |
| `app/engine/local-executor.ts` | Client-side executor (21/24 nodes local, 3 server) |
| `app/engine/local-handlers/` | Local node handlers (command, http, drive, prompt, workflow) |
| `app/engine/types.ts` | Core types (WorkflowNode, ExecutionContext, ServiceContext, PromptCallbacks) |
| `app/engine/handlers/` | 24 node type handlers (shared by both server and local executors) |
| `app/hooks/useLocalWorkflowExecution.ts` | Client-side local execution hook |
| `app/routes/api.workflow.execute-node.tsx` | Single-node execution API for server-requiring nodes |
| `app/routes/api.workflow.mcp-proxy.tsx` | MCP tool definition and execution proxy |
| `app/routes/api.workflow.ai-generate.tsx` | AI workflow generation endpoint |
| `app/services/drive-local.ts` | IndexedDB-based Drive operations for local execution |
| `app/services/drive-tools-local.ts` | Local Gemini function calling Drive tools |
| `app/services/gemini-chat-core.ts` | Browser-compatible Gemini API client (extracted from server) |
| `app/utils/drive-file-local.ts` | Drive event UI dispatch for local execution |
| `app/components/execution/PromptModal.tsx` | Interactive prompt modals |
| `app/components/ide/WorkflowPropsPanel.tsx` | Workflow node list, execution controls, logs |
| `app/components/ide/AIWorkflowDialog.tsx` | AI generation dialog UI |
| `app/components/settings/ShortcutsTab.tsx` | Shortcut key settings UI |
| `app/types/settings.ts` | `ShortcutKeyBinding` type, validation helpers (`isBuiltinShortcut`, `isValidShortcutKey`) |
