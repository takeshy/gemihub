import type { Route } from "./+types/api.workflow.$id.execute";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  readFile,
  getDriveContext,
  searchFiles,
  findFileByExactName,
  getFileMetadata,
} from "~/services/google-drive.server";
import { parseWorkflowData, parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflow } from "~/engine/executor";
import type { ServiceContext, PromptCallbacks, ExecutionLog } from "~/engine/types";
import { getSettings } from "~/services/user-settings.server";
import { getEncryptionParams } from "~/types/settings";
import {
  createExecution,
  addLog,
  getExecution,
  isExecutionOwnedBy,
  setCancelled,
  setCompleted,
  setError,
  subscribe,
  requestPrompt,
  broadcastDriveFileUpdated,
  broadcastDriveFileCreated,
  broadcastDriveFileDeleted,
} from "~/services/execution-store.server";
import { saveExecutionRecord } from "~/services/workflow-history.server";
import yaml from "js-yaml";
import { createLogContext, emitLog } from "~/services/logger.server";

function isDriveId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{20,}$/.test(value);
}

function looksLikeWorkflowFile(value: string): boolean {
  return value.endsWith(".yaml") || value.endsWith(".yml");
}

async function resolveWorkflowFileId(
  accessToken: string,
  rootFolderId: string,
  workflowPath: string,
  abortSignal?: AbortSignal
): Promise<{ id: string; name: string }> {
  if (isDriveId(workflowPath)) {
    const metadata = await getFileMetadata(accessToken, workflowPath, {
      signal: abortSignal,
    });
    return { id: metadata.id, name: metadata.name };
  }

  const candidates = looksLikeWorkflowFile(workflowPath)
    ? [workflowPath]
    : [workflowPath, `${workflowPath}.yaml`, `${workflowPath}.yml`];

  const searched = await searchFiles(
    accessToken,
    rootFolderId,
    workflowPath,
    false,
    { signal: abortSignal }
  );
  const bySearch = candidates
    .map((candidate) => searched.find((f) => f.name === candidate))
    .find(Boolean);
  if (bySearch) return { id: bySearch.id, name: bySearch.name };

  for (const candidate of candidates) {
    const exact = await findFileByExactName(accessToken, candidate, rootFolderId, {
      signal: abortSignal,
    });
    if (exact) return { id: exact.id, name: exact.name };
  }

  throw new Error(`Sub-workflow file not found: ${workflowPath}`);
}

function parseWorkflowContentByName(
  content: string,
  workflowName?: string
) {
  if (!workflowName) {
    return parseWorkflowYaml(content);
  }

  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid sub-workflow YAML");
  }

  const root = parsed as Record<string, unknown>;
  const workflows = root.workflows;
  if (Array.isArray(workflows)) {
    const selected = workflows.find((item) => (
      item &&
      typeof item === "object" &&
      (item as Record<string, unknown>).name === workflowName
    ));
    if (!selected || typeof selected !== "object") {
      throw new Error(`Sub-workflow not found by name: ${workflowName}`);
    }
    return parseWorkflowData(selected as Record<string, unknown>);
  }

  return parseWorkflowYaml(content);
}

// POST: Start execution
export async function action({ request, params }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const logCtx = createLogContext(request, "/api/workflow/execute", validTokens.rootFolderId);

  const fileId = params.id;
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  logCtx.details = { workflowId: fileId, executionId, streaming: true };
  emitLog(logCtx, 200);

  // Create execution state
  const executionState = createExecution(executionId, fileId, validTokens.rootFolderId);

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

      // Load settings for edit history and command node tools
      let settings;
      try {
        settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      } catch { /* ignore */ }
      const MAX_SUBWORKFLOW_DEPTH = 20;
      const subWorkflowStack: string[] = [`${fileId}:${workflowName ?? ""}`];

      const serviceContext: ServiceContext = {
        driveAccessToken: validTokens.accessToken,
        driveRootFolderId: validTokens.rootFolderId,
        driveHistoryFolderId: driveContext.historyFolderId,
        geminiApiKey: validTokens.geminiApiKey,
        abortSignal: executionState.abortController.signal,
        editHistorySettings: settings?.editHistory,
        settings,
        onDriveFileUpdated: (data) => broadcastDriveFileUpdated(executionId, data),
        onDriveFileCreated: (data) => broadcastDriveFileCreated(executionId, data),
        onDriveFileDeleted: (data) => broadcastDriveFileDeleted(executionId, data),
      };

      const onLog = (log: ExecutionLog) => {
        addLog(executionId, log);
      };

      let cachedEncryptionPassword: string | null = null;
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
        promptForDiff: async (title, fileName, oldContent, newContent) => {
          const { createTwoFilesPatch } = await import("diff");
          const diffStr = createTwoFilesPatch(
            fileName, fileName, oldContent, newContent,
            "Current", "New", { context: 3 }
          );
          const result = await requestPrompt(executionId, "diff", {
            title, fileName, diff: diffStr,
            button1: "OK", button2: "Cancel",
          });
          return result === "OK";
        },
        promptForPassword: async (title) => {
          if (cachedEncryptionPassword) return cachedEncryptionPassword;
          const result = await requestPrompt(executionId, "password", {
            title: title || "Enter password",
          });
          if (result) cachedEncryptionPassword = result;
          return result;
        },
        executeSubWorkflow: async (
          workflowPath,
          subWorkflowName,
          inputVariables
        ) => {
          const resolved = await resolveWorkflowFileId(
            validTokens.accessToken,
            validTokens.rootFolderId,
            workflowPath,
            executionState.abortController.signal
          );
          const subKey = `${resolved.id}:${subWorkflowName ?? ""}`;
          if (subWorkflowStack.length >= MAX_SUBWORKFLOW_DEPTH) {
            throw new Error(`Sub-workflow depth exceeded limit (${MAX_SUBWORKFLOW_DEPTH})`);
          }
          if (subWorkflowStack.includes(subKey)) {
            const pathChain = [...subWorkflowStack, subKey].join(" -> ");
            throw new Error(`Sub-workflow cycle detected: ${pathChain}`);
          }

          subWorkflowStack.push(subKey);
          try {
            const subContent = await readFile(validTokens.accessToken, resolved.id);
            const subWorkflow = parseWorkflowContentByName(subContent, subWorkflowName);

            const subResult = await executeWorkflow(
              subWorkflow,
              { variables: new Map(inputVariables) },
              serviceContext,
              onLog,
              {
                workflowId: resolved.id,
                workflowName: subWorkflowName,
                abortSignal: executionState.abortController.signal,
              },
              promptCallbacks
            );

            if (subResult.historyRecord?.status === "cancelled") {
              throw new Error("Sub-workflow execution cancelled");
            }
            if (subResult.historyRecord?.status === "error") {
              const subError = subResult.historyRecord.steps
                .filter((s) => s.status === "error")
                .pop()
                ?.error;
              throw new Error(subError || "Sub-workflow execution failed");
            }

            return subResult.context.variables;
          } finally {
            subWorkflowStack.pop();
          }
        },
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
      if (executionState.abortController.signal.aborted || record?.status === "cancelled") {
        setCancelled(executionId, "Workflow execution was stopped", record);
      } else if (record?.status === "error") {
        const lastErrorStep = record.steps.filter(s => s.status === "error").pop();
        setError(executionId, lastErrorStep?.error || "Workflow execution failed");
      } else {
        // Check for __openFile from drive-file node with open: true
        const openFileRaw = result.context.variables.get("__openFile");
        let openFile: { fileId: string; fileName: string; mimeType: string } | undefined;
        if (typeof openFileRaw === "string") {
          try { openFile = JSON.parse(openFileRaw); } catch { /* ignore */ }
        }
        setCompleted(executionId, record, openFile);
      }

      if (record) {
        try {
          const encryption = settings ? getEncryptionParams(settings, "workflow") : undefined;
          await saveExecutionRecord(
            validTokens.accessToken,
            validTokens.rootFolderId,
            record,
            encryption
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
export async function loader({ request, params: _params }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);

  const url = new URL(request.url);
  const executionId = url.searchParams.get("executionId");

  if (!executionId) {
    return new Response("Missing executionId", { status: 400 });
  }

  const execution = getExecution(executionId);
  if (!execution) {
    return new Response("Execution not found", { status: 404 });
  }
  if (execution.workflowId !== _params.id || !isExecutionOwnedBy(executionId, tokens.rootFolderId)) {
    return new Response("Forbidden", { status: 403 });
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
