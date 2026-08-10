import type { Route } from "./+types/api.mcp.tool-call";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { getOrCreateClient } from "~/services/mcp-tools.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import { resolveMcpServerForProxy } from "~/services/mcp-proxy-server-resolver";
import { getEnabledMcpServers, type McpServerConfig } from "~/types/settings";
import { createLogContext, emitLog } from "~/services/logger.server";

/**
 * Server-side proxy for MCP tool calls from sandboxed iframes.
 * The iframe cannot directly call MCP servers due to CORS and sandbox restrictions,
 * so this endpoint proxies the request.
 * Reuses cached MCP clients to avoid re-initializing on every request (prevents 429).
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const logCtx = createLogContext(request, "/api/mcp/tool-call", validTokens.rootFolderId);

  const body = await request.json();
  const { serverId, serverUrl, serverHeaders, toolName, args } = body as {
    serverId?: string;
    serverUrl: string;
    serverHeaders?: Record<string, string>;
    toolName: string;
    args: Record<string, unknown>;
  };

  logCtx.details = { mcpToolName: toolName, mcpServerUrl: serverUrl };

  if (!serverUrl || !toolName) {
    emitLog(logCtx, 400, { error: "serverUrl and toolName are required" });
    return Response.json(
      { error: "serverUrl and toolName are required" },
      { status: 400, headers: responseHeaders }
    );
  }

  try {
    validateMcpServerUrl(serverUrl);
  } catch (error) {
    emitLog(logCtx, 400, { error: error instanceof Error ? error.message : "Invalid server URL" });
    return Response.json(
      {
        content: [{ type: "text", text: error instanceof Error ? error.message : "Invalid server URL" }],
        isError: true,
      },
      { status: 400, headers: responseHeaders }
    );
  }

  try {
    const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
    const resolved = resolveMcpServerForProxy({
      servers: getEnabledMcpServers(settings),
      serverId,
      serverUrl,
      serverHeaders,
    });
    if (resolved.error) {
      return Response.json(
        {
          content: [{ type: "text", text: resolved.error.message }],
          isError: true,
        },
        { status: resolved.error.status, headers: responseHeaders }
      );
    }
    const matchedServer = resolved.matchedServer;

    if (!matchedServer) {
      return Response.json(
        { content: [{ type: "text", text: "No matching MCP server found in settings" }], isError: true },
        { status: 403, headers: responseHeaders }
      );
    }
    const config: McpServerConfig = matchedServer;
    const tokenBefore = JSON.stringify(matchedServer.oauthTokens ?? null);

    const client = await getOrCreateClient(config);
    const result = await client.callToolWithUi(toolName, args || {});

    if (tokenBefore !== JSON.stringify(matchedServer.oauthTokens ?? null)) {
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
    }

    emitLog(logCtx, 200);
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    emitLog(logCtx, 200, { error: error instanceof Error ? error.message : "MCP tool call failed" });
    return Response.json(
      {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "MCP tool call failed",
          },
        ],
        isError: true,
      },
      {
        status: 200, // Return 200 with isError flag, matching MCP conventions
        headers: responseHeaders,
      }
    );
  }
}
