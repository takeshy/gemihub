import type { Route } from "./+types/api.chat";
import { z } from "zod";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { chatWithToolsStream, generateImageStream } from "~/services/gemini-chat.server";
import { DRIVE_TOOL_DEFINITIONS, DRIVE_SEARCH_TOOL_NAMES, executeDriveTool } from "~/services/drive-tools.server";
import { getMcpToolDefinitions, executeMcpTool } from "~/services/mcp-tools.server";
import { getDriveToolModeConstraint, isImageGenerationModel } from "~/types/settings";
import type { ToolDefinition, McpServerConfig, ModelType } from "~/types/settings";
import type { Message, StreamChunk } from "~/types/chat";
import { createLogContext, emitLog } from "~/services/logger.server";

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
    id: z.string().optional(),
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
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
  const logCtx = createLogContext(request, "/api/chat", validTokens.rootFolderId);

  const apiKey = validTokens.geminiApiKey;
  if (!apiKey) {
    emitLog(logCtx, 400, { error: "Gemini API key not configured" });
    return new Response(
      JSON.stringify({ error: "Gemini API key not configured" }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } }
    );
  }

  const body = await request.json();
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    emitLog(logCtx, 400, { error: "Invalid request body" });
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
  const requestedMcpServers = validData.mcpServers as McpServerConfig[] | undefined;
  const webSearchEnabled = validData.webSearchEnabled;
  const requestSettings = validData.settings;
  const requestedMcpServerIds = (requestedMcpServers || [])
    .map((s) => s.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // Resolve driveToolMode: new field takes precedence, fall back to legacy enableDriveTools
  const requestedDriveToolMode =
    rawDriveToolMode ?? (enableDriveTools === false ? "none" : "all");
  const ragSettingForConstraint = webSearchEnabled
    ? "__websearch__"
    : ragStoreIds && ragStoreIds.length > 0
      ? "__rag__"
      : null;
  const toolConstraint = getDriveToolModeConstraint(model, ragSettingForConstraint);
  const driveToolMode = toolConstraint.forcedMode ?? requestedDriveToolMode;
  const functionToolsForcedOff =
    toolConstraint.locked && toolConstraint.forcedMode === "none";

  // Build tools array
  const tools: ToolDefinition[] = [];

  if (driveToolMode !== "none") {
    if (driveToolMode === "noSearch") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(t => !DRIVE_SEARCH_TOOL_NAMES.has(t.name)));
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  let resolvedMcpServers: McpServerConfig[] | undefined;
  let settingsForMcpPersistence:
    | Awaited<ReturnType<typeof getSettings>>
    | null = null;
  const mcpTokenSnapshot = new Map<string, string>();

  if (!functionToolsForcedOff && enableMcp && requestedMcpServerIds.length > 0) {
    try {
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      settingsForMcpPersistence = settings;
      const byId = new Map(settings.mcpServers.map((s) => [s.id || "", s] as const));
      const selected: McpServerConfig[] = [];
      const seen = new Set<string>();
      for (const id of requestedMcpServerIds) {
        const match = byId.get(id);
        if (match) {
          const key = match.id || match.name;
          if (seen.has(key)) continue;
          seen.add(key);
          selected.push(match);
          mcpTokenSnapshot.set(key, JSON.stringify(match.oauthTokens ?? null));
        }
      }
      resolvedMcpServers = selected;
    } catch (error) {
      console.error("Failed to resolve MCP servers from user settings:", error);
    }
  }

  let mcpToolDefs: ToolDefinition[] = [];
  if (resolvedMcpServers && resolvedMcpServers.length > 0) {
    try {
      mcpToolDefs = await getMcpToolDefinitions(resolvedMcpServers);
      tools.push(...mcpToolDefs);
    } catch (error) {
      console.error("Failed to get MCP tool definitions:", error);
    }
  }

  // Build executeToolCall dispatcher
  const driveToolNames = new Set(DRIVE_TOOL_DEFINITIONS.map((t) => t.name));
  const mcpToolNames = new Set(mcpToolDefs.map((t) => t.name));

  logCtx.details = {
    model,
    toolCount: tools.length,
    mcpServers: resolvedMcpServers?.map((s) => s.name) ?? [],
    ragStoreIds: ragStoreIds ?? [],
    streaming: true,
  };
  emitLog(logCtx, 200);

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
          const result = await executeDriveTool(
            name,
            args,
            validTokens.accessToken,
            validTokens.rootFolderId
          );
          if (name === "update_drive_file") {
            const r = result as { id?: string; name?: string; content?: string; md5Checksum?: string; modifiedTime?: string };
            if (r.id && r.content != null) {
              sendChunk({
                type: "drive_file_updated",
                updatedFile: {
                  fileId: r.id,
                  fileName: r.name || "",
                  content: r.content,
                  md5Checksum: r.md5Checksum || "",
                  modifiedTime: r.modifiedTime || "",
                },
              });
            }
            // Strip content from result returned to Gemini (token savings)
            const { content: _content, md5Checksum: _md5, modifiedTime: _mt, ...geminiResult } = result as Record<string, unknown>;
            return geminiResult;
          }
          if (name === "create_drive_file") {
            const r = result as { id?: string; name?: string; content?: string; md5Checksum?: string; modifiedTime?: string };
            if (r.id && r.content != null) {
              sendChunk({
                type: "drive_file_created",
                createdFile: {
                  fileId: r.id,
                  fileName: r.name || "",
                  content: r.content,
                  md5Checksum: r.md5Checksum || "",
                  modifiedTime: r.modifiedTime || "",
                },
              });
            }
            const { content: _content, md5Checksum: _md5, modifiedTime: _mt, ...geminiResult } = result as Record<string, unknown>;
            return geminiResult;
          }
          return result;
        }

        if (mcpToolNames.has(name) && resolvedMcpServers) {
          const result = await executeMcpTool(resolvedMcpServers, name, args);
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
        if (settingsForMcpPersistence && resolvedMcpServers && resolvedMcpServers.length > 0) {
          const tokenChanged = resolvedMcpServers.some(
            (server) =>
              mcpTokenSnapshot.get(server.id || server.name) !== JSON.stringify(server.oauthTokens ?? null)
          );
          if (tokenChanged) {
            try {
              const freshSettings = await getSettings(
                validTokens.accessToken,
                validTokens.rootFolderId
              );
              for (const server of resolvedMcpServers!) {
                const key = server.id || server.name;
                const target = freshSettings.mcpServers.find(
                  (s) => (s.id || s.name) === key
                );
                if (target) {
                  target.oauthTokens = server.oauthTokens;
                }
              }
              await saveSettings(
                validTokens.accessToken,
                validTokens.rootFolderId,
                freshSettings
              );
            } catch (error) {
              console.error("Failed to persist refreshed MCP OAuth tokens:", error);
            }
          }
        }
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
