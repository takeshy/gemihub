# Workflow Execution

Workflow execution engine with YAML parsing, handler-based node dispatch, SSE streaming, interactive prompts, and AI-powered workflow generation.

## Features

- **YAML Parser**: Converts YAML workflow definitions into an executable AST
- **Handler-Based Execution**: 24 node types dispatched to isolated handler functions
- **SSE Streaming**: Real-time execution log streaming via Server-Sent Events
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
  options?: WorkflowOptions          // { showProgress?: boolean }
  positions?: Map<string, Position>  // Visual positions for diagram
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

`executeWorkflow()` runs a parsed workflow using a stack-based depth-first approach.

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
  geminiApiKey?: string
  abortSignal?: AbortSignal
  settings?: UserSettings
  onDriveFileUpdated?: (data) => void   // Broadcast to SSE
  onDriveFileCreated?: (data) => void   // Broadcast to SSE
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
| `contains` | String contains |

---

## SSE Streaming

Execution uses Server-Sent Events for real-time updates.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workflow/{id}/execute` | Start execution, returns `{ executionId }` |
| GET | `/api/workflow/{id}/execute?executionId={id}` | SSE stream |
| POST | `/api/workflow/{id}/stop` | Stop execution |
| POST | `/api/prompt-response` | Respond to an interactive prompt |

### SSE Event Types

| Event | Description |
|-------|-------------|
| `log` | Node execution log (nodeId, nodeType, message, status, input/output) |
| `status` | Status change (running / completed / error / cancelled / waiting-prompt) |
| `complete` | Execution finished with record and optional openFile |
| `cancelled` | User stopped execution |
| `error` | Fatal error message |
| `prompt-request` | Prompt waiting for user input (type, title, options, etc.) |
| `drive-file-updated` | Workflow modified a Drive file |
| `drive-file-created` | Workflow created a Drive file |

### Client-Side Hook

`useWorkflowExecution` manages execution state:

```typescript
{
  executionId: string | null
  logs: LogEntry[]
  status: "idle" | "running" | "completed" | "cancelled" | "error" | "waiting-prompt"
  promptData: Record<string, unknown> | null
}
```

Methods: `start()`, `stop()`, `handlePromptResponse(value)`

---

## Execution Store

In-memory state management for active executions (no database persistence).

### Execution State

```typescript
ExecutionState {
  id: string
  status: "running" | "completed" | "error" | "cancelled" | "waiting-prompt"
  logs: ExecutionLog[]
  record?: ExecutionRecord
  abortController: AbortController
  promptResolve?: (value: string | null) => void
  promptType?: string
  promptData?: Record<string, unknown>
  subscribers: Set<(event, data) => void>
}
```

### Broadcast Mechanism

- `broadcast(id, event, data)` calls all SSE subscribers
- Existing logs are replayed when a new subscriber connects
- Executions are cleaned up after 30 minutes

---

## Interactive Prompts

Workflows can pause to prompt users for input.

### Prompt Flow

1. Handler calls `promptCallbacks.promptForValue(title, default, multiline)`
2. Execution store sets status to `"waiting-prompt"`
3. SSE broadcasts `prompt-request` event to client
4. Client shows prompt modal
5. User submits input via POST `/api/prompt-response`
6. `resolvePrompt()` unblocks the handler Promise
7. Handler resumes with the returned value

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

All 24 node types are dispatched to isolated handler functions in `app/engine/handlers/`.

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

### ExecutionPanel

Main execution view in the IDE right sidebar:

- Run/Stop buttons
- Real-time execution log display with status icons
- Auto-scroll to latest log entry
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
| `app/engine/executor.ts` | Stack-based executor with handler dispatch |
| `app/engine/types.ts` | Core types (WorkflowNode, ExecutionContext, ServiceContext, PromptCallbacks) |
| `app/engine/handlers/` | 24 node type handlers |
| `app/services/execution-store.server.ts` | In-memory execution state, SSE broadcast, prompt management |
| `app/routes/api.workflow.$id.execute.tsx` | SSE endpoint for starting/streaming execution |
| `app/routes/api.workflow.$id.stop.tsx` | Stop execution endpoint |
| `app/routes/api.prompt-response.tsx` | Prompt response endpoint |
| `app/routes/api.workflow.ai-generate.tsx` | AI workflow generation endpoint |
| `app/hooks/useWorkflowExecution.ts` | Client-side execution state hook |
| `app/components/execution/ExecutionPanel.tsx` | Execution log UI |
| `app/components/execution/PromptModal.tsx` | Interactive prompt modals |
| `app/components/ide/AIWorkflowDialog.tsx` | AI generation dialog UI |
| `app/components/settings/ShortcutsTab.tsx` | Shortcut key settings UI |
| `app/types/settings.ts` | `ShortcutKeyBinding` type, validation helpers (`isBuiltinShortcut`, `isValidShortcutKey`) |
