// Workflow to Mermaid flowchart converter
// Ported from obsidian-gemini-helper, adapted for this project's types

import type { Workflow, WorkflowNode } from "~/engine/types";

/**
 * Escape text for Mermaid labels (handle quotes and special chars)
 */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/\n/g, "<br/>")
    .replace(/[[\]{}()]/g, "");
}

/**
 * Get full label for a workflow node
 */
function getNodeLabel(node: WorkflowNode): string {
  const id = node.id;
  const p = node.properties;

  let label: string;
  switch (node.type) {
    case "variable":
    case "set":
      label = `**${id}**\n${p.name || ""} = ${p.value || ""}`;
      break;
    case "if":
    case "while":
      label = p.condition || "condition";
      break;
    case "command": {
      const prompt = p.prompt || "(no prompt)";
      const model = p.model ? `\nModel: ${p.model}` : "";
      const saveTo = p.saveTo ? `\n→ ${p.saveTo}` : "";
      label = `**${id}**\n${prompt}${model}${saveTo}`;
      break;
    }
    case "drive-file":
      label = `**${id}**\nWrite: ${p.path || ""}\nMode: ${p.mode || "overwrite"}`;
      break;
    case "drive-read":
      label = `**${id}**\nRead: ${p.path || ""}\n→ ${p.saveTo || ""}`;
      break;
    case "drive-search":
      label = `**${id}**\nSearch: ${p.query || ""}\n→ ${p.saveTo || ""}`;
      break;
    case "drive-list":
      label = `**${id}**\nList: ${p.folder || "/"}\n→ ${p.saveTo || ""}`;
      break;
    case "drive-folder-list":
      label = `**${id}**\nFolders: ${p.folder || "/"}\n→ ${p.saveTo || ""}`;
      break;
    case "drive-file-picker":
      label = `**${id}**\nFile picker\n→ ${p.saveTo || ""}`;
      break;
    case "drive-save":
      label = `**${id}**\nSave: ${p.source || ""}\n→ ${p.path || ""}`;
      break;
    case "drive-delete":
      label = `**${id}**\nDelete: ${p.path || ""}`;
      break;
    case "dialog": {
      const title = p.title || "";
      const msg = p.message || "";
      label = `**${id}**\n${title}\n${msg}`.trim();
      break;
    }
    case "prompt-value":
      label = `**${id}**\nInput: ${p.title || ""}\n→ ${p.saveTo || ""}`;
      break;
    case "prompt-file":
      label = `**${id}**\nFile: ${p.title || ""}\n→ ${p.saveTo || ""}`;
      break;
    case "prompt-selection":
      label = `**${id}**\nSelection: ${p.title || ""}\n→ ${p.saveTo || ""}`;
      break;
    case "workflow":
      label = `**${id}**\nSub-workflow: ${p.path || ""}`;
      break;
    case "http":
      label = `**${id}**\n${p.method || "GET"} ${p.url || ""}\n→ ${p.saveTo || ""}`;
      break;
    case "json":
      label = `**${id}**\nJSON: ${p.source || ""}\n→ ${p.saveTo || ""}`;
      break;
    case "mcp":
      label = `**${id}**\nMCP: ${p.tool || ""}\nURL: ${p.url || ""}`;
      break;
    case "rag-sync":
      label = `**${id}**\nRAG: ${p.path || ""}\n→ ${p.ragSetting || ""}`;
      break;
    case "sleep":
      label = `**${id}**\nSleep ${p.duration || ""}ms`;
      break;
    case "gemihub-command":
      label = `**${id}**\nCmd: ${p.command || ""}\n${p.path || ""}`;
      break;
    default:
      label = `**${id}**\n${node.type}`;
  }

  // Append comment if present
  if (p.comment) {
    const firstLine = p.comment.split("\n")[0];
    const truncated = firstLine.length > 30 ? firstLine.slice(0, 30) + "…" : firstLine;
    label += `\n💬 ${truncated}`;
  }

  return label;
}

/**
 * Get Mermaid shape for node type
 */
function getMermaidShape(node: WorkflowNode, label: string): string {
  const safeId = node.id.replace(/-/g, "_");
  const safeLabel = escapeLabel(label);

  switch (node.type) {
    case "if":
      return `${safeId}{"◇ IF<br/>${safeLabel}"}`;
    case "while":
      return `${safeId}{"◇ WHILE<br/>${safeLabel}"}`;
    case "variable":
    case "set":
      return `${safeId}[/"${safeLabel}"/]`;
    case "command":
      return `${safeId}[["${safeLabel}"]]`;
    case "dialog":
    case "prompt-value":
    case "prompt-file":
    case "prompt-selection":
    case "drive-file-picker":
      return `${safeId}(["${safeLabel}"])`;
    default:
      return `${safeId}["${safeLabel}"]`;
  }
}

/**
 * Convert a parsed Workflow to Mermaid flowchart syntax
 */
export function workflowToMermaid(workflow: Workflow): string {
  if (workflow.nodes.size === 0) {
    return "flowchart TD\n  empty[No nodes]";
  }

  const lines: string[] = ["flowchart TD"];
  const definedNodes = new Set<string>();

  // Build edge lookup per source node
  const outgoing = new Map<string, Array<{ to: string; label?: string }>>();
  for (const edge of workflow.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from)!.push({ to: edge.to, label: edge.label });
  }

  // Collect incoming edges to detect back-edges (loops)
  const whileNodeIds = new Set<string>();
  const nodeOrder = new Map<string, number>();
  let idx = 0;
  for (const [id, node] of workflow.nodes) {
    nodeOrder.set(id, idx++);
    if (node.type === "while") whileNodeIds.add(id);
  }

  const backEdges = new Set<string>();
  for (const edge of workflow.edges) {
    const fromIdx = nodeOrder.get(edge.from);
    const toIdx = nodeOrder.get(edge.to);
    if (fromIdx !== undefined && toIdx !== undefined && toIdx <= fromIdx) {
      if (whileNodeIds.has(edge.to)) {
        backEdges.add(`${edge.from}->${edge.to}`);
      }
    }
  }

  // Find terminal nodes (no outgoing edges)
  const hasOutgoing = new Set<string>();
  for (const edge of workflow.edges) {
    hasOutgoing.add(edge.from);
  }

  // Helper to define a node once
  const defineNode = (nodeId: string) => {
    if (definedNodes.has(nodeId)) return;
    const node = workflow.nodes.get(nodeId);
    if (!node) return;
    const label = getNodeLabel(node);
    lines.push(`  ${getMermaidShape(node, label)}`);
    definedNodes.add(nodeId);
  };

  // Generate node definitions and edges
  for (const [nodeId, node] of workflow.nodes) {
    const safeId = nodeId.replace(/-/g, "_");
    defineNode(nodeId);

    const edges = outgoing.get(nodeId) || [];

    if (node.type === "if" || node.type === "while") {
      for (const edge of edges) {
        defineNode(edge.to);
        const targetId = edge.to.replace(/-/g, "_");
        if (edge.label === "true") {
          const lbl = node.type === "while" ? "Yes ↓" : "Yes";
          lines.push(`  ${safeId} -->|"${lbl}"| ${targetId}`);
        } else if (edge.label === "false") {
          const lbl = node.type === "while" ? "No →" : "No";
          lines.push(`  ${safeId} -->|"${lbl}"| ${targetId}`);
        } else {
          lines.push(`  ${safeId} --> ${targetId}`);
        }
      }
    } else {
      for (const edge of edges) {
        defineNode(edge.to);
        const targetId = edge.to.replace(/-/g, "_");
        const isBackEdge = backEdges.has(`${nodeId}->${edge.to}`);
        if (isBackEdge) {
          lines.push(`  ${safeId} -.->|"Loop"| ${targetId}`);
        } else {
          lines.push(`  ${safeId} --> ${targetId}`);
        }
      }
    }
  }

  // Connect terminal nodes to END
  let hasTerminal = false;
  for (const [nodeId] of workflow.nodes) {
    if (!hasOutgoing.has(nodeId)) {
      const safeId = nodeId.replace(/-/g, "_");
      lines.push(`  ${safeId} --> END`);
      hasTerminal = true;
    }
  }

  if (hasTerminal) {
    lines.push(`  END(["■ END"])`);
    lines.push("");
    lines.push("  %% Styling");
    lines.push("  style END fill:#FFB6C1,stroke:#DC143C,color:#000");
  }

  return lines.join("\n");
}
