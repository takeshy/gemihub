import type { Route } from "./+types/api.chat.interactions";
import { z } from "zod";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { DRIVE_TOOL_DEFINITIONS, DRIVE_SEARCH_TOOL_NAMES } from "~/services/drive-tools.server";
import { getMcpToolDefinitions } from "~/services/mcp-tools.server";
import { HUBWORK_TOOL_DEFINITIONS } from "~/services/hubwork-tool-definitions";
import type { ToolDefinition, McpServerConfig, ModelType } from "~/types/settings";
import type { Message, StreamChunk } from "~/types/chat";
import { createLogContext, emitLog } from "~/services/logger.server";
import {
  buildInteractionsTools,
  buildInteractionInput,
  buildGenerationConfig,
  buildToolResultInput,
  streamInteraction,
  type ToolResultInput,
} from "~/services/gemini-interactions.server";

const InteractionsChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: z.number(),
  }).passthrough()).min(1),
  model: z.string(),
  systemPrompt: z.string().optional(),
  previousInteractionId: z.string().optional(),
  ragStoreIds: z.array(z.string()).optional(),
  driveToolMode: z.enum(["all", "noSearch", "none"]).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  webSearchEnabled: z.boolean().optional(),
  enableThinking: z.boolean().optional(),
  settings: z.object({
    ragTopK: z.number().optional(),
  }).optional(),
  // Extra tool definitions from client (e.g. JS sandbox, skill workflows)
  extraToolDefinitions: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.object({
      type: z.string(),
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()).optional(),
    }),
  })).optional(),
  // Resume after requires_action
  toolResults: z.array(z.object({
    callId: z.string(),
    name: z.string(),
    result: z.unknown(),
  })).optional(),
  currentInteractionId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST handler -- Interactions API SSE streaming proxy
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const logCtx = createLogContext(request, "/api/chat/interactions", validTokens.rootFolderId);

  const apiKey = validTokens.geminiApiKey;
  if (!apiKey) {
    emitLog(logCtx, 400, { error: "Gemini API key not configured" });
    return new Response(
      JSON.stringify({ error: "Gemini API key not configured" }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    emitLog(logCtx, 400, { error: "Invalid JSON" });
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } },
    );
  }
  const parsed = InteractionsChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    emitLog(logCtx, 400, { error: "Invalid request body" });
    return new Response(
      JSON.stringify({ error: "Invalid request body", details: parsed.error.issues }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } },
    );
  }

  const validData = parsed.data;
  const messages = validData.messages as unknown as Message[];
  const model = validData.model as ModelType;
  const systemPrompt = validData.systemPrompt;
  const ragStoreIds = validData.ragStoreIds;
  const driveToolMode = validData.driveToolMode ?? "all";
  const requestedMcpServerIds = validData.mcpServerIds ?? [];
  const webSearchEnabled = validData.webSearchEnabled;
  const enableThinking = validData.enableThinking;
  const toolResults = validData.toolResults as ToolResultInput[] | undefined;
  const currentInteractionId = validData.currentInteractionId;
  const previousInteractionId = validData.previousInteractionId;
  const extraToolDefinitions = validData.extraToolDefinitions as ToolDefinition[] | undefined;

  // Build tool definitions (needed for both initial and resume requests)
  const tools: ToolDefinition[] = [];

  // Drive tools
  if (driveToolMode !== "none") {
    if (driveToolMode === "noSearch") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(t => !DRIVE_SEARCH_TOOL_NAMES.has(t.name)));
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  // MCP tool definitions
  let resolvedMcpServers: McpServerConfig[] | undefined;
  if (requestedMcpServerIds.length > 0) {
    try {
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
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
        }
      }
      resolvedMcpServers = selected;
    } catch (error) {
      console.error("Failed to resolve MCP servers:", error);
    }
  }

  if (resolvedMcpServers && resolvedMcpServers.length > 0) {
    try {
      const mcpToolDefs = await getMcpToolDefinitions(resolvedMcpServers);
      tools.push(...mcpToolDefs);
    } catch (error) {
      console.error("Failed to get MCP tool definitions:", error);
    }
  }

  // Hubwork spreadsheet schema tool
  tools.push(...HUBWORK_TOOL_DEFINITIONS);

  // Extra tool definitions from client (JS sandbox, skill workflows)
  if (extraToolDefinitions && extraToolDefinitions.length > 0) {
    tools.push(...extraToolDefinitions);
  }

  // Build Interactions API parameters
  const rawTopK = validData.settings?.ragTopK;
  const clampedTopK = rawTopK != null && Number.isFinite(rawTopK) ? Math.min(20, Math.max(1, rawTopK)) : undefined;

  const interactionsTools = buildInteractionsTools(tools, ragStoreIds, clampedTopK, webSearchEnabled);

  const input = toolResults
    ? buildToolResultInput(toolResults)
    : buildInteractionInput(messages, previousInteractionId);

  const generationConfig = buildGenerationConfig(model, enableThinking);

  const interactionId = toolResults ? currentInteractionId : previousInteractionId;

  logCtx.details = {
    model,
    toolCount: tools.length,
    ragStoreIds: ragStoreIds ?? [],
    isResume: !!toolResults,
    streaming: true,
  };
  emitLog(logCtx, 200);

  // Create SSE stream
  const abortSignal = request.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let aborted = false;

      abortSignal.addEventListener("abort", () => {
        aborted = true;
        try { controller.close(); } catch { /* already closed */ }
      });

      const sendChunk = (chunk: StreamChunk) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        } catch {
          aborted = true;
        }
      };

      try {
        const generator = streamInteraction({
          apiKey,
          model,
          input,
          systemPrompt: toolResults ? undefined : systemPrompt,
          tools: interactionsTools.length > 0 ? interactionsTools : undefined,
          previousInteractionId: interactionId,
          generationConfig,
          webSearchEnabled,
        });

        for await (const chunk of generator) {
          sendChunk(chunk);
        }
      } catch (error) {
        sendChunk({
          type: "error",
          error: error instanceof Error ? error.message : "Stream processing error",
        });
        sendChunk({ type: "done" });
      } finally {
        try { controller.close(); } catch { /* already closed by abort */ }
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
