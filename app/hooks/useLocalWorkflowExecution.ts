import { useState, useRef, useCallback } from "react";
import type { McpAppInfo } from "~/types/chat";
import type { PromptCallbacks, DialogResult, ExecutionLog, ExecutionRecord } from "~/engine/types";
import type { UserSettings } from "~/types/settings";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflowLocally, type DriveEvent } from "~/engine/local-executor";
import { processDriveEvent } from "~/utils/drive-file-local";
import { getCachedLoaderDataInMemory } from "~/routes/_index";
import { getCachedApiKey, setCachedApiKey } from "~/services/api-key-cache";
import { getCachedLoaderData } from "~/services/indexeddb-cache";
import { decryptPrivateKey } from "~/services/crypto-core";

export interface LogEntry {
  nodeId: string;
  nodeType: string;
  message: string;
  status: "info" | "success" | "error";
  timestamp: string;
  input?: Record<string, unknown>;
  output?: unknown;
  mcpApps?: McpAppInfo[];
}

type ExecutionHookStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "error"
  | "waiting-prompt";

interface PromptRequest {
  resolve: (value: string | null) => void;
  data: Record<string, unknown>;
}

async function saveExecutionHistory(record: ExecutionRecord): Promise<void> {
  const res = await fetch("/api/workflow/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", record }),
  });
  if (!res.ok) throw new Error("Failed to save execution history");
}

export function useLocalWorkflowExecution(workflowId: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<ExecutionHookStatus>("idle");
  const [promptData, setPromptData] = useState<Record<string, unknown> | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const promptRequestRef = useRef<PromptRequest | null>(null);

  const onLog = useCallback((log: ExecutionLog) => {
    setLogs((prev) => [
      ...prev,
      {
        nodeId: log.nodeId,
        nodeType: log.nodeType,
        message: log.message,
        status: log.status,
        timestamp: log.timestamp.toISOString(),
        input: log.input,
        output: log.output,
        mcpApps: log.mcpApps,
      },
    ]);
  }, []);

  const onDriveEvent = useCallback((event: DriveEvent) => {
    processDriveEvent(event).catch(() => {});
  }, []);

  /**
   * Create prompt callbacks that show UI directly on the client.
   * When a prompt is needed, we set promptData (which triggers the PromptModal)
   * and return a Promise that resolves when the user responds.
   */
  const createPromptCallbacks = useCallback((): PromptCallbacks => {
    const waitForPrompt = (data: Record<string, unknown>): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        promptRequestRef.current = { resolve, data };
        setStatus("waiting-prompt");
        setPromptData(data);
      });
    };

    return {
      promptForValue: async (title, defaultValue, multiline) => {
        return waitForPrompt({ type: "value", title, defaultValue, multiline });
      },
      promptForDialog: async (
        title, message, options, multiSelect, button1, button2,
        markdown, inputTitle, defaults, multiline,
      ) => {
        const result = await waitForPrompt({
          type: "dialog", title, message, options, multiSelect,
          button1, button2, markdown, inputTitle, defaults, multiline,
        });
        if (!result) return null;
        try {
          return JSON.parse(result) as DialogResult;
        } catch {
          return { button: button1, selected: [], input: result };
        }
      },
      promptForDriveFile: async (title, extensions) => {
        const result = await waitForPrompt({ type: "drive-file", title, extensions });
        if (!result) return null;
        try {
          return JSON.parse(result);
        } catch {
          return { id: result, name: result };
        }
      },
      promptForDiff: async (title, fileName, oldContent, newContent) => {
        let diffStr: string | undefined;
        if (oldContent && !newContent) {
          // Pre-computed diff passed directly (from server-side prompt round-trip)
          diffStr = oldContent;
        } else if (oldContent || newContent) {
          const { createTwoFilesPatch } = await import("diff");
          diffStr = createTwoFilesPatch(
            fileName, fileName, oldContent, newContent,
            "Current", "New", { context: 3 },
          );
        }
        const result = await waitForPrompt({
          type: "diff", title, fileName,
          diff: diffStr, button1: "OK", button2: "Cancel",
        });
        return result === "OK";
      },
      promptForPassword: async (title) => {
        return waitForPrompt({ type: "password", title: title || "Enter password" });
      },
    };
  }, []);

  const executeWorkflow = useCallback(async (
    yamlContent: string,
    options?: { startNodeId?: string; initialVariables?: Record<string, string | number>; workflowName?: string },
  ) => {
    // Abort any previous execution before starting a new one
    abortControllerRef.current?.abort();

    setLogs([]);
    setStatus("running");
    setPromptData(null);
    promptRequestRef.current = null;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const workflow = parseWorkflowYaml(yamlContent);
      const promptCallbacks = createPromptCallbacks();

      // Get settings from in-memory cache or IndexedDB
      let settings = getCachedLoaderDataInMemory()?.settings as UserSettings | undefined;
      if (!settings) {
        const cached = await getCachedLoaderData();
        settings = cached?.settings as UserSettings | undefined;
      }

      // Ensure Gemini API key is available for command nodes
      const hasCommandNode = Array.from(workflow.nodes.values()).some(n => n.type === "command");
      let geminiApiKey = getCachedApiKey() || undefined;

      if (hasCommandNode && !geminiApiKey && settings?.encryptedApiKey && settings?.apiKeySalt) {
        if (!promptCallbacks.promptForPassword) throw new Error("Password prompt not available");
        const password = await promptCallbacks.promptForPassword("Enter password");
        if (!password) throw new Error("API key unlock cancelled");
        try {
          geminiApiKey = await decryptPrivateKey(settings.encryptedApiKey, settings.apiKeySalt, password);
          setCachedApiKey(geminiApiKey);
        } catch {
          throw new Error("Failed to decrypt API key (wrong password?)");
        }
      }

      const result = await executeWorkflowLocally(
        workflow,
        { onLog, onDriveEvent, promptCallbacks },
        {
          workflowId,
          workflowName: options?.workflowName,
          abortSignal: abortController.signal,
          startNodeId: options?.startNodeId,
          initialVariables: options?.initialVariables,
          geminiApiKey,
          settings,
        },
      );

      const record = result.historyRecord;
      if (abortController.signal.aborted || record.status === "cancelled") {
        setStatus("cancelled");
      } else if (record.status === "error") {
        setStatus("error");
      } else {
        setStatus("completed");
      }

      // Save execution history to Drive (best-effort, non-blocking)
      saveExecutionHistory(record).catch(() => {});

      return result;
    } catch (err) {
      if (abortController.signal.aborted) {
        setStatus("cancelled");
      } else {
        setStatus("error");
        setLogs((prev) => [
          ...prev,
          {
            nodeId: "system",
            nodeType: "system",
            message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
            status: "error" as const,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      return null;
    } finally {
      abortControllerRef.current = null;
    }
  }, [workflowId, onLog, onDriveEvent, createPromptCallbacks]);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // Also resolve any pending prompt with null
    if (promptRequestRef.current) {
      promptRequestRef.current.resolve(null);
      promptRequestRef.current = null;
      setPromptData(null);
    }
  }, []);

  const handlePromptResponse = useCallback((value: string | null) => {
    if (promptRequestRef.current) {
      promptRequestRef.current.resolve(value);
      promptRequestRef.current = null;
      setPromptData(null);
      if (value !== null) {
        setStatus("running");
      }
    }
  }, []);

  return {
    executeWorkflow,
    stop,
    status,
    logs,
    promptData,
    handlePromptResponse,
  };
}
