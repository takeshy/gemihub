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
  const ragSection = buildRagSection(context?.ragSettingNames);

  return `
# Gemini Hub Workflow Specification

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
- JSON escape: \`{{variable:json}}\` for embedding in JSON strings
- Expression (in set node): \`{{a}} + {{b}}\`, operators: +, -, *, /, %

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
- **duration** (required): Sleep duration in milliseconds

### AI & LLM

#### command
Execute LLM prompt via Gemini API.
- **prompt** (required): Prompt template (supports {{variables}})
- **model** (optional): Model override${modelList}
- **saveTo** (optional): Variable for text response
${ragSection}
### Google Drive Operations

#### drive-file
Write/create file on Drive.
- **path** (required): File name/path (supports {{variables}})
- **content** (required): Content to write (supports {{variables}})
- **mode** (optional): overwrite (default), append, create

#### drive-read
Read file from Drive.
- **path** (required): File name or Drive file ID
- **saveTo** (required): Variable for content

#### drive-search
Search files on Drive.
- **query** (required): Search query
- **searchContent** (optional): "true"/"false" (default: "false")
- **saveTo** (required): Variable for results (JSON array)

#### drive-list
List files in folder.
- **folder** (optional): Folder name
- **limit** (optional): Max results (default: "50")
- **saveTo** (required): Variable for results

#### drive-folder-list
List folders.
- **folder** (optional): Parent folder
- **saveTo** (required): Variable for results

#### drive-file-picker
File picker dialog.
- **title** (optional): Dialog title
- **path** (optional): Direct path (skip dialog)
- **extensions** (optional): Comma-separated extensions
- **saveTo** (optional): Variable for file data
- **savePathTo** (optional): Variable for file path

#### drive-save
Save FileExplorerData to Drive.
- **source** (required): Variable containing FileExplorerData
- **path** (required): Save path
- **savePathTo** (optional): Variable for final path

#### preview
Generate preview link.
- **path** (required): File path

### User Interaction

#### dialog
Show dialog with options and optional text input.
- **title** (optional): Dialog title
- **message** (optional): Message content
- **markdown** (optional): "true"/"false"
- **options** (optional): Comma-separated options
- **multiSelect** (optional): "true"/"false"
- **inputTitle** (optional): Label for text input field
- **multiline** (optional): "true"/"false"
- **button1** (optional): Primary button text (default: "OK")
- **button2** (optional): Secondary button text
- **saveTo** (optional): Variable for result JSON

#### prompt-value
Prompt user for text input.
- **title** (optional): Dialog title
- **default** (optional): Default value
- **multiline** (optional): "true"/"false"
- **saveTo** (required): Variable for input value

### External Services

#### http
Make HTTP request.
- **url** (required): Request URL
- **method** (optional): GET, POST, PUT, DELETE, PATCH
- **contentType** (optional): "json", "form-data", "text"
- **headers** (optional): JSON headers
- **body** (optional): Request body
- **saveTo** (optional): Variable for response
- **saveStatus** (optional): Variable for status code
- **throwOnError** (optional): "true" to throw on 4xx/5xx
${mcpSection}
### Data Processing

#### json
Parse JSON string.
- **source** (required): Variable containing JSON string
- **saveTo** (required): Variable for parsed object

### Integration

#### workflow
Execute sub-workflow.
- **path** (required): Workflow file name
- **name** (optional): Workflow name
- **input** (optional): JSON mapping
- **output** (optional): JSON mapping
- **prefix** (optional): Prefix for imported variables

## Control Flow

### Sequential Flow
Nodes execute in order. Use **next** to jump:

### Back-Reference Rule
The \`next\` property can only reference earlier nodes if the target is a **while** node.

### Termination
Use "end" to explicitly terminate: \`next: end\`

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

## Best Practices
1. Use descriptive node IDs (e.g., "fetch-data", "check-status" rather than "node-1", "node-2")
2. Initialize variables before use
3. Use dialog for confirmations and user feedback
4. Always specify saveTo for output nodes
5. One task per command node — break complex tasks into multiple command nodes
6. Use set node for counter operations in loops
7. Use json node to parse structured API responses before accessing properties
`;
}

function buildModelList(models: ModelInfo[]): string {
  const nonImageModels = models.filter((m) => !m.isImageModel);
  if (nonImageModels.length === 0) return "";
  const list = nonImageModels
    .map((m) => `  - \`${m.name}\` — ${m.description}`)
    .join("\n");
  return `\n  Available models:\n${list}`;
}

function buildMcpSection(mcpServers?: McpServerConfig[]): string {
  const enabled = mcpServers?.filter((s) => s.enabled) ?? [];
  if (enabled.length === 0) {
    return `#### mcp
Call MCP server tool.
- **url** (required): MCP server endpoint URL
- **tool** (required): Tool name
- **args** (optional): JSON arguments
- **headers** (optional): JSON headers
- **saveTo** (optional): Variable for result

`;
  }

  const serverList = enabled
    .map((s) => {
      const hints = s.toolHints?.length
        ? ` (tools: ${s.toolHints.join(", ")})`
        : "";
      return `  - \`${s.url}\` — ${s.name}${hints}`;
    })
    .join("\n");

  return `#### mcp
Call MCP server tool.
- **url** (required): MCP server endpoint URL
- **tool** (required): Tool name
- **args** (optional): JSON arguments
- **headers** (optional): JSON headers
- **saveTo** (optional): Variable for result

Available MCP servers:
${serverList}

`;
}

function buildRagSection(ragSettingNames?: string[]): string {
  if (!ragSettingNames || ragSettingNames.length === 0) return "";

  const list = ragSettingNames.map((n) => `  - \`${n}\``).join("\n");
  return `
The command node also supports RAG (Retrieval-Augmented Generation):
- **ragSettingName** (optional): Name of the RAG setting to use for context-aware responses
  Available RAG settings:
${list}

`;
}
