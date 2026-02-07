import yaml from "js-yaml";
import type {
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowOptions,
} from "./types";

interface FrontmatterWorkflowNode {
  id?: unknown;
  type?: unknown;
  next?: unknown;
  trueNext?: unknown;
  falseNext?: unknown;
  [key: string]: unknown;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

const VALID_NODE_TYPES: Set<string> = new Set([
  "variable", "set", "if", "while", "command", "http", "json",
  "drive-file", "drive-read", "drive-search", "drive-list",
  "drive-folder-list", "drive-file-picker", "drive-save",
  "preview", "dialog", "prompt-value", "workflow", "mcp", "sleep",
]);

function isWorkflowNodeType(value: unknown): value is WorkflowNodeType {
  return typeof value === "string" && VALID_NODE_TYPES.has(value);
}

export function parseWorkflowYaml(yamlContent: string): Workflow {
  const parsed = yaml.load(yamlContent) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid workflow YAML");
  }
  return parseWorkflowData(parsed);
}

export function parseWorkflowData(data: Record<string, unknown>): Workflow {
  const workflowData = data as {
    name?: string;
    nodes?: FrontmatterWorkflowNode[];
    options?: WorkflowOptions;
    positions?: Record<string, { x: number; y: number }>;
  };

  if (!workflowData || !Array.isArray(workflowData.nodes)) {
    throw new Error("Invalid workflow: missing nodes array");
  }

  const nodesList: FrontmatterWorkflowNode[] = workflowData.nodes;
  const options: WorkflowOptions | undefined = workflowData.options;
  const positions = workflowData.positions;

  const workflow: Workflow = {
    nodes: new Map(),
    edges: [],
    startNode: null,
    options,
    positions,
  };

  const usedIds = new Set<string>();

  for (let i = 0; i < nodesList.length; i++) {
    const rawNode = nodesList[i];
    if (!rawNode || typeof rawNode !== "object") continue;

    let id = normalizeValue(rawNode.id) || `node-${i + 1}`;
    const typeRaw = rawNode.type;
    if (!isWorkflowNodeType(typeRaw)) continue;

    // Detect and resolve duplicate node IDs
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}_${suffix}`)) suffix++;
      id = `${id}_${suffix}`;
    }
    usedIds.add(id);

    const properties: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawNode)) {
      if (["id", "type", "next", "trueNext", "falseNext"].includes(key)) continue;
      const normalized = normalizeValue(value);
      if (normalized !== "") {
        properties[key] = normalized;
      }
    }

    const workflowNode: WorkflowNode = { id, type: typeRaw, properties };
    workflow.nodes.set(id, workflowNode);
    if (workflow.startNode === null) {
      workflow.startNode = id;
    }
  }

  const nodeIds = new Set<string>(workflow.nodes.keys());

  // Build node index map for back-reference validation
  const nodeIndexMap = new Map<string, number>();
  for (let i = 0; i < nodesList.length; i++) {
    const rawNode = nodesList[i];
    if (rawNode && typeof rawNode === "object") {
      const id = normalizeValue(rawNode.id) || `node-${i + 1}`;
      nodeIndexMap.set(id, i);
    }
  }

  // Identify while nodes
  const whileNodeIds = new Set<string>();
  for (const [id, node] of workflow.nodes) {
    if (node.type === "while") whileNodeIds.add(id);
  }

  const addEdge = (from: string, to: string, label?: "true" | "false") => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) {
      throw new Error(`Invalid edge reference: ${from} -> ${to}`);
    }
    workflow.edges.push({ from, to, label });
  };

  const validateBackReference = (fromId: string, toId: string) => {
    const fromIndex = nodeIndexMap.get(fromId);
    const toIndex = nodeIndexMap.get(toId);
    if (fromIndex !== undefined && toIndex !== undefined && toIndex <= fromIndex) {
      if (!whileNodeIds.has(toId)) {
        throw new Error(
          `Invalid back-reference: "${fromId}" -> "${toId}". Only while nodes can be loop targets.`
        );
      }
    }
  };

  const isTerminator = (value: string) => value === "end";

  for (let i = 0; i < nodesList.length; i++) {
    const rawNode = nodesList[i];
    if (!rawNode || typeof rawNode !== "object") continue;

    const id = normalizeValue(rawNode.id) || `node-${i + 1}`;
    const typeRaw = rawNode.type;
    if (!isWorkflowNodeType(typeRaw) || !workflow.nodes.has(id)) continue;

    if (typeRaw === "if" || typeRaw === "while") {
      const trueNext = normalizeValue(rawNode.trueNext);
      const falseNext = normalizeValue(rawNode.falseNext);

      if (!trueNext) {
        throw new Error(`Node ${id} (${typeRaw}) missing trueNext`);
      }

      if (!isTerminator(trueNext)) addEdge(id, trueNext, "true");

      if (falseNext) {
        if (!isTerminator(falseNext)) addEdge(id, falseNext, "false");
      } else if (i < nodesList.length - 1) {
        const fallbackId = normalizeValue(nodesList[i + 1]?.id) || `node-${i + 2}`;
        if (fallbackId !== id && nodeIds.has(fallbackId)) {
          addEdge(id, fallbackId, "false");
        }
      }
    } else {
      const next = normalizeValue(rawNode.next);
      if (next) {
        if (!isTerminator(next)) {
          validateBackReference(id, next);
          addEdge(id, next);
        }
      } else if (i < nodesList.length - 1) {
        const fallbackId = normalizeValue(nodesList[i + 1]?.id) || `node-${i + 2}`;
        if (fallbackId !== id && nodeIds.has(fallbackId)) {
          addEdge(id, fallbackId);
        }
      }
    }
  }

  if (!workflow.startNode) {
    throw new Error("Workflow has no nodes");
  }

  return workflow;
}

export function getNextNodes(
  workflow: Workflow,
  currentNodeId: string,
  conditionResult?: boolean
): string[] {
  const nextNodes: string[] = [];
  const currentNode = workflow.nodes.get(currentNodeId);
  if (!currentNode) return nextNodes;

  const outgoingEdges = workflow.edges.filter((e) => e.from === currentNodeId);

  if (currentNode.type === "if" || currentNode.type === "while") {
    if (conditionResult !== undefined) {
      const expectedLabel = conditionResult ? "true" : "false";
      for (const edge of outgoingEdges) {
        if (edge.label === expectedLabel) nextNodes.push(edge.to);
      }
    }
  } else {
    for (const edge of outgoingEdges) {
      nextNodes.push(edge.to);
    }
  }

  return nextNodes;
}

// Serialize workflow back to YAML
export function serializeWorkflow(workflow: Workflow, name?: string): string {
  const nodes: Record<string, unknown>[] = [];
  const nodeOrder: string[] = [];

  // Build order from startNode traversal
  if (workflow.startNode) {
    const visited = new Set<string>();
    const queue = [workflow.startNode];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      nodeOrder.push(id);
      const edges = workflow.edges.filter((e) => e.from === id);
      for (const edge of edges) {
        if (!visited.has(edge.to)) queue.push(edge.to);
      }
    }
    // Add any remaining nodes not reachable from start
    for (const id of workflow.nodes.keys()) {
      if (!visited.has(id)) nodeOrder.push(id);
    }
  }

  // Build edge lookup for next/trueNext/falseNext
  const edgeMap = new Map<string, { next?: string; trueNext?: string; falseNext?: string }>();
  for (const edge of workflow.edges) {
    if (!edgeMap.has(edge.from)) edgeMap.set(edge.from, {});
    const entry = edgeMap.get(edge.from)!;
    if (edge.label === "true") entry.trueNext = edge.to;
    else if (edge.label === "false") entry.falseNext = edge.to;
    else entry.next = edge.to;
  }

  for (const id of nodeOrder) {
    const node = workflow.nodes.get(id);
    if (!node) continue;

    const obj: Record<string, unknown> = {
      id: node.id,
      type: node.type,
    };

    // Add properties
    for (const [key, value] of Object.entries(node.properties)) {
      obj[key] = value;
    }

    // Add edge references
    const edgeInfo = edgeMap.get(id);
    if (edgeInfo) {
      const nodeIdx = nodeOrder.indexOf(id);
      const nextNodeId = nodeIdx < nodeOrder.length - 1 ? nodeOrder[nodeIdx + 1] : undefined;

      if (node.type === "if" || node.type === "while") {
        if (edgeInfo.trueNext) obj.trueNext = edgeInfo.trueNext;
        if (edgeInfo.falseNext && edgeInfo.falseNext !== nextNodeId) {
          obj.falseNext = edgeInfo.falseNext;
        }
      } else {
        if (edgeInfo.next && edgeInfo.next !== nextNodeId) {
          obj.next = edgeInfo.next;
        }
      }
    }

    nodes.push(obj);
  }

  const output: Record<string, unknown> = { name: name || "workflow" };
  if (workflow.positions) {
    output.positions = workflow.positions;
  }
  output.nodes = nodes;

  return yaml.dump(output, { lineWidth: -1, noRefs: true });
}
