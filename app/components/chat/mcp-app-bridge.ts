import type { McpAppResult, McpAppUiResource } from "~/types/settings";

export interface McpAppHostMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface BridgeOptions {
  send: (message: McpAppHostMessage) => void;
  toolResult: McpAppResult;
  toolInput?: Record<string, unknown>;
  hostContext: () => Record<string, unknown>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpAppResult>;
  readResource: (uri: string) => Promise<McpAppUiResource | null>;
  resize: (height: number) => void;
}

// MCP Apps 2026-01-26: initialize -> initialized -> tool input/result.
// Keep this bridge independent of the DOM so the wire lifecycle can be tested.
export function createMcpAppBridge(options: BridgeOptions) {
  let initialized = false;
  let delivered = false;
  const notify = (method: string, params: unknown) => options.send({ jsonrpc: "2.0", method, params });

  return async (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const message = data as McpAppHostMessage;
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
    const isRequest = typeof message.id === "string" || typeof message.id === "number";
    const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
      ? message.params as Record<string, unknown> : {};
    const reply = (result: unknown) => options.send({ jsonrpc: "2.0", id: message.id, result });

    // JSON-RPC notifications must never receive response/error envelopes.
    if (!isRequest) {
      if (message.method === "ui/notifications/initialized" && initialized && !delivered) {
        delivered = true;
        notify("ui/notifications/tool-input", options.toolInput ? { arguments: options.toolInput } : {});
        notify("ui/notifications/tool-result", options.toolResult);
      } else if (message.method === "ui/notifications/size-changed") {
        if (typeof params.height === "number" && Number.isFinite(params.height) && params.height > 0) {
          options.resize(Math.min(800, Math.max(200, params.height)));
        }
      }
      return;
    }

    try {
      switch (message.method) {
        case "ui/initialize":
          initialized = true;
          delivered = false;
          reply({
            protocolVersion: "2026-01-26",
            hostInfo: { name: "GemiHub", version: "1.0.0" },
            hostCapabilities: { serverTools: {}, serverResources: {} },
            hostContext: options.hostContext(),
          });
          break;
        case "ping":
          reply({});
          break;
        case "tools/call":
          if (typeof params.name !== "string" || !params.name
            || (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments)))) {
            options.send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid tool call parameters" } });
            return;
          }
          reply(await options.callTool(params.name, (params.arguments as Record<string, unknown> | undefined) ?? {}));
          break;
        case "resources/read": {
          if (typeof params.uri !== "string" || !params.uri) {
            options.send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Resource URI is required" } });
            return;
          }
          const resource = await options.readResource(params.uri);
          if (!resource) throw new Error("Failed to read MCP resource");
          reply({ contents: [resource] });
          break;
        }
        case "ui/request-display-mode":
          reply({ mode: "inline" });
          break;
        case "context/update": // Compatibility with the previous host bridge.
          reply({ ok: true });
          break;
        default:
          options.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
      }
    } catch (error) {
      options.send({ jsonrpc: "2.0", id: message.id, error: {
        code: -32000, message: error instanceof Error ? error.message : "Internal error",
      } });
    }
  };
}
