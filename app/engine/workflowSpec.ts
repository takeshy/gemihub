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
}

export function getWorkflowSpecification(context?: WorkflowSpecContext): string {
  const models = getAvailableModels(context?.apiPlan ?? "paid");
  const modelList = buildModelList(models);
  const mcpSection = buildMcpSection(context?.mcpServers);
  const mcpServerList = buildMcpServerList(context?.mcpServers);
  const commandRagSection = buildCommandRagSection(context?.ragSettingNames);
  const ragSyncSection = buildRagSyncSection(context?.ragSettingNames);

  return `
# GemiHub Workflow Specification

## Format
Workflows are defined in YAML format. Output ONLY the YAML content starting with "name:".
Do NOT include \`\`\`yaml or \`\`\` markers.

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
- JSON escape: \`{{variable:json}}\` for embedding in JSON strings (escapes quotes, newlines, etc.)
- Expression (in set node): \`{{a}} + {{b}}\`, operators: +, -, *, /, %

Example — JSON escape usage:
\`\`\`yaml
- id: build-json
  type: set
  name: payload
  value: '{"content": "{{userInput:json}}"}'
\`\`\`

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
Initialize a variable.
- **name** (required): Variable name
- **value** (required): Initial value (string or number)

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
- **systemPrompt** (optional): System prompt override
- **attachments** (optional): Comma-separated variable names containing FileExplorerData (images, PDFs, etc.)
- **saveTo** (optional): Variable for text response
- **saveImageTo** (optional): Variable for generated image (FileExplorerData JSON) — use with image generation models

### Google Drive Operations

#### drive-file
Write/create file on Drive.
- **path** (required): File name/path (supports {{variables}})
- **content** (required): Content to write (supports {{variables}})
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
Interactive file picker dialog.
- **title** (optional): Dialog title
- **mode** (optional): "select" (default) — pick existing file; "create" — enter new path
- **default** (optional): Default path value
- **path** (optional): Direct path (skip dialog entirely)
- **extensions** (optional): Comma-separated extensions filter
- **saveTo** (optional): Variable for FileExplorerData JSON
- **savePathTo** (optional): Variable for file path string

FileExplorerData structure: \`{id, path, basename, name, extension, mimeType, contentType, data}\`

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
- **default** (optional): Default prompt text
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
- **throwOnError** (optional): "true" to throw error on 4xx/5xx status

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
- **saveTo** (optional): Variable for result JSON: \`{path, ragSetting, fileId, mode, syncedAt}\`

### Data Processing

#### json
Parse JSON string into an object for property access in templates.
- **source** (required): Variable containing JSON string
- **saveTo** (required): Variable for parsed JSON object

After parsing, access nested values with template syntax such as \`{{data.items[0].name}}\`.

### Integration

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
                const params = Object.entries(schema.properties)
                  .map(([k, v]) => {
                    const req = schema.required?.includes(k) ? " (required)" : "";
                    return `${k}: ${v.type || "string"}${req}${v.description ? " — " + v.description : ""}`;
                  })
                  .join("; ");
                if (params) line += ` | args: { ${params} }`;
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
