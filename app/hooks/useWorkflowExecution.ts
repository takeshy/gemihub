import { useState, useRef, useCallback, useEffect } from "react";
import type { McpAppInfo } from "~/types/chat";
import { attachDriveFileHandlers } from "~/utils/drive-file-sse";

interface LogEntry {
  nodeId: string;
  nodeType: string;
  message: string;
  status: "info" | "success" | "error";
  timestamp: string;
  mcpApps?: McpAppInfo[];
}

type ExecutionHookStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "error"
  | "waiting-prompt";

export function useWorkflowExecution(workflowId: string) {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<ExecutionHookStatus>("idle");
  const [promptData, setPromptData] = useState<Record<string, unknown> | null>(
    null
  );
  const eventSourceRef = useRef<EventSource | null>(null);

  // Clean up EventSource on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const attachEventSource = useCallback((es: EventSource) => {
    eventSourceRef.current?.close();
    eventSourceRef.current = es;

    es.addEventListener("log", (e) => {
      const log = JSON.parse(e.data);
      setLogs((prev) => [...prev, log]);
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      setStatus(data.status);
    });

    es.addEventListener("complete", () => {
      setStatus("completed");
      es.close();
    });

    es.addEventListener("cancelled", () => {
      setStatus("cancelled");
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
      setStatus("error");
      es.close();
    });

    es.addEventListener("prompt-request", (e) => {
      const data = JSON.parse(e.data);
      setStatus("waiting-prompt");
      setPromptData(data);
    });

    attachDriveFileHandlers(es);

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStatus((prev) => (prev === "running" ? "error" : prev));
      }
    };
  }, []);

  const start = useCallback(async () => {
    setLogs([]);
    setStatus("running");
    setPromptData(null);

    try {
      const res = await fetch(`/api/workflow/${workflowId}/execute`, {
        method: "POST",
      });
      const data = await res.json();
      const newExecutionId = data.executionId;
      setExecutionId(newExecutionId);

      const es = new EventSource(
        `/api/workflow/${workflowId}/execute?executionId=${newExecutionId}`
      );
      attachEventSource(es);
    } catch (err) {
      setStatus("error");
      setLogs((prev) => [
        ...prev,
        {
          nodeId: "system",
          nodeType: "system",
          message: `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
          status: "error" as const,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, [workflowId, attachEventSource]);

  const reconnect = useCallback((execId: string, initialPromptData?: Record<string, unknown>) => {
    setExecutionId(execId);
    setLogs([]);
    setStatus(initialPromptData ? "waiting-prompt" : "running");
    setPromptData(initialPromptData ?? null);

    const es = new EventSource(
      `/api/workflow/${workflowId}/execute?executionId=${execId}`
    );
    attachEventSource(es);
  }, [workflowId, attachEventSource]);

  const stop = useCallback(async () => {
    if (!executionId) return;
    try {
      const res = await fetch(`/api/workflow/${workflowId}/stop`, {
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
  }, [executionId, workflowId]);

  const handlePromptResponse = useCallback(
    async (value: string | null) => {
      if (!executionId) return;
      setPromptData(null);
      setStatus("running");

      await fetch("/api/prompt-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, value }),
      });
    },
    [executionId]
  );

  return {
    start,
    reconnect,
    stop,
    status,
    logs,
    promptData,
    handlePromptResponse,
    executionId,
  };
}
