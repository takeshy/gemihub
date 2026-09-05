import { isReadOnlyDriveTool } from "~/services/drive-tool-definitions";
import type { WorkflowNode, ExecutionContext, ServiceContext, FileExplorerData, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
import { chatWithToolsStream, generateImageStream } from "~/services/gemini-chat.server";
import { streamWithTools } from "~/services/gemini-vertex.server";
import type { StreamChunk } from "~/types/chat";
import {
  DRIVE_TOOL_DEFINITIONS,
  DRIVE_SEARCH_TOOL_NAMES,
  executeDriveTool,
} from "~/services/drive-tools.server";
import {
  getMcpToolDefinitions,
  executeMcpTool,
} from "~/services/mcp-tools.server";
import {
  getDefaultModelForPlan,
  getDriveToolModeConstraint,
  getEnabledMcpServers,
  isImageGenerationModel,
  type ToolDefinition,
  type ModelType,
} from "~/types/settings";
import { getOrCreateStore } from "~/services/file-search.server";
import { readFileRaw } from "~/services/google-drive.server";
import { assertPersonalVertexModel, PERSONAL_MAX_FUNCTION_CALLS } from "~/services/ai/personal-vertex.server";
import type { Message, Attachment, McpAppInfo } from "~/types/chat";

export interface CommandToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface CommandNodeResult {
  usedModel: string;
  mcpApps?: McpAppInfo[];
  toolCalls?: CommandToolCall[];
  ragSources?: string[];
  webSearchSources?: string[];
  attachmentNames?: string[];
}

export async function handleCommandNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  _promptCallbacks?: PromptCallbacks
): Promise<CommandNodeResult> {
  if (serviceContext.abortSignal?.aborted) {
    throw new Error("Execution cancelled");
  }

  const promptTemplate = node.properties["prompt"];
  if (!promptTemplate) throw new Error("Command node missing 'prompt' property");

  const prompt = replaceVariables(promptTemplate, context);
  const originalPrompt = prompt;

  // A user who selected personal Vertex AI runs on it even if a Gemini API
  // key is still stored: "Vertex only" is the setting, the key is inert. The
  // prepaid source asserts the balance before execution and records usage
  // afterwards inside the Vertex stream; an empty balance throws
  // AiBudgetExceededError from that assertion.
  const personalVertex = serviceContext.personalVertex;
  const apiKey = personalVertex ? undefined : serviceContext.geminiApiKey;
  if (!apiKey && !personalVertex) throw new Error("Gemini API key not configured");

  const settings = serviceContext.settings;

  // Resolve model: node property → settings.selectedModel → plan default
  const modelProp = node.properties["model"];
  const modelName: ModelType = (modelProp
    ? replaceVariables(modelProp, context)
    : settings?.selectedModel || getDefaultModelForPlan(settings?.apiPlan ?? "paid")) as ModelType;

  if (personalVertex) assertPersonalVertexModel(modelName);

  // Resolve RAG store IDs
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
    // Fallback: if settings has the RAG name but no store ID, try to find the store by name
    if (!ragStoreIds && apiKey) {
      try {
        const storeName = await getOrCreateStore(apiKey, ragSettingProp, {
          signal: serviceContext.abortSignal,
        });
        ragStoreIds = [storeName];
        // Cache the store ID in settings for subsequent nodes
        if (rag) {
          rag.storeName = storeName;
          rag.storeId = storeName;
        }
      } catch {
        // Store lookup failed, proceed without RAG
      }
    }
  }

  // Build tools array
  const tools: ToolDefinition[] = [];

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

  // Drive tools
  if (driveToolMode !== "none") {
    if (driveToolMode === "readOnly") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(tool => isReadOnlyDriveTool(tool.name)));
    } else if (driveToolMode === "noSearch") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(t => !DRIVE_SEARCH_TOOL_NAMES.has(t.name)));
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  // MCP tools
  const mcpServersProp = node.properties["mcpServers"] || "";
  const mcpServerIds = mcpServersProp
    ? mcpServersProp.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const enabledMcpServers = !functionToolsForcedOff && mcpServerIds.length > 0 && settings?.mcpServers
    ? getEnabledMcpServers(settings).filter(
        (s) => mcpServerIds.includes(s.id || "")
      )
    : [];
  let mcpToolDefs: ToolDefinition[] = [];
  if (enabledMcpServers.length > 0) {
    try {
      mcpToolDefs = await getMcpToolDefinitions(enabledMcpServers, serviceContext.abortSignal);
      if (serviceContext.abortSignal?.aborted) {
        throw new Error("Execution cancelled");
      }
      tools.push(...mcpToolDefs);
    } catch (error) {
      if (serviceContext.abortSignal?.aborted) {
        throw new Error("Execution cancelled");
      }
      console.error("Failed to get MCP tool definitions for command node:", error);
    }
  }

  // Build tool dispatcher
  const driveToolNames = new Set(DRIVE_TOOL_DEFINITIONS.map(t => t.name));
  const mcpToolNames = new Set(mcpToolDefs.map(t => t.name));
  const collectedMcpApps: McpAppInfo[] = [];

  const executeToolCall = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> => {
    if (serviceContext.abortSignal?.aborted) {
      throw new Error("Execution cancelled");
    }
    if (driveToolNames.has(name)) {
      if (driveToolMode === "readOnly" && !isReadOnlyDriveTool(name)) return { error: "Drive tool is disabled in read-only mode" };
      return executeDriveTool(
        name,
        args,
        serviceContext.driveAccessToken,
        serviceContext.driveRootFolderId,
        serviceContext.abortSignal
      );
    }
    if (mcpToolNames.has(name) && enabledMcpServers.length > 0) {
      const result = await executeMcpTool(
        enabledMcpServers,
        name,
        args,
        serviceContext.abortSignal,
        node.properties["confirm"] === "false" ? async () => {} : serviceContext.mcpApproval
      );
      if (result.mcpApp) collectedMcpApps.push(result.mcpApp);
      return result.textResult;
    }
    return { error: `Unknown tool: ${name}` };
  };

  // Build attachments from comma-separated variable names
  const attachments: Attachment[] = [];
  const attachmentsProp = node.properties["attachments"];
  if (attachmentsProp) {
    const varNames = replaceVariables(attachmentsProp, context)
      .split(",").map(s => s.trim()).filter(Boolean);
    for (const varName of varNames) {
      const val = context.variables.get(varName);
      if (!val || typeof val !== "string") continue;
      try {
        const fileData: FileExplorerData = JSON.parse(val);
        // If FileExplorerData has an id but no data, read from Drive
        if (!fileData.data && fileData.id && serviceContext.driveAccessToken) {
          const res = await readFileRaw(
            serviceContext.driveAccessToken,
            fileData.id,
            { signal: serviceContext.abortSignal }
          );
          const buffer = await res.arrayBuffer();
          fileData.data = Buffer.from(buffer).toString("base64");
          // Infer mimeType from extension if generic
          if (!fileData.mimeType || fileData.mimeType === "application/octet-stream") {
            const ext = (fileData.extension || "").toLowerCase();
            const mimeMap: Record<string, string> = {
              canvas: "application/json",
              png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
              gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
              pdf: "application/pdf",
              mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac",
              aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus", ogg: "audio/ogg",
              mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
              avi: "video/x-msvideo", mkv: "video/x-matroska",
            };
            fileData.mimeType = mimeMap[ext] || "application/octet-stream";
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
        if (serviceContext.abortSignal?.aborted) {
          throw new Error("Execution cancelled");
        }
        // not valid FileExplorerData, skip
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

  // Check if this is an image generation model
  const saveImageTo = node.properties["saveImageTo"];
  if (isImageGenerationModel(modelName)) {
    // The Vertex stream handles image models natively (responseModalities)
    // and yields the same chunk shapes.
    const imageGenerator = personalVertex
      ? streamWithTools({
          tenant: personalVertex.tenant,
          model: modelName,
          messages,
          tools: [],
          systemPrompt,
          executeToolCall: async () => ({ error: "No tools available for image generation" }),
          billing: personalVertex.billing,
        })
      : generateImageStream(apiKey!, messages, modelName, systemPrompt);
    let fullResponse = "";
    for await (const chunk of imageGenerator) {
      if (serviceContext.abortSignal?.aborted) {
        throw new Error("Execution cancelled");
      }
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
    return { usedModel: modelName, mcpApps: undefined };
  }

  // Call the AI and collect the full response. The key path uses the Gemini
  // API (with RAG via File Search); the personal Vertex path has no File
  // Search client, so ragStoreIds are not passed there.
  const generator: AsyncGenerator<StreamChunk> = personalVertex
    ? streamWithTools({
        tenant: personalVertex.tenant,
        model: modelName,
        messages,
        tools,
        systemPrompt,
        webSearchEnabled,
        enableThinking: node.properties["enableThinking"] !== "false",
        maxFunctionCalls: PERSONAL_MAX_FUNCTION_CALLS,
        executeToolCall,
        billing: personalVertex.billing,
      })
    : chatWithToolsStream(
        apiKey!,
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
        }
      );

  let fullResponse = "";
  const collectedToolCalls: CommandToolCall[] = [];
  let collectedRagSources: string[] | undefined;
  let collectedWebSources: string[] | undefined;
  let pendingToolCall: { name: string; args: Record<string, unknown> } | null = null;

  for await (const chunk of generator) {
    if (serviceContext.abortSignal?.aborted) {
      throw new Error("Execution cancelled");
    }
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
    context.lastCommandInfo = {
      nodeId: node.id,
      originalPrompt,
      saveTo,
    };
  }

  return {
    usedModel: modelName,
    mcpApps: collectedMcpApps.length > 0 ? collectedMcpApps : undefined,
    toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
    ragSources: collectedRagSources,
    webSearchSources: collectedWebSources,
    attachmentNames: attachments.length > 0 ? attachments.map(a => a.name) : undefined,
  };
}
