// MCP (Model Context Protocol) client - ported from obsidian-gemini-helper (Node.js fetch version)

import type { McpServerConfig, McpToolInfo, McpAppResult, McpAppUiResource } from "~/types/settings";

// JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

interface McpToolsListResult {
  tools: McpToolInfo[];
}

interface McpToolCallResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: {
      uri: string;
      mimeType?: string;
      text?: string;
    };
  }>;
  isError?: boolean;
  _meta?: {
    ui?: {
      resourceUri: string;
    };
  };
}

interface McpResourceReadResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

/**
 * MCP Client for communicating with MCP servers via Streamable HTTP transport
 */
export class McpClient {
  private config: McpServerConfig;
  private sessionId: string | null = null;
  private requestId = 0;
  private initialized = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.config.headers,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const response = await fetch(this.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MCP request failed (${response.status}): ${text}`);
    }

    // Extract session ID
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      return this.parseSSEResponse(text);
    } else {
      const jsonResponse: JsonRpcResponse = await response.json();
      if (jsonResponse.error) {
        throw new Error(`MCP Error ${jsonResponse.error.code}: ${jsonResponse.error.message}`);
      }
      return jsonResponse.result;
    }
  }

  /**
   * Parse SSE response to extract JSON-RPC result
   */
  private parseSSEResponse(sseText: string): unknown {
    const lines = sseText.split("\n");
    let lastData = "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        lastData = line.substring(6);
      }
    }

    if (!lastData) {
      throw new Error("No data received in SSE response");
    }

    const jsonResponse: JsonRpcResponse = JSON.parse(lastData);

    if (jsonResponse.error) {
      throw new Error(`MCP Error ${jsonResponse.error.code}: ${jsonResponse.error.message}`);
    }

    return jsonResponse.result;
  }

  /**
   * Send a notification (no response expected)
   */
  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const notification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    try {
      await fetch(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(notification),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Notifications may not return anything
    }
  }

  /**
   * Initialize the MCP session
   */
  async initialize(): Promise<McpInitializeResult> {
    if (this.initialized) {
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: this.config.name, version: "unknown" },
      };
    }

    const result = (await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "gemini-hub",
        version: "1.0.0",
      },
    })) as McpInitializeResult;

    await this.sendNotification("notifications/initialized");

    this.initialized = true;
    return result;
  }

  /**
   * List available tools
   */
  async listTools(): Promise<McpToolInfo[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const result = (await this.sendRequest("tools/list")) as McpToolsListResult;
    return result.tools || [];
  }

  /**
   * Call a tool (raw result)
   */
  async callToolRaw(toolName: string, args?: Record<string, unknown>): Promise<McpToolCallResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    return (await this.sendRequest("tools/call", {
      name: toolName,
      arguments: args || {},
    })) as McpToolCallResult;
  }

  /**
   * Call a tool and return MCP Apps result
   */
  async callToolWithUi(toolName: string, args?: Record<string, unknown>): Promise<McpAppResult> {
    const result = await this.callToolRaw(toolName, args);

    return {
      content:
        result.content?.map((c) => ({
          type: c.type,
          text: c.text,
          data: c.data,
          mimeType: c.mimeType,
          resource: c.resource,
        })) || [],
      isError: result.isError,
      _meta: result._meta,
    };
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<McpAppUiResource | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = (await this.sendRequest("resources/read", {
        uri,
      })) as McpResourceReadResult;

      if (result.contents && result.contents.length > 0) {
        const content = result.contents[0];
        return {
          uri: content.uri,
          mimeType: content.mimeType || "text/html",
          text: content.text,
          blob: content.blob,
        };
      }

      return null;
    } catch (error) {
      console.error(`Failed to read resource ${uri}:`, error);
      return null;
    }
  }

  /**
   * Close the MCP session
   */
  async close(): Promise<void> {
    if (this.sessionId) {
      try {
        const headers: Record<string, string> = {
          ...this.config.headers,
        };
        headers["Mcp-Session-Id"] = this.sessionId;

        await fetch(this.config.url, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Ignore close errors
      }
      this.sessionId = null;
      this.initialized = false;
    }
  }
}
