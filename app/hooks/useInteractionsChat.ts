/**
 * Interactions API chat hook.
 * Calls the server-side /api/chat/interactions SSE endpoint,
 * executes tool calls locally (local-first), and resumes the
 * interaction with tool results via multi-round POST requests.
 */

import {
  DRIVE_TOOL_DEFINITIONS,
  DRIVE_SEARCH_TOOL_NAMES,
} from "~/services/drive-tool-definitions";
import { executeLocalDriveTool } from "~/services/drive-tools-local";
import { executeSandboxedJS, EXECUTE_JAVASCRIPT_TOOL } from "~/services/sandbox-executor";
import {
  isImageGenerationModel,
  type ToolDefinition,
  type ModelType,
  type DriveToolMode,
} from "~/types/settings";
import type { Message, StreamChunk, StreamChunkUsage, ToolCall } from "~/types/chat";
import { buildWorkflowToolId } from "~/services/skill-loader";
import { isDriveToolMediaResult } from "~/services/gemini-chat-core";
import type { LocalChatCallbacks } from "./useLocalChat";
import { executeSkillWorkflowTool, type SkillWorkflowEntry } from "./skillWorkflowTool";

export interface InteractionsChatOptions {
  model: ModelType;
  messages: Message[];
  systemPrompt?: string;
  previousInteractionId?: string;
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
// Tool dispatcher (same logic as useLocalChat.ts)
// ---------------------------------------------------------------------------

function buildToolDispatcher(
  driveToolMode: DriveToolMode,
  mcpServerIds: string[],
  skillWorkflows: InteractionsChatOptions["skillWorkflows"],
  callbacks?: LocalChatCallbacks,
  abortSignal?: AbortSignal,
  options?: { requirePlanApproval?: boolean },
): {
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  driveToolNames: Set<string>;
  mcpToolNames: Set<string>;
} {
  const planApprovalPending = options?.requirePlanApproval ?? false;
  // Drive tools
  const driveTools = driveToolMode === "none"
    ? []
    : driveToolMode === "noSearch"
      ? DRIVE_TOOL_DEFINITIONS.filter(t => !DRIVE_SEARCH_TOOL_NAMES.has(t.name))
      : DRIVE_TOOL_DEFINITIONS;
  const driveToolNames = new Set(driveTools.map(t => t.name));

  // MCP tool names are resolved dynamically (names come from server tool definitions)
  // We don't have the names here, so we route unknown tools to MCP if mcpServerIds is non-empty
  const mcpToolNames = new Set<string>();

  const executeToolCall = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (abortSignal?.aborted) throw new Error("Aborted");

    // Drive tools — execute locally (IndexedDB)
    if (driveToolNames.has(name)) {
      const result = await executeLocalDriveTool(
        name,
        args,
        { onDriveEvent: (event) => callbacks?.onDriveEvent?.(event) },
        abortSignal,
      );
      // Strip large fields for token savings
      if (name === "update_drive_file" && typeof result === "object" && result !== null) {
        const { content: _content, ...rest } = result as Record<string, unknown>;
        return rest;
      }
      if (name === "create_drive_file" && typeof result === "object" && result !== null) {
        const { content: _content, ...rest } = result as Record<string, unknown>;
        return rest;
      }
      return result;
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
      try {
        return await executeSkillWorkflowTool(
          args.workflowId as string,
          (args.variables as string) || "{}",
          skillWorkflows,
          callbacks,
        );
      } catch (err) {
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

    // Calendar tools — route via server API
    if (name === "calendar_list_events" || name === "calendar_create_event" || name === "calendar_update_event" || name === "calendar_delete_event") {
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

  return { executeToolCall, driveToolNames, mcpToolNames };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FUNCTION_CALLS = 50;
const DEFAULT_WARNING_THRESHOLD = 10;

export async function* executeInteractionsChat(
  options: InteractionsChatOptions,
  callbacks?: LocalChatCallbacks,
): AsyncGenerator<StreamChunk> {
  const {
    model,
    messages,
    systemPrompt,
    previousInteractionId,
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
  } = options;

  // Image generation models should not use Interactions API
  if (isImageGenerationModel(model)) {
    yield { type: "error", error: "Image generation models do not support Interactions API" };
    yield { type: "done" };
    return;
  }

  const { executeToolCall } = buildToolDispatcher(
    driveToolMode,
    mcpServerIds,
    skillWorkflows,
    callbacks,
    abortSignal,
    { requirePlanApproval },
  );

  // Build extra tool definitions (client-only tools) to send to server
  const extraToolDefinitions: ToolDefinition[] = [];
  extraToolDefinitions.push(EXECUTE_JAVASCRIPT_TOOL);
  if (skillWorkflows && skillWorkflows.length > 0) {
    const workflowIds = skillWorkflows.map((sw) => buildWorkflowToolId(sw.skillId, sw.workflow));
    extraToolDefinitions.push({
      name: "run_skill_workflow",
      description:
        "Execute a workflow provided by an active agent skill. Available workflows: " +
        workflowIds.join(", "),
      parameters: {
        type: "object",
        properties: {
          workflowId: {
            type: "string",
            description:
              "Workflow ID in the format skillId/workflowName. Available: " +
              workflowIds.join(", "),
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

  const warningThreshold = Math.min(
    functionCallWarningThreshold ?? DEFAULT_WARNING_THRESHOLD,
    maxFunctionCalls,
  );
  let functionCallCount = 0;
  let warningEmitted = false;
  let currentInteractionId = previousInteractionId;
  let toolResults: Array<{ callId: string; name: string; result: unknown }> | undefined;
  let shouldStopAfterRound = false;

  // Accumulate usage across rounds
  const totalUsage: StreamChunkUsage = {};

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

    // Build request body
    const requestBody: Record<string, unknown> = {
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        attachments: m.attachments,
        interactionId: m.interactionId,
      })),
      model,
      systemPrompt,
      driveToolMode,
      mcpServerIds,
      ragStoreIds,
      webSearchEnabled,
      enableThinking,
      settings: ragTopK != null ? { ragTopK } : undefined,
      extraToolDefinitions: extraToolDefinitions.length > 0 ? extraToolDefinitions : undefined,
    };

    if (toolResults) {
      // Resume: send tool results + current interaction ID
      requestBody.toolResults = toolResults;
      requestBody.currentInteractionId = currentInteractionId;
    } else {
      // Initial: send previous interaction ID for chaining
      requestBody.previousInteractionId = currentInteractionId;
    }

    // POST to server
    let response: Response;
    try {
      response = await fetch("/api/chat/interactions", {
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
    toolResults = undefined;

    for await (const chunk of parseSSEStream(response, abortSignal)) {
      if (abortSignal?.aborted) break;

      if (chunk.type === "requires_action") {
        requiresAction = true;
        pendingToolCalls = chunk.pendingToolCalls ?? [];
        currentInteractionId = chunk.interactionId;
        accumulateUsage(chunk.usage);
        continue;
      }

      if (chunk.type === "done") {
        accumulateUsage(chunk.usage);
        currentInteractionId = chunk.interactionId;
        // Yield done with accumulated total usage
        yield {
          type: "done",
          interactionId: currentInteractionId,
          usage: totalUsage.totalTokens ? totalUsage : chunk.usage,
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
    const remainingBefore = maxFunctionCalls - functionCallCount;

    if (remainingBefore <= 0) {
      yield {
        type: "text",
        content: "\n\n[Function call limit reached. Summarizing with available information...]",
      };
      // Send error results for all pending calls so the model can produce a final summary
      toolResults = pendingToolCalls.map(fc => ({
        callId: fc.id,
        name: fc.name,
        result: { error: "Function call limit reached. Please provide a final answer based on the information gathered so far." },
      }));
      shouldStopAfterRound = true;
      continue;
    }

    const callsToExecute = pendingToolCalls.slice(0, remainingBefore);
    const skippedCount = pendingToolCalls.length - callsToExecute.length;
    const remainingAfter = remainingBefore - callsToExecute.length;

    if (!warningEmitted && remainingAfter <= warningThreshold) {
      warningEmitted = true;
      yield {
        type: "text",
        content: `\n\n[Note: ${remainingAfter} function calls remaining. Please work efficiently.]`,
      };
    }

    const results: Array<{ callId: string; name: string; result: unknown }> = [];

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

    if (skippedCount > 0 || functionCallCount >= maxFunctionCalls) {
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

    toolResults = results;
  }
}
