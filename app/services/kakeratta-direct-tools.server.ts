import { getMcpToolDefinitions, executeMcpTool } from "./mcp-tools.server";
import { getEnabledMcpServers, deriveMcpServerId, sanitizeMcpIdentifier, type UserSettings } from "~/types/settings";

const dependencies = { getMcpToolDefinitions, executeMcpTool };

/** Direct requests use only explicitly selected servers and existing approvals. */
export async function getDirectTools(settings: UserSettings, selectedIds: string[], backend = dependencies, persistTokens?: (servers: UserSettings["mcpServers"]) => Promise<void>) {
  const selected = new Set(selectedIds);
  const servers = getEnabledMcpServers(settings).filter(server => server.id && selected.has(server.id)).map(server => ({ ...server }));
  const discovered = await backend.getMcpToolDefinitions(servers);
  const approved = new Set(servers.flatMap(server => (server.tools ?? []).filter(tool => !tool.annotations?.applicationOnlyHint && (server.autoApprove || server.allowedTools?.includes(tool.name))).map(tool => `mcp_${sanitizeMcpIdentifier(deriveMcpServerId(server))}_${sanitizeMcpIdentifier(tool.name)}`)));
  const definitions = discovered.filter(tool => approved.has(tool.name));
  await persistTokens?.(servers);
  const allowed = new Set(definitions.map(tool => tool.name));
  return {
    definitions,
    async execute(name: string, args: Record<string, unknown>, signal: AbortSignal) {
      if (!allowed.has(name)) return { error: "This tool was not selected and approved for direct requests" };
      try { return (await backend.executeMcpTool(servers, name, args, signal)).textResult; }
      finally { await persistTokens?.(servers); }
    },
  };
}
