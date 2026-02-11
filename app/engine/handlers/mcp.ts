import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import type { McpAppInfo } from "~/types/chat";
import type { McpAppResult, McpAppUiResource } from "~/types/settings";
import { McpClient } from "~/services/mcp-client.server";
import { replaceVariables } from "./utils";

// Handle MCP node - call remote MCP server tool via HTTP
export async function handleMcpNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext
): Promise<McpAppInfo | undefined> {
  const url = replaceVariables(node.properties["url"] || "", context);
  const toolName = replaceVariables(node.properties["tool"] || "", context);
  const argsStr = node.properties["args"] || "";
  const headersStr = node.properties["headers"] || "";
  const saveTo = node.properties["saveTo"];

  if (!url) throw new Error("MCP node missing 'url' property");
  if (!toolName) throw new Error("MCP node missing 'tool' property");

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

  // Use McpClient for proper MCP lifecycle (initialize → tools/call → close)
  const client = new McpClient({ name: "workflow", url, headers });
  try {
    await client.initialize();
    const callResult = await client.callToolWithUi(toolName, args, 60_000);

    // Extract text content from result
    const textParts = callResult.content
      ?.filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
    const resultText = textParts || JSON.stringify(callResult.content);

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
        _meta: { ui: { resourceUri } },
      };

      let uiResource: McpAppUiResource | null = null;
      try {
        uiResource = await client.readResource(resourceUri);

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

      mcpAppInfo = {
        serverUrl: url,
        toolResult,
        uiResource,
      };
    }

    return mcpAppInfo;
  } finally {
    await client.close();
  }
}
