import type { WorkflowNode, ExecutionContext, ServiceContext, FileExplorerData, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
import { chatWithToolsStream, generateImageStream } from "~/services/gemini-chat.server";
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
  isImageGenerationModel,
  type ToolDefinition,
  type ModelType,
} from "~/types/settings";
import type { Message, Attachment, McpAppInfo } from "~/types/chat";

export interface CommandNodeResult {
  usedModel: string;
  mcpApps?: McpAppInfo[];
}

export async function handleCommandNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  _promptCallbacks?: PromptCallbacks
): Promise<CommandNodeResult> {
  const promptTemplate = node.properties["prompt"];
  if (!promptTemplate) throw new Error("Command node missing 'prompt' property");

  const prompt = replaceVariables(promptTemplate, context);
  const originalPrompt = prompt;

  const apiKey = serviceContext.geminiApiKey;
  if (!apiKey) throw new Error("Gemini API key not configured");

  const settings = serviceContext.settings;

  // Resolve model: node property → settings.selectedModel → plan default
  const modelProp = node.properties["model"];
  const modelName: ModelType = (modelProp
    ? replaceVariables(modelProp, context)
    : settings?.selectedModel || getDefaultModelForPlan(settings?.apiPlan ?? "paid")) as ModelType;

  // Resolve RAG store IDs
  const ragSetting = node.properties["ragSetting"] || "";
  const webSearchEnabled = ragSetting === "__websearch__";
  let ragStoreIds: string[] | undefined;
  if (ragSetting && ragSetting !== "__none__" && ragSetting !== "__websearch__" && settings?.ragSettings) {
    const rag = settings.ragSettings[ragSetting];
    if (rag) {
      ragStoreIds = rag.storeIds.length > 0
        ? rag.storeIds
        : rag.storeId
          ? [rag.storeId]
          : undefined;
    }
  }

  // Build tools array
  const tools: ToolDefinition[] = [];

  // Drive tools
  const driveToolMode = node.properties["driveToolMode"] || "none";
  if (driveToolMode !== "none") {
    if (driveToolMode === "noSearch") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(t => !DRIVE_SEARCH_TOOL_NAMES.has(t.name)));
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  // MCP tools
  const mcpServersProp = node.properties["mcpServers"] || "";
  const mcpServerNames = mcpServersProp
    ? mcpServersProp.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const enabledMcpServers = mcpServerNames.length > 0 && settings?.mcpServers
    ? settings.mcpServers.filter(s => mcpServerNames.includes(s.name))
    : [];
  let mcpToolDefs: ToolDefinition[] = [];
  if (enabledMcpServers.length > 0) {
    try {
      mcpToolDefs = await getMcpToolDefinitions(enabledMcpServers);
      tools.push(...mcpToolDefs);
    } catch (error) {
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
    if (driveToolNames.has(name)) {
      return executeDriveTool(
        name,
        args,
        serviceContext.driveAccessToken,
        serviceContext.driveRootFolderId
      );
    }
    if (mcpToolNames.has(name) && enabledMcpServers.length > 0) {
      const result = await executeMcpTool(enabledMcpServers, name, args);
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
        if (fileData.data && fileData.mimeType) {
          const attachType = fileData.mimeType.startsWith("image/") ? "image"
            : fileData.mimeType === "application/pdf" ? "pdf" : "text";
          attachments.push({
            name: fileData.basename || fileData.name || "file",
            type: attachType,
            mimeType: fileData.mimeType,
            data: fileData.data,
          });
        }
      } catch { /* not valid FileExplorerData, skip */ }
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
    const imageGenerator = generateImageStream(apiKey, messages, modelName, systemPrompt);
    let fullResponse = "";
    for await (const chunk of imageGenerator) {
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

  // Call chatWithToolsStream and collect full response
  const generator = chatWithToolsStream(
    apiKey,
    modelName,
    messages,
    tools,
    systemPrompt,
    tools.length > 0 ? executeToolCall : undefined,
    ragStoreIds,
    {
      webSearchEnabled,
      functionCallLimits: settings ? {
        maxFunctionCalls: settings.maxFunctionCalls,
        functionCallWarningThreshold: settings.functionCallWarningThreshold,
      } : undefined,
      ragTopK: settings?.ragTopK,
    }
  );

  let fullResponse = "";
  for await (const chunk of generator) {
    if (chunk.type === "text" && chunk.content) {
      fullResponse += chunk.content;
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
  };
}
