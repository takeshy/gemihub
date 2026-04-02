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

  let formatSection: string;
  if (context?.includeSkillGeneration) {
    formatSection = `## Format
Output a single continuous text with a \`===WORKFLOW===\` separator line.
The first part is the SKILL.md content (YAML frontmatter + markdown instructions) as raw text.
The second part (after the separator) is the workflow YAML wrapped in a \`\`\`yaml code fence.

Example structure:
---
name: Skill Display Name
description: Short description of what this skill does
workflows:
  - path: workflows/<workflow-filename>.yaml
    description: What the workflow does
---

Instructions for the AI agent when this skill is active.
Describe the agent's role, behavior rules, and how to use the workflows.

===WORKFLOW===
\`\`\`yaml
name: workflow-name
nodes:
  - id: first-node
    type: variable
    ...
\`\`\`

IMPORTANT: The workflow YAML MUST be inside a \`\`\`yaml code fence to preserve indentation.`;
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
- **value** (optional): Initial value (string or number, default: empty string)

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
- **saveTo** (optional): Variable for result JSON: \`{path, ragSetting, fileId, storeName, mode, syncedAt}\`

### Data Processing

#### json
Parse JSON string into an object for property access in templates.
- **source** (required): Variable containing JSON string
- **saveTo** (required): Variable for parsed JSON object

After parsing, access nested values with template syntax such as \`{{data.items[0].name}}\`.

#### script
Execute JavaScript code in a sandboxed environment (no DOM, network, or storage access). Useful for string manipulation, data transformation, calculations, and encoding/decoding that the set node cannot handle.
- **code** (required): JavaScript code (supports {{variables}}). Use \`return\` to return a value. Non-string return values are JSON-serialized.
- **saveTo** (optional): Variable for the result
- **timeout** (optional): Timeout in milliseconds (default: 10000)

Example — split and sort a comma-separated list:
\`\`\`yaml
- id: sort-items
  type: script
  code: |
    var items = '{{rawList}}'.split(',').map(function(s){ return s.trim(); });
    items.sort();
    return items.join('\\n');
  saveTo: sortedList
\`\`\`

Example — Base64 encode:
\`\`\`yaml
- id: encode
  type: script
  code: "return btoa('{{plainText}}')"
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

### Hubwork (Sheets/Gmail — paid feature)

#### sheet-read
Read rows from a Google Sheets sheet.
- **sheet** (required): Sheet name (tab name)
- **filter** (optional): JSON filter like \`{"status": "active"}\` or simple \`column == value\`
- **limit** (optional): Max rows to return
- **saveTo** (required): Variable for result (JSON array of objects)

#### sheet-write
Append rows to a Google Sheets sheet.
- **sheet** (required): Sheet name
- **data** (required): JSON object or array of objects matching sheet headers

#### sheet-update
Update rows matching a filter.
- **sheet** (required): Sheet name
- **filter** (required): JSON filter to match rows
- **data** (required): JSON object with columns to update
- **saveTo** (optional): Variable for updated row count

#### sheet-delete
Delete rows matching a filter.
- **sheet** (required): Sheet name
- **filter** (required): JSON filter to match rows
- **saveTo** (optional): Variable for deleted row count

#### gmail-send
Send an email via Gmail API.
- **to** (required): Recipient email address
- **subject** (required): Email subject
- **body** (optional): HTML email body
- **saveTo** (optional): Variable for message ID

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
11. **Use comment field**: Add a \`comment\` property to nodes to describe their purpose. This is displayed in the sidebar for readability. Example: \`comment: "Fetch latest articles from RSS feed"\`
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
 * Build the user prompt for workflow generation based on mode and parameters.
 * Shared by ai-generate (Gemini streaming) and ai-prompt (external LLM copy).
 */
export function buildWorkflowUserPrompt({
  mode,
  name,
  description,
  currentYaml,
  executionSteps,
  outputAsMarkdown,
  skillMode,
  skillFolderName,
}: {
  mode: "create" | "modify";
  name?: string;
  description: string;
  currentYaml?: string;
  executionSteps?: import("./types").ExecutionStep[];
  outputAsMarkdown?: boolean;
  skillMode?: boolean;
  skillFolderName?: string;
}): string {
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
