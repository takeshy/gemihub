import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import type { McpAppInfo } from "~/types/chat";
import type { McpAppResult, McpAppUiResource, McpServerConfig } from "~/types/settings";
import { deriveMcpServerId } from "~/types/settings";
import { McpClient } from "~/services/mcp-client.server";
import { getOrCreateClient } from "~/services/mcp-tools.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import { replaceVariables } from "./utils";

function normalizeUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

// Handle MCP node - call remote MCP server tool via HTTP
export async function handleMcpNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<McpAppInfo | undefined> {
  const url = replaceVariables(node.properties["url"] || "", context);
  const toolName = replaceVariables(node.properties["tool"] || "", context);
  const argsStr = node.properties["args"] || "";
  const headersStr = node.properties["headers"] || "";
  const saveTo = node.properties["saveTo"];

  if (!url) throw new Error("MCP node missing 'url' property");
  if (!toolName) throw new Error("MCP node missing 'tool' property");
  validateMcpServerUrl(url);

  // Parse headers
  let headers: Record<string, string> = {};
  if (headersStr) {
    const replacedHeaders = replaceVariables(headersStr, context);
    try {
      headers = JSON.parse(replacedHeaders);
    } catch {
      throw new Error(`Invalid JSON in MCP headers: ${replacedHeaders}`);
    }
  }

  // Parse arguments
  let args: Record<string, unknown> = {};
  if (argsStr) {
    const replacedArgs = replaceVariables(argsStr, context);
    try {
      args = JSON.parse(replacedArgs);
    } catch {
      throw new Error(`Invalid JSON in MCP args: ${replacedArgs}`);
    }
  }

  // Find matching server config from settings (for OAuth token injection/refresh)
  const normalizedUrl = normalizeUrl(url);
  const matchedServer = serviceContext.settings?.mcpServers?.find(
    (s) => normalizeUrl(s.url) === normalizedUrl
  );

  // If a matching server config exists, use getOrCreateClient for OAuth support;
  // otherwise fall back to a direct McpClient (backward compat)
  let client: McpClient;
  let isSharedClient = false;
  if (matchedServer) {
    // Merge workflow node headers into the server config
    const configWithHeaders = Object.keys(headers).length > 0
      ? { ...matchedServer, headers: { ...matchedServer.headers, ...headers } }
      : matchedServer;
    client = await getOrCreateClient(configWithHeaders);
    isSharedClient = true;
  } else {
    client = new McpClient({ name: "workflow", url, headers });
  }

  try {
    const callResult = await client.callToolWithUi(
      toolName,
      args,
      60_000,
      serviceContext.abortSignal
    );

    // Extract text content from result
    const textParts = callResult.content
      ?.filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
    const resultText = textParts
      || (callResult.structuredContent !== undefined
        ? JSON.stringify(callResult.structuredContent)
        : null)
      || JSON.stringify(callResult.content);

    if (saveTo) {
      context.variables.set(saveTo, resultText);
    }

    // Check for UI resource metadata
    const saveUiTo = node.properties["saveUiTo"];
    let mcpAppInfo: McpAppInfo | undefined;

    if (callResult._meta?.ui?.resourceUri) {
      const resourceUri = callResult._meta.ui.resourceUri;
      const toolResult: McpAppResult = {
        content: callResult.content || [],
        structuredContent: callResult.structuredContent,
        _meta: { ui: { resourceUri } },
      };

      let uiResource: McpAppUiResource | null = null;
      try {
        uiResource = await client.readResource(resourceUri, serviceContext.abortSignal);

        if (uiResource && saveUiTo) {
          context.variables.set(saveUiTo, JSON.stringify({
            serverUrl: url,
            resourceUri,
            mimeType: uiResource.mimeType || "text/html",
            content: uiResource.text || uiResource.blob || "",
          }));
        }
      } catch {
        // UI resource fetch is non-fatal
      }

      mcpAppInfo = buildMcpAppInfo(matchedServer, url, headers, toolResult, uiResource);
    }

    return mcpAppInfo;
  } finally {
    if (!isSharedClient) {
      await client.close();
    }
  }
}

/**
 * Build McpAppInfo matching the chat path's pattern so that the client-side
 * proxy (resource-read / tool-call) can resolve the server config correctly.
 */
function buildMcpAppInfo(
  matchedServer: McpServerConfig | undefined,
  url: string,
  nodeHeaders: Record<string, string>,
  toolResult: McpAppResult,
  uiResource: McpAppUiResource | null,
): McpAppInfo {
  if (matchedServer) {
    // Use serverId + server config headers so the proxy resolves via
    // resolveMcpServerForProxy and getOrCreateClient injects OAuth tokens.
    return {
      serverId: deriveMcpServerId(matchedServer),
      serverUrl: matchedServer.url,
      serverHeaders: matchedServer.headers,
      toolResult,
      uiResource,
    };
  }
  // No matching config — pass node headers as-is (backward compat)
  return {
    serverUrl: url,
    serverHeaders: Object.keys(nodeHeaders).length > 0 ? nodeHeaders : undefined,
    toolResult,
    uiResource,
  };
}
