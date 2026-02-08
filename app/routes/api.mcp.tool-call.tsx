import type { Route } from "./+types/api.mcp.tool-call";
import { requireAuth } from "~/services/session.server";
import { getOrCreateClient } from "~/services/mcp-tools.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import type { McpServerConfig } from "~/types/settings";

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

  await requireAuth(request);

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
      { status: 400 }
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
      { status: 400 }
    );
  }

  try {
    const config: McpServerConfig = {
      name: "mcp-app-proxy",
      url: serverUrl,
      headers: serverHeaders,
    };

    const client = getOrCreateClient(config);
    const result = await client.callToolWithUi(toolName, args || {});

    return Response.json(result);
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
      { status: 200 } // Return 200 with isError flag, matching MCP conventions
    );
  }
}
