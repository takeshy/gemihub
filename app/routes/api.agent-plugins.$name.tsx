import type { Route } from "./+types/api.agent-plugins.$name";
import { getValidTokens } from "~/services/google-auth.server";
import { requireAuth } from "~/services/session.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import {
  AgentPluginClientError,
  fetchAgentPlugin,
  installAgentPluginPackage,
  mergeAgentPluginMcpServers,
  uninstallAgentPluginPackage,
} from "~/services/agent-plugin.server";

function validName(name: string): boolean {
  return /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name);
}

export async function action({ request, params }: Route.ActionArgs) {
  if (!validName(params.name)) return Response.json({ error: "Invalid Agent Plugin name" }, { status: 400 });
  const session = await requireAuth(request);
  const { tokens, setCookieHeader } = await getValidTokens(request, session);
  const headers = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  try {
    const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
    const current = (settings.agentPlugins || []).find((plugin) => plugin.name === params.name);
    if (!current) return Response.json({ error: "Agent Plugin not found" }, { status: 404, headers });

    if (request.method === "DELETE") {
      await uninstallAgentPluginPackage(tokens.accessToken, tokens.rootFolderId, current.name);
      const agentPlugins = settings.agentPlugins.filter((plugin) => plugin.name !== current.name);
      const mcpServers = settings.mcpServers.filter((server) => server.agentPlugin?.pluginName !== current.name);
      await saveSettings(tokens.accessToken, tokens.rootFolderId, { ...settings, agentPlugins, mcpServers });
      return Response.json({ success: true }, { headers });
    }
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
    const body = await request.json() as { action?: unknown; commitSha?: unknown; sourceType?: unknown; sourceRef?: unknown };
    if (body.action === "toggle") {
      const agentPlugins = settings.agentPlugins.map((plugin) => plugin.name === current.name ? { ...plugin, enabled: !plugin.enabled } : plugin);
      await saveSettings(tokens.accessToken, tokens.rootFolderId, { ...settings, agentPlugins });
      return Response.json({ success: true, enabled: !current.enabled }, { headers });
    }
    if (body.action === "check-update") {
      const preview = await fetchAgentPlugin(current.repo, { includeAllFiles: false });
      return Response.json({
        updateAvailable: preview.commitSha !== current.commitSha,
        version: preview.version,
        commitSha: preview.commitSha,
        sourceType: preview.sourceType,
        sourceRef: preview.sourceRef,
        warnings: preview.warnings,
      }, { headers });
    }
    if (body.action === "update") {
      if (typeof body.commitSha !== "string" || typeof body.sourceRef !== "string" || (body.sourceType !== "release" && body.sourceType !== "branch")) {
        throw new AgentPluginClientError("Update requires a pinned commit returned by check-update");
      }
      const preview = await fetchAgentPlugin(current.repo, { source: { commitSha: body.commitSha, sourceRef: body.sourceRef, sourceType: body.sourceType } });
      if (preview.manifest.name !== current.name) throw new AgentPluginClientError(`Update manifest name mismatch: expected ${current.name}, got ${preview.manifest.name}`);
      const installed = await installAgentPluginPackage(tokens.accessToken, tokens.rootFolderId, preview);
      const config = installed.config;
      config.enabled = current.enabled;
      const agentPlugins = settings.agentPlugins.map((plugin) => plugin.name === current.name ? config : plugin);
      const mcpServers = mergeAgentPluginMcpServers(settings.mcpServers, preview);
      await saveSettings(tokens.accessToken, tokens.rootFolderId, { ...settings, agentPlugins, mcpServers });
      return Response.json({ success: true, config, cacheFiles: installed.cacheFiles, warnings: preview.warnings }, { headers });
    }
    return Response.json({ error: "Unknown action" }, { status: 400, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent Plugin operation failed" }, { status: error instanceof AgentPluginClientError ? 400 : 500, headers });
  }
}
