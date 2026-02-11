import type { WorkflowNode, WorkflowNodeType } from "~/engine/types";

export function getNodeSummary(node: WorkflowNode): string {
  const p = node.properties;
  switch (node.type) {
    case "variable":
      return p.name ? `${p.name} = ${truncate(p.value || "", 40)}` : "";
    case "set":
      return p.name ? `${p.name} = ${truncate(p.value || "", 40)}` : "";
    case "if":
    case "while":
      return truncate(p.condition || "", 60);
    case "command":
      return truncate(p.prompt || "", 60);
    case "http":
      return `${(p.method || "GET").toUpperCase()} ${truncate(p.url || "", 50)}`;
    case "json":
      return p.saveTo ? `${truncate(p.source || "", 20)} → ${p.saveTo}` : "";
    case "drive-file":
      return `${truncate(p.path || "", 40)} (${p.mode || "overwrite"})`;
    case "drive-read":
      return p.path
        ? `${truncate(p.path, 30)}${p.saveTo ? ` → ${p.saveTo}` : ""}`
        : "";
    case "drive-search":
      return truncate(p.query || "", 60);
    case "drive-list":
    case "drive-folder-list":
      return truncate(p.folder || "", 60);
    case "drive-file-picker":
      return truncate(p.title || "", 60);
    case "drive-save":
      return p.path ? `${truncate(p.source || "", 20)} → ${p.path}` : "";
    case "drive-delete":
      return truncate(p.path || "", 60);
    case "dialog":
      return truncate(p.title || p.message || "", 60);
    case "prompt-value":
      return truncate(p.title || "", 60);
    case "prompt-file":
      return truncate(p.title || "", 60);
    case "prompt-selection":
      return truncate(p.title || "", 60);
    case "workflow":
      return p.path || p.name || "";
    case "mcp":
      return p.tool ? `${truncate(p.url || "", 20)}:${p.tool}` : "";
    case "rag-sync":
      return p.path ? `${truncate(p.path, 30)} → ${p.ragSetting || ""}` : "";
    case "sleep":
      return p.duration ? `${p.duration}ms` : "";
    default:
      return "";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function getNodeTypeLabel(type: WorkflowNodeType): string {
  const labels: Record<WorkflowNodeType, string> = {
    variable: "Variable",
    set: "Set",
    if: "If",
    while: "While",
    command: "LLM",
    http: "HTTP",
    json: "JSON",
    "drive-file": "Drive File",
    "drive-read": "Drive Read",
    "drive-search": "Drive Search",
    "drive-list": "Drive List",
    "drive-folder-list": "Folder List",
    "drive-file-picker": "File Picker",
    "drive-save": "Drive Save",
    "drive-delete": "Drive Delete",
    dialog: "Dialog",
    "prompt-value": "Prompt",
    "prompt-file": "File Prompt",
    "prompt-selection": "Selection",
    workflow: "Workflow",
    mcp: "MCP",
    "rag-sync": "RAG Sync",
    sleep: "Sleep",
  };
  return labels[type] || type;
}

export function getNodeTypeColor(type: WorkflowNodeType): string {
  switch (type) {
    // Control flow: blue
    case "if":
    case "while":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    // Variables: slate
    case "variable":
    case "set":
      return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
    // AI: purple
    case "command":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
    // Drive: green
    case "drive-file":
    case "drive-read":
    case "drive-search":
    case "drive-list":
    case "drive-folder-list":
    case "drive-file-picker":
    case "drive-save":
    case "drive-delete":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    // Interactive: amber
    case "dialog":
    case "prompt-value":
    case "prompt-file":
    case "prompt-selection":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300";
    // External: cyan
    case "http":
    case "json":
    case "mcp":
    case "rag-sync":
      return "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300";
    // Sub-workflow: indigo
    case "workflow":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300";
    // Misc
    case "sleep":
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  }
}
