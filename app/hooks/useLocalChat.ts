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
  type UserSettings,
} from "~/types/settings";
import type { Message, StreamChunk, McpAppInfo } from "~/types/chat";
import type { DriveEvent } from "~/engine/local-executor";
import type { ExecutionLog } from "~/engine/types";
import {
  executeSkillWorkflowTool,
  type SkillWorkflowCallbacks,
  type SkillWorkflowEntry,
} from "./skillWorkflowTool";
import { getWorkflowNodeSpec } from "~/engine/workflowSpec";

export interface LocalChatOptions {
  apiKey: string;
  canUseProxy: boolean;
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
  skillWorkflows?: SkillWorkflowEntry[];
  requirePlanApproval?: boolean;
  settings?: UserSettings;
}

export interface LocalChatCallbacks extends SkillWorkflowCallbacks {
  onDriveEvent?: (event: DriveEvent) => void;
  onMcpApp?: (app: McpAppInfo) => void;
  onSkillWorkflowLog?: (log: ExecutionLog) => void;
}

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

export async function* executeLocalChat(
  options: LocalChatOptions,
  callbacks?: LocalChatCallbacks,
): AsyncGenerator<StreamChunk> {
  const {
    apiKey,
    canUseProxy,
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
    requirePlanApproval,
    settings,
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
    const workflowList = skillWorkflows
      .map((sw) => {
        const id = `${sw.skillId}/${sw.workflow.name || sw.workflow.path.replace(/^.*\//, "").replace(/\.(yaml|yml)$/, "")}`;
        const inputs = sw.workflow.inputVariables?.length ? sw.workflow.inputVariables.join(", ") : "none declared";
        return `- ${id}: ${sw.workflow.description || sw.workflow.path}; inputVariables: ${inputs}`;
      })
      .join("\n");
    tools.push({
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

  tools.push(EXECUTE_JAVASCRIPT_TOOL);

  tools.push({
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

  // Build tool dispatcher
  const driveToolNames = new Set(DRIVE_TOOL_DEFINITIONS.map((t) => t.name));
  const mcpToolNames = new Set(mcpToolDefs.map((t) => t.name));
  const executedSkillWorkflowIds = new Set<string>();
  let skillWorkflowFailed = false;

  const executeToolCall = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (abortSignal?.aborted) throw new Error("Aborted");

    if (requirePlanApproval && (name === "create_drive_file" || name === "update_drive_file")) {
      return { error: "BLOCKED: You must present a plan to the user FIRST and wait for their confirmation before writing any file. List ALL files you will create with full web/ paths, then STOP. Do NOT call any file-writing tools in this turn." };
    }

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

    // Workflow spec lookup (full spec when nodeTypes omitted)
    if (name === "get_workflow_spec") {
      const nodeTypes = Array.isArray(args.nodeTypes) ? (args.nodeTypes as string[]) : undefined;
      return { spec: getWorkflowNodeSpec(nodeTypes) };
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
      if (requirePlanApproval) {
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
          { canUseProxy, geminiApiKey: apiKey, settings },
        );
        if (typeof result.error === "string") skillWorkflowFailed = true;
        return result;
      } catch (err) {
        skillWorkflowFailed = true;
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
          ? { maxFunctionCalls, functionCallWarningThreshold, requestLimitExtension: requestFunctionCallLimitExtension }
          : undefined,
      ragTopK,
    },
  );
}

export { chatStream };
