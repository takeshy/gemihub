// MCP (Model Context Protocol) client - ported from obsidian-gemini-helper (Node.js fetch version)

import type {
  JsonValue,
  McpServerConfig,
  McpToolInfo,
  McpAppResult,
  McpAppUiResource,
} from "~/types/settings";
import { validateMcpServerUrl } from "./url-validator.server";

/**
 * Error thrown when an MCP HTTP request fails with a non-OK status code.
 * Preserves the HTTP status code for programmatic inspection (e.g. 401 → OAuth discovery).
 */
export class McpHttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

/** JSON-RPC error returned by an MCP server. */
export class McpRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(`MCP Error ${code}: ${message}`);
  }
}

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

interface McpToolsListResult {
  tools: McpToolInfo[];
  nextCursor?: string;
}

interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: {
    name: string;
    version: string;
  };
}

interface McpDiscoverResult {
  supportedVersions: string[];
}

interface McpToolCallResult {
  content: Array<{
    type: string;
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
  structuredContent?: JsonValue;
  _meta?: {
    ui?: {
      resourceUri: string;
    };
  };
}

/** The newest MCP revision implemented by this client. */
export const MCP_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const CLIENT_INFO = { name: "gemihub", version: "1.0.0" } as const;

type ProtocolMode = "unknown" | "modern" | "legacy";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldTryLegacyProtocol(error: unknown): boolean {
  if (error instanceof McpHttpError) {
    return [400, 404, 405].includes(error.statusCode);
  }
  return error instanceof McpRpcError && [-32601, -32022].includes(error.code);
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
  private requestId = 0;
  private protocolMode: ProtocolMode = "unknown";
  private negotiatedVersion: string | null = null;
  private sessionId: string | null = null;
  private negotiationPromise: Promise<void> | null = null;

  constructor(config: McpServerConfig) {
    validateMcpServerUrl(config.url);
    this.config = config;
  }

  private createRequestSignal(timeoutMs: number, abortSignal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!abortSignal) return timeoutSignal;
    return AbortSignal.any([timeoutSignal, abortSignal]);
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async sendRequestRaw(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    abortSignal?: AbortSignal,
    mode: Exclude<ProtocolMode, "unknown"> | "legacy-initialize" = "modern"
  ): Promise<unknown> {
    const requestParams = mode === "modern"
      ? {
          ...params,
          _meta: {
            ...(isRecord(params?._meta) ? params._meta : {}),
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        }
      : params;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params: requestParams,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.config.headers,
      "Mcp-Method": method,
    };

    const requestName = requestParams?.name ?? requestParams?.uri;
    if (typeof requestName === "string") {
      headers["Mcp-Name"] = requestName;
    }
    if (mode === "modern") {
      headers["MCP-Protocol-Version"] = MCP_PROTOCOL_VERSION;
    } else if (mode === "legacy" && this.negotiatedVersion) {
      headers["MCP-Protocol-Version"] = this.negotiatedVersion;
    }
    if (mode !== "modern" && this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const body = JSON.stringify(request);
    const signal = this.createRequestSignal(timeoutMs ?? 30_000, abortSignal);
    let requestUrl = new URL(this.config.url);
    let requestHeaders = headers;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: requestHeaders,
        body,
        signal,
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 5) throw new Error("MCP redirect limit exceeded");
      const location = response.headers.get("location");
      if (!location) throw new Error("MCP redirect response is missing Location");
      const nextUrl = new URL(location, requestUrl);
      validateMcpServerUrl(nextUrl.toString());
      if (nextUrl.origin !== requestUrl.origin) {
        const configured = new Set(Object.keys(this.config.headers || {}).map((key) => key.toLowerCase()));
        requestHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => !configured.has(key.toLowerCase())));
      }
      requestUrl = nextUrl;
    }
    if (!response) throw new Error("MCP request did not produce a response");

    if (!response.ok) {
      const text = await response.text();
      throw new McpHttpError(response.status, `MCP request failed (${response.status}): ${text}`);
    }

    if (mode !== "modern") {
      const newSessionId = response.headers.get("mcp-session-id");
      if (newSessionId) this.sessionId = newSessionId;
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      return this.parseSSEResponse(text);
    } else {
      const jsonResponse: JsonRpcResponse = await response.json();
      if (jsonResponse.error) {
        throw new McpRpcError(
          jsonResponse.error.code,
          jsonResponse.error.message,
          jsonResponse.error.data
        );
      }
      return jsonResponse.result;
    }
  }

  private async sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    await this.ensureProtocol(abortSignal);
    return this.sendRequestRaw(
      method,
      params,
      timeoutMs,
      abortSignal,
      this.protocolMode === "modern" ? "modern" : "legacy"
    );
  }

  private async ensureProtocol(abortSignal?: AbortSignal): Promise<void> {
    if (this.protocolMode !== "unknown") return;
    if (!this.negotiationPromise) {
      this.negotiationPromise = this.negotiateProtocol(abortSignal).finally(() => {
        this.negotiationPromise = null;
      });
    }
    await this.negotiationPromise;
  }

  private async negotiateProtocol(abortSignal?: AbortSignal): Promise<void> {
    try {
      const discovery = (await this.sendRequestRaw(
        "server/discover",
        undefined,
        undefined,
        abortSignal,
        "modern"
      )) as McpDiscoverResult;

      if (discovery.supportedVersions?.includes(MCP_PROTOCOL_VERSION)) {
        this.protocolMode = "modern";
        this.negotiatedVersion = MCP_PROTOCOL_VERSION;
        return;
      }

      const legacyVersion = discovery.supportedVersions?.find(
        (version) => version !== MCP_PROTOCOL_VERSION
      );
      await this.initializeLegacy(legacyVersion || LEGACY_PROTOCOL_VERSION, abortSignal);
    } catch (error) {
      if (!shouldTryLegacyProtocol(error)) throw error;
      await this.initializeLegacy(LEGACY_PROTOCOL_VERSION, abortSignal);
    }
  }

  private async initializeLegacy(
    requestedVersion: string,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const result = (await this.sendRequestRaw("initialize", {
      protocolVersion: requestedVersion,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, undefined, abortSignal, "legacy-initialize")) as McpInitializeResult;

    this.protocolMode = "legacy";
    this.negotiatedVersion = result.protocolVersion;
    await this.sendLegacyNotification("notifications/initialized", undefined, abortSignal);
  }

  /**
   * Parse SSE response to extract JSON-RPC result
   */
  private parseSSEResponse(sseText: string): unknown {
    const lines = sseText.split(/\r?\n/);
    const events: string[] = [];
    let currentDataLines: string[] = [];

    for (const line of lines) {
      if (line === "") {
        if (currentDataLines.length > 0) {
          events.push(currentDataLines.join("\n"));
          currentDataLines = [];
        }
        continue;
      }
      if (line.startsWith(":")) continue; // SSE comment line
      if (line.startsWith("data:")) {
        const dataLine = line.slice(5).replace(/^ /, "");
        currentDataLines.push(dataLine);
      }
    }

    if (currentDataLines.length > 0) {
      events.push(currentDataLines.join("\n"));
    }

    let lastJsonRpc: JsonRpcResponse | null = null;
    for (const payload of events) {
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as JsonRpcResponse;
        if (parsed.jsonrpc === "2.0" && ("result" in parsed || "error" in parsed)) {
          lastJsonRpc = parsed;
        }
      } catch {
        // Ignore non-JSON event payloads and keep scanning
      }
    }

    if (!lastJsonRpc) {
      throw new Error("No JSON-RPC data received in SSE response");
    }

    if (lastJsonRpc.error) {
      throw new McpRpcError(
        lastJsonRpc.error.code,
        lastJsonRpc.error.message,
        lastJsonRpc.error.data
      );
    }

    return lastJsonRpc.result;
  }

  private async sendLegacyNotification(
    method: string,
    params?: Record<string, unknown>,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
      "Mcp-Method": method,
    };
    if (this.negotiatedVersion) {
      headers["MCP-Protocol-Version"] = this.negotiatedVersion;
    }
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    try {
      await fetch(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: this.createRequestSignal(10_000, abortSignal),
      });
    } catch {
      // Notifications do not have a JSON-RPC response to await.
    }
  }

  /**
   * List available tools (follows pagination via nextCursor)
   */
  async listTools(abortSignal?: AbortSignal): Promise<McpToolInfo[]> {
    const allTools: McpToolInfo[] = [];
    let cursor: string | undefined;
    const maxPages = 100;
    let page = 0;

    do {
      const params: Record<string, unknown> | undefined = cursor ? { cursor } : undefined;
      const result = (await this.sendRequest("tools/list", params, undefined, abortSignal)) as McpToolsListResult;
      if (result.tools) {
        allTools.push(...result.tools);
      }
      cursor = result.nextCursor;
      page++;
    } while (cursor && page < maxPages);

    return allTools;
  }

  /**
   * Call a tool (raw result)
   */
  async callToolRaw(
    toolName: string,
    args?: Record<string, unknown>,
    timeoutMs?: number,
    abortSignal?: AbortSignal
  ): Promise<McpToolCallResult> {
    return (await this.sendRequest("tools/call", {
      name: toolName,
      arguments: args || {},
    }, timeoutMs, abortSignal)) as McpToolCallResult;
  }

  /**
   * Call a tool and return MCP Apps result
   */
  async callToolWithUi(
    toolName: string,
    args?: Record<string, unknown>,
    timeoutMs?: number,
    abortSignal?: AbortSignal
  ): Promise<McpAppResult> {
    const result = await this.callToolRaw(toolName, args, timeoutMs, abortSignal);

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
      structuredContent: result.structuredContent,
      _meta: result._meta,
    };
  }

  /**
   * Read a resource
   */
  async readResource(uri: string, abortSignal?: AbortSignal): Promise<McpAppUiResource | null> {
    try {
      const result = (await this.sendRequest("resources/read", {
        uri,
      }, undefined, abortSignal)) as McpResourceReadResult;

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

  /** Close a negotiated legacy HTTP session. Modern clients are stateless. */
  async close(): Promise<void> {
    if (this.protocolMode === "legacy" && this.sessionId) {
      try {
        await fetch(this.config.url, {
          method: "DELETE",
          headers: {
            ...this.config.headers,
            "Mcp-Session-Id": this.sessionId,
            ...(this.negotiatedVersion
              ? { "MCP-Protocol-Version": this.negotiatedVersion }
              : {}),
          },
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Ignore shutdown errors.
      }
    }
    this.sessionId = null;
    this.negotiatedVersion = null;
    this.protocolMode = "unknown";
  }

}
