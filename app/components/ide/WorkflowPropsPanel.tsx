import { useState, useEffect, useCallback, useRef } from "react";
import {
  GitBranch,
  Plus,
  FilePlus,
  FileCode,
  Loader2,
  RefreshCw,
  Pencil,
  Trash2,
  Play,
  Square,
  Clock,
  CheckCircle,
  XCircle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Info,
  Sparkles,
  AppWindow,
  AlertTriangle,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { Workflow, WorkflowNode } from "~/engine/types";
import { parseWorkflowYaml, serializeWorkflow } from "~/engine/parser";
import {
  getNodeSummary,
  getNodeTypeLabel,
  getNodeTypeColor,
} from "~/utils/workflow-node-summary";
import { buildOutgoingMap } from "~/utils/workflow-connections";
import { NodeEditorModal } from "./NodeEditorModal";
import type { NodePropertyContext } from "~/utils/workflow-node-properties";
import { McpAppModal } from "~/components/execution/McpAppModal";
import type { McpAppInfo } from "~/types/chat";
import { ExecutionHistoryModal } from "./ExecutionHistoryModal";
import { PromptModal } from "~/components/execution/PromptModal";
import yaml from "js-yaml";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { useI18n } from "~/i18n/context";
import { getLocallyModifiedFileIds } from "~/services/indexeddb-cache";

interface WorkflowFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

interface WorkflowPropsPanelProps {
  activeFileId: string | null;
  activeFileName: string | null;
  onNewWorkflow: () => void;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  onWorkflowChanged?: () => void;
  onModifyWithAI?: (currentYaml: string, workflowName: string) => void;
  settings?: import("~/types/settings").UserSettings;
  refreshKey?: number;
}

function isWorkflowFile(name: string | null): boolean {
  if (!name) return false;
  return name.endsWith(".yaml") || name.endsWith(".yml");
}

export function WorkflowPropsPanel({
  activeFileId,
  activeFileName,
  onNewWorkflow,
  onSelectFile,
  onWorkflowChanged,
  onModifyWithAI,
  settings,
  refreshKey,
}: WorkflowPropsPanelProps) {
  if (isWorkflowFile(activeFileName) && activeFileId) {
    return (
      <WorkflowNodeListView
        fileId={activeFileId}
        fileName={activeFileName!}
        onNewWorkflow={onNewWorkflow}
        onSelectFile={onSelectFile}
        onWorkflowChanged={onWorkflowChanged}
        onModifyWithAI={onModifyWithAI}
        settings={settings}
        refreshKey={refreshKey}
      />
    );
  }

  return (
    <WorkflowListView
      onNewWorkflow={onNewWorkflow}
      onSelectFile={onSelectFile}
    />
  );
}

// ─── Workflow Node List View (YAML active) ───────────────────────────────────

interface LogEntry {
  nodeId: string;
  nodeType: string;
  message: string;
  status: "info" | "success" | "error";
  timestamp: string;
  input?: Record<string, unknown>;
  output?: unknown;
  mcpApps?: McpAppInfo[];
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function WorkflowNodeListView({
  fileId,
  fileName,
  onNewWorkflow,
  onSelectFile,
  onWorkflowChanged,
  onModifyWithAI,
  settings,
  refreshKey,
}: {
  fileId: string;
  fileName: string;
  onNewWorkflow: () => void;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  onWorkflowChanged?: () => void;
  onModifyWithAI?: (currentYaml: string, workflowName: string) => void;
  settings?: import("~/types/settings").UserSettings;
  refreshKey?: number;
}) {
  const { content: rawContent, error: fileError, saveToCache, refresh } = useFileWithCache(fileId, refreshKey, "PropsPanel");

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [rawYaml, setRawYaml] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Parse workflow content during render for instant display
  const [prevRawContent, setPrevRawContent] = useState<string | null>(null);
  if (rawContent !== null && rawContent !== prevRawContent) {
    setPrevRawContent(rawContent);
    setRawYaml(rawContent);
    try {
      const parsed = parseWorkflowYaml(rawContent);
      setWorkflow(parsed);
      setError(null);
      try {
        const yamlData = yaml.load(rawContent) as Record<string, unknown>;
        setWorkflowName(
          typeof yamlData?.name === "string" ? yamlData.name : fileName.replace(/\.ya?ml$/, "")
        );
      } catch {
        setWorkflowName(fileName.replace(/\.ya?ml$/, ""));
      }
    } catch (err) {
      console.error("[PropsPanel] parse error:", err);
      setError(err instanceof Error ? err.message : "Failed to parse workflow");
      setWorkflow(null);
    }
  }

  // Node editor
  const [editingNode, setEditingNode] = useState<Partial<WorkflowNode> | null>(null);
  const [isNewNode, setIsNewNode] = useState(false);
  const [editingNextInfo, setEditingNextInfo] = useState<{
    next?: string;
    trueNext?: string;
    falseNext?: string;
  }>({});

  // History
  const [showHistory, setShowHistory] = useState(false);

  // Execution
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<
    "idle" | "running" | "completed" | "cancelled" | "error" | "waiting-prompt"
  >("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null);
  const [mcpAppModal, setMcpAppModal] = useState<McpAppInfo[] | null>(null);
  const [promptData, setPromptData] = useState<Record<string, unknown> | null>(null);
  const eventSourceRef = useState<EventSource | null>(null);

  const { t } = useI18n();
  const [hasLocalChanges, setHasLocalChanges] = useState(false);

  useEffect(() => {
    const checkModified = () => {
      getLocallyModifiedFileIds().then((ids) => {
        setHasLocalChanges(ids.has(fileId));
      }).catch(() => {});
    };
    checkModified();

    const handleModified = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.fileId === fileId) {
        setHasLocalChanges(true);
      }
    };
    const handleSync = () => {
      checkModified();
    };

    window.addEventListener("file-modified", handleModified);
    window.addEventListener("sync-complete", handleSync);
    return () => {
      window.removeEventListener("file-modified", handleModified);
      window.removeEventListener("sync-complete", handleSync);
    };
  }, [fileId]);

  const saveWorkflow = useCallback(
    async (updated: Workflow) => {
      try {
        const yamlContent = serializeWorkflow(updated, workflowName);
        await saveToCache(yamlContent);
        setWorkflow(updated);
        setRawYaml(yamlContent);
        onWorkflowChanged?.();
      } catch (err) {
        console.error("[PropsPanel] saveWorkflow error:", err);
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    },
    [saveToCache, workflowName, onWorkflowChanged]
  );

  const handleAddNode = useCallback(() => {
    setEditingNode({});
    setIsNewNode(true);
    setEditingNextInfo({});
  }, []);

  const handleEditNode = useCallback(
    (node: WorkflowNode) => {
      if (!workflow) return;
      setEditingNode(node);
      setIsNewNode(false);
      // Build current next info from edges
      const outgoing = workflow.edges.filter((e) => e.from === node.id);
      const nextInfo: { next?: string; trueNext?: string; falseNext?: string } =
        {};
      if (node.type === "if" || node.type === "while") {
        nextInfo.trueNext =
          outgoing.find((e) => e.label === "true")?.to || "";
        nextInfo.falseNext =
          outgoing.find((e) => e.label === "false")?.to || "";
      } else {
        nextInfo.next = outgoing.find((e) => !e.label)?.to || "";
      }
      setEditingNextInfo(nextInfo);
    },
    [workflow]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (!workflow) return;
      if (!confirm(`Delete node "${nodeId}"?`)) return;

      const updated: Workflow = {
        ...workflow,
        nodes: new Map(workflow.nodes),
        edges: workflow.edges.filter(
          (e) => e.from !== nodeId && e.to !== nodeId
        ),
      };
      updated.nodes.delete(nodeId);
      if (updated.startNode === nodeId) {
        const remaining = Array.from(updated.nodes.keys());
        updated.startNode = remaining.length > 0 ? remaining[0] : null;
      }
      saveWorkflow(updated);
    },
    [workflow, saveWorkflow]
  );

  const handleSaveNode = useCallback(
    (
      node: WorkflowNode,
      nextInfo: { next?: string; trueNext?: string; falseNext?: string }
    ) => {
      if (!workflow) return;

      const updated: Workflow = {
        ...workflow,
        nodes: new Map(workflow.nodes),
        edges: [...workflow.edges],
      };

      // Add/update node
      updated.nodes.set(node.id, node);

      // If new and workflow was empty, set as start
      if (isNewNode && !updated.startNode) {
        updated.startNode = node.id;
      }

      // Remove old edges from this node
      updated.edges = updated.edges.filter((e) => e.from !== node.id);

      // Add new edges
      if (node.type === "if" || node.type === "while") {
        if (nextInfo.trueNext) {
          updated.edges.push({
            from: node.id,
            to: nextInfo.trueNext,
            label: "true",
          });
        }
        if (nextInfo.falseNext) {
          updated.edges.push({
            from: node.id,
            to: nextInfo.falseNext,
            label: "false",
          });
        }
      } else {
        if (nextInfo.next) {
          updated.edges.push({ from: node.id, to: nextInfo.next });
        }
      }

      saveWorkflow(updated);
      setEditingNode(null);
    },
    [workflow, isNewNode, saveWorkflow]
  );

  // Execution
  const startExecution = useCallback(async () => {
    setLogs([]);
    setExecutionStatus("running");
    setShowLogs(true);

    try {
      const res = await fetch(`/api/workflow/${fileId}/execute`, {
        method: "POST",
      });
      const data = await res.json();
      const newExecId = data.executionId;
      setExecutionId(newExecId);

      const es = new EventSource(
        `/api/workflow/${fileId}/execute?executionId=${newExecId}`
      );
      eventSourceRef[1](es);

      es.addEventListener("log", (e) => {
        const log = JSON.parse(e.data);
        setLogs((prev) => [...prev, log]);
        if (log.mcpApps && log.mcpApps.length > 0) {
          setMcpAppModal(log.mcpApps);
        }
      });
      es.addEventListener("complete", (e) => {
        setExecutionStatus("completed");
        es.close();
        window.dispatchEvent(new Event("workflow-completed"));
        try {
          const data = JSON.parse((e as MessageEvent).data);
          if (data.openFile) {
            onSelectFile(data.openFile.fileId, data.openFile.fileName, data.openFile.mimeType);
          }
        } catch { /* ignore parse errors */ }
      });
      es.addEventListener("cancelled", () => {
        setExecutionStatus("cancelled");
        es.close();
      });
      es.addEventListener("error", (e) => {
        if (e instanceof MessageEvent) {
          const data = JSON.parse(e.data);
          setLogs((prev) => [
            ...prev,
            {
              nodeId: "system",
              nodeType: "system",
              message: data.error || "Execution error",
              status: "error" as const,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        setExecutionStatus("error");
        es.close();
      });
      es.addEventListener("status", (e) => {
        const data = JSON.parse(e.data);
        setExecutionStatus(data.status);
      });
      es.addEventListener("prompt-request", (e) => {
        const data = JSON.parse(e.data);
        setExecutionStatus("waiting-prompt");
        setPromptData(data);
      });
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setExecutionStatus((prev) => (prev === "running" ? "error" : prev));
        }
      };
    } catch {
      setExecutionStatus("error");
    }
  }, [fileId, eventSourceRef, onSelectFile]);

  const stopExecution = useCallback(async () => {
    if (!executionId) return;
    try {
      const res = await fetch(`/api/workflow/${fileId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLogs((prev) => [
          ...prev,
          {
            nodeId: "system",
            nodeType: "system",
            message: data.error || "Failed to stop execution",
            status: "error" as const,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        {
          nodeId: "system",
          nodeType: "system",
          message: `Failed to stop execution: ${error instanceof Error ? error.message : String(error)}`,
          status: "error" as const,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, [executionId, fileId]);

  // Listen for shortcut-triggered execution
  const pendingExecutionRef = useRef<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const targetFileId = (e as CustomEvent).detail?.fileId as string | undefined;
      // If this event targets a different file, ignore
      if (targetFileId && targetFileId !== fileId) return;
      if (executionStatus !== "running" && executionStatus !== "waiting-prompt" && workflow && !hasLocalChanges) {
        startExecution();
      } else if (!workflow) {
        // Workflow not loaded yet (just navigated) — defer execution
        pendingExecutionRef.current = fileId;
      }
    };
    window.addEventListener("shortcut-execute-workflow", handler);
    return () => window.removeEventListener("shortcut-execute-workflow", handler);
  }, [executionStatus, workflow, hasLocalChanges, startExecution, fileId]);

  // Deferred execution: run when workflow finishes loading after a shortcut navigation
  useEffect(() => {
    if (pendingExecutionRef.current !== fileId) return;
    if (!workflow) return;
    // Clear immediately so it won't re-fire on subsequent state changes
    pendingExecutionRef.current = null;
    if (
      !hasLocalChanges &&
      executionStatus !== "running" &&
      executionStatus !== "waiting-prompt"
    ) {
      startExecution();
    }
  }, [workflow, fileId, hasLocalChanges, executionStatus, startExecution]);

  const handlePromptResponse = useCallback(
    async (value: string | null) => {
      if (!executionId) return;
      setPromptData(null);
      setExecutionStatus("running");
      await fetch("/api/prompt-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, value }),
      });
    },
    [executionId]
  );

  // Current executing nodeId from logs
  const currentNodeId =
    executionStatus === "running" && logs.length > 0
      ? logs[logs.length - 1].nodeId
      : null;
  const completedNodeIds = new Set(
    logs.filter((l) => l.status === "success").map((l) => l.nodeId)
  );
  const errorNodeIds = new Set(
    logs.filter((l) => l.status === "error").map((l) => l.nodeId)
  );

  if (rawContent === null && !fileError && !error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const nodeOrder = workflow ? getNodeOrder(workflow) : [];
  const outgoingMap = workflow ? buildOutgoingMap(workflow) : new Map<string, Array<{ to: string; label?: string }>>();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <span
          className="truncate text-xs font-semibold text-gray-700 dark:text-gray-300"
          title={workflowName}
        >
          {workflowName}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Refresh"
          >
            <RefreshCw size={ICON.SM} />
          </button>
          {workflow && (
            <button
              onClick={handleAddNode}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              title="Add Node"
            >
              <Plus size={ICON.MD} />
            </button>
          )}
        </div>
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto py-1">
        {!workflow ? (
          <div className="flex flex-col items-center justify-center px-4 py-8">
            {(fileError || error) ? (
              <p className="text-xs text-red-500 mb-2">{fileError || error}</p>
            ) : (
              <p className="text-xs text-gray-400 mb-2">Failed to parse workflow</p>
            )}
            <button
              onClick={refresh}
              className="text-xs text-blue-600 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : nodeOrder.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8">
            <GitBranch
              size={24}
              className="mb-2 text-gray-300 dark:text-gray-600"
            />
            <p className="mb-2 text-center text-xs text-gray-500">
              No nodes yet
            </p>
            <button
              onClick={handleAddNode}
              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
            >
              <Plus size={ICON.SM} />
              Add Node
            </button>
          </div>
        ) : (
          nodeOrder.map((nodeId) => {
            const node = workflow.nodes.get(nodeId);
            if (!node) return null;
            const summary = getNodeSummary(node);
            const typeLabel = getNodeTypeLabel(node.type);
            const typeColor = getNodeTypeColor(node.type);
            const outgoing = outgoingMap.get(nodeId) || [];

            const isExecuting = currentNodeId === nodeId;
            const isCompleted = completedNodeIds.has(nodeId);
            const isError = errorNodeIds.has(nodeId);

            let borderClass = "border-gray-200 dark:border-gray-800";
            if (isExecuting)
              borderClass = "border-blue-500 dark:border-blue-400";
            else if (isError)
              borderClass = "border-red-400 dark:border-red-500";
            else if (isCompleted)
              borderClass = "border-green-400 dark:border-green-500";

            return (
              <div key={nodeId} className="px-2 py-0.5">
                <div
                  className={`rounded border ${borderClass} bg-white px-2 py-1.5 dark:bg-gray-900 transition-colors`}
                >
                  {/* Node header */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block rounded px-1 py-0.5 text-[10px] font-medium leading-none ${typeColor}`}
                    >
                      {typeLabel}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                      {nodeId}
                    </span>
                    {isCompleted && !isError && (
                      <CheckCircle
                        size={ICON.SM}
                        className="flex-shrink-0 text-green-500"
                      />
                    )}
                    {isError && (
                      <XCircle
                        size={ICON.SM}
                        className="flex-shrink-0 text-red-500"
                      />
                    )}
                    {isExecuting && (
                      <Loader2
                        size={ICON.SM}
                        className="flex-shrink-0 animate-spin text-blue-500"
                      />
                    )}
                    <button
                      onClick={() => handleEditNode(node)}
                      className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                      title="Edit"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => handleDeleteNode(nodeId)}
                      className="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900"
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {/* Summary */}
                  {summary && (
                    <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {summary}
                    </p>
                  )}
                </div>
                {/* Outgoing edges */}
                {outgoing.length > 0 && (
                  <div className="ml-3 mt-0.5 mb-0.5">
                    {outgoing.map((edge, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500"
                      >
                        {edge.label ? (
                          <span
                            className={
                              edge.label === "true"
                                ? "text-green-500"
                                : "text-red-400"
                            }
                          >
                            {edge.label === "true" ? "T" : "F"}
                          </span>
                        ) : (
                          <ArrowRight size={9} />
                        )}
                        <span>{edge.to}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Execution Logs (collapsible) */}
      {logs.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex w-full items-center gap-1 px-3 py-1 text-[10px] text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {showLogs ? (
              <ChevronDown size={10} />
            ) : (
              <ChevronRight size={10} />
            )}
            Logs ({logs.length})
          </button>
          {showLogs && (
            <div className="max-h-48 overflow-y-auto px-2 pb-1 font-mono text-[10px]">
              {logs.map((log, i) => {
                const isExpanded = expandedLogIndex === i;
                const hasDetail = log.input || log.output || (log.mcpApps && log.mcpApps.length > 0);
                return (
                  <div key={i}>
                    <div
                      onClick={() => hasDetail && setExpandedLogIndex(isExpanded ? null : i)}
                      className={`flex items-start gap-1 py-0.5 ${hasDetail ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded" : ""} ${
                        log.status === "error"
                          ? "text-red-500"
                          : log.status === "success"
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-500"
                      }`}
                    >
                      {log.status === "error" ? (
                        <XCircle size={10} className="mt-0.5 flex-shrink-0" />
                      ) : log.status === "success" ? (
                        <CheckCircle size={10} className="mt-0.5 flex-shrink-0" />
                      ) : (
                        <Info size={10} className="mt-0.5 flex-shrink-0" />
                      )}
                      {!!hasDetail && (isExpanded ? <ChevronDown size={10} className="mt-0.5 flex-shrink-0" /> : <ChevronRight size={10} className="mt-0.5 flex-shrink-0" />)}
                      <span className="text-gray-400">[{log.nodeId}]</span>
                      <span className="break-all">{log.message}</span>
                      {log.mcpApps && log.mcpApps.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setMcpAppModal(log.mcpApps!); }}
                          className="ml-1 flex-shrink-0 text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                          title="Open MCP App"
                        >
                          <AppWindow size={12} />
                        </button>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="ml-5 mb-1 space-y-1 text-[10px]">
                        {log.input && (
                          <div>
                            <span className="font-semibold text-gray-500">Input:</span>
                            <pre className="mt-0.5 max-h-24 overflow-auto rounded bg-gray-100 p-1 text-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-pre-wrap">{formatValue(log.input)}</pre>
                          </div>
                        )}
                        {log.output !== undefined && (
                          <div>
                            <span className="font-semibold text-gray-500">Output:</span>
                            <pre className="mt-0.5 max-h-24 overflow-auto rounded bg-gray-100 p-1 text-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-pre-wrap">{formatValue(log.output)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Push required warning */}
      {hasLocalChanges && (
        <div className="flex items-center gap-1 border-t border-gray-200 px-3 py-1.5 dark:border-gray-800">
          <AlertTriangle size={ICON.SM} className="flex-shrink-0 text-yellow-500" />
          <span className="text-[10px] text-yellow-600 dark:text-yellow-400">
            {t("workflow.pushRequired")}
          </span>
        </div>
      )}

      {/* Footer: Execute + History */}
      <div className="flex items-center gap-2 border-t border-gray-200 px-3 py-2 dark:border-gray-800">
        {executionStatus === "running" ||
        executionStatus === "waiting-prompt" ? (
          <button
            onClick={stopExecution}
            className="flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
          >
            <Square size={ICON.SM} />
            Stop
          </button>
        ) : (
          <button
            onClick={startExecution}
            disabled={hasLocalChanges || !workflow}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              hasLocalChanges || !workflow
                ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            <Play size={ICON.SM} />
            Execute
          </button>
        )}
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Clock size={ICON.SM} />
          History
        </button>
        {onModifyWithAI && rawYaml && (
          <button
            onClick={() => onModifyWithAI(rawYaml, workflowName)}
            className="flex items-center gap-1 rounded bg-purple-100 px-2 py-1 text-xs text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
            title="Modify with AI"
          >
            <Sparkles size={ICON.SM} />
            AI
          </button>
        )}
        <button
          onClick={onNewWorkflow}
          className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          title="New Workflow"
        >
          <FilePlus size={ICON.SM} />
          New
        </button>
        {executionStatus !== "idle" && (
          <span className="ml-auto">
            {executionStatus === "running" && (
              <Loader2
                size={ICON.MD}
                className="animate-spin text-blue-500"
              />
            )}
            {executionStatus === "completed" && (
              <CheckCircle size={ICON.MD} className="text-green-500" />
            )}
            {executionStatus === "error" && (
              <XCircle size={ICON.MD} className="text-red-500" />
            )}
            {executionStatus === "cancelled" && (
              <Square size={ICON.MD} className="text-orange-500" />
            )}
            {executionStatus === "waiting-prompt" && (
              <Loader2
                size={ICON.MD}
                className="animate-spin text-yellow-500"
              />
            )}
          </span>
        )}
      </div>

      {/* Node Editor Modal */}
      {editingNode !== null && workflow && (
        <NodeEditorModal
          node={isNewNode ? editingNode : editingNode}
          existingNodeIds={Array.from(workflow.nodes.keys())}
          allNodeIds={Array.from(workflow.nodes.keys())}
          onSave={handleSaveNode}
          onCancel={() => setEditingNode(null)}
          initialNext={editingNextInfo}
          propertyContext={{
            ragSettingNames: settings?.ragSettings ? Object.keys(settings.ragSettings) : [],
            mcpServerIds: settings?.mcpServers?.map(s => s.id || s.name) || [],
          } satisfies NodePropertyContext}
        />
      )}

      {/* MCP App Modal */}
      {mcpAppModal && (
        <McpAppModal
          mcpApps={mcpAppModal}
          onClose={() => setMcpAppModal(null)}
        />
      )}

      {/* Prompt Modal (for drive-file-picker, prompt-value, dialog nodes) */}
      {promptData && (
        <PromptModal
          data={promptData}
          onSubmit={handlePromptResponse}
          onCancel={() => handlePromptResponse(null)}
        />
      )}

      {/* Execution History Modal */}
      {showHistory && (
        <ExecutionHistoryModal
          workflowId={fileId}
          workflowName={workflowName}
          onClose={() => setShowHistory(false)}
          encryptedPrivateKey={settings?.encryption?.encryptedPrivateKey}
          salt={settings?.encryption?.salt}
        />
      )}
    </div>
  );
}

function getNodeOrder(workflow: Workflow): string[] {
  if (!workflow.startNode) return Array.from(workflow.nodes.keys());

  const order: string[] = [];
  const visited = new Set<string>();
  const queue = [workflow.startNode];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    const edges = workflow.edges.filter((e) => e.from === id);
    for (const edge of edges) {
      if (!visited.has(edge.to)) queue.push(edge.to);
    }
  }

  // Add unreachable nodes
  for (const id of workflow.nodes.keys()) {
    if (!visited.has(id)) order.push(id);
  }

  return order;
}

// ─── Workflow List View (no YAML active) ─────────────────────────────────────

function WorkflowListView({
  onNewWorkflow,
  onSelectFile,
}: {
  onNewWorkflow: () => void;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowFile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drive/files?action=list");
      if (res.ok) {
        const data = await res.json();
        const yamlFiles = (data.files as WorkflowFile[]).filter(
          (f) => f.name.endsWith(".yaml") || f.name.endsWith(".yml")
        );
        setWorkflows(yamlFiles);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Workflows
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchWorkflows}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Refresh"
          >
            <RefreshCw size={ICON.SM} />
          </button>
          <button
            onClick={onNewWorkflow}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="New Workflow"
          >
            <Plus size={ICON.MD} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
            <GitBranch
              size={32}
              className="mb-3 text-gray-300 dark:text-gray-600"
            />
            <p className="mb-3 text-center text-sm text-gray-500 dark:text-gray-400">
              No workflows yet.
            </p>
            <button
              onClick={onNewWorkflow}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus size={ICON.MD} />
              New Workflow
            </button>
          </div>
        ) : (
          <div className="py-1">
            {workflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() =>
                  onSelectFile(wf.id, wf.name, wf.mimeType || "text/yaml")
                }
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <FileCode
                  size={ICON.MD}
                  className="flex-shrink-0 text-orange-500"
                />
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {wf.name}
                </span>
              </button>
            ))}
            <button
              onClick={onNewWorkflow}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            >
              <Plus size={ICON.MD} className="flex-shrink-0" />
              <span>New Workflow</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
