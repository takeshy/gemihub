import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";

// Handle MCP node - call remote MCP server tool via HTTP
export async function handleMcpNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext
): Promise<void> {
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
}
