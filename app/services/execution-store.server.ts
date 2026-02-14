import type { ExecutionLog, ExecutionRecord } from "~/engine/types";

interface ExecutionState {
  id: string;
  workflowId: string;
  ownerRootFolderId: string;
  status: "running" | "completed" | "error" | "cancelled" | "waiting-prompt";
  createdAt: number;
  logs: ExecutionLog[];
  record?: ExecutionRecord;
  abortController: AbortController;
  // For interactive prompts (SSE-based)
  promptResolve?: (value: string | null) => void;
  promptType?: string;
  promptData?: Record<string, unknown>;
  // SSE subscribers
  subscribers: Set<(event: string, data: string) => void>;
}

// In-memory execution state store
const executions = new Map<string, ExecutionState>();

export function createExecution(
  executionId: string,
  workflowId: string,
  ownerRootFolderId: string
): ExecutionState {
  cleanup();
  const state: ExecutionState = {
    id: executionId,
    workflowId,
    ownerRootFolderId,
    status: "running",
    createdAt: Date.now(),
    logs: [],
    abortController: new AbortController(),
    subscribers: new Set(),
  };
  executions.set(executionId, state);
  return state;
}

export function getExecution(executionId: string): ExecutionState | undefined {
  return executions.get(executionId);
}

export function isExecutionOwnedBy(executionId: string, ownerRootFolderId: string): boolean {
  const state = executions.get(executionId);
  if (!state) return false;
  return state.ownerRootFolderId === ownerRootFolderId;
}

export function addLog(executionId: string, log: ExecutionLog): void {
  const state = executions.get(executionId);
  if (!state) return;
  state.logs.push(log);
  broadcast(executionId, "log", JSON.stringify({
    nodeId: log.nodeId,
    nodeType: log.nodeType,
    message: log.message,
    status: log.status,
    timestamp: log.timestamp.toISOString(),
    input: log.input,
    output: log.output,
    mcpApps: log.mcpApps,
  }));
}

export function setStatus(executionId: string, status: ExecutionState["status"]): void {
  const state = executions.get(executionId);
  if (!state) return;
  state.status = status;
  broadcast(executionId, "status", JSON.stringify({ status }));
}

export function setCompleted(
  executionId: string,
  record?: ExecutionRecord,
  openFile?: { fileId: string; fileName: string; mimeType: string }
): void {
  const state = executions.get(executionId);
  if (!state) return;
  state.status = "completed";
  state.record = record;
  broadcast(executionId, "complete", JSON.stringify({
    status: "completed",
    record: record ? { id: record.id, steps: record.steps.length } : undefined,
    openFile,
  }));
}

export function setCancelled(
  executionId: string,
  reason?: string,
  record?: ExecutionRecord
): void {
  const state = executions.get(executionId);
  if (!state) return;
  // Guard: if already cancelled, only update record if provided (no re-broadcast)
  if (state.status === "cancelled") {
    if (record) state.record = record;
    return;
  }
  state.status = "cancelled";
  state.record = record;
  broadcast(executionId, "status", JSON.stringify({ status: "cancelled" }));
  broadcast(executionId, "cancelled", JSON.stringify({
    status: "cancelled",
    reason,
    record: record ? { id: record.id, steps: record.steps.length } : undefined,
  }));
}

export function setError(executionId: string, error: string): void {
  const state = executions.get(executionId);
  if (!state) return;
  state.status = "error";
  broadcast(executionId, "error", JSON.stringify({ error }));
}

export function stopExecution(executionId: string): boolean {
  const state = executions.get(executionId);
  if (!state) return false;
  if (state.status === "completed" || state.status === "error" || state.status === "cancelled") {
    return true;
  }

  // Unblock pending prompts so executor can observe abort and finish.
  if (state.promptResolve) {
    state.promptResolve(null);
    state.promptResolve = undefined;
    state.promptType = undefined;
    state.promptData = undefined;
  }

  if (!state.abortController.signal.aborted) {
    state.abortController.abort();
  }

  setCancelled(executionId, "Workflow execution was stopped");
  return true;
}

// SSE prompt request
export function requestPrompt(
  executionId: string,
  promptType: string,
  promptData: Record<string, unknown>
): Promise<string | null> {
  const state = executions.get(executionId);
  if (!state) throw new Error("Execution not found");
  if (state.abortController.signal.aborted || state.status === "cancelled") {
    return Promise.resolve(null);
  }

  state.status = "waiting-prompt";
  state.promptType = promptType;
  state.promptData = promptData;

  broadcast(executionId, "prompt-request", JSON.stringify({
    type: promptType,
    ...promptData,
  }));

  return new Promise<string | null>((resolve) => {
    state.promptResolve = resolve;
  });
}

// Resolve a pending prompt
export function resolvePrompt(executionId: string, value: string | null): void {
  const state = executions.get(executionId);
  if (!state || !state.promptResolve) return;

  state.promptResolve(value);
  state.promptResolve = undefined;
  state.promptType = undefined;
  state.promptData = undefined;
  if (state.status !== "cancelled") {
    state.status = "running";
  }
}

// Subscribe to execution events
export function subscribe(
  executionId: string,
  callback: (event: string, data: string) => void
): () => void {
  const state = executions.get(executionId);
  if (!state) throw new Error("Execution not found");

  state.subscribers.add(callback);

  // Send existing logs
  for (const log of state.logs) {
    callback("log", JSON.stringify({
      nodeId: log.nodeId,
      nodeType: log.nodeType,
      message: log.message,
      status: log.status,
      timestamp: log.timestamp.toISOString(),
      input: log.input,
      output: log.output,
      mcpApps: log.mcpApps,
    }));
  }

  // Send current status
  if (state.status !== "running") {
    callback("status", JSON.stringify({ status: state.status }));
  }

  // If there's a pending prompt, send it
  if (state.promptType && state.promptData) {
    callback("prompt-request", JSON.stringify({
      type: state.promptType,
      ...state.promptData,
    }));
  }

  return () => {
    state.subscribers.delete(callback);
  };
}

function broadcast(executionId: string, event: string, data: string): void {
  const state = executions.get(executionId);
  if (!state) return;
  for (const cb of state.subscribers) {
    cb(event, data);
  }
}

export function broadcastDriveFileUpdated(executionId: string, data: { fileId: string; fileName: string; content?: string }): void {
  broadcast(executionId, "drive-file-updated", JSON.stringify(data));
}

export function broadcastDriveFileCreated(executionId: string, data: { fileId: string; fileName: string; content: string; md5Checksum: string; modifiedTime: string }): void {
  broadcast(executionId, "drive-file-created", JSON.stringify(data));
}

export function broadcastDriveFileDeleted(executionId: string, data: { fileId: string; fileName: string }): void {
  broadcast(executionId, "drive-file-deleted", JSON.stringify(data));
}

// Cleanup old executions (called on each new execution)
export function cleanup(maxAge: number = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, state] of executions) {
    if (state.status === "running" || state.status === "waiting-prompt") continue;
    const lastActivity = state.logs.length > 0
      ? state.logs[state.logs.length - 1].timestamp.getTime()
      : state.createdAt;
    if (now - lastActivity > maxAge) {
      executions.delete(id);
    }
  }
}
