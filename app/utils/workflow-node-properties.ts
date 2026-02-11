import type { WorkflowNodeType } from "~/engine/types";
import { AVAILABLE_MODELS } from "~/types/settings";

const ALL_MODEL_OPTIONS = AVAILABLE_MODELS.map((m) => m.name);

export interface NodePropertyDef {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  multiline?: boolean;
  options?: string[];
  defaultValue?: string;
}

export interface NodePropertyContext {
  ragSettingNames?: string[];
  mcpServerNames?: string[];
}

export function getNodePropertyDefs(type: WorkflowNodeType, context?: NodePropertyContext): NodePropertyDef[] {
  switch (type) {
    case "variable":
      return [
        { key: "name", label: "Name", required: true, placeholder: "myVar" },
        { key: "value", label: "Value", required: false, placeholder: "hello" },
      ];
    case "set":
      return [
        { key: "name", label: "Name", required: true, placeholder: "myVar" },
        { key: "value", label: "Value", required: true, placeholder: "{{result}}" },
      ];
    case "if":
      return [
        { key: "condition", label: "Condition", required: true, placeholder: "{{x}} > 10" },
      ];
    case "while":
      return [
        { key: "condition", label: "Condition", required: true, placeholder: "{{count}} < 5" },
      ];
    case "command":
      return [
        { key: "prompt", label: "Prompt", required: true, multiline: true, placeholder: "Summarize the following text: {{input}}" },
        { key: "model", label: "Model", required: false, options: ALL_MODEL_OPTIONS },
        { key: "ragSetting", label: "RAG / Search", required: false, options: ["__none__", "__websearch__", ...(context?.ragSettingNames || [])], defaultValue: "__none__" },
        { key: "driveToolMode", label: "Drive Tools", required: false, options: ["none", "all", "noSearch"], defaultValue: "none" },
        { key: "mcpServers", label: "MCP Servers", required: false, placeholder: context?.mcpServerNames?.length ? context.mcpServerNames.join(", ") : "server1,server2" },
        { key: "attachments", label: "Attachments", required: false, placeholder: "imageVar,fileVar" },
        { key: "saveTo", label: "Save To", required: false, placeholder: "result" },
        { key: "saveImageTo", label: "Save Image To", required: false, placeholder: "generatedImage" },
        { key: "systemPrompt", label: "System Prompt", required: false, multiline: true },
      ];
    case "http":
      return [
        { key: "url", label: "URL", required: true, placeholder: "https://api.example.com" },
        { key: "method", label: "Method", required: false, options: ["GET", "POST", "PUT", "PATCH", "DELETE"], defaultValue: "GET" },
        { key: "contentType", label: "Content Type", required: false, options: ["json", "text", "form-data", "binary"], defaultValue: "json" },
        { key: "headers", label: "Headers", required: false, multiline: true, placeholder: '{"Authorization": "Bearer ..."}' },
        { key: "body", label: "Body", required: false, multiline: true },
        { key: "saveTo", label: "Save To", required: false, placeholder: "response" },
        { key: "saveStatus", label: "Save Status To", required: false, placeholder: "statusCode" },
        { key: "throwOnError", label: "Throw On Error", required: false, options: ["false", "true"], defaultValue: "false" },
      ];
    case "json":
      return [
        { key: "source", label: "Source", required: true, placeholder: "{{data}}" },
        { key: "saveTo", label: "Save To", required: true, placeholder: "extracted" },
      ];
    case "drive-file":
      return [
        { key: "path", label: "Path", required: true, placeholder: "notes/output.md" },
        { key: "content", label: "Content", required: false, multiline: true, placeholder: "{{result}}" },
        { key: "mode", label: "Mode", required: false, options: ["create", "append", "overwrite"], defaultValue: "overwrite" },
        { key: "confirm", label: "Confirm", required: false, options: ["true", "false"], defaultValue: "true" },
        { key: "history", label: "History", required: false, options: ["false", "true"], defaultValue: "false" },
        { key: "open", label: "Open after run", required: false, options: ["false", "true"], defaultValue: "false" },
      ];
    case "drive-read":
      return [
        { key: "path", label: "Path", required: true, placeholder: "notes/input.md" },
        { key: "saveTo", label: "Save To", required: true, placeholder: "fileContent" },
      ];
    case "drive-search":
      return [
        { key: "query", label: "Query", required: true, placeholder: "search keywords" },
        { key: "searchContent", label: "Search Content", required: false, options: ["false", "true"], defaultValue: "false" },
        { key: "limit", label: "Limit", required: false, placeholder: "10" },
        { key: "saveTo", label: "Save To", required: true, placeholder: "results" },
      ];
    case "drive-list":
      return [
        { key: "folder", label: "Folder", required: false, placeholder: "notes/" },
        { key: "limit", label: "Limit", required: false, placeholder: "50" },
        { key: "sortBy", label: "Sort By", required: false, options: ["modified", "created", "name"], defaultValue: "modified" },
        { key: "sortOrder", label: "Sort Order", required: false, options: ["desc", "asc"], defaultValue: "desc" },
        { key: "modifiedWithin", label: "Modified Within", required: false, placeholder: "7d" },
        { key: "createdWithin", label: "Created Within", required: false, placeholder: "30d" },
        { key: "saveTo", label: "Save To", required: true, placeholder: "files" },
      ];
    case "drive-folder-list":
      return [
        { key: "folder", label: "Folder", required: false, placeholder: "/" },
        { key: "saveTo", label: "Save To", required: true, placeholder: "folders" },
      ];
    case "drive-file-picker":
      return [
        { key: "title", label: "Title", required: false, placeholder: "Select a file" },
        { key: "mode", label: "Mode", required: false, options: ["select", "create"], defaultValue: "select" },
        { key: "default", label: "Default", required: false, placeholder: "path/to/file.md" },
        { key: "extensions", label: "Extensions", required: false, placeholder: "md,txt,yaml" },
        { key: "saveTo", label: "Save To", required: false, placeholder: "selectedFile" },
        { key: "savePathTo", label: "Save Path To", required: false, placeholder: "filePath" },
      ];
    case "drive-save":
      return [
        { key: "source", label: "Source", required: true, placeholder: "{{content}}" },
        { key: "path", label: "Path", required: true, placeholder: "output/result.md" },
        { key: "savePathTo", label: "Save Path To", required: false, placeholder: "savedPath" },
      ];
    case "drive-delete":
      return [
        { key: "path", label: "Path", required: true, placeholder: "notes/old-file.md" },
      ];
    case "dialog":
      return [
        { key: "title", label: "Title", required: false, placeholder: "Choose an option" },
        { key: "message", label: "Message", required: false, multiline: true },
        { key: "markdown", label: "Markdown", required: false, options: ["false", "true"], defaultValue: "false" },
        { key: "options", label: "Options (comma-sep)", required: false, placeholder: "opt1,opt2,opt3" },
        { key: "multiSelect", label: "Multi Select", required: false, options: ["false", "true"], defaultValue: "false" },
        { key: "inputTitle", label: "Input Title", required: false, placeholder: "Enter text" },
        { key: "multiline", label: "Multiline Input", required: false, options: ["false", "true"], defaultValue: "false" },
        { key: "button1", label: "Button 1", required: false, placeholder: "OK" },
        { key: "button2", label: "Button 2", required: false, placeholder: "Cancel" },
        { key: "defaults", label: "Defaults (JSON)", required: false, placeholder: '{"selected": ["opt1"]}' },
        { key: "saveTo", label: "Save To", required: false, placeholder: "choice" },
      ];
    case "prompt-value":
      return [
        { key: "title", label: "Title", required: false, placeholder: "Enter a value" },
        { key: "default", label: "Default", required: false },
        { key: "multiline", label: "Multiline", required: false, options: ["false", "true"], defaultValue: "false" },
        { key: "saveTo", label: "Save To", required: true, placeholder: "userInput" },
      ];
    case "prompt-file":
      return [
        { key: "title", label: "Title", required: false, placeholder: "Select a file" },
        { key: "default", label: "Default", required: false, placeholder: "path/to/file.md" },
        { key: "saveTo", label: "Save To (content)", required: false, placeholder: "fileContent" },
        { key: "saveFileTo", label: "Save File Info To", required: false, placeholder: "fileInfo" },
      ];
    case "prompt-selection":
      return [
        { key: "title", label: "Title", required: false, placeholder: "Enter text" },
        { key: "saveTo", label: "Save To", required: true, placeholder: "selection" },
      ];
    case "workflow":
      return [
        { key: "path", label: "Path", required: false, placeholder: "sub-workflow.yaml" },
        { key: "name", label: "Name", required: false, placeholder: "Sub Workflow" },
        { key: "input", label: "Input", required: false, multiline: true, placeholder: '{"subVar": "{{parentValue}}"}' },
        { key: "output", label: "Output", required: false, multiline: true, placeholder: '{"parentVar": "subResultVar"}' },
        { key: "prefix", label: "Prefix", required: false, placeholder: "sub_" },
      ];
    case "mcp":
      return [
        { key: "url", label: "Server URL", required: true, placeholder: "http://localhost:3001" },
        { key: "tool", label: "Tool", required: true, placeholder: "tool_name" },
        { key: "args", label: "Arguments", required: false, multiline: true, placeholder: '{"key": "value"}' },
        { key: "headers", label: "Headers", required: false, multiline: true, placeholder: '{"Authorization": "Bearer ..."}' },
        { key: "saveTo", label: "Save To", required: false, placeholder: "mcpResult" },
        { key: "saveUiTo", label: "Save UI To", required: false, placeholder: "mcpUi" },
      ];
    case "rag-sync":
      return [
        { key: "path", label: "File Path", required: true, placeholder: "notes/file.md" },
        { key: "ragSetting", label: "RAG Setting", required: true, placeholder: "myRagStore", options: context?.ragSettingNames?.length ? context.ragSettingNames : undefined },
        { key: "saveTo", label: "Save To", required: false, placeholder: "syncResult" },
      ];
    case "sleep":
      return [
        { key: "duration", label: "Duration (ms)", required: true, placeholder: "1000" },
      ];
    default:
      return [];
  }
}
