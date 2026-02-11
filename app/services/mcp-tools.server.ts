// MCP tools integration with Gemini Function Calling

import { McpClient } from "./mcp-client.server";
import type {
  McpServerConfig,
  McpToolInfo,
  ToolDefinition,
  ToolPropertyDefinition,
} from "~/types/settings";
import type { McpAppInfo } from "~/types/chat";

// Cache of MCP clients per session
const mcpClients = new Map<string, McpClient>();

/**
 * Sanitize MCP server/tool name for use in prefixed tool names.
 * Matches obsidian-gemini-helper: lowercase, replace non-alphanumeric with _, strip leading/trailing _.
 */
function sanitizeMcpName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

function getClientKey(config: McpServerConfig): string {
  const token = config.oauthTokens?.accessToken || "";
  return `${config.url}:${JSON.stringify(config.headers || {})}:${token}`;
}

export function getOrCreateClient(config: McpServerConfig): McpClient {
  const key = getClientKey(config);
  let client = mcpClients.get(key);
  if (!client) {
    // Evict stale client for the same URL+headers but different (old) token
    const baseKey = `${config.url}:${JSON.stringify(config.headers || {})}:`;
    for (const [k, old] of mcpClients) {
      if (k.startsWith(baseKey) && k !== key) {
        old.close().catch(() => {});
        mcpClients.delete(k);
      }
    }

    // Inject OAuth Authorization header if tokens are present
    const effectiveConfig = { ...config };
    if (config.oauthTokens) {
      effectiveConfig.headers = {
        ...config.headers,
        Authorization: `Bearer ${config.oauthTokens.accessToken}`,
      };
    }
    client = new McpClient(effectiveConfig);
    mcpClients.set(key, client);
  }
  return client;
}

/**
 * Get tool definitions from all enabled MCP servers, formatted for Gemini Function Calling.
 * Tool names are prefixed with mcp_{serverName}_ to avoid collisions.
 */
export async function getMcpToolDefinitions(
  mcpServers: McpServerConfig[]
): Promise<ToolDefinition[]> {
  const allTools: ToolDefinition[] = [];

  for (const server of mcpServers) {
    try {
      const client = getOrCreateClient(server);
      const tools = await client.listTools();

      for (const tool of tools) {
        const toolDef = mcpToolInfoToDefinition(server.name, tool);
        allTools.push(toolDef);
      }
    } catch (error) {
      console.error(`Failed to get tools from MCP server ${server.name}:`, error);
    }
  }

  return allTools;
}

/**
 * Recursively convert an MCP JSON Schema property to Gemini ToolPropertyDefinition
 */
function convertProperty(raw: Record<string, unknown>, fallbackDesc: string): ToolPropertyDefinition {
  const type = (raw.type as string) || "string";
  const description = (raw.description as string) || fallbackDesc;
  const result: ToolPropertyDefinition = { type, description };

  if (raw.enum && Array.isArray(raw.enum)) {
    result.enum = raw.enum as string[];
  }

  // Handle nested object properties
  if (raw.properties && typeof raw.properties === "object") {
    const nested: Record<string, ToolPropertyDefinition> = {};
    for (const [k, v] of Object.entries(raw.properties as Record<string, unknown>)) {
      nested[k] = convertProperty(v as Record<string, unknown>, k);
    }
    result.properties = nested;
    if (raw.required && Array.isArray(raw.required)) {
      result.required = raw.required as string[];
    }
  }

  // Handle array items
  if (type === "array" && raw.items && typeof raw.items === "object") {
    result.items = convertProperty(raw.items as Record<string, unknown>, "item");
  }

  return result;
}

/**
 * Convert MCP tool info to Gemini ToolDefinition
 */
function mcpToolInfoToDefinition(serverName: string, tool: McpToolInfo): ToolDefinition {
  const safeName = sanitizeMcpName(serverName);
  const safeToolName = sanitizeMcpName(tool.name);
  const properties: Record<string, ToolPropertyDefinition> = {};
  const required: string[] = [];

  if (tool.inputSchema && typeof tool.inputSchema === "object") {
    const schema = tool.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    if (schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        properties[key] = convertProperty(value as Record<string, unknown>, key);
      }
    }

    if (schema.required) {
      required.push(...schema.required);
    }
  }

  return {
    name: `mcp_${safeName}_${safeToolName}`,
    description: tool.description || `MCP tool: ${tool.name} from ${serverName}`,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

/**
 * Result of an MCP tool execution, including optional MCP App info
 */
export interface McpToolExecutionResult {
  /** Text result to send back to Gemini as the function response */
  textResult: unknown;
  /** MCP App info if the tool returned UI metadata */
  mcpApp?: McpAppInfo;
}

/**
 * Build a tool map from server configs, matching obsidian-gemini-helper's createMcpToolExecutor pattern.
 * Maps prefixed tool names to { server, mcpToolName (original name) }.
 */
function buildToolMap(mcpServers: McpServerConfig[]): Map<string, { server: McpServerConfig; mcpToolName: string }> {
  const toolMap = new Map<string, { server: McpServerConfig; mcpToolName: string }>();

  for (const server of mcpServers) {
    if (!server.tools) continue;
    const safeName = sanitizeMcpName(server.name);

    for (const tool of server.tools) {
      const safeToolName = sanitizeMcpName(tool.name);
      const prefixedName = `mcp_${safeName}_${safeToolName}`;
      toolMap.set(prefixedName, { server, mcpToolName: tool.name });
    }
  }

  return toolMap;
}

/**
 * Execute an MCP tool call, returning both the text result and any MCP App info.
 * Matches obsidian-gemini-helper's mcpToolExecutor.execute() pattern.
 */
export async function executeMcpTool(
  mcpServers: McpServerConfig[],
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolExecutionResult> {
  // Build tool map for lookup (matches obsidian pattern)
  const toolMap = buildToolMap(mcpServers);
  const entry = toolMap.get(toolName);

  if (!entry) {
    // Fallback: try prefix matching for servers without cached tools
    let server: McpServerConfig | undefined;
    let actualToolName = "";

    for (const s of mcpServers) {
      const safeName = sanitizeMcpName(s.name);
      const prefix = `mcp_${safeName}_`;
      if (toolName.startsWith(prefix)) {
        server = s;
        actualToolName = toolName.slice(prefix.length);
        break;
      }
    }

    if (!server) {
      return { textResult: { error: `MCP server not found for tool: ${toolName}` } };
    }

    return executeToolOnServer(server, actualToolName, args);
  }

  return executeToolOnServer(entry.server, entry.mcpToolName, args);
}

async function executeToolOnServer(
  server: McpServerConfig,
  actualToolName: string,
  args: Record<string, unknown>
): Promise<McpToolExecutionResult> {
  try {
    const client = getOrCreateClient(server);
    const appResult = await client.callToolWithUi(actualToolName, args);

    // Extract text content for Gemini
    const textParts = appResult.content
      ?.filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");

    const textResult = textParts || JSON.stringify(appResult.content);

    // Check for MCP App UI metadata - check result first, then tool definition as fallback
    let resourceUri = appResult._meta?.ui?.resourceUri;
    if (!resourceUri && server.tools) {
      const toolInfo = server.tools.find((t) => t.name === actualToolName);
      if (toolInfo?._meta?.ui?.resourceUri) {
        resourceUri = toolInfo._meta.ui.resourceUri;
        // Also set on appResult so client has access
        if (!appResult._meta) appResult._meta = {};
        if (!appResult._meta.ui) appResult._meta.ui = { resourceUri };
      }
    }

    let mcpApp: McpAppInfo | undefined;
    if (resourceUri) {
      let uiResource = null;
      try {
        uiResource = await client.readResource(resourceUri);
      } catch (e) {
        console.error(`Failed to fetch MCP App UI resource (${resourceUri}):`, e);
      }

      mcpApp = {
        serverUrl: server.url,
        serverHeaders: server.headers,
        toolResult: appResult,
        uiResource,
      };
    }

    return { textResult, mcpApp };
  } catch (error) {
    return {
      textResult: {
        error: error instanceof Error ? error.message : "MCP tool call failed",
      },
    };
  }
}

/**
 * Close all MCP clients
 */
export async function closeAllMcpClients(): Promise<void> {
  for (const client of mcpClients.values()) {
    await client.close();
  }
  mcpClients.clear();
}
