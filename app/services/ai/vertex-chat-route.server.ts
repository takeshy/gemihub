/**
 * Vertex chat SSE handler for org project mounts. api.chat.tsx delegates
 * here when the request body carries a projectId; the legacy key-based SSE
 * path stays in the route for everyone else.
 */
import { z } from "zod";
import { requireAuth } from "../session.server";
import { getValidTokens } from "../google-auth.server";
import {
  getSettingsForTenant,
  getSettingsForTenantStrict,
  saveSettingsForTenant,
} from "../user-settings-tenant.server";
import { streamWithTools } from "../gemini-vertex.server";
import { DRIVE_TOOL_DEFINITIONS, DRIVE_SEARCH_TOOL_NAMES, executeStorageTool } from "../storage-tools.server";
import { getMcpToolDefinitions, executeMcpTool } from "../mcp-tools.server";
import { getDriveToolModeConstraint, getEnabledMcpServers, supportsWebSearch } from "~/types/settings";
import type { ToolDefinition, McpServerConfig, ModelType } from "~/types/settings";
import type { Message, StreamChunk } from "~/types/chat";
import {
  ModelNotAllowedError,
  ProjectAccessError,
  assertModelAllowed,
  requireProjectAccess,
} from "../project-acl.server";
import { createLogContext, emitLog } from "../logger.server";
import { requireRateLimit } from "../rate-limiter.server";
import { auditFromRoute } from "../audit-log.server";
import { buildRagContext } from "../rag-sync-tenant.server";

const ChatRequestSchema = z.object({
  // Project the chat is running in. Required so we can route the Vertex
  // call to the right tenant project.
  projectId: z.string().min(1),
  // Phase 5e-step4: messages may include `toolCalls` and `toolResults` on an
  // assistant turn — that's how the client continues a chat after handling a
  // requires_action delegation. messagesToContents (gemini-content-builders)
  // handles this shape natively; passthrough() lets these extra fields flow.
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
  mcpServerIds: z.array(z.string()).optional(),
  mcpServers: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }).passthrough()).optional(),
  webSearchEnabled: z.boolean().optional(),
  enableThinking: z.boolean().optional(),
  requirePlanApproval: z.boolean().optional(),
  settings: z.object({
    maxFunctionCalls: z.number().optional(),
    ragTopK: z.number().optional(),
  }).optional(),
  /**
   * Tools that the CLIENT will execute (e.g. execute_javascript,
   * run_skill_workflow). The server declares them to Vertex so the model can
   * choose them, but emits requires_action on the call so the client can
   * actually run them. Must be a strict subset of the client's known tools.
   */
  extraToolDefinitions: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  }).passthrough()).optional(),
});

// ---------------------------------------------------------------------------
// POST handler -- Chat SSE streaming API (Vertex AI)
// ---------------------------------------------------------------------------

export async function handleVertexChatAction(
  request: Request,
  body: unknown,
): Promise<Response> {
  const tokens = await requireAuth(request);
  const {
    tokens: validTokens,
    setCookieHeader,
  } = tokens.authMethod === "oidc" || !tokens.refreshToken
    ? { tokens, setCookieHeader: undefined }
    : await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const logCtx = createLogContext(request, "/api/chat", validTokens.rootFolderId);

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
  const requestedMcpServers = validData.mcpServers as McpServerConfig[] | undefined;
  const webSearchEnabled = validData.webSearchEnabled && supportsWebSearch(model);
  const enableThinking = validData.enableThinking;
  const requirePlanApproval = validData.requirePlanApproval === true;
  const requestSettings = validData.settings;
  const requestedMcpServerIds = validData.mcpServerIds && validData.mcpServerIds.length > 0
    ? validData.mcpServerIds
    : (requestedMcpServers || [])
        .map((s) => s.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
  const enableMcp = validData.enableMcp ?? requestedMcpServerIds.length > 0;

  // Tenant resolution: every Vertex call needs a tenant. requireProjectAccess
  // verifies the user belongs to the project and returns the tenant info.
  let ctx;
  try {
    ctx = await requireProjectAccess(request, validData.projectId, "viewer");
    assertModelAllowed(ctx, model);
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      emitLog(logCtx, err.status, { error: err.message });
      return Response.json(
        { error: err.message },
        { status: err.status, headers: responseHeaders },
      );
    }
    if (err instanceof ModelNotAllowedError) {
      emitLog(logCtx, err.status, { error: err.message });
      return Response.json(
        { error: err.message, model: err.model, allowed: err.allowed },
        { status: err.status, headers: responseHeaders },
      );
    }
    throw err;
  }

  // Phase 6: per-user rate limiting on chat
  const rateLimited = await requireRateLimit("chat", ctx.uid);
  if (rateLimited) {
    emitLog(logCtx, 429, { error: "Rate limit exceeded" });
    return rateLimited;
  }

  // Phase 6: inject RAG context into system prompt when ragStoreIds are provided
  let effectiveSystemPrompt = systemPrompt;
  if (ragStoreIds && ragStoreIds.length > 0) {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMessage?.content) {
      try {
        const ragContext = await buildRagContext({
          orgId: ctx.orgId,
          projectId: ctx.projectId,
          settingName: ragStoreIds[0],
          query: lastUserMessage.content,
          tenant: ctx.tenant,
          topK: requestSettings?.ragTopK ?? 5,
        });
        if (ragContext) {
          effectiveSystemPrompt = effectiveSystemPrompt
            ? `${effectiveSystemPrompt}\n\nRelevant context from documents:\n${ragContext}`
            : `Relevant context from documents:\n${ragContext}`;
        }
      } catch (err) {
        console.error("[chat] RAG context injection failed:", err instanceof Error ? err.message : String(err));
      }
    }
  }

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
    | Awaited<ReturnType<typeof getSettingsForTenant>>
    | null = null;
  const mcpTokenSnapshot = new Map<string, string>();

  if (!functionToolsForcedOff && enableMcp && requestedMcpServerIds.length > 0) {
    try {
      const settings = await getSettingsForTenant(ctx);
      settingsForMcpPersistence = settings;
      const byId = new Map(getEnabledMcpServers(settings).map((s) => [s.id || "", s] as const));
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

  // Phase 5e-step4: client-delegated tools (execute_javascript,
  // run_skill_workflow, etc.) are declared to Vertex but executed in the
  // browser. Server emits `requires_action` when the model picks one.
  const extraTools = (validData.extraToolDefinitions ?? []) as unknown as ToolDefinition[];
  if (extraTools.length > 0) tools.push(...extraTools);
  const delegateToolNames = new Set(extraTools.map((t) => t.name));
  delegateToolNames.add("create_drive_file");
  delegateToolNames.add("update_drive_file");

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

  // Phase 6: audit log chat stream start
  auditFromRoute({
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    uid: ctx.uid,
    email: validTokens.email ?? "",
    action: "chat.stream",
    resourceType: "chat_session",
    metadata: { model, toolCount: tools.length, webSearchEnabled, ragStoreIds },
    request,
    statusCode: 200,
  });

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

      // executeToolCall defined here so it can send mcp_app chunks via sendChunk
      const executeToolCall = async (
        name: string,
        args: Record<string, unknown>
      ): Promise<unknown> => {
        if (
          requirePlanApproval &&
          (name === "create_drive_file" || name === "update_drive_file")
        ) {
          return {
            error:
              "BLOCKED: You must present a plan to the user FIRST and wait for their confirmation before writing any file. List ALL files you will create or modify with full web/ paths, then STOP.",
          };
        }

        if (driveToolNames.has(name)) {
          const result = await executeStorageTool(
            name,
            args,
            ctx,
            abortSignal,
          );
          if (name === "update_drive_file") {
            const r = result as { id?: string; name?: string; content?: string };
            if (r.id && r.content != null) {
              sendChunk({
                type: "drive_file_updated",
                updatedFile: { fileId: r.id, fileName: r.name || "", content: r.content },
              });
            }
            const { content: _content, ...geminiResult } = result as Record<string, unknown>;
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
          if (result.mcpApp) {
            sendChunk({ type: "mcp_app", mcpApp: result.mcpApp });
          }
          return result.textResult;
        }

        return { error: `Unknown tool: ${name}` };
      };

      try {
        for await (const chunk of streamWithTools({
          tenant: ctx.tenant,
          model,
          messages,
          tools,
          systemPrompt: effectiveSystemPrompt,
          webSearchEnabled,
          enableThinking,
          maxFunctionCalls: requestSettings?.maxFunctionCalls,
          executeToolCall,
          delegateToolNames,
          billing: ctx.tenant.vertexBillingMode === "customer" ? undefined : { orgId: ctx.orgId, uid: ctx.uid, scope: "org" },
        })) {
          sendChunk(chunk);
        }
      } catch (error) {
        sendChunk({
          type: "error",
          error: error instanceof Error ? error.message : "Stream processing error",
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
              // Strict: the refreshed OAuth tokens are merged into the stored
              // settings and written back — defaults here would wipe them.
              const freshSettings = await getSettingsForTenantStrict(ctx);
              for (const server of resolvedMcpServers!) {
                const key = server.id || server.name;
                const target = getEnabledMcpServers(freshSettings).find(
                  (s) => (s.id || s.name) === key
                );
                if (target) {
                  target.oauthTokens = server.oauthTokens;
                }
              }
              await saveSettingsForTenant(ctx, freshSettings);
            } catch (error) {
              console.error("Failed to persist refreshed MCP OAuth tokens:", error);
            }
          }
        }
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
