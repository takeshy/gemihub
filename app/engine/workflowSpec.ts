// Workflow specification for AI generation (adapted for Drive-based workflows)
// Dynamic based on settings context (models, MCP servers, RAG settings)

import type {
  ApiPlan,
  McpServerConfig,
  ModelInfo,
} from "~/types/settings";
import { getAvailableModels } from "~/types/settings";

interface WorkflowSpecContext {
  apiPlan?: ApiPlan;
  mcpServers?: McpServerConfig[];
  ragSettingNames?: string[];
  outputAsMarkdown?: boolean;
  includeSkillGeneration?: boolean;
}

export function getWorkflowSpecification(context?: WorkflowSpecContext): string {
  const models = getAvailableModels(context?.apiPlan ?? "paid");
  const modelList = buildModelList(models);
  const mcpSection = buildMcpSection(context?.mcpServers);
  const mcpServerList = buildMcpServerList(context?.mcpServers);
  const commandRagSection = buildCommandRagSection(context?.ragSettingNames);
  const ragSyncSection = buildRagSyncSection(context?.ragSettingNames);
  const hubworkSection = buildHubworkSection(context?.apiPlan ?? "paid");

  let formatSection: string;
  if (context?.includeSkillGeneration) {
    formatSection = `## Format
Output a single continuous text with a \`===WORKFLOW===\` separator line.
The first part is the SKILL.md content (YAML frontmatter + \`\`\`skill-capabilities fenced YAML block + markdown instructions) as raw text.
The second part (after the separator) is the workflow YAML wrapped in a \`\`\`yaml code fence.

Example structure:
---
name: Skill Display Name
description: Short description of what this skill does
---

\`\`\`skill-capabilities
workflows:
  - path: workflows/<workflow-filename>.yaml
    description: What the workflow does
\`\`\`

Instructions for the AI agent when this skill is active.
Describe the agent's role, behavior rules, and how to use the workflows. Reference input variables by their exact name so the chat LLM knows what to pass.

===WORKFLOW===
\`\`\`yaml
name: workflow-name
nodes:
  - id: first-node
    type: variable
    ...
\`\`\`

IMPORTANT:
- Frontmatter holds only user-facing metadata (name, description). Do NOT put \`workflows:\` in the frontmatter.
- Workflow / script IDs live in the \`\`\`skill-capabilities fenced YAML block. The runtime auto-fills \`inputVariables\` from the workflow YAML's \`{{var}}\` usage, so keep that clean and unambiguous.
- The workflow YAML after the separator MUST be inside a \`\`\`yaml code fence to preserve indentation.`;
  } else if (context?.outputAsMarkdown) {
    formatSection = `## Format
Workflows are defined in YAML format inside a \`\`\`yaml code block within a Markdown document.
Include a brief description and processing overview BEFORE the \`\`\`yaml code block as Markdown text.`;
  } else {
    formatSection = `## Format
Workflows are defined in YAML format. Output ONLY the YAML content starting with "name:".
Do NOT include \`\`\`yaml or \`\`\` markers.`;
  }

  return `
# GemiHub Workflow Specification

${formatSection}

## Basic Structure
\`\`\`yaml
name: workflow-name
nodes:
  - id: node-1
    type: variable
    name: myVar
    value: "initial value"
  - id: node-2
    type: command
    prompt: "Process {{myVar}}"
    saveTo: result
\`\`\`

## Variable Syntax
- Simple: \`{{variableName}}\`
- Object: \`{{obj.property}}\`, \`{{obj.nested.value}}\`
- Array: \`{{arr[0]}}\`, \`{{arr[0].name}}\`
- Variable index: \`{{arr[index]}}\` (where index is a variable)
- JSON escape: \`{{variable:json}}\` — escapes content to be safely embedded **inside a string literal** (escapes quotes, newlines, etc.)
- Expression (in set node): \`{{a}} + {{b}}\`, operators: +, -, *, /, %

### CRITICAL: \`:json\` does NOT add surrounding quotes
\`{{var:json}}\` only ESCAPES the content — it does not add outer quotes. You must provide the quotes yourself when embedding inside a string.

✅ Correct (inside a JSON string):
\`\`\`yaml
args: '{"text": "{{content:json}}"}'   # the "..." around it provides the string literal
\`\`\`

✅ Correct (inside JavaScript code in a script node):
\`\`\`yaml
code: |
  var text = "{{content:json}}";       # wrap in quotes to make it a JS string
  return JSON.parse("{{jsonStr:json}}"); # quotes turn it into a parseable string
\`\`\`

❌ Wrong — missing quotes produces invalid JavaScript:
\`\`\`yaml
code: |
  var text = {{content:json}};          # syntax error — bare escaped text isn't valid JS
  return JSON.parse({{jsonStr:json}});  # same error
\`\`\`

**Rule of thumb for script/http/json-string contexts**: if the variable holds a plain string that should become a string literal, always write \`"{{var:json}}"\` with the surrounding quotes.

## Condition Syntax
Operators: ==, !=, <, >, <=, >=, contains
\`\`\`yaml
condition: "{{status}} == done"
condition: "{{count}} < 10"
condition: "{{text}} contains keyword"
\`\`\`

## Node Types

### Control Flow

#### variable
Initialize or declare a variable.
- **name** (required): Variable name
- **value** (optional): Initial value (string or number).
  - Omit to declare an INPUT variable: keeps the value passed by the caller (parent workflow / skill / hotkey); defaults to "" if no caller value was provided.
  - Specify \`value: ""\` (or a number/string) to force a known initial value regardless of caller state.
  - Omitting \`value\` is perfectly valid for accumulators that will be appended to later — the node writes "" if the variable doesn't exist yet.

#### set
Update a variable with expression support.
- **name** (required): Variable name
- **value** (required): New value or expression (e.g., "{{counter}} + 1")

#### if
Conditional branching.
- **condition** (required): Condition to evaluate
- **trueNext** (required): Node ID for true branch
- **falseNext** (optional): Node ID for false branch (defaults to next node)

#### while
Loop while condition is true.
- **condition** (required): Loop condition
- **trueNext** (required): Node ID for loop body
- **falseNext** (optional): Node ID for exit (defaults to next node)

#### sleep
Pause execution.
- **duration** (required): Sleep duration in milliseconds (supports {{variables}})

### AI & LLM

#### command
Execute LLM prompt via Gemini API with optional tools.
- **prompt** (required): Prompt template (supports {{variables}})
- **model** (optional): Model override${modelList}
- **ragSetting** (optional): "__websearch__", "__none__", or RAG setting name${commandRagSection}
- **driveToolMode** (optional): "all", "noSearch", "none" (default: "none")
- **mcpServers** (optional): Comma-separated MCP server IDs${mcpServerList}
- **enableThinking** (optional): "true" (default) or "false". Enable deep thinking mode
- **systemPrompt** (optional): System prompt override
- **attachments** (optional): Comma-separated variable names containing FileExplorerData (images, PDFs, etc.)
- **saveTo** (optional): Variable for text response
- **saveImageTo** (optional): Variable for generated image (FileExplorerData JSON) — use with image generation models

### Google Drive Operations

#### drive-file
Write/create file on Drive.
- **path** (required): File name/path (supports {{variables}})
- **content** (optional): Content to write (supports {{variables}}, default: empty string)
- **mode** (optional): "overwrite" (default), "append", "create"
- **confirm** (optional): "true" (default) / "false" — show diff review dialog when updating existing files
- **history** (optional): "true"/"false" — record edit in edit history
- **open** (optional): "true"/"false" — open file in IDE after workflow completes

#### drive-read
Read file from Drive.
- **path** (required): File name or Drive file ID
- **saveTo** (required): Variable for content (string)

#### drive-search
Search files on Drive.
- **query** (required): Search query
- **searchContent** (optional): "true"/"false" (default: "false") — search inside file content
- **limit** (optional): Maximum results to return (default: 10)
- **saveTo** (required): Variable for results — JSON array: \`[{id, name, modifiedTime}]\`

#### drive-list
List files in folder.
- **folder** (optional): Folder name (virtual path prefix)
- **limit** (optional): Max results (default: 50)
- **sortBy** (optional): "modified" (default), "created", "name"
- **sortOrder** (optional): "desc" (default), "asc"
- **modifiedWithin** (optional): Time filter, e.g. "7d", "2h", "30m"
- **createdWithin** (optional): Time filter, e.g. "30d"
- **saveTo** (required): Variable for results

Result structure:
\`\`\`json
{"notes": [{id, name, modifiedTime, createdTime}], "count": 5, "totalCount": 100, "hasMore": true}
\`\`\`
Access: \`{{fileList.notes[index].name}}\`, \`{{fileList.count}}\`, \`{{fileList.hasMore}}\`

#### drive-folder-list
List virtual folders.
- **folder** (optional): Parent folder
- **saveTo** (required): Variable for results

Result structure:
\`\`\`json
{"folders": [{"name": "subfolder"}], "count": 3}
\`\`\`

#### drive-file-picker
Interactive file picker dialog. When saveTo is used, file content is automatically loaded (binary files as Base64, text files as-is).
- **title** (optional): Dialog title
- **mode** (optional): "select" (default) — pick existing file; "create" — enter new path
- **default** (optional): Default path value
- **path** (optional): Direct path (skip dialog entirely)
- **extensions** (optional): Comma-separated extensions filter
- **saveTo** (optional): Variable for FileExplorerData JSON (includes file content)
- **savePathTo** (optional): Variable for file path string

FileExplorerData structure: \`{id, path, basename, name, extension, mimeType, contentType, data}\`
- contentType: "binary" for PDF/images/etc., "text" for text files
- data: Base64 string for binary, plain text for text files

Example — image analysis with attachments:
\`\`\`yaml
- id: select-image
  type: drive-file-picker
  title: "Select an image to analyze"
  extensions: "png,jpg,jpeg,gif,webp"
  saveTo: imageData
- id: analyze
  type: command
  prompt: "Describe this image in detail"
  attachments: imageData
  saveTo: analysis
\`\`\`

Example — load file without dialog (e.g., from a previous step):
\`\`\`yaml
- id: load-pdf
  type: drive-file-picker
  path: "{{pdfPath}}"
  saveTo: pdfData
\`\`\`

#### drive-save
Save FileExplorerData (e.g., from HTTP download or image generation) to Drive.
- **source** (required): Variable containing FileExplorerData JSON
- **path** (required): Save path
- **savePathTo** (optional): Variable for final saved path

#### drive-delete
Soft-delete a file by moving it to the trash/ subfolder.
- **path** (required): File path to delete (supports {{variables}}, .md auto-appended if no extension)

### User Interaction

#### dialog
Show dialog with options and optional text input.
- **title** (optional): Dialog title
- **message** (optional): Message content (supports {{variables}})
- **markdown** (optional): "true"/"false" — render message as markdown
- **options** (optional): Comma-separated options for selection
- **multiSelect** (optional): "true"/"false" — allow multiple selections
- **inputTitle** (optional): Label for text input field (adds a text input to dialog)
- **multiline** (optional): "true"/"false" — multiline text input
- **button1** (optional): Primary button text (default: "OK")
- **button2** (optional): Secondary button text (e.g., "Cancel")
- **defaults** (optional): JSON string with defaults: \`{"input": "text", "selected": ["opt1"]}\`
- **saveTo** (optional): Variable for result JSON

Result structure: \`{"button": "OK", "selected": ["opt1", "opt2"], "input": "text"}\`

IMPORTANT: To check which button was pressed, use:
\`\`\`yaml
condition: "{{dialogResult}} contains \\"button\\":\\"OK\\""
\`\`\`
To check selected items: \`"{{dialogResult}} contains \\"opt1\\""\`

#### prompt-value
Prompt user for text input.
- **title** (optional): Dialog title
- **default** (optional): Default value (supports {{variables}})
- **multiline** (optional): "true"/"false"
- **saveTo** (required): Variable for input value (string)

#### prompt-file
Prompt user to select a file from Drive. Returns file **content** as a string.
- **title** (optional): Dialog title (supports {{variables}})
- **saveTo** (optional): Variable for file content (string)
- **saveFileTo** (optional): Variable for file metadata JSON: \`{path, basename, name, extension}\`

#### prompt-selection
Prompt user for multiline text input (e.g., a text selection or passage).
- **title** (optional): Dialog title
- **saveTo** (required): Variable for input text (string)

### External Services

#### http
Make HTTP request.
- **url** (required): Request URL (supports {{variables}})
- **method** (optional): GET, POST, PUT, DELETE, PATCH
- **contentType** (optional): "json" (default), "text", "form-data", "binary"
  - "json": Body sent as JSON with application/json Content-Type
  - "text": Body sent as plain text
  - "form-data": Body is JSON object of field→value pairs (supports FileExplorerData for file uploads)
  - "binary": Body is a FileExplorerData variable; decoded from base64 and sent with its mimeType
- **headers** (optional): JSON headers string
- **body** (optional): Request body (supports {{variables}})
- **saveTo** (optional): Variable for response (text, JSON, or FileExplorerData for binary)
- **saveStatus** (optional): Variable for HTTP status code (number)
- **throwOnError** (optional): Whether to throw on 4xx/5xx status. **Default:
  \`"true"\`** — HTTP errors abort the workflow so the failure surfaces to the
  chat AI, the user, and the "Open workflow" recovery UI. Set \`"false"\`
  ONLY when the workflow **explicitly branches on \`saveStatus\`** (e.g. an
  \`if\` node checking \`{{status}} >= 400\`) and the downstream path
  legitimately handles the error case — not just to "not crash".

Form-data example with file upload:
\`\`\`yaml
- id: upload
  type: http
  url: "https://api.example.com/upload"
  method: POST
  contentType: form-data
  body: '{"file:image.png": "{{imageData}}", "description": "My image"}'
  saveTo: uploadResult
\`\`\`

${mcpSection}
#### rag-sync
Sync a Drive file to a Gemini RAG (File Search) store.
- **path** (required): File path on Drive
- **ragSetting** (required): RAG setting name${ragSyncSection}
- **saveTo** (optional): Variable for result JSON: \`{path, ragSetting, fileId, storeName, mode, syncedAt}\`

### Data Processing

#### json
Parse a JSON string into an object/array for property access in templates.
- **source** (required): The **variable name** holding the JSON string — NOT an interpolated expression, NOT wrapped in quotes, NOT with \`{{...}}\`. Just the bare name.
- **saveTo** (required): Variable for the parsed object

After parsing, access nested values with template syntax such as \`{{data.items[0].name}}\`.

✅ Correct:
\`\`\`yaml
- id: parse-result
  type: json
  source: apiResponseBody     # just the variable name
  saveTo: parsed
\`\`\`

❌ Wrong:
\`\`\`yaml
- id: parse-result
  type: json
  source: "{{apiResponseBody}}"       # WRONG — no interpolation here
  source: "[{{apiResponseBody}}]"     # WRONG — you'll corrupt valid JSON by wrapping it
  saveTo: parsed
\`\`\`

#### script
Execute JavaScript code in a sandboxed environment (no DOM, network, or storage access). Useful for string manipulation, data transformation, calculations, and encoding/decoding that the set node cannot handle.
- **code** (required): JavaScript code. \`{{variable}}\` is substituted as plain text BEFORE the code runs. Use \`return\` to return a value. Non-string return values are JSON-serialized.
- **saveTo** (optional): Variable for the result
- **timeout** (optional): Timeout in milliseconds (default: 10000)

##### Runtime — what's available inside \`code\`

The script runs in one of two sandboxes depending on context: an \`isolated-vm\` V8 isolate on the server (hubwork web/api workflows, scheduled workflows) and a sandboxed iframe on the client (chat-invoked workflows, in-IDE execution). Both sandboxes expose the **same minimal API surface** so a script written for one runs unchanged in the other.

**Available (use freely):**
- Full ECMAScript standard library — \`Date\`, \`JSON\`, \`Math\`, \`RegExp\`, \`Map\`, \`Set\`, \`Promise\`, \`Array\`, \`String\`, \`Number\`, etc.
- \`Intl.DateTimeFormat\`, \`Intl.NumberFormat\`, \`Intl.Collator\`, \`Date.prototype.toLocaleString\` — locale-aware formatting.
- \`utils\` — GemiHub helper namespace injected into both runtimes. Use these instead of runtime-specific globals (\`crypto.*\`, Node \`require\`, etc.) so the same script works everywhere.
  - \`utils.randomUUID()\` — returns an RFC 4122 v4 UUID string. Use for row IDs, event IDs, idempotency keys. **Prefer this over \`Math.random()\`-based IDs** — it's collision-safe and identical on client/server.

**NOT available** — referencing any of these throws \`ReferenceError\`: \`crypto\` (use \`utils.randomUUID()\` instead), \`fetch\` / \`XMLHttpRequest\` (use an \`http\` node), \`setTimeout\` / \`setInterval\` beyond node completion, \`window\` / \`document\` / DOM, \`localStorage\` / \`IndexedDB\`, \`process\` / \`require\` / \`import()\`.

Typical pattern (the skill-generated \`prepare\` script):
\`\`\`yaml
- id: prepare
  type: script
  saveTo: prepared
  code: |
    const name = "{{request.body.name:json}}";
    const start = "{{request.body.start:json}}";
    return {
      id: utils.randomUUID(),
      now: new Date().toISOString(),
      title: name + " - Meeting",
      displayRange: new Date(start).toLocaleString("en-US", {
        dateStyle: "long", timeStyle: "short", timeZone: "UTC",
      }),
    };
\`\`\`

### Variable interpolation in script code — READ CAREFULLY

The substitution is a plain text replace. Pay attention to what makes valid JavaScript AFTER substitution.

- If the variable is a **plain string** and you want it as a JS string, wrap in quotes with \`:json\`:
\`\`\`yaml
code: |
  var text = "{{userInput:json}}";      # becomes: var text = "hello \\"world\\"";
\`\`\`

- If the variable is a **JSON string that you want to parse**, wrap in quotes with \`:json\` and pass to \`JSON.parse\`:
\`\`\`yaml
code: |
  var data = JSON.parse("{{jsonStr:json}}");  # becomes: JSON.parse("[{\\"url\\":\\"...\\"}]")
\`\`\`

- If the variable is a **JSON string that should land as a bare JS literal** (array / object from \`calendar-list\`, \`sheet-read\`, a prior \`script\`, etc.) use \`{{var}}\` — NO \`:json\`, NO surrounding quotes. GemiHub stores every variable as a JSON-serialized string, and JSON is a valid JS literal, so raw interpolation works:
\`\`\`yaml
code: |
  const events = {{events}} || [];      # becomes: const events = [{"id":"abc","start":"..."}] || [];
  events.forEach(e => { /* ... */ });
\`\`\`
This is the idiomatic pattern for iterating arrays returned by \`calendar-list\`, \`sheet-read\`, etc. \`{{events:json}}\` without surrounding quotes escapes the double-quotes into \`\\"\` and produces invalid JS — always pair \`:json\` with \`"..."\`.

❌ Common mistakes:
\`\`\`yaml
code: |
  var text = {{userInput:json}};        # WRONG — missing quotes, invalid JS
  JSON.parse({{jsonStr:json}});         # WRONG — JSON.parse needs a string, you removed the quotes
  const events = {{events:json}} || []; # WRONG — :json escapes " to \\"; use {{events}} bare, or JSON.parse("{{events:json}}")
  var html = '{{content}}';             # RISKY — breaks if content contains a single quote or newline; prefer "{{content:json}}"
\`\`\`

Example — split and sort a comma-separated list:
\`\`\`yaml
- id: sort-items
  type: script
  code: |
    var items = "{{rawList:json}}".split(',').map(function(s){ return s.trim(); });
    items.sort();
    return items.join('\\n');
  saveTo: sortedList
\`\`\`

Example — Base64 encode:
\`\`\`yaml
- id: encode
  type: script
  code: return btoa("{{plainText:json}}")
  saveTo: encoded
\`\`\`

### GemiHub Commands

#### gemihub-command
Execute GemiHub file operations (encrypt, publish, rename, etc.).
- **command** (required): Command name: "encrypt", "publish", "unpublish", "duplicate", "convert-to-pdf", "convert-to-html", "rename"
- **path** (required): File path, Drive file ID, or \`{{variable}}\`
- **text** (optional): Additional text argument (e.g., new name for "rename", custom name for "duplicate")
- **saveTo** (optional): Variable for result

Command results:
- encrypt → new file name (with .encrypted suffix)
- publish → public URL
- unpublish → "ok"
- duplicate → new file name
- convert-to-pdf → PDF file name (saved to temporaries/)
- convert-to-html → HTML file name (saved to temporaries/)
- rename → new file name

${hubworkSection}### Integration

#### workflow
Execute sub-workflow.
- **path** (required): Workflow file name
- **name** (optional): Workflow name
- **input** (optional): JSON mapping of parent→child variables
- **output** (optional): JSON mapping of child→parent variables
- **prefix** (optional): Prefix for imported variables

## Control Flow

### Sequential Flow
Nodes execute in the order listed. Use **next** to jump to a specific node:
\`\`\`yaml
- id: step1
  type: command
  prompt: "First step"
  saveTo: result1
  next: step3
- id: step2
  type: command
  prompt: "Skipped"
  saveTo: result2
- id: step3
  type: command
  prompt: "Jumped here from step1"
  saveTo: result3
\`\`\`

### Back-Reference Rule
The \`next\` property can only reference earlier nodes if the target is a **while** node.
- Valid: \`next: loop\` (where loop is a while node defined earlier)
- Invalid: \`next: step1\` (where step1 is a non-while node defined earlier)

### Termination
Use "end" to explicitly terminate a branch: \`next: end\`

## Complete Loop Example
\`\`\`yaml
name: process-all-files
nodes:
  - id: init-index
    type: variable
    name: "index"
    value: "0"
  - id: list-files
    type: drive-list
    saveTo: "fileList"
  - id: loop
    type: while
    condition: "{{index}} < {{fileList.count}}"
    trueNext: read-file
    falseNext: finish
  - id: read-file
    type: drive-read
    path: "{{fileList.notes[index].name}}"
    saveTo: "content"
  - id: process
    type: command
    prompt: "Summarize: {{content}}"
    saveTo: "result"
  - id: increment
    type: set
    name: "index"
    value: "{{index}} + 1"
    next: loop
  - id: finish
    type: dialog
    title: "Done"
    message: "Processed {{index}} files"
\`\`\`

Loop key points:
- Use \`{{fileList.notes[index].name}}\` to access array items by variable index
- Use \`{{fileList.count}}\` for loop condition
- Increment with set node and \`next: <while-node-id>\` to return to loop

## Best Practices
1. Use descriptive node IDs (e.g., "fetch-data", "check-status" rather than "node-1", "node-2")
2. Initialize variables before use
3. Use dialog for confirmations and user feedback
4. Always specify saveTo for output nodes
5. One task per command node — break complex tasks into multiple command nodes
6. Use set node for counter operations in loops
7. Use json node to parse structured API responses before accessing properties
8. Use drive-file-picker when the user needs to choose a file interactively
9. Use prompt-value for simple text input, prompt-selection for longer text, prompt-file when you need file content
10. When building JSON payloads with user content, use \`{{variable:json}}\` to safely escape strings
11. **Use comment field**: Add a \`comment\` property to nodes to describe their purpose. This is displayed in the sidebar for readability. Example: \`comment: "Fetch latest articles from RSS feed"\`
12. **Let HTTP failures surface.** \`http\` nodes throw on 4xx/5xx **by default** — don't override this unless you genuinely handle the error downstream. A workflow that silently continues on HTTP errors (\`throwOnError: "false"\` without a handler, or \`script\` nodes that read \`saveStatus\` and return "error" strings) looks like a success to the chat AI and the runtime, hides the failure from the user, and blocks the "Open workflow" recovery UI. Reserve \`throwOnError: "false"\` for the case where the workflow has a real error-handling branch (e.g. an \`if\` node reading \`saveStatus\` and taking a different path on failure). Example:
    \`\`\`yaml
    # ✅ Default: HTTP errors abort the workflow
    - id: fetch
      type: http
      url: "{{url}}"
      saveTo: body
      saveStatus: status

    # ✅ Acceptable: explicit error-handling branch
    - id: fetch
      type: http
      url: "{{url}}"
      throwOnError: "false"
      saveTo: body
      saveStatus: status
    - id: check-status
      type: if
      condition: "{{status}} >= 400"
      trueNext: handle-error    # real branch that does something useful

    # ❌ Anti-pattern: swallows every HTTP failure
    - id: fetch
      type: http
      url: "{{url}}"
      throwOnError: "false"   # workflow "succeeds" even on 503, no handler
      saveTo: body
    \`\`\`

## How workflow output reaches the user

When a workflow is invoked by a skill (via the \`run_skill_workflow\` tool), the
runtime **automatically returns every variable whose name does NOT start with
\`_\`** back to the chat AI. The chat AI then decides how to present those
values to the user, guided by the SKILL.md instructions.

- You do NOT need to add a final \`command\` node just to "output" a variable.
  The chat-side AI already receives it.
- A \`command\` node runs a separate LLM call **inside** the workflow; its
  output gets saved to a variable — it does not bypass the chat AI to write
  directly to the chat.
- If the user wants a specific variable (e.g. \`ogpMarkdown\`) rendered verbatim
  in the chat reply, write that requirement into the SKILL.md instructions
  body: _"After the workflow completes, output the value of \`ogpMarkdown\` to
  the user verbatim."_ The instructions steer the chat AI's behavior.
- For plain workflows triggered from the Workflow panel (not via a skill),
  variables are not surfaced to the chat — in that case use UI-producing
  nodes such as \`dialog\`, or file-writing nodes like \`drive-save\`, for
  visible results.
`;
}

function buildModelList(models: ModelInfo[]): string {
  if (models.length === 0) return "";
  const list = models
    .map((m) => {
      const tag = m.isImageModel ? " (image generation)" : "";
      return `  - \`${m.name}\` — ${m.description}${tag}`;
    })
    .join("\n");
  return `\n  Available models:\n${list}`;
}

function buildMcpSection(mcpServers?: McpServerConfig[]): string {
  const enabled = mcpServers ?? [];
  if (enabled.length === 0) {
    return `#### mcp
Call MCP server tool via HTTP (Streamable HTTP transport).
- **url** (required): MCP server endpoint URL
- **tool** (required): Tool name
- **args** (optional): JSON arguments
- **headers** (optional): JSON headers for authentication
- **saveTo** (optional): Variable for result text
- **saveUiTo** (optional): Variable for UI resource data (if server returns _meta.ui.resourceUri)

`;
  }

  const serverSections = enabled
    .map((s) => {
      let section = `  - \`${s.url}\` — ${s.name}`;
      if (s.tools?.length) {
        const toolList = s.tools
          .map((tool) => {
            let line = `      - **${tool.name}**`;
            if (tool.description) line += `: ${tool.description}`;
            if (tool.inputSchema) {
              const schema = tool.inputSchema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
              if (schema.properties) {
                const paramLines = Object.entries(schema.properties)
                  .map(([k, v]) => {
                    const req = schema.required?.includes(k) ? " (required)" : "";
                    let paramLine = `          - **${k}**: ${v.type || "string"}${req}`;
                    if (v.description) paramLine += ` — ${v.description}`;
                    return paramLine;
                  });
                if (paramLines.length > 0) {
                  line += `\n        args:\n${paramLines.join("\n")}`;
                }
              }
            }
            return line;
          })
          .join("\n");
        section += `\n    Tools:\n${toolList}`;
      }
      return section;
    })
    .join("\n");

  return `#### mcp
Call MCP server tool via HTTP (Streamable HTTP transport).
- **url** (required): MCP server endpoint URL
- **tool** (required): Tool name
- **args** (optional): JSON arguments
- **headers** (optional): JSON headers for authentication
- **saveTo** (optional): Variable for result text
- **saveUiTo** (optional): Variable for UI resource data (if server returns _meta.ui.resourceUri)

Example:
\`\`\`yaml
- id: call-tool
  type: mcp
  url: "http://localhost:3001"
  tool: "search_documents"
  args: '{"query": "{{searchQuery:json}}"}'
  saveTo: searchResults
\`\`\`

Available MCP servers:
${serverSections}

`;
}

function buildMcpServerList(mcpServers?: McpServerConfig[]): string {
  const enabled = mcpServers ?? [];
  if (enabled.length === 0) return "";
  const ids = enabled
    .map((s) => `\`${s.id || s.name}\` (${s.name})`)
    .join(", ");
  return `\n  Available: ${ids}`;
}

function buildCommandRagSection(ragSettingNames?: string[]): string {
  if (!ragSettingNames || ragSettingNames.length === 0) return "";
  const names = ragSettingNames.map((n) => `\`${n}\``).join(", ");
  return `\n  Available RAG settings: ${names}`;
}

function buildRagSyncSection(ragSettingNames?: string[]): string {
  if (!ragSettingNames || ragSettingNames.length === 0) return "";
  const names = ragSettingNames.map((n) => `\`${n}\``).join(", ");
  return `\n  Available: ${names}`;
}

/**
 * Return workflow spec content. If `nodeTypes` is empty/undefined, returns the
 * full spec. Otherwise extracts just the `#### nodeType` sections requested.
 */
export function getWorkflowNodeSpec(
  nodeTypes: string[] | undefined,
  context?: WorkflowSpecContext,
): string {
  const fullSpec = getWorkflowSpecification(context);
  if (!nodeTypes || nodeTypes.length === 0) return fullSpec;
  // Split spec into sections keyed by `#### nodeName` heading.
  const sectionMap = new Map<string, string>();
  const headerRe = /^#### (\S+)[^\n]*$/gm;
  const headers: { name: string; start: number; bodyStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(fullSpec)) !== null) {
    headers.push({ name: m[1], start: m.index, bodyStart: m.index + m[0].length });
  }
  // Boundary: next `^#### ` OR next `^### ` / `^## ` (a higher-level heading) OR end.
  const boundaryRe = /^#{2,4} /gm;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    boundaryRe.lastIndex = h.bodyStart;
    let end = fullSpec.length;
    let bm: RegExpExecArray | null;
    while ((bm = boundaryRe.exec(fullSpec)) !== null) {
      if (bm.index > h.bodyStart) {
        end = bm.index;
        break;
      }
    }
    sectionMap.set(h.name, fullSpec.slice(h.start, end).replace(/\s+$/, ""));
  }

  const sections: string[] = [];
  for (const raw of nodeTypes) {
    const nodeType = raw.trim();
    if (!nodeType) continue;
    const found = sectionMap.get(nodeType);
    if (found) {
      sections.push(found);
    } else {
      sections.push(`#### ${nodeType}\n(unknown node type — verify the name in the workflow spec)`);
    }
  }
  return sections.join("\n\n");
}

function buildHubworkSection(apiPlan: ApiPlan): string {
  if (apiPlan !== "paid") return "";
  return `### HTTP Workflow Trigger (paid plan only)

Workflows under \`web/api/*.yaml\` are exposed as HTTP endpoints. They use a top-level \`trigger:\` block and receive caller input through \`request.*\` variables.

#### trigger
Top-level workflow block declaring the HTTP endpoint behavior. NOT a node — appears at the workflow root, not under \`nodes:\`.
- **requireAuth** (optional): Account type the caller must be authenticated as (e.g. \`accounts\`, \`members\`). Caller invokes \`gemihub.auth.require("<type>")\` first. When set, \`auth.email\`, \`auth.type\`, and \`currentUser.*\` become available.
- **idempotencyKeyField** (optional, POST only): Body field used to dedup repeat submissions.
- **honeypotField** (optional, POST only): Body field that should always be empty; non-empty submissions are silently treated as success.
- **successRedirect** (optional, POST only): URL to 302 to after success (form submissions).
- **errorRedirect** (optional, POST only): URL to 302 to after failure.

Example:
\`\`\`yaml
trigger:
  requireAuth: accounts
nodes:
  - id: get-cal
    type: calendar-list
    timeMin: "{{request.query.timeMin}}"
    timeMax: "{{request.query.timeMax}}"
    saveTo: events
  - id: respond
    type: set
    name: __response
    value: "{{events}}"
\`\`\`

### Request Input Variables (paid plan only, populated by the HTTP trigger)

These variables are auto-populated for workflows reached via HTTP. **The \`request.\` prefix is mandatory** — bare \`{{query.X}}\` or \`{{body.X}}\` will silently resolve to empty string and break downstream nodes.

- \`{{request.method}}\` — "GET", "POST", etc.
- \`{{request.query.<name>}}\` — URL query parameter (use this for **GET** endpoints called via \`gemihub.get("path?key=v")\` or \`gemihub.get("path", {key: "v"})\`)
- \`{{request.body.<name>}}\` — JSON body field or form field (use this for **POST** endpoints called via \`gemihub.post("path", {key: "v"})\`)
- \`{{request.params.<name>}}\` — URL path parameter (rare)
- For file uploads, additionally: \`{{request.body.<name>_name}}\`, \`{{request.body.<name>_type}}\`, \`{{request.body.<name>_size}}\` (the value itself is base64)
- \`{{auth.email}}\`, \`{{auth.type}}\`, \`{{currentUser}}\` — only when \`requireAuth\` is set and the caller is authenticated. \`currentUser\` is a JSON string; access fields like \`{{currentUser}}\` then parse, or rely on the unwrapped variable if the workflow already \`set\`s it.

### Response Variables (paid plan only)

Set these at the end of the workflow to control the HTTP response. Both are optional.
- \`__response\` — Response body. Set to \`"{{var}}"\` (no \`:json\` modifier) — \`{{var}}\` already serializes objects/arrays to a JSON string, which the handler parses and returns. If unset, the endpoint returns \`{}\`.
- \`__statusCode\` — HTTP status code (default 200). Set to a number string like \`"404"\`.
- \`__redirect\` (POST body field, not workflow variable) — overrides \`successRedirect\` per-request.

### Common HTTP Workflow Mistakes
1. **Missing \`request.\` prefix** — \`{{query.X}}\` is wrong; use \`{{request.query.X}}\`. Same for \`request.body.*\`, \`request.params.*\`.
2. **Wrong method namespace** — GET endpoints must read \`request.query.*\`; POST endpoints must read \`request.body.*\`. Reading the wrong one returns empty.
3. **Forgetting \`__response\`** — If you don't set \`__response\`, the endpoint returns \`{}\` regardless of what the workflow computed.
4. **Using \`{{var:json}}\` for \`__response\`** — Always \`value: "{{var}}"\`, never \`"{{var:json}}"\`. \`{{var}}\` already produces a JSON string from an object/array, and the handler calls \`JSON.parse\` on it. \`:json\` escapes that string a second time, yielding invalid JSON — the parse fails, the raw escaped string is returned, and the client sees a double-stringified value. \`:json\` is only for embedding inside a JSON string literal (e.g. \`value: '{"msg": "{{text:json}}"}'\`).

### Hubwork (Sheets/Gmail/Calendar — paid plan only)

The nodes below require the paid plan with Hubwork enabled and the corresponding Google API permissions granted. They will fail at runtime on the free plan.

#### sheet-read
Read rows from a Google Sheets sheet.
- **sheet** (required): Sheet name (tab name)
- **filter** (optional): JSON filter like \`{"status": "active"}\` or simple \`column == value\`
- **limit** (optional): Max rows to return
- **saveTo** (required): Variable for result (JSON array of objects)

#### sheet-write
Append rows to a Google Sheets sheet.
- **sheet** (required): Sheet name
- **data** (required): **Single-quoted JSON string** that parses to an array of objects (or a single object) matching sheet headers. The handler runs \`JSON.parse\` on the raw value — a YAML mapping crashes at runtime.
  \`\`\`yaml
  # ✅ Correct: JSON string inside single quotes
  data: '[{"id": "{{prepared.id}}", "email": "{{auth.email}}", "created_at": "{{prepared.now}}"}]'

  # ❌ Wrong: YAML mapping (template engine can't interpolate into a non-string value)
  data:
    id: "{{prepared.id}}"
    email: "{{auth.email}}"
  \`\`\`

#### sheet-update
Update rows matching a filter.
- **sheet** (required): Sheet name
- **filter** (required): Single-quoted JSON string to match rows (e.g. \`filter: '{"id": "{{id}}"}'\`)
- **data** (required): Single-quoted JSON string with columns to update (e.g. \`data: '{"status": "done"}'\`). Same YAML-mapping caveat as \`sheet-write\`.
- **saveTo** (optional): Variable for updated row count

#### sheet-delete
Delete rows matching a filter.
- **sheet** (required): Sheet name
- **filter** (required): Single-quoted JSON string to match rows (e.g. \`filter: '{"id": "{{id}}"}'\`)
- **saveTo** (optional): Variable for deleted row count

#### gmail-send
Send an email via Gmail API.
- **to** (required): Recipient email address
- **subject** (required): Email subject
- **body** (optional): HTML email body. Format dates/timestamps in a \`script\` node first and reference \`{{<saveTo>.displayField}}\` — NEVER embed raw \`{{request.body.start}}\` ISO values (\`2025-04-02T10:30:00.000Z\`) directly, because the recipient sees a machine timestamp.
- **saveTo** (optional): Variable for message ID

#### calendar-list
List events from Google Calendar.
- **calendarId** (optional): Calendar ID (default: "primary")
- **timeMin** (optional): RFC3339 lower bound (e.g. "2026-04-14T00:00:00Z")
- **timeMax** (optional): RFC3339 upper bound
- **maxResults** (optional): Max events to return (default: 50, capped at 250)
- **query** (optional): Free-text search query
- **saveTo** (required): Variable for result (JSON array of \`{id, summary, description, start, end, location, status, htmlLink}\`)

#### calendar-create
Create a new event on Google Calendar.
- **calendarId** (optional): Calendar ID (default: "primary")
- **summary** (required): Event title
- **start** (required): Start time — RFC3339 dateTime, or \`YYYY-MM-DD\` for an all-day event
- **end** (required): End time — same format as start
- **description** (optional): Event description
- **location** (optional): Event location
- **saveTo** (optional): Variable for the created event ID

#### calendar-update
Update an existing event. Only fields you provide are patched.
- **calendarId** (optional): Calendar ID (default: "primary")
- **eventId** (required): Event ID to update
- **summary** (optional): New title
- **description** (optional): New description
- **start** (optional): New start (RFC3339 or \`YYYY-MM-DD\` for all-day)
- **end** (optional): New end (same format as start)
- **location** (optional): New location
- **saveTo** (optional): Variable for the updated event ID

#### calendar-delete
Delete an event from Google Calendar.
- **calendarId** (optional): Calendar ID (default: "primary")
- **eventId** (required): Event ID to delete

`;
}

/**
 * Build the user prompt for workflow generation based on mode and parameters.
 * Shared by ai-generate (Gemini streaming) and ai-prompt (external LLM copy).
 */
export function buildWorkflowUserPrompt({
  mode,
  name,
  description,
  currentYaml,
  existingInstructions,
  workflowFilePath,
  executionSteps,
  outputAsMarkdown,
  skillMode,
  skillFolderName,
}: {
  mode: "create" | "modify";
  name?: string;
  description: string;
  currentYaml?: string;
  existingInstructions?: string;
  /** For Modify Skill with AI: actual path of the referenced workflow file
   *  relative to the skill folder (e.g., "workflows/run-lint.yaml"). Used to
   *  preserve the correct frontmatter reference instead of inventing one
   *  from the skill name. */
  workflowFilePath?: string;
  executionSteps?: import("./types").ExecutionStep[];
  outputAsMarkdown?: boolean;
  skillMode?: boolean;
  skillFolderName?: string;
}): string {
  if (mode === "modify" && skillMode && currentYaml) {
    let executionContext = "";
    if (executionSteps && executionSteps.length > 0) {
      executionContext = "\n\nEXECUTION HISTORY (selected steps):\n";
      executionSteps.forEach((step, i) => {
        executionContext += `\nStep ${i + 1} [${step.nodeType}] ${step.nodeId}\n`;
        if (step.input) {
          const inputStr = typeof step.input === "string"
            ? step.input
            : JSON.stringify(step.input, null, 2);
          executionContext += `  Input: ${inputStr}\n`;
        }
        if (step.error) {
          executionContext += `  Error: ${step.error}\n`;
        } else if (step.output !== undefined) {
          const outputStr = typeof step.output === "string"
            ? step.output
            : JSON.stringify(step.output, null, 2);
          executionContext += `  Output: ${outputStr}\n`;
        }
        executionContext += `  Status: ${step.status}\n`;
      });
    }
    // Use the caller-supplied workflow path when available (it's the actual
    // path in the skill folder). Only fall back to skill-name-based invention
    // when the caller didn't tell us — this happens for create-skill flows.
    const workflowRefPath = workflowFilePath
      ?? `workflows/${name?.endsWith(".yaml") ? name : `${name || "workflow"}.yaml`}`;
    const instructionsSection = existingInstructions
      ? `Here is the current SKILL.md instructions body:\n\n${existingInstructions}\n\n`
      : "";
    return `Here is the current workflow YAML:\n\n\`\`\`yaml\n${currentYaml}\n\`\`\`\n\n${instructionsSection}${executionContext}\nPlease modify this skill according to the following request:\n${description}\n\nOutput the updated SKILL.md instructions body first as raw markdown text, then a line containing only "===WORKFLOW===", then the COMPLETE modified workflow YAML inside a \`\`\`yaml code block.\nThe workflow file reference is "${workflowRefPath}". Output only the instructions body; the runtime handles frontmatter and the \`\`\`skill-capabilities fenced block for you.`;
  }
  if (mode === "modify" && currentYaml) {
    let executionContext = "";
    if (executionSteps && executionSteps.length > 0) {
      executionContext = "\n\nEXECUTION HISTORY (selected steps):\n";
      executionSteps.forEach((step, i) => {
        executionContext += `\nStep ${i + 1} [${step.nodeType}] ${step.nodeId}\n`;
        if (step.input) {
          const inputStr = typeof step.input === "string"
            ? step.input
            : JSON.stringify(step.input, null, 2);
          executionContext += `  Input: ${inputStr}\n`;
        }
        if (step.error) {
          executionContext += `  Error: ${step.error}\n`;
        } else if (step.output !== undefined) {
          const outputStr = typeof step.output === "string"
            ? step.output
            : JSON.stringify(step.output, null, 2);
          executionContext += `  Output: ${outputStr}\n`;
        }
        executionContext += `  Status: ${step.status}\n`;
      });
    }
    const outputInstruction = outputAsMarkdown
      ? "Output the COMPLETE modified workflow YAML inside a ```yaml code block."
      : "Output the COMPLETE modified workflow YAML. Do not omit any nodes.";
    return `Here is the current workflow YAML:\n\n\`\`\`yaml\n${currentYaml}\n\`\`\`${executionContext}\n\nPlease modify this workflow according to the following request:\n${description}\n\n${outputInstruction}`;
  }
  if (skillMode && name) {
    const folderInfo = skillFolderName ? ` in the skill folder "${skillFolderName}"` : "";
    return `Create a skill${folderInfo} with a workflow named "${name}".\n\nGenerate both a SKILL.md (with appropriate name, description, workflow reference to "workflows/${name.endsWith(".yaml") ? name : name + ".yaml"}", and AI agent instructions) and the workflow YAML.\n\n${description}`;
  }
  return name
    ? `Create a workflow named "${name}".\n\n${description}`
    : description;
}
