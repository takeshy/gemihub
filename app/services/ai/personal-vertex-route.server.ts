import { streamMcpApproval, rememberMcpTool } from "~/services/mcp-approval.server";
import { isReadOnlyDriveTool } from "~/services/drive-tool-definitions";
/**
 * Personal Vertex chat SSE handler for Drive-mount users who have opted into
 * Vertex AI with a prepaid budget (no org project required). api.chat.tsx
 * delegates here when the request body carries `personalVertex: true`.
 *
 * Unlike the org Vertex path (vertex-chat-route.server.ts), this handler:
 *   - Uses the user's own Drive tokens for file tools (not GCS storage tools)
 *   - Reads user settings from Drive (not tenant-scoped settings)
 *   - Bills against the user's personal prepaid balance (not an org budget)
 *   - Falls back to the service-wide default Vertex AI connection
 */
import { z } from "zod";
import { requireAuth } from "../session.server";
import { getValidTokens } from "../google-auth.server";
import { emailToUid } from "../organizations.server";
import { getSettings, saveSettings } from "../user-settings.server";
import { streamWithTools } from "../gemini-vertex.server";
import {
  DRIVE_TOOL_DEFINITIONS,
  DRIVE_SEARCH_TOOL_NAMES,
  executeDriveTool,
} from "../drive-tools.server";
import { getMcpToolDefinitions, executeMcpTool } from "../mcp-tools.server";
import {
  getDriveToolModeConstraint,
  getEnabledMcpServers,
  supportsWebSearch,
} from "~/types/settings";
import type { ToolDefinition, McpServerConfig, ModelType, UserSettings } from "~/types/settings";
import type { Message, StreamChunk } from "~/types/chat";
import type { TenantInfo } from "~/types/enterprise";
import { createLogContext, emitLog } from "../logger.server";
import { requireRateLimit } from "../rate-limiter.server";
import { isVertexModelPriced } from "../ai-budget.server";
import { AVAILABLE_MODELS, normalizeDeprecatedModelName } from "~/types/settings";

const ChatRequestSchema = z.object({
  personalVertex: z.boolean().optional(),
  messages: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          timestamp: z.number(),
        })
        .passthrough(),
    )
    .min(1),
  model: z.string(),
  systemPrompt: z.string().optional(),
  ragStoreIds: z.array(z.string()).optional(),
  enableDriveTools: z.boolean().optional(),
  driveToolMode: z.enum(["all", "noSearch", "readOnly", "none"]).optional(),
  enableMcp: z.boolean().optional(),
  mcpServerIds: z.array(z.string()).optional(),
  mcpServers: z
    .array(
      z
        .object({
          id: z.string().optional(),
          name: z.string(),
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
        })
        .passthrough(),
    )
    .optional(),
  webSearchEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(["default", "none", "minimal", "low", "medium", "high"]).optional(),
  requirePlanApproval: z.boolean().optional(),
  settings: z.object({
    maxFunctionCalls: z.number().optional(),
    ragTopK: z.number().optional(),
  }).optional(),
  extraToolDefinitions: z
    .array(
      z
        .object({
          name: z.string(),
          description: z.string(),
          parameters: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
    )
    .optional(),
});

/**
 * Personal Vertex runs on OUR Google Cloud project against a prepaid balance,
 * so the model has to be one we both offer and can price. Deriving the set
 * from what settings can actually select keeps the two in step — an earlier
 * VERTEX_MODELS-based list rejected `gemini-3.1-pro-preview-customtools`,
 * which the paid plan offers, so every message 403'd with no way to tell why.
 * The price check still blocks anything we cannot bill: an unpriced model
 * would be drawn down at the Pro-tier fallback while Google charges us the
 * real rate, up to ten times more for an image model.
 */
const PERSONAL_ALLOWED_MODELS: ReadonlySet<string> = new Set(
  AVAILABLE_MODELS.map((model) => model.name),
);

/**
 * A single request must not be able to run away with the balance, so the
 * prepaid path caps tool rounds well below the 50 the org path allows.
 */
const PERSONAL_MAX_FUNCTION_CALLS = 15;

/** Build a TenantInfo from service-wide environment defaults. */
function personalTenant(uid: string, settings: UserSettings): TenantInfo {
  const own = settings.personalVertexSource === "own";
  return {
    gcsBucket: "",
    region: process.env.DEFAULT_TENANT_REGION || "global",
    vertexProjectId: own ? settings.personalVertexProjectId?.trim() : process.env.GCP_PROJECT_ID || "",
    vertexLocation: own
      ? settings.personalVertexLocation?.trim() || "global"
      : process.env.VERTEX_LOCATION || process.env.DEFAULT_TENANT_REGION || "global",
    ...(own ? { vertexOAuthUserId: uid, vertexBillingMode: "customer" as const } : {}),
  };
}

export async function handlePersonalVertexChatAction(
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
  const responseHeaders = setCookieHeader
    ? { "Set-Cookie": setCookieHeader }
    : undefined;
  const logCtx = createLogContext(request, "/api/chat", validTokens.rootFolderId);

  const parsed = ChatRequestSchema.safeParse(body);
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
  const enableDriveTools = validData.enableDriveTools;
  const rawDriveToolMode = validData.driveToolMode;
  const requestedMcpServers = validData.mcpServers as McpServerConfig[] | undefined;
  const webSearchEnabled = validData.webSearchEnabled && supportsWebSearch(model);
  const reasoningEffort = validData.reasoningEffort;
  const requirePlanApproval = validData.requirePlanApproval === true;
  const requestSettings = validData.settings;
  const requestedMcpServerIds =
    validData.mcpServerIds && validData.mcpServerIds.length > 0
      ? validData.mcpServerIds
      : (requestedMcpServers || [])
          .map((s) => s.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
  const enableMcp = validData.enableMcp ?? requestedMcpServerIds.length > 0;

  const normalizedModel = normalizeDeprecatedModelName(model) ?? model;
  if (!PERSONAL_ALLOWED_MODELS.has(normalizedModel) || !isVertexModelPriced(normalizedModel)) {
    emitLog(logCtx, 403, { error: `model not available on personal Vertex: ${model}` });
    return new Response(
      JSON.stringify({ error: `model "${model}" is not available on personal Vertex AI` }),
      { status: 403, headers: { "Content-Type": "application/json", ...responseHeaders } },
    );
  }

  // RAG needs either the user's own Gemini File Search key or a project's
  // Firestore vector index; personal Vertex has neither. Say so instead of
  // accepting the request, silently skipping retrieval, AND letting the RAG
  // tool constraint strip the function tools — which leaves the user worse
  // off than if they had never selected a source.
  if (ragStoreIds && ragStoreIds.length > 0) {
    emitLog(logCtx, 400, { error: "RAG is not available on personal Vertex" });
    return new Response(
      JSON.stringify({
        error:
          "RAG is not available with personal Vertex AI. Deselect the RAG source, or use your own Gemini API key.",
      }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } },
    );
  }

  const uid = emailToUid(validTokens.email ?? "");
  if (!uid) {
    emitLog(logCtx, 400, { error: "Session has no email to bill" });
    return new Response(
      JSON.stringify({ error: "This session has no email address to bill personal Vertex usage to." }),
      { status: 400, headers: { "Content-Type": "application/json", ...responseHeaders } },
    );
  }

  const personalSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
  const usesOwnVertex = personalSettings.personalVertexSource === "own";
  if (usesOwnVertex && !personalSettings.personalVertexProjectId?.trim()) {
    return new Response(JSON.stringify({ error: "Set a Google Cloud project ID before using your own Vertex AI." }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...responseHeaders },
    });
  }

  // Per-user rate limiting
  const rateLimited = await requireRateLimit("chat", uid);
  if (rateLimited) {
    emitLog(logCtx, 429, { error: "Rate limit exceeded" });
    return rateLimited;
  }

  // Resolve driveToolMode
  const requestedDriveToolMode =
    rawDriveToolMode ?? (enableDriveTools === false ? "none" : "all");
  // RAG is rejected above, so web search is the only constraint driver here.
  const ragSettingForConstraint = webSearchEnabled ? "__websearch__" : null;
  const toolConstraint = getDriveToolModeConstraint(model, ragSettingForConstraint);
  const driveToolMode = toolConstraint.forcedMode ?? requestedDriveToolMode;
  const functionToolsForcedOff =
    toolConstraint.locked && toolConstraint.forcedMode === "none";

  // Build tools array
  const tools: ToolDefinition[] = [];

  if (driveToolMode !== "none") {
    if (driveToolMode === "readOnly") {
      tools.push(...DRIVE_TOOL_DEFINITIONS.filter(tool => isReadOnlyDriveTool(tool.name)));
    } else if (driveToolMode === "noSearch") {
      tools.push(
        ...DRIVE_TOOL_DEFINITIONS.filter(
          (t) => !DRIVE_SEARCH_TOOL_NAMES.has(t.name),
        ),
      );
    } else {
      tools.push(...DRIVE_TOOL_DEFINITIONS);
    }
  }

  // Resolve MCP servers from user's Drive settings
  let resolvedMcpServers: McpServerConfig[] | undefined;
  let settingsForMcpPersistence:
    | Awaited<ReturnType<typeof getSettings>>
    | null = personalSettings;
  const mcpTokenSnapshot = new Map<string, string>();

  if (!functionToolsForcedOff && enableMcp && requestedMcpServerIds.length > 0) {
    try {
      const settings = personalSettings;
      settingsForMcpPersistence = settings;
      const byId = new Map(
        getEnabledMcpServers(settings).map((s) => [s.id || "", s] as const),
      );
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

  // Client-delegated tools (execute_javascript, run_skill_workflow, etc.)
  const extraTools = (validData.extraToolDefinitions ?? []) as unknown as ToolDefinition[];
  if (extraTools.length > 0) tools.push(...extraTools);
  const delegateToolNames = new Set(extraTools.map((t) => t.name));
  // File writes are DELEGATED to the browser, exactly as on the org path.
  // executeDriveTool does not write to Drive — it returns the content for the
  // caller to persist — so running these server-side would drop the edit:
  // nothing reaches the IndexedDB cache, editHistory, or Push. The browser
  // runs them through drive-tools-local, which is the local-first path the
  // Drive mount already uses for key-based chat.
  delegateToolNames.add("create_drive_file");
  delegateToolNames.add("update_drive_file");

  const driveToolNames = new Set(DRIVE_TOOL_DEFINITIONS.map((t) => t.name));
  const mcpToolNames = new Set(mcpToolDefs.map((t) => t.name));

  logCtx.details = {
    model,
    toolCount: tools.length,
    mcpServers: resolvedMcpServers?.map((s) => s.name) ?? [],
    ragStoreIds: ragStoreIds ?? [],
    streaming: true,
    personalVertex: true,
  };
  emitLog(logCtx, 200);

  const tenant = personalTenant(uid, personalSettings);

  // Create SSE stream
  const abortSignal = request.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let aborted = false;

      abortSignal.addEventListener("abort", () => {
        aborted = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      const sendChunk = (chunk: StreamChunk) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        } catch {
          aborted = true;
        }
      };

      const executeToolCall = async (
        name: string,
        args: Record<string, unknown>,
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

        // Reads/searches only — the write tools never reach here, they are in
        // delegateToolNames and execute in the browser.
        if (driveToolNames.has(name)) {
          if (driveToolMode === "readOnly" && !isReadOnlyDriveTool(name)) return { error: "Drive tool is disabled in read-only mode" };
          return executeDriveTool(
            name,
            args,
            validTokens.accessToken,
            validTokens.rootFolderId,
          );
        }

        if (mcpToolNames.has(name) && resolvedMcpServers) {
          const result = await executeMcpTool(resolvedMcpServers, name, args, request.signal, streamMcpApproval(validTokens, sendChunk, (server, tool) => rememberMcpTool(validTokens.accessToken, validTokens.rootFolderId, server, tool), request.signal));
          if (result.mcpApp) {
            sendChunk({ type: "mcp_app", mcpApp: result.mcpApp });
          }
          return result.textResult;
        }

        return { error: `Unknown tool: ${name}` };
      };

      try {
        for await (const chunk of streamWithTools({
          tenant,
          model,
          messages,
          tools,
          systemPrompt,
          webSearchEnabled,
          reasoningEffort,
          maxFunctionCalls: Math.min(
            requestSettings?.maxFunctionCalls ?? PERSONAL_MAX_FUNCTION_CALLS,
            PERSONAL_MAX_FUNCTION_CALLS,
          ),
          executeToolCall,
          delegateToolNames,
          billing: usesOwnVertex ? undefined : { uid, scope: "personal" },
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
        if (
          settingsForMcpPersistence &&
          resolvedMcpServers &&
          resolvedMcpServers.length > 0
        ) {
          const tokenChanged = resolvedMcpServers.some(
            (server) =>
              mcpTokenSnapshot.get(server.id || server.name) !==
              JSON.stringify(server.oauthTokens ?? null),
          );
          if (tokenChanged) {
            try {
              const freshSettings = await getSettings(
                validTokens.accessToken,
                validTokens.rootFolderId,
              );
              for (const server of resolvedMcpServers!) {
                const key = server.id || server.name;
                const target = getEnabledMcpServers(freshSettings).find(
                  (s) => (s.id || s.name) === key,
                );
                if (target) {
                  target.oauthTokens = server.oauthTokens;
                }
              }
              await saveSettings(
                validTokens.accessToken,
                validTokens.rootFolderId,
                freshSettings,
              );
            } catch (error) {
              console.error("Failed to persist refreshed MCP OAuth tokens:", error);
            }
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed by abort */
        }
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
