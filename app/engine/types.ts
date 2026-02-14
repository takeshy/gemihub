// Workflow node types (ported from obsidian-gemini-helper, adapted for Drive)
export type WorkflowNodeType =
  | "variable"
  | "set"
  | "if"
  | "while"
  | "command"
  | "http"
  | "json"
  | "drive-file"       // was: note
  | "drive-read"       // was: note-read
  | "drive-search"     // was: note-search
  | "drive-list"       // was: note-list
  | "drive-folder-list"// was: folder-list
  | "drive-file-picker"// was: file-explorer
  | "drive-save"       // was: file-save
  | "drive-delete"     // soft delete (move to trash/)
  | "dialog"
  | "prompt-value"
  | "prompt-file"
  | "prompt-selection"
  | "workflow"
  | "mcp"
  | "rag-sync"
  | "sleep"
  | "gemihub-command";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  properties: Record<string, string>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string; // "true" or "false" for conditional nodes
}

export interface WorkflowOptions {
  showProgress?: boolean;
}

export interface Workflow {
  nodes: Map<string, WorkflowNode>;
  edges: WorkflowEdge[];
  startNode: string | null;
  options?: WorkflowOptions;
  positions?: Record<string, { x: number; y: number }>;
}

// Execution context
export interface ExecutionContext {
  variables: Map<string, string | number>;
  logs: ExecutionLog[];
  lastCommandInfo?: LastCommandInfo;
}

export interface ExecutionLog {
  nodeId: string;
  nodeType: WorkflowNodeType | "system";
  message: string;
  timestamp: Date;
  status: "info" | "success" | "error";
  input?: Record<string, unknown>;
  output?: unknown;
  mcpApps?: import("~/types/chat").McpAppInfo[];
}

export interface LastCommandInfo {
  nodeId: string;
  originalPrompt: string;
  saveTo: string;
}

// Condition evaluation
export type ComparisonOperator =
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "contains";

export interface ParsedCondition {
  left: string;
  operator: ComparisonOperator;
  right: string;
}

// Execution status types
export type ExecutionStatus = "running" | "completed" | "error" | "cancelled";

export interface ExecutionStep {
  nodeId: string;
  nodeType: WorkflowNodeType;
  timestamp: string;
  input?: Record<string, unknown>;
  output?: unknown;
  status: "success" | "error" | "skipped";
  error?: string;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowName?: string;
  startTime: string;
  endTime?: string;
  status: ExecutionStatus;
  steps: ExecutionStep[];
  isEncrypted?: boolean;
}

export interface ExecutionRecordItem {
  id: string;
  fileId: string;
  workflowId: string;
  workflowName?: string;
  startTime: string;
  endTime?: string;
  status: ExecutionStatus;
  stepCount: number;
  isEncrypted?: boolean;
}

// Workflow request (AI generation) record
export interface WorkflowRequestRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  createdAt: string;
  description: string;
  thinking: string;
  model: string;
  mode: "create" | "modify";
  history?: { role: "user" | "model"; text: string }[];
  isEncrypted?: boolean;
}

export interface WorkflowRequestRecordItem {
  id: string;
  fileId: string;
  workflowId: string;
  workflowName: string;
  createdAt: string;
  description: string;
  model: string;
  mode: "create" | "modify";
  isEncrypted?: boolean;
}

// Workflow input for execution
export interface WorkflowInput {
  variables: Map<string, string | number>;
}

// Dialog result
export interface DialogResult {
  button: string;
  selected: string[];
  input?: string;
}

// FileExplorerData (adapted for Drive)
export interface FileExplorerData {
  id?: string;     // Drive file ID
  path: string;
  basename: string;
  name: string;
  extension: string;
  mimeType: string;
  contentType: "text" | "binary";
  data: string;
}

// Prompt callbacks for interactive nodes (SSE-based)
export interface PromptCallbacks {
  promptForValue: (
    prompt: string,
    defaultValue?: string,
    multiline?: boolean
  ) => Promise<string | null>;
  promptForDialog: (
    title: string,
    message: string,
    options: string[],
    multiSelect: boolean,
    button1: string,
    button2?: string,
    markdown?: boolean,
    inputTitle?: string,
    defaults?: { input?: string; selected?: string[] },
    multiline?: boolean
  ) => Promise<DialogResult | null>;
  promptForDriveFile: (
    title: string,
    extensions?: string[]
  ) => Promise<{ id: string; name: string } | null>;
  promptForDiff?: (
    title: string,
    fileName: string,
    oldContent: string,
    newContent: string
  ) => Promise<boolean>;
  promptForPassword?: (title?: string) => Promise<string | null>;
  executeSubWorkflow?: (
    workflowPath: string,
    workflowName: string | undefined,
    inputVariables: Map<string, string | number>
  ) => Promise<Map<string, string | number>>;
}

// Service context injected into handlers (replaces Obsidian App/Plugin)
export interface ServiceContext {
  driveAccessToken: string;
  driveRootFolderId: string;
  driveHistoryFolderId: string;
  geminiApiKey?: string;
  abortSignal?: AbortSignal;
  editHistorySettings?: import("~/types/settings").EditHistorySettings;
  settings?: import("~/types/settings").UserSettings;
  onDriveFileUpdated?: (data: { fileId: string; fileName: string; content?: string }) => void;
  onDriveFileCreated?: (data: { fileId: string; fileName: string; content: string; md5Checksum: string; modifiedTime: string }) => void;
  onDriveFileDeleted?: (data: { fileId: string; fileName: string }) => void;
}
