import type { Route } from "./+types/api.mcp.resource-read";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { getOrCreateClient } from "~/services/mcp-tools.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import { resolveMcpServerForProxy } from "~/services/mcp-proxy-server-resolver";
import { getEnabledMcpServers, type McpServerConfig } from "~/types/settings";
import { createLogContext, emitLog } from "~/services/logger.server";

/**
 * Server-side proxy for reading MCP resources (used by McpAppRenderer as fallback).
 * Reuses cached MCP clients to avoid re-initializing on every request (prevents 429).
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const logCtx = createLogContext(request, "/api/mcp/resource-read", validTokens.rootFolderId);

  const body = await request.json();
  const { serverId, serverUrl, serverHeaders, resourceUri } = body as {
    serverId?: string;
    serverUrl: string;
    serverHeaders?: Record<string, string>;
    resourceUri: string;
  };

  logCtx.details = { resourceUri };

  if (!serverUrl || !resourceUri) {
    emitLog(logCtx, 400, { error: "serverUrl and resourceUri are required" });
    return Response.json(
      { error: "serverUrl and resourceUri are required" },
      { status: 400, headers: responseHeaders }
    );
  }

  try {
    validateMcpServerUrl(serverUrl);
  } catch (error) {
    emitLog(logCtx, 400, { error: error instanceof Error ? error.message : "Invalid server URL" });
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid server URL" },
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
        { error: resolved.error.message },
        { status: resolved.error.status, headers: responseHeaders }
      );
    }
    const matchedServer = resolved.matchedServer;

    if (!matchedServer) {
      return Response.json(
        { error: "No matching MCP server found in settings" },
        { status: 403, headers: responseHeaders }
      );
    }
    const config: McpServerConfig = matchedServer;
    const tokenBefore = JSON.stringify(matchedServer.oauthTokens ?? null);

    const client = await getOrCreateClient(config);
    const resource = await client.readResource(resourceUri);

    if (tokenBefore !== JSON.stringify(matchedServer.oauthTokens ?? null)) {
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
    }

    if (!resource) {
      emitLog(logCtx, 404, { error: "Resource not found" });
      return Response.json({ error: "Resource not found" }, { status: 404, headers: responseHeaders });
    }

    emitLog(logCtx, 200);
    return Response.json(resource, { headers: responseHeaders });
  } catch (error) {
    emitLog(logCtx, 500, { error: error instanceof Error ? error.message : "Resource read failed" });
    return Response.json(
      { error: error instanceof Error ? error.message : "Resource read failed" },
      { status: 500, headers: responseHeaders }
    );
  }
}
