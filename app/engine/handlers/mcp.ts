import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import type { McpAppInfo } from "~/types/chat";
import type { McpAppResult, McpAppUiResource } from "~/types/settings";
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

  // Call MCP server using JSON-RPC over HTTP (Streamable HTTP transport)
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
      id: Date.now(),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP call failed: ${response.status} ${text}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(`MCP tool error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  // Extract text content from result
  const content = result.result?.content;
  if (content && Array.isArray(content)) {
    const textParts = content
      .filter((c: { type: string; text?: string }) => c.type === "text" && c.text)
      .map((c: { text: string }) => c.text);
    const resultText = textParts.join("\n");

    if (saveTo) {
      context.variables.set(saveTo, resultText);
    }
  } else if (saveTo) {
    context.variables.set(saveTo, JSON.stringify(result.result || result));
  }

  // Check for UI resource metadata
  const saveUiTo = node.properties["saveUiTo"];
  let mcpAppInfo: McpAppInfo | undefined;

  if (result.result?._meta?.ui?.resourceUri) {
    const resourceUri = result.result._meta.ui.resourceUri;
    const toolResult: McpAppResult = {
      content: Array.isArray(content)
        ? content.map((c: { type: string; text?: string }) => ({
            type: c.type as "text" | "image" | "resource",
            text: c.text,
          }))
        : [],
      _meta: { ui: { resourceUri } },
    };

    try {
      // Fetch the UI resource from the MCP server
      const uiResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "resources/read",
          params: { uri: resourceUri },
          id: Date.now(),
        }),
      });

      let uiResource: McpAppUiResource | undefined;
      if (uiResponse.ok) {
        const uiResult = await uiResponse.json();
        const uiContent = uiResult.result?.contents?.[0];
        if (uiContent) {
          uiResource = {
            uri: resourceUri,
            mimeType: uiContent.mimeType || "text/html",
            text: uiContent.text,
            blob: uiContent.blob,
          };

          // Save to variable if saveUiTo is set
          if (saveUiTo) {
            context.variables.set(saveUiTo, JSON.stringify({
              serverUrl: url,
              resourceUri,
              mimeType: uiContent.mimeType || "text/html",
              content: uiContent.text || uiContent.blob || "",
            }));
          }
        }
      }

      mcpAppInfo = {
        serverUrl: url,
        toolResult,
        uiResource: uiResource || null,
      };
    } catch {
      // UI resource fetch is non-fatal; still create McpAppInfo without resource
      mcpAppInfo = {
        serverUrl: url,
        toolResult,
        uiResource: null,
      };
    }
  }

  return mcpAppInfo;
}
