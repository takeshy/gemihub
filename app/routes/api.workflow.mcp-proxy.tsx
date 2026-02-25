/**
 * MCP proxy for local workflow execution.
 * The command node's local handler calls this to get MCP tool definitions
 * and execute MCP tool calls (which require server-side MCP client).
 */
import type { Route } from "./+types/api.workflow.mcp-proxy";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { getMcpToolDefinitions, executeMcpTool } from "~/services/mcp-tools.server";
import type { McpServerConfig } from "~/types/settings";

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders: Record<string, string> = {};
  if (setCookieHeader) responseHeaders["Set-Cookie"] = setCookieHeader;

  const body = await request.json();
  const { action: actionType } = body as { action: string };

  let settings;
  try {
    settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
  } catch (err) {
    return Response.json(
      { error: `Failed to load settings: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: responseHeaders }
    );
  }

  switch (actionType) {
    case "getToolDefinitions": {
      const { mcpServerIds } = body as { mcpServerIds: string[] };
      if (!mcpServerIds || !Array.isArray(mcpServerIds)) {
        return Response.json({ error: "mcpServerIds required" }, { status: 400, headers: responseHeaders });
      }

      const enabledServers = (settings?.mcpServers || []).filter(
        (s: McpServerConfig) => mcpServerIds.includes(s.id || "")
      );

      try {
        const tools = await getMcpToolDefinitions(enabledServers, request.signal);
        return Response.json({ tools }, { headers: responseHeaders });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "Failed to get MCP tool definitions" },
          { status: 500, headers: responseHeaders }
        );
      }
    }

    case "executeTool": {
      const { mcpServerIds, toolName, args } = body as {
        mcpServerIds: string[];
        toolName: string;
        args: Record<string, unknown>;
      };
      if (!toolName) {
        return Response.json({ error: "toolName required" }, { status: 400, headers: responseHeaders });
      }

      const enabledServers = (settings?.mcpServers || []).filter(
        (s: McpServerConfig) => (mcpServerIds || []).includes(s.id || "")
      );

      try {
        const result = await executeMcpTool(enabledServers, toolName, args || {}, request.signal);
        return Response.json({
          textResult: result.textResult,
          mcpApp: result.mcpApp,
        }, { headers: responseHeaders });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "MCP tool execution failed" },
          { status: 500, headers: responseHeaders }
        );
      }
    }

    default:
      return Response.json({ error: `Unknown action: ${actionType}` }, { status: 400, headers: responseHeaders });
  }
}
