import type { Route } from "./+types/api.mcp.tool-call";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { getOrCreateClient } from "~/services/mcp-tools.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import type { McpServerConfig } from "~/types/settings";

function canonicalizeHeaders(headers?: Record<string, string>): string {
  if (!headers) return "";
  return JSON.stringify(
    Object.entries(headers)
      .map(([k, v]) => [k.toLowerCase(), v] as const)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

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

  const body = await request.json();
  const { serverUrl, serverHeaders, toolName, args } = body as {
    serverUrl: string;
    serverHeaders?: Record<string, string>;
    toolName: string;
    args: Record<string, unknown>;
  };

  if (!serverUrl || !toolName) {
    return Response.json(
      { error: "serverUrl and toolName are required" },
      { status: 400, headers: responseHeaders }
    );
  }

  try {
    validateMcpServerUrl(serverUrl);
  } catch (error) {
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
    const targetHeaderSig = canonicalizeHeaders(serverHeaders);
    const matchedServer = settings.mcpServers.find(
      (s) => s.url === serverUrl && canonicalizeHeaders(s.headers) === targetHeaderSig
    );

    const tokenBefore = matchedServer
      ? JSON.stringify(matchedServer.oauthTokens ?? null)
      : null;

    const config: McpServerConfig = matchedServer ? matchedServer : {
      name: "mcp-app-proxy",
      url: serverUrl,
      headers: serverHeaders,
    };

    const client = await getOrCreateClient(config);
    const result = await client.callToolWithUi(toolName, args || {});

    if (matchedServer && tokenBefore !== JSON.stringify(matchedServer.oauthTokens ?? null)) {
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
    }

    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
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
