/**
 * Local command node handler.
 * Calls Gemini API directly from the browser using gemini-chat-core.ts.
 * Drive tools → drive-tools-local.ts (IndexedDB)
 * MCP tools → /api/workflow/mcp-proxy (server proxy)
 */
import type { WorkflowNode, ExecutionContext, FileExplorerData } from "../types";
import type { DriveEvent } from "../local-executor";
import { replaceVariables } from "../handlers/utils";
import {
  chatWithToolsStream,
  generateImageStream,
} from "~/services/gemini-chat-core";
import {
  DRIVE_TOOL_DEFINITIONS,
  DRIVE_SEARCH_TOOL_NAMES,
} from "~/services/drive-tool-definitions";
import { executeLocalDriveTool } from "~/services/drive-tools-local";
import { executeSandboxedJS, EXECUTE_JAVASCRIPT_TOOL } from "~/services/sandbox-executor";
import { readFileBinaryLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import {
  getDefaultModelForPlan,
  getDriveToolModeConstraint,
  isImageGenerationModel,
  type ToolDefinition,
  type ModelType,
  type UserSettings,
} from "~/types/settings";
import type { Message, Attachment, McpAppInfo } from "~/types/chat";

export interface CommandToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface CommandNodeLocalResult {
  usedModel: string;
  mcpApps?: McpAppInfo[];
  toolCalls?: CommandToolCall[];
  ragSources?: string[];
  webSearchSources?: string[];
  attachmentNames?: string[];
  driveEvents: DriveEvent[];
}

export async function handleCommandNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
  geminiApiKey: string,
  settings: UserSettings | undefined,
  abortSignal?: AbortSignal,
): Promise<CommandNodeLocalResult> {
  if (abortSignal?.aborted) throw new Error("Execution cancelled");

  const promptTemplate = node.properties["prompt"];
  if (!promptTemplate) throw new Error("Command node missing 'prompt' property");

  const prompt = replaceVariables(promptTemplate, context);
  const originalPrompt = prompt;

  // Resolve model
  const modelProp = node.properties["model"];
  const modelName: ModelType = (modelProp
    ? replaceVariables(modelProp, context)
    : settings?.selectedModel || getDefaultModelForPlan(settings?.apiPlan ?? "paid")) as ModelType;

  // Resolve RAG store IDs from settings
  const ragSettingProp = node.properties["ragSetting"] || "";
  const webSearchEnabled = ragSettingProp === "__websearch__";
  let ragStoreIds: string[] | undefined;
  if (ragSettingProp && ragSettingProp !== "__none__" && ragSettingProp !== "__websearch__" && settings?.ragSettings) {
    const rag = settings.ragSettings[ragSettingProp];
    if (rag) {
      ragStoreIds = rag.isExternal
        ? rag.storeIds.length > 0 ? rag.storeIds : undefined
        : rag.storeId
          ? [rag.storeId]
          : undefined;
    }
  }

  // Build tools array
  const tools: ToolDefinition[] = [];
  const driveEvents: DriveEvent[] = [];

  const requestedDriveToolMode = node.properties["driveToolMode"] || "none";
  const ragSettingForConstraint = webSearchEnabled
    ? "__websearch__"
    : ragStoreIds && ragStoreIds.length > 0
      ? "__rag__"
      : null;
  const toolConstraint = getDriveToolModeConstraint(modelName, ragSettingForConstraint);
  const driveToolMode = toolConstraint.forcedMode ?? requestedDriveToolMode;
  const functionToolsForcedOff =
    toolConstraint.locked && toolConstraint.forcedMode === "none";

  // JavaScript sandbox tool
  if (!functionToolsForcedOff) {
    tools.push(EXECUTE_JAVASCRIPT_TOOL);
  }

  // Drive tools
  if (driveToolMode !== "none") {
    if (driveToolMode === "noSearch") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(t => !DRIVE_SEARCH_TOOL_NAMES.has(t.name)));
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  // MCP tools (fetch definitions via proxy)
  const mcpServersProp = node.properties["mcpServers"] || "";
  const mcpServerIds = mcpServersProp
    ? mcpServersProp.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  let mcpToolDefs: ToolDefinition[] = [];
  if (!functionToolsForcedOff && mcpServerIds.length > 0) {
    try {
      const res = await fetch("/api/workflow/mcp-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getToolDefinitions", mcpServerIds }),
        signal: abortSignal,
      });
      if (!res.ok) throw new Error(`MCP proxy failed: ${res.status}`);
      const data = await res.json();
      if (data.tools && Array.isArray(data.tools)) {
        mcpToolDefs = data.tools;
        tools.push(...mcpToolDefs);
      }
    } catch (err) {
      if (abortSignal?.aborted) throw new Error("Execution cancelled");
      console.error("Failed to get MCP tool definitions:", err);
    }
  }

  // Build tool dispatcher
  const driveToolNames = new Set(DRIVE_TOOL_DEFINITIONS.map(t => t.name));
  const mcpToolNames = new Set(mcpToolDefs.map(t => t.name));
  const collectedMcpApps: McpAppInfo[] = [];

  const executeToolCall = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (abortSignal?.aborted) throw new Error("Execution cancelled");

    if (driveToolNames.has(name)) {
      return executeLocalDriveTool(name, args, {
        onDriveEvent: (event) => driveEvents.push(event),
      }, abortSignal);
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
        if (data.mcpApp) collectedMcpApps.push(data.mcpApp);
        return data.textResult;
      } catch (err) {
        if (abortSignal?.aborted) throw new Error("Execution cancelled");
        return { error: err instanceof Error ? err.message : "MCP tool call failed" };
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
        if (abortSignal?.aborted) throw new Error("Execution cancelled");
        return { error: err instanceof Error ? err.message : "JavaScript execution failed" };
      }
    }

    return { error: `Unknown tool: ${name}` };
  };

  // Build attachments from comma-separated variable names
  const attachments: Attachment[] = [];
  const attachmentsProp = node.properties["attachments"];
  if (attachmentsProp) {
    const meta = await getCachedRemoteMeta();
    const varNames = replaceVariables(attachmentsProp, context)
      .split(",").map(s => s.trim()).filter(Boolean);
    for (const varName of varNames) {
      const val = context.variables.get(varName);
      if (!val || typeof val !== "string") continue;
      try {
        const fileData: FileExplorerData = JSON.parse(val);
        // If FileExplorerData has an id but no data, read from IndexedDB
        if (!fileData.data && fileData.id) {
          try {
            const fileMeta = meta?.files[fileData.id];
            fileData.data = await readFileBinaryLocal(fileData.id);
            if (!fileData.mimeType || fileData.mimeType === "application/octet-stream") {
              const ext = (fileData.extension || "").toLowerCase();
              const mimeMap: Record<string, string> = {
                png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
                pdf: "application/pdf",
                mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac",
                aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus", ogg: "audio/ogg",
                mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
                avi: "video/x-msvideo", mkv: "video/x-matroska",
              };
              fileData.mimeType = mimeMap[ext] || fileMeta?.mimeType || "application/octet-stream";
            }
          } catch {
            // Cache miss, skip this attachment
            continue;
          }
        }
        if (fileData.data && fileData.mimeType) {
          const attachType = fileData.mimeType.startsWith("image/") ? "image"
            : fileData.mimeType === "application/pdf" ? "pdf"
            : fileData.mimeType.startsWith("audio/") ? "audio"
            : fileData.mimeType.startsWith("video/") ? "video"
            : "text";
          attachments.push({
            name: fileData.basename || fileData.name || "file",
            type: attachType,
            mimeType: fileData.mimeType,
            data: fileData.data,
          });
        }
      } catch {
        if (abortSignal?.aborted) throw new Error("Execution cancelled");
      }
    }
  }

  // Build messages
  const messages: Message[] = [
    {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  ];

  // System prompt
  const systemPrompt = node.properties["systemPrompt"]
    ? replaceVariables(node.properties["systemPrompt"], context)
    : undefined;

  // Image generation model
  const saveImageTo = node.properties["saveImageTo"];
  if (isImageGenerationModel(modelName)) {
    const imageGenerator = generateImageStream(geminiApiKey, messages, modelName, systemPrompt);
    let fullResponse = "";
    for await (const chunk of imageGenerator) {
      if (abortSignal?.aborted) throw new Error("Execution cancelled");
      if (chunk.type === "text" && chunk.content) {
        fullResponse += chunk.content;
      } else if (chunk.type === "image_generated" && chunk.generatedImage && saveImageTo) {
        const img = chunk.generatedImage;
        const ext = img.mimeType === "image/png" ? "png" : "jpg";
        const fileData: FileExplorerData = {
          path: `generated.${ext}`,
          basename: `generated.${ext}`,
          name: "generated",
          extension: ext,
          mimeType: img.mimeType,
          contentType: "binary",
          data: img.data,
        };
        context.variables.set(saveImageTo, JSON.stringify(fileData));
      } else if (chunk.type === "error") {
        throw new Error(chunk.error || "Image generation error");
      }
    }
    const saveTo = node.properties["saveTo"];
    if (saveTo) {
      context.variables.set(saveTo, fullResponse);
      context.lastCommandInfo = { nodeId: node.id, originalPrompt, saveTo };
    }
    return { usedModel: modelName, driveEvents };
  }

  // Normal chat with tools
  const generator = chatWithToolsStream(
    geminiApiKey,
    modelName,
    messages,
    tools,
    systemPrompt,
    tools.length > 0 ? executeToolCall : undefined,
    ragStoreIds,
    {
      webSearchEnabled,
      enableThinking: node.properties["enableThinking"] !== "false",
      functionCallLimits: {
        maxFunctionCalls: 50,
        functionCallWarningThreshold: 10,
      },
      ragTopK: settings?.ragTopK,
    },
  );

  let fullResponse = "";
  const collectedToolCalls: CommandToolCall[] = [];
  let collectedRagSources: string[] | undefined;
  let collectedWebSources: string[] | undefined;
  let pendingToolCall: { name: string; args: Record<string, unknown> } | null = null;

  for await (const chunk of generator) {
    if (abortSignal?.aborted) throw new Error("Execution cancelled");
    if (chunk.type === "text" && chunk.content) {
      fullResponse += chunk.content;
    } else if (chunk.type === "tool_call" && chunk.toolCall) {
      pendingToolCall = { name: chunk.toolCall.name, args: chunk.toolCall.args };
    } else if (chunk.type === "tool_result" && chunk.toolResult) {
      if (pendingToolCall) {
        collectedToolCalls.push({ ...pendingToolCall, result: chunk.toolResult.result });
        pendingToolCall = null;
      }
    } else if (chunk.type === "rag_used" && chunk.ragSources) {
      collectedRagSources = chunk.ragSources;
    } else if (chunk.type === "web_search_used" && chunk.ragSources) {
      collectedWebSources = chunk.ragSources;
    } else if (chunk.type === "error") {
      throw new Error(chunk.error || "LLM error");
    }
  }

  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, fullResponse);
    context.lastCommandInfo = { nodeId: node.id, originalPrompt, saveTo };
  }

  return {
    usedModel: modelName,
    mcpApps: collectedMcpApps.length > 0 ? collectedMcpApps : undefined,
    toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
    ragSources: collectedRagSources,
    webSearchSources: collectedWebSources,
    attachmentNames: attachments.length > 0 ? attachments.map(a => a.name) : undefined,
    driveEvents,
  };
}
