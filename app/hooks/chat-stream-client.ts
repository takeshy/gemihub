/**
 * Client-side chat stream orchestrator for `/api/chat`.
 *
 * The server streams Vertex AI chunks and can emit `requires_action` for
 * client-only tools such as JavaScript sandbox execution and skill workflows.
 * This module executes those tools locally, appends their results to the
 * working message history, and resumes the `/api/chat` loop.
 */

import { executeSandboxedJS, EXECUTE_JAVASCRIPT_TOOL } from "~/services/sandbox-executor";
import {
  isImageGenerationModel,
  type ToolDefinition,
  type ModelType,
  type DriveToolMode,
  type UserSettings,
} from "~/types/settings";
import type { Message, StreamChunk, StreamChunkUsage, ToolCall, McpAppInfo } from "~/types/chat";
import type { DriveEvent } from "~/engine/local-executor";
import type { ExecutionLog } from "~/engine/types";
import { isDriveToolMediaResult } from "~/services/gemini-content-builders";
import { executeLocalDriveTool } from "~/services/drive-tools-local";
import {
  executeSkillWorkflowTool,
  type SkillWorkflowCallbacks,
  type SkillWorkflowEntry,
} from "./skillWorkflowTool";
import { getWorkflowNodeSpec } from "~/engine/workflowSpec";
import {
  CALENDAR_TOOL_NAMES,
  GMAIL_SEND_TOOL_NAME,
  HUBWORK_TOOL_DEFINITIONS,
} from "~/services/hubwork-tool-definitions";
import {
  getCachedObject,
  objectPathForCachedFile,
  setCachedObject,
  setLocalSyncEntry,
  type CachedObject,
} from "~/services/storage-cache";
import { mimeTypeFromFileName } from "~/utils/mime-type";
import { buildOkfDocumentTool, executeReadOkfDocumentTool } from "./okfDocumentTool";
import {
  executeTimelineTool,
  TIMELINE_TOOL_DEFINITIONS,
} from "~/services/system-timeline";

/**
 * Callbacks the chat caller can hand to executeChatStream.
 */
export interface LocalChatCallbacks extends SkillWorkflowCallbacks {
  onDriveEvent?: (event: DriveEvent) => void;
  onMcpApp?: (app: McpAppInfo) => void;
  onSkillWorkflowLog?: (log: ExecutionLog) => void;
}

export interface ChatStreamOptions {
  /** Org project — required for org-scoped Vertex. Omit for personalVertex. */
  projectId?: string;
  /** When true, the request runs on the service-default Vertex connection with a personal prepaid budget. */
  personalVertex?: boolean;
  /** Enterprise tenant identifier ({orgId}/{projectId}) for GCS-backed local tools. */
  mountKey?: string;
  model: ModelType;
  canUseProxy: boolean;
  messages: Message[];
  systemPrompt?: string;
  driveToolMode: DriveToolMode;
  mcpServerIds: string[];
  ragStoreIds?: string[];
  webSearchEnabled?: boolean;
  enableThinking?: boolean;
  maxFunctionCalls?: number;
  functionCallWarningThreshold?: number;
  ragTopK?: number;
  abortSignal?: AbortSignal;
  skillWorkflows?: SkillWorkflowEntry[];
  requirePlanApproval?: boolean;
  settings?: UserSettings;
  okfRoot?: string;
  activeOkfBundleIds?: string[];
}

function normalizeStoragePath(path: string): string {
  return path.replace(/^\/+/, "");
}

async function readRemoteTextFile(
  projectId: string,
  relativePath: string,
): Promise<{ content: string; contentType: string; md5Hash: string; revision: string } | null> {
  const res = await fetch(
    `/api/storage/read?mount=${encodeURIComponent(`project:${projectId}`)}&path=${encodeURIComponent(relativePath)}&format=json`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Failed to read ${relativePath}`);
  }
  const data = (await res.json()) as {
    content: string;
    object: { contentType: string; md5Hash: string; revision: string };
  };
  return {
    content: data.content,
    contentType: data.object.contentType,
    md5Hash: data.object.md5Hash,
    revision: data.object.revision,
  };
}

async function executeLocalStorageWriteTool(
  name: string,
  args: Record<string, unknown>,
  callbacks: LocalChatCallbacks | undefined,
  options: {
    mountKey?: string;
    projectId?: string;
  } | undefined,
): Promise<unknown> {
  const mountKey = options?.mountKey;
  const projectId = options?.projectId;
  if (!mountKey || !projectId) {
    return { error: `${name}: project context is required for local file writes` };
  }

  const rawPath = name === "create_drive_file" ? args.name : args.fileId;
  const content = args.content;
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return { error: `${name}: '${name === "create_drive_file" ? "name" : "fileId"}' must be a non-empty string` };
  }
  if (typeof content !== "string") {
    return { error: `${name}: 'content' must be a string` };
  }

  const relativePath = normalizeStoragePath(rawPath);
  const objectPath = objectPathForCachedFile(mountKey, relativePath);
  const existingCached = await getCachedObject(mountKey, objectPath);
  const remote = existingCached
    ? null
    : await readRemoteTextFile(projectId, relativePath).catch((err) => {
        if (err instanceof Error && /not found/i.test(err.message)) return null;
        throw err;
      });

  if (name === "create_drive_file" && (existingCached || remote)) {
    return {
      error: `create_drive_file: a file already exists at '${relativePath}'. Use update_drive_file instead.`,
      existingFileId: relativePath,
    };
  }
  if (name === "update_drive_file" && !existingCached && !remote) {
    return { error: `File not found: ${relativePath}` };
  }

  const base: CachedObject | undefined = existingCached ?? (remote
    ? {
        mountKey,
        objectPath,
        relativePath,
        content: remote.content,
        encoding: "utf-8",
        contentType: remote.contentType,
        md5Hash: remote.md5Hash,
        revision: remote.revision,
        cachedAt: Date.now(),
        dirty: false,
      }
    : undefined);
  const next: CachedObject = base
    ? {
        ...base,
        content,
        encoding: "utf-8",
        contentType: base.contentType || mimeTypeFromFileName(relativePath),
        cachedAt: Date.now(),
        dirty: true,
      }
    : {
        mountKey,
        objectPath,
        relativePath,
        content,
        encoding: "utf-8",
        contentType: mimeTypeFromFileName(relativePath),
        md5Hash: "",
        revision: "0",
        cachedAt: Date.now(),
        dirty: true,
      };
  await setCachedObject(next);
  await setLocalSyncEntry({
    mountKey,
    objectPath,
    relativePath,
    md5Hash: next.md5Hash,
    revision: next.revision,
    updatedAt: next.cachedAt,
  });

  callbacks?.onDriveEvent?.({
    type: name === "create_drive_file" ? "created" : "updated",
    fileId: relativePath,
    fileName: relativePath,
    content,
    md5Checksum: "",
    modifiedTime: new Date().toISOString(),
  });

  return {
    id: relativePath,
    name: relativePath,
    localOnly: true,
    dirty: true,
    message: "Saved to local IndexedDB cache. Use Push to upload this change to Cloud Storage.",
  };
}

// ---------------------------------------------------------------------------
// SSE parser
// ---------------------------------------------------------------------------

async function* parseSSEStream(
  response: Response,
  abortSignal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (abortSignal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n\n")) {
        const lineEnd = buffer.indexOf("\n\n");
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);

        if (line.startsWith("data: ")) {
          try {
            const chunk = JSON.parse(line.slice(6)) as StreamChunk;
            yield chunk;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Tool dispatcher for client-only and local-first tools.
// ---------------------------------------------------------------------------

function buildToolDispatcher(
  mcpServerIds: string[],
  skillWorkflows: ChatStreamOptions["skillWorkflows"],
  callbacks?: LocalChatCallbacks,
  abortSignal?: AbortSignal,
  options?: {
    requirePlanApproval?: boolean;
    canUseProxy?: boolean;
    settings?: UserSettings;
    mountKey?: string;
    projectId?: string;
    /** Drive mount running on personal Vertex — writes go to the Drive cache. */
    personalVertex?: boolean;
    okfRoot?: string;
    activeOkfBundleIds?: string[];
  },
): {
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  mcpToolNames: Set<string>;
} {
  const planApprovalPending = options?.requirePlanApproval ?? false;

  // MCP tool names are resolved dynamically (names come from server tool definitions)
  // We don't have the names here, so we route unknown tools to MCP if mcpServerIds is non-empty
  const mcpToolNames = new Set<string>();
  const executedSkillWorkflowIds = new Set<string>();
  let skillWorkflowFailed = false;

  const executeToolCall = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (abortSignal?.aborted) throw new Error("Aborted");

    if (planApprovalPending && (name === "create_drive_file" || name === "update_drive_file")) {
      return { error: "BLOCKED: You must present a plan to the user FIRST and wait for their confirmation before writing any file. List ALL files you will create with full web/ paths, then STOP. Do NOT call any file-writing tools in this turn." };
    }

    if (name === "create_drive_file" || name === "update_drive_file") {
      // Personal Vertex runs on the Drive mount, whose local-first writes go
      // through drive-tools-local (IndexedDB + editHistory). The project
      // storage cache below needs a projectId this path does not have.
      if (options?.personalVertex) {
        const result = await executeLocalDriveTool(
          name,
          args,
          { onDriveEvent: (event) => callbacks?.onDriveEvent?.(event) },
          abortSignal,
        );
        // Strip the echoed content before it goes back to the model.
        if (typeof result === "object" && result !== null) {
          const { content: _content, ...rest } = result as Record<string, unknown>;
          return rest;
        }
        return result;
      }
      return executeLocalStorageWriteTool(name, args, callbacks, options);
    }

    // Workflow spec lookup (full spec when nodeTypes omitted)
    if (name === "get_workflow_spec") {
      const nodeTypes = Array.isArray(args.nodeTypes) ? (args.nodeTypes as string[]) : undefined;
      return { spec: getWorkflowNodeSpec(nodeTypes) };
    }

    if (name === "read_okf_document") {
      const bundleId = typeof args.bundleId === "string" ? args.bundleId : "";
      const path = typeof args.path === "string" ? args.path : "";
      return executeReadOkfDocumentTool(
        options?.okfRoot || "Knowledge",
        options?.activeOkfBundleIds,
        bundleId,
        path,
      );
    }

    if (name === "read_timeline" || name === "append_timeline") {
      return executeTimelineTool(name, args);
    }

    // JavaScript sandbox
    if (name === "execute_javascript") {
      try {
        const code = args.code as string;
        const input = args.input as string | undefined;
        const result = await executeSandboxedJS(code, input);
        return { result };
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return { error: err instanceof Error ? err.message : "JavaScript execution failed" };
      }
    }

    // Skill workflow
    if (name === "run_skill_workflow" && skillWorkflows && skillWorkflows.length > 0) {
      if (planApprovalPending) {
        return { error: "BLOCKED: You must present a plan to the user FIRST and wait for their confirmation before calling this tool. List ALL files you will create with full web/ paths, then STOP. Do NOT call any more tools in this turn." };
      }
      const workflowId = args.workflowId as string;
      if (skillWorkflowFailed) {
        return { error: "BLOCKED: A skill workflow already failed in this turn. Do not inspect files or retry automatically; report the failure to the user and stop." };
      }
      if (executedSkillWorkflowIds.has(workflowId)) {
        return { error: `BLOCKED: Skill workflow ${workflowId} was already executed in this turn. Do not retry automatically; report the result to the user and stop.` };
      }
      executedSkillWorkflowIds.add(workflowId);
      try {
        const result = await executeSkillWorkflowTool(
          workflowId,
          (args.variables as string) || "{}",
          skillWorkflows,
          callbacks,
          {
            canUseProxy: options?.canUseProxy,
            settings: options?.settings,
            mountKey: options?.mountKey,
            projectId: options?.projectId,
          },
        );
        if (typeof (result as { error?: unknown }).error === "string") skillWorkflowFailed = true;
        return result;
      } catch (err) {
        skillWorkflowFailed = true;
        return { error: err instanceof Error ? err.message : "Skill workflow execution failed" };
      }
    }

    // Hubwork spreadsheet schema tool — route via settings API
    if (name === "get_spreadsheet_schema") {
      try {
        const ssId = (args.spreadsheetId as string) || "";
        const url = ssId
          ? `/api/settings/hubwork-sheets?spreadsheetId=${encodeURIComponent(ssId)}`
          : "/api/settings/hubwork-sheets?spreadsheetId=__default__";
        const res = await fetch(url, { signal: abortSignal });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { error: (data as { error?: string }).error || "Failed to fetch spreadsheet schema" };
        }
        const data = await res.json();
        return { spreadsheetId: ssId || "(default)", ...data };
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return { error: err instanceof Error ? err.message : "Failed to fetch spreadsheet schema" };
      }
    }

    // Hubwork migrate schema tool
    if (name === "migrate_spreadsheet_schema") {
      if (planApprovalPending) {
        return { error: "BLOCKED: You must present a plan to the user FIRST and wait for their confirmation before calling this tool." };
      }
      try {
        const schema = args.schema as string;
        if (!schema) return { error: "schema parameter is required" };
        const res = await fetch("/api/settings/hubwork-migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schema }),
          signal: abortSignal,
        });
        const data = await res.json();
        if (!res.ok) return { error: (data as { error?: string }).error || "Migration failed" };
        return data;
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return { error: err instanceof Error ? err.message : "Migration failed" };
      }
    }

    // Gmail tools — route via server API.
    if (name === GMAIL_SEND_TOOL_NAME) {
      try {
        const res = await fetch("/api/gmail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send", ...args }),
          signal: abortSignal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { error: (data as { error?: string }).error || "Gmail operation failed" };
        return data;
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return { error: err instanceof Error ? err.message : "Gmail operation failed" };
      }
    }

    // Calendar tools — route via server API
    if (CALENDAR_TOOL_NAMES.has(name)) {
      const actionMap: Record<string, string> = {
        calendar_list_events: "list",
        calendar_create_event: "create",
        calendar_update_event: "update",
        calendar_delete_event: "delete",
      };
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionMap[name], ...args }),
          signal: abortSignal,
        });
        const data = await res.json();
        if (!res.ok) return { error: (data as { error?: string }).error || "Calendar operation failed" };
        return data;
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return { error: err instanceof Error ? err.message : "Calendar operation failed" };
      }
    }

    // MCP tools — route via server proxy
    if (mcpServerIds.length > 0) {
      try {
        const res = await fetch("/api/workflow/mcp-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "executeTool",
            mcpServerIds,
            toolName: name,
            args,
          }),
          signal: abortSignal,
        });
        if (!res.ok) throw new Error(`MCP tool call failed: ${res.status}`);
        const data = await res.json();
        if (data.mcpApp) callbacks?.onMcpApp?.(data.mcpApp);
        return data.textResult;
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return { error: err instanceof Error ? err.message : "MCP tool call failed" };
      }
    }

    return { error: `Unknown tool: ${name}` };
  };

  return { executeToolCall, mcpToolNames };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FUNCTION_CALLS = 50;
const DEFAULT_WARNING_THRESHOLD = 10;

async function requestFunctionCallLimitExtension(details: {
  used: number;
  currentLimit: number;
  extensionAmount: number;
  remaining: number;
}): Promise<number> {
  const input = window.prompt(
    [
      `Tool calls are running low (${details.used}/${details.currentLimit} used, ${details.remaining} remaining).`,
      "Add more tool calls for this response?",
    ].join("\n"),
    String(details.extensionAmount),
  );
  if (input === null) return 0;
  const requested = Number.parseInt(input, 10);
  return Number.isFinite(requested) && requested > 0 ? requested : 0;
}

export async function* executeChatStream(
  options: ChatStreamOptions,
  callbacks?: LocalChatCallbacks,
): AsyncGenerator<StreamChunk> {
  const {
    projectId,
    personalVertex,
    model,
    canUseProxy,
    messages,
    systemPrompt,
    driveToolMode,
    mcpServerIds,
    ragStoreIds,
    webSearchEnabled = false,
    enableThinking,
    maxFunctionCalls = DEFAULT_MAX_FUNCTION_CALLS,
    functionCallWarningThreshold,
    ragTopK,
    abortSignal,
    skillWorkflows,
    requirePlanApproval,
    settings,
    okfRoot,
    activeOkfBundleIds,
  } = options;

  // Image revision models are handled by the server-side /api/chat path.
  if (isImageGenerationModel(model)) {
    yield { type: "error", error: "Image revision models do not support client-side tool delegation" };
    yield { type: "done" };
    return;
  }

  const { executeToolCall } = buildToolDispatcher(
    mcpServerIds,
    skillWorkflows,
    callbacks,
    abortSignal,
    {
      requirePlanApproval,
      canUseProxy,
      settings,
      mountKey: options.mountKey,
      projectId: options.projectId,
      personalVertex,
      okfRoot,
      activeOkfBundleIds,
    },
  );

  // Build extra tool definitions (client-only tools) to send to server
  const extraToolDefinitions: ToolDefinition[] = [];
  extraToolDefinitions.push(...buildOkfDocumentTool(activeOkfBundleIds));
  extraToolDefinitions.push(...TIMELINE_TOOL_DEFINITIONS);
  extraToolDefinitions.push(EXECUTE_JAVASCRIPT_TOOL);
  extraToolDefinitions.push({
    name: "get_workflow_spec",
    description:
      "Return the authoritative GemiHub workflow specification (variable syntax, condition syntax, all node types, trigger block, request.* / __response variables, etc.). Call this WHENEVER you touch a workflow YAML file — creating, modifying, reviewing, or DEBUGGING. When investigating why a workflow does not work, ALWAYS call this FIRST before guessing at the cause: most workflow bugs are wrong parameter names, missing `request.` prefix on input variables, or missing `__response`. Call with no arguments to get the full spec; pass `nodeTypes` only if you already know exactly which sections you need.",
    parameters: {
      type: "object",
      properties: {
        nodeTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. Filter to specific sections (node type names like 'command', 'drive-file', 'calendar-list', or the special name 'trigger'). Omit to receive the entire spec — recommended when debugging an unfamiliar workflow.",
        },
      },
    },
  });
  if (skillWorkflows && skillWorkflows.length > 0) {
    const workflowList = skillWorkflows
      .map((sw) => {
        const id = `${sw.skillId}/${sw.workflow.name || sw.workflow.path.replace(/^.*\//, "").replace(/\.(yaml|yml)$/, "")}`;
        const inputs = sw.workflow.inputVariables?.length ? sw.workflow.inputVariables.join(", ") : "none declared";
        return `- ${id}: ${sw.workflow.description || sw.workflow.path}; inputVariables: ${inputs}`;
      })
      .join("\n");
    extraToolDefinitions.push({
      name: "run_skill_workflow",
      description:
        `Execute a workflow provided by an active agent skill. Use only one of these exact workflow IDs:\n${workflowList}\nLoad the relevant SKILL.md with read_drive_file before calling this tool. If the workflow fails, do NOT retry automatically — report the error to the user instead.`,
      parameters: {
        type: "object",
        properties: {
          workflowId: {
            type: "string",
            description:
              "Workflow ID in the format skillId/workflowName. Discover valid IDs by reading the active skill's SKILL.md.",
          },
          variables: {
            type: "string",
            description: "JSON object of input variables for the workflow",
          },
        },
        required: ["workflowId"],
      },
    });
  }
  extraToolDefinitions.push(...HUBWORK_TOOL_DEFINITIONS);

  const warningThreshold = Math.min(
    functionCallWarningThreshold ?? DEFAULT_WARNING_THRESHOLD,
    maxFunctionCalls,
  );
  let functionCallCount = 0;
  let currentFunctionCallLimit = maxFunctionCalls;
  let lastLimitExtensionPromptLimit: number | null = null;
  // Phase 5e-step4: Vertex isn't stateful — there is no interactionId chain.
  // The hook keeps the field around as `undefined` so the existing `done`
  // chunk shape (interactionId?: string) stays compatible with callers.
  const currentInteractionId: string | undefined = undefined;
  // Working copy of the conversation. Each round we append the assistant
  // turn that surfaced the requires_action plus the tool results we just
  // produced. Server sees the full history on every POST.
  const workingMessages: Message[] = [...messages];
  let shouldStopAfterRound = false;

  // Accumulate usage across rounds
  const totalUsage: StreamChunkUsage = {};
  const webSearchSources: NonNullable<StreamChunk["webSearchSources"]> = [];

  function accumulateWebSearchSources(sources: StreamChunk["webSearchSources"]): void {
    for (const source of sources ?? []) {
      if (!webSearchSources.some((existing) => existing.url === source.url)) webSearchSources.push(source);
    }
  }

  function accumulateUsage(roundUsage: StreamChunkUsage | undefined) {
    if (!roundUsage) return;
    if (roundUsage.inputTokens) totalUsage.inputTokens = (totalUsage.inputTokens ?? 0) + roundUsage.inputTokens;
    if (roundUsage.outputTokens) totalUsage.outputTokens = (totalUsage.outputTokens ?? 0) + roundUsage.outputTokens;
    if (roundUsage.thinkingTokens) totalUsage.thinkingTokens = (totalUsage.thinkingTokens ?? 0) + roundUsage.thinkingTokens;
    if (roundUsage.totalTokens) totalUsage.totalTokens = (totalUsage.totalTokens ?? 0) + roundUsage.totalTokens;
    if (roundUsage.totalCost !== undefined) totalUsage.totalCost = (totalUsage.totalCost ?? 0) + roundUsage.totalCost;
  }

  while (true) {
    if (abortSignal?.aborted) {
      // Emit done so ChatPanel saves any partial message accumulated so far
      yield { type: "done", interactionId: currentInteractionId, usage: totalUsage.totalTokens ? totalUsage : undefined };
      return;
    }

    // Build request body — Vertex/api.chat shape (Phase 5e-step4).
    // Tool results from the previous round are now baked into workingMessages
    // (as the assistant turn's toolCalls + toolResults), not a separate field.
    const requestBody: Record<string, unknown> = {
      ...(personalVertex ? { personalVertex: true } : { projectId }),
      messages: workingMessages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        attachments: m.attachments,
        toolCalls: m.toolCalls,
        toolResults: m.toolResults,
      })),
      model,
      systemPrompt,
      driveToolMode,
      mcpServerIds,
      ragStoreIds,
      webSearchEnabled,
      enableThinking,
      settings: ragTopK != null ? { ragTopK } : undefined,
      requirePlanApproval,
      extraToolDefinitions: extraToolDefinitions.length > 0 ? extraToolDefinitions : undefined,
    };

    // POST to server
    let response: Response;
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });
    } catch (err) {
      if (abortSignal?.aborted) throw err;
      yield { type: "error", error: err instanceof Error ? err.message : "Network error" };
      yield { type: "done", interactionId: currentInteractionId, usage: totalUsage.totalTokens ? totalUsage : undefined };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      yield { type: "error", error: `Server error ${response.status}: ${text}` };
      yield { type: "done", interactionId: currentInteractionId, usage: totalUsage.totalTokens ? totalUsage : undefined };
      return;
    }

    // Parse SSE stream
    let requiresAction = false;
    let pendingToolCalls: ToolCall[] = [];

    for await (const chunk of parseSSEStream(response, abortSignal)) {
      if (abortSignal?.aborted) break;

      if (chunk.type === "requires_action") {
        accumulateWebSearchSources(chunk.webSearchSources);
        requiresAction = true;
        pendingToolCalls = chunk.pendingToolCalls ?? [];
        accumulateUsage(chunk.usage);
        continue;
      }

      if (chunk.type === "done") {
        accumulateWebSearchSources(chunk.webSearchSources);
        accumulateUsage(chunk.usage);
        if (requiresAction) {
          break;
        }
        // Yield done with accumulated total usage
        yield {
          type: "done",
          interactionId: currentInteractionId,
          usage: totalUsage.totalTokens ? totalUsage : chunk.usage,
          webSearchSources: webSearchSources.length > 0 ? webSearchSources : undefined,
        };
        return;
      }

      yield chunk;
    }

    if (!requiresAction) {
      // Stream ended without requires_action or done — emit done so ChatPanel saves the message
      yield { type: "done", interactionId: currentInteractionId, usage: totalUsage.totalTokens ? totalUsage : undefined };
      return;
    }

    // If previous round already hit the limit and model still wants tool calls, stop now
    if (shouldStopAfterRound) {
      yield {
        type: "done",
        interactionId: currentInteractionId,
        usage: totalUsage.totalTokens ? totalUsage : undefined,
      };
      return;
    }

    // Execute tool calls locally
    let remainingBefore = currentFunctionCallLimit - functionCallCount;
    const results: Array<{ callId: string; name: string; result: unknown }> = [];

    if (remainingBefore <= 0) {
      yield {
        type: "text",
        content: "\n\n[Function call limit reached. Summarizing with available information...]",
      };
      // Send error results for all pending calls so the model can produce a final summary
      for (const fc of pendingToolCalls) {
        results.push({
          callId: fc.id,
          name: fc.name,
          result: { error: "Function call limit reached. Please provide a final answer based on the information gathered so far." },
        });
      }
      shouldStopAfterRound = true;
    } else {
      if (
        lastLimitExtensionPromptLimit !== currentFunctionCallLimit
        && (
          remainingBefore <= warningThreshold
          || remainingBefore - Math.min(pendingToolCalls.length, remainingBefore) <= warningThreshold
          || pendingToolCalls.length > remainingBefore
        )
      ) {
        lastLimitExtensionPromptLimit = currentFunctionCallLimit;
        const extensionAmount = await requestFunctionCallLimitExtension({
          used: functionCallCount,
          currentLimit: currentFunctionCallLimit,
          extensionAmount: maxFunctionCalls,
          remaining: remainingBefore,
        });
        if (extensionAmount > 0) {
          currentFunctionCallLimit += extensionAmount;
          remainingBefore = currentFunctionCallLimit - functionCallCount;
        }
      }

      const callsToExecute = pendingToolCalls.slice(0, remainingBefore);
      const skippedCount = pendingToolCalls.length - callsToExecute.length;

      for (const fc of callsToExecute) {
        yield { type: "tool_call", toolCall: fc };

        let result: unknown;
        try {
          result = await executeToolCall(fc.name, fc.args);
        } catch (err) {
          if (abortSignal?.aborted) throw err;
          result = { error: err instanceof Error ? err.message : "Tool execution failed" };
        }

        if (isDriveToolMediaResult(result)) {
          yield {
            type: "tool_result",
            toolResult: {
              toolCallId: fc.id,
              result: { mediaFile: result.__mediaData.fileName, mimeType: result.__mediaData.mimeType },
            },
          };
          results.push({ callId: fc.id, name: fc.name, result: { fileName: result.__mediaData.fileName } });
        } else {
          yield {
            type: "tool_result",
            toolResult: { toolCallId: fc.id, result },
          };
          results.push({ callId: fc.id, name: fc.name, result });
        }
      }

      functionCallCount += callsToExecute.length;

      if (skippedCount > 0 || functionCallCount >= currentFunctionCallLimit) {
        const skippedMsg = skippedCount > 0 ? ` (${skippedCount} additional calls were skipped)` : "";
        yield {
          type: "text",
          content: `\n\n[Function call limit reached${skippedMsg}. Summarizing with available information...]`,
        };
        // Add error results for skipped calls so model knows they were not executed
        for (const fc of pendingToolCalls.slice(remainingBefore)) {
          results.push({
            callId: fc.id,
            name: fc.name,
            result: { error: "Function call limit reached. Please provide a final answer based on the information gathered so far." },
          });
        }
        shouldStopAfterRound = true;
      }
    }

    // Phase 5e-step4: instead of attaching toolResults as a separate request
    // field, append an assistant message that carries both the model's
    // function calls and the executed results. messagesToContents on the
    // server expands this single turn into the (model: functionCall,
    // user: functionResponse) pair that Vertex expects.
    workingMessages.push({
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      toolCalls: pendingToolCalls,
      toolResults: results.map((r) => ({ toolCallId: r.callId, result: r.result })),
    });
  }
}
