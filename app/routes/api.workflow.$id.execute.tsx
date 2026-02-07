import type { Route } from "./+types/api.workflow.$id.execute";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { readFile, getDriveContext } from "~/services/google-drive.server";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflow } from "~/engine/executor";
import type { ServiceContext, PromptCallbacks, ExecutionLog } from "~/engine/types";
import { getSettings } from "~/services/user-settings.server";
import {
  createExecution,
  addLog,
  setCompleted,
  setError,
  subscribe,
  requestPrompt,
} from "~/services/execution-store.server";
import { saveExecutionRecord } from "~/services/workflow-history.server";
import yaml from "js-yaml";

// POST: Start execution
export async function action({ request, params }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const fileId = params.id;
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create execution state
  const executionState = createExecution(executionId, fileId);

  // Start workflow execution in background
  (async () => {
    try {
      const content = await readFile(validTokens.accessToken, fileId);
      const workflow = parseWorkflowYaml(content);
      const driveContext = await getDriveContext(validTokens);

      // Extract workflow name from YAML
      let workflowName: string | undefined;
      try {
        const parsed = yaml.load(content) as Record<string, unknown>;
        if (parsed && typeof parsed.name === "string") {
          workflowName = parsed.name;
        }
      } catch { /* ignore parse errors */ }

      // Load settings for edit history
      let editHistorySettings;
      try {
        const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
        editHistorySettings = settings.editHistory;
      } catch { /* ignore */ }

      const serviceContext: ServiceContext = {
        driveAccessToken: validTokens.accessToken,
        driveRootFolderId: validTokens.rootFolderId,
        driveHistoryFolderId: driveContext.historyFolderId,
        geminiApiKey: validTokens.geminiApiKey,
        abortSignal: executionState.abortController.signal,
        editHistorySettings,
      };

      const promptCallbacks: PromptCallbacks = {
        promptForValue: async (title, defaultValue, multiline) => {
          const result = await requestPrompt(executionId, "value", {
            title,
            defaultValue,
            multiline,
          });
          return result;
        },
        promptForDialog: async (
          title, message, options, multiSelect, button1, button2,
          markdown, inputTitle, defaults, multiline
        ) => {
          const result = await requestPrompt(executionId, "dialog", {
            title, message, options, multiSelect, button1, button2,
            markdown, inputTitle, defaults, multiline,
          });
          if (!result) return null;
          try {
            return JSON.parse(result);
          } catch {
            return { button: button1, selected: [], input: result };
          }
        },
        promptForDriveFile: async (title, extensions) => {
          const result = await requestPrompt(executionId, "drive-file", {
            title,
            extensions,
          });
          if (!result) return null;
          try {
            return JSON.parse(result);
          } catch {
            return { id: result, name: result };
          }
        },
      };

      const onLog = (log: ExecutionLog) => {
        addLog(executionId, log);
      };

      const result = await executeWorkflow(
        workflow,
        { variables: new Map() },
        serviceContext,
        onLog,
        { workflowId: fileId, workflowName, abortSignal: executionState.abortController.signal },
        promptCallbacks
      );

      const record = result.historyRecord;
      if (record?.status === "error") {
        const lastErrorStep = record.steps.filter(s => s.status === "error").pop();
        setError(executionId, lastErrorStep?.error || "Workflow execution failed");
      } else if (record?.status === "cancelled") {
        setError(executionId, "Workflow execution was stopped");
      } else {
        setCompleted(executionId, record);
      }

      if (record) {
        try {
          await saveExecutionRecord(
            validTokens.accessToken,
            validTokens.rootFolderId,
            record
          );
        } catch (e) {
          console.error("Failed to save execution history:", e);
        }
      }
    } catch (err) {
      setError(
        executionId,
        err instanceof Error ? err.message : String(err)
      );
    }
  })();

  return Response.json({ executionId }, { headers: responseHeaders });
}

// GET: SSE stream
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAuth(request);

  const url = new URL(request.url);
  const executionId = url.searchParams.get("executionId");

  if (!executionId) {
    return new Response("Missing executionId", { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // Stream closed
        }
      };

      const unsubscribe = subscribe(executionId, send);

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
