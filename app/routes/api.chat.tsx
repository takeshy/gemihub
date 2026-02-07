import type { Route } from "./+types/api.chat";
import { z } from "zod";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { chatWithToolsStream, generateImageStream } from "~/services/gemini-chat.server";
import { DRIVE_TOOL_DEFINITIONS, DRIVE_SEARCH_TOOL_NAMES, executeDriveTool } from "~/services/drive-tools.server";
import { getMcpToolDefinitions, executeMcpTool } from "~/services/mcp-tools.server";
import { isImageGenerationModel } from "~/types/settings";
import type { ToolDefinition, McpServerConfig, ModelType } from "~/types/settings";
import type { Message, StreamChunk } from "~/types/chat";

const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: z.number(),
  }).passthrough()).min(1),
  model: z.string(),
  systemPrompt: z.string().optional(),
  ragStoreIds: z.array(z.string()).optional(),
  enableDriveTools: z.boolean().optional(),
  driveToolMode: z.enum(["all", "noSearch", "none"]).optional(),
  enableMcp: z.boolean().optional(),
  mcpServers: z.array(z.object({
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean(),
  }).passthrough()).optional(),
  webSearchEnabled: z.boolean().optional(),
  apiPlan: z.string().optional(),
  settings: z.object({
    maxFunctionCalls: z.number().optional(),
    functionCallWarningThreshold: z.number().optional(),
    ragTopK: z.number().optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// POST handler -- Chat SSE streaming API
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const apiKey = validTokens.geminiApiKey;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Gemini API key not configured" }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } }
    );
  }

  const body = await request.json();
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid request body", details: parsed.error.issues }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } }
    );
  }

  const validData = parsed.data;
  const messages = validData.messages as unknown as Message[];
  const model = validData.model as ModelType;
  const systemPrompt = validData.systemPrompt;
  const ragStoreIds = validData.ragStoreIds;
  const enableDriveTools = validData.enableDriveTools;
  const rawDriveToolMode = validData.driveToolMode;
  const enableMcp = validData.enableMcp;
  const mcpServers = validData.mcpServers as McpServerConfig[] | undefined;
  const webSearchEnabled = validData.webSearchEnabled;
  const requestSettings = validData.settings;

  // Resolve driveToolMode: new field takes precedence, fall back to legacy enableDriveTools
  const driveToolMode = rawDriveToolMode ?? (enableDriveTools === false ? "none" : "all");

  // Build tools array
  const tools: ToolDefinition[] = [];

  if (driveToolMode !== "none") {
    if (driveToolMode === "noSearch") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(t => !DRIVE_SEARCH_TOOL_NAMES.has(t.name)));
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  let mcpToolDefs: ToolDefinition[] = [];
  if (enableMcp && mcpServers && mcpServers.length > 0) {
    try {
      mcpToolDefs = await getMcpToolDefinitions(mcpServers);
      tools.push(...mcpToolDefs);
    } catch (error) {
      console.error("Failed to get MCP tool definitions:", error);
    }
  }

  // Build executeToolCall dispatcher
  const driveToolNames = new Set(DRIVE_TOOL_DEFINITIONS.map((t) => t.name));
  const mcpToolNames = new Set(mcpToolDefs.map((t) => t.name));

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendChunk = (chunk: StreamChunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };

      // executeToolCall defined here so it can send mcp_app chunks via sendChunk
      const executeToolCall = async (
        name: string,
        args: Record<string, unknown>
      ): Promise<unknown> => {
        if (driveToolNames.has(name)) {
          return executeDriveTool(
            name,
            args,
            validTokens.accessToken,
            validTokens.rootFolderId
          );
        }

        if (mcpToolNames.has(name) && mcpServers) {
          const result = await executeMcpTool(mcpServers, name, args);
          // Send mcp_app chunk if the tool returned UI metadata
          if (result.mcpApp) {
            sendChunk({ type: "mcp_app", mcpApp: result.mcpApp });
          }
          return result.textResult;
        }

        return { error: `Unknown tool: ${name}` };
      };

      try {
        let generator: AsyncGenerator<StreamChunk>;

        if (isImageGenerationModel(model)) {
          // Image generation mode
          generator = generateImageStream(
            apiKey,
            messages,
            model,
            systemPrompt
          );
        } else {
          // Chat with tools mode
          generator = chatWithToolsStream(
            apiKey,
            model,
            messages,
            tools,
            systemPrompt,
            tools.length > 0 ? executeToolCall : undefined,
            ragStoreIds,
            {
              ragTopK: requestSettings?.ragTopK,
              functionCallLimits: {
                maxFunctionCalls: requestSettings?.maxFunctionCalls,
                functionCallWarningThreshold:
                  requestSettings?.functionCallWarningThreshold,
              },
              webSearchEnabled,
            }
          );
        }

        for await (const chunk of generator) {
          sendChunk(chunk);
        }
      } catch (error) {
        sendChunk({
          type: "error",
          error:
            error instanceof Error ? error.message : "Stream processing error",
        });
        sendChunk({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(responseHeaders ?? {}),
    },
  });
}
