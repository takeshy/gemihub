/**
 * Local chat execution hook.
 * Calls Gemini API directly from the browser using gemini-chat-core.ts.
 * Drive tools → drive-tools-local.ts (IndexedDB)
 * MCP tools → /api/workflow/mcp-proxy (server proxy)
 *
 * Pattern follows app/engine/local-handlers/command.ts.
 */
import {
  chatWithToolsStream,
  chatStream,
  generateImageStream,
} from "~/services/gemini-chat-core";
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
import type { Message, StreamChunk, McpAppInfo } from "~/types/chat";
import type { SkillWorkflowRef } from "~/types/skill";
import type { DriveEvent } from "~/engine/local-executor";
import { readFileLocal } from "~/services/drive-local";
import { parseWorkflowContentByName } from "~/engine/parser";
import { executeWorkflowLocally, type LocalExecuteCallbacks } from "~/engine/local-executor";
import { buildWorkflowToolId } from "~/services/skill-loader";

export interface LocalChatOptions {
  apiKey: string;
  model: ModelType;
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
  skillWorkflows?: Array<{
    skillId: string;
    skillName: string;
    workflow: SkillWorkflowRef;
    folderId: string;
  }>;
}

export interface LocalChatCallbacks {
  onDriveEvent?: (event: DriveEvent) => void;
  onMcpApp?: (app: McpAppInfo) => void;
}

export async function* executeLocalChat(
  options: LocalChatOptions,
  callbacks?: LocalChatCallbacks,
): AsyncGenerator<StreamChunk> {
  const {
    apiKey,
    model,
    messages,
    systemPrompt,
    driveToolMode,
    mcpServerIds,
    ragStoreIds,
    webSearchEnabled = false,
    enableThinking,
    maxFunctionCalls,
    functionCallWarningThreshold,
    ragTopK,
    abortSignal,
    skillWorkflows,
  } = options;

  // Image generation model
  if (isImageGenerationModel(model)) {
    yield* generateImageStream(apiKey, messages, model, systemPrompt);
    return;
  }

  // Build tools array
  const tools: ToolDefinition[] = [];

  // Drive tools
  if (driveToolMode !== "none") {
    if (driveToolMode === "noSearch") {
      tools.push(
        ...DRIVE_TOOL_DEFINITIONS.filter(
          (t) => !DRIVE_SEARCH_TOOL_NAMES.has(t.name),
        ),
      );
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  // MCP tools (fetch definitions via proxy)
  let mcpToolDefs: ToolDefinition[] = [];
  if (mcpServerIds.length > 0) {
    try {
      const res = await fetch("/api/workflow/mcp-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getToolDefinitions",
          mcpServerIds,
        }),
        signal: abortSignal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tools && Array.isArray(data.tools)) {
          mcpToolDefs = data.tools;
          tools.push(...mcpToolDefs);
        }
      }
    } catch (err) {
      if (abortSignal?.aborted) throw err;
      console.error("Failed to get MCP tool definitions:", err);
    }
  }

  // Skill workflow tool
  if (skillWorkflows && skillWorkflows.length > 0) {
    const workflowIds = skillWorkflows.map((sw) =>
      buildWorkflowToolId(sw.skillId, sw.workflow),
    );
    tools.push({
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
            description: "Optional JSON object of input variables",
          },
        },
        required: ["workflowId"],
      },
    });
  }

  // JavaScript sandbox tool (not available for Gemma models which lack function calling)
  if (!model.toLowerCase().includes("gemma")) {
    tools.push(EXECUTE_JAVASCRIPT_TOOL);
  }

  // Build tool dispatcher
  const driveToolNames = new Set(DRIVE_TOOL_DEFINITIONS.map((t) => t.name));
  const mcpToolNames = new Set(mcpToolDefs.map((t) => t.name));

  const executeToolCall = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (abortSignal?.aborted) throw new Error("Aborted");

    if (driveToolNames.has(name)) {
      const result = await executeLocalDriveTool(
        name,
        args,
        {
          onDriveEvent: (event) => callbacks?.onDriveEvent?.(event),
        },
        abortSignal,
      );

      // Strip large fields from responses sent back to Gemini to save tokens
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

    if (mcpToolNames.has(name) && mcpServerIds.length > 0) {
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
        return {
          error: err instanceof Error ? err.message : "MCP tool call failed",
        };
      }
    }

    // JavaScript sandbox tool
    if (name === "execute_javascript") {
      try {
        const code = args.code as string;
        const input = args.input as string | undefined;
        const result = await executeSandboxedJS(code, input);
        return { result };
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return {
          error: err instanceof Error ? err.message : "JavaScript execution failed",
        };
      }
    }

    // Skill workflow tool
    if (name === "run_skill_workflow" && skillWorkflows && skillWorkflows.length > 0) {
      try {
        const workflowId = args.workflowId as string;
        const variablesJson = (args.variables as string) || "{}";

        // Find matching skill workflow
        const match = skillWorkflows.find(
          (sw) => buildWorkflowToolId(sw.skillId, sw.workflow) === workflowId,
        );
        if (!match) {
          return { error: `Skill workflow not found: ${workflowId}` };
        }

        // Resolve the workflow file from pre-resolved fileId
        const fileId = match.workflow.fileId;
        if (!fileId) {
          return { error: `Workflow file not found: ${match.workflow.path}` };
        }

        const content = await readFileLocal(fileId);
        const workflow = parseWorkflowContentByName(content);

        // Parse input variables
        let initialVariables: Record<string, string | number> = {};
        try {
          const parsed = JSON.parse(variablesJson);
          if (typeof parsed === "object" && parsed !== null) {
            initialVariables = parsed;
          }
        } catch { /* ignore parse errors */ }

        // Execute workflow headlessly with no-op callbacks
        const headlessCallbacks: LocalExecuteCallbacks = {
          onLog: () => {},
          onDriveEvent: (event) => callbacks?.onDriveEvent?.(event),
          promptCallbacks: {
            promptForValue: async () => null,
            promptForDialog: async () => null,
            promptForDriveFile: async () => null,
          },
        };
        const result = await executeWorkflowLocally(workflow, headlessCallbacks, {
          initialVariables,
          workflowId: fileId,
        });

        // Collect result variables
        const resultVars: Record<string, string | number> = {};
        for (const [k, v] of result.context.variables) {
          resultVars[k] = v;
        }

        return {
          status: result.historyRecord?.status || "completed",
          variables: resultVars,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : "Skill workflow execution failed",
        };
      }
    }

    return { error: `Unknown tool: ${name}` };
  };

  // Stream with tools
  yield* chatWithToolsStream(
    apiKey,
    model,
    messages,
    tools,
    systemPrompt,
    tools.length > 0 ? executeToolCall : undefined,
    ragStoreIds,
    {
      webSearchEnabled,
      enableThinking,
      functionCallLimits:
        maxFunctionCalls !== undefined || functionCallWarningThreshold !== undefined
          ? { maxFunctionCalls, functionCallWarningThreshold }
          : undefined,
      ragTopK,
    },
  );
}

export { chatStream };
