import type { Route } from "./+types/api.agent-plugins";
import { getValidTokens } from "~/services/google-auth.server";
import { requireAuth } from "~/services/session.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import {
  AgentPluginClientError,
  fetchAgentPlugin,
  installAgentPluginPackage,
  mergeAgentPluginMcpServers,
} from "~/services/agent-plugin.server";
import { hydrateAgentPluginMcpTools } from "~/services/mcp-tools.server";

function publicPreview(preview: Awaited<ReturnType<typeof fetchAgentPlugin>>) {
  const { files: _files, ...result } = preview;
  return result;
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAuth(request);
  const { tokens, setCookieHeader } = await getValidTokens(request, session);
  const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
  return Response.json({ agentPlugins: settings.agentPlugins || [] }, { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const session = await requireAuth(request);
  const { tokens, setCookieHeader } = await getValidTokens(request, session);
  try {
    const body = await request.json() as { repo?: unknown; action?: unknown; commitSha?: unknown; sourceType?: unknown; sourceRef?: unknown };
    if (typeof body.repo !== "string") throw new AgentPluginClientError("repo is required");
    const repo = body.repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    if (body.action === "preview") {
      const preview = await fetchAgentPlugin(repo, { includeAllFiles: false });
      return Response.json(publicPreview(preview), { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined });
    }
    if (typeof body.commitSha !== "string" || typeof body.sourceRef !== "string" || (body.sourceType !== "release" && body.sourceType !== "branch")) {
      throw new AgentPluginClientError("Install requires the commit SHA and source shown in preview");
    }
    const preview = await fetchAgentPlugin(repo, { source: { commitSha: body.commitSha, sourceRef: body.sourceRef, sourceType: body.sourceType } });

    const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
    const existing = (settings.agentPlugins || []).find((plugin) => plugin.name === preview.manifest.name);
    if (existing && existing.repo !== repo) throw new AgentPluginClientError(`Agent Plugin "${preview.manifest.name}" is already installed from ${existing.repo}`);
    const installed = await installAgentPluginPackage(tokens.accessToken, tokens.rootFolderId, preview);
    const config = installed.config;
    config.enabled = existing?.enabled ?? true;
    const agentPlugins = [...(settings.agentPlugins || []).filter((plugin) => plugin.name !== config.name), config];
    const mcpServers = mergeAgentPluginMcpServers(settings.mcpServers, preview);
    const mcpWarnings = await hydrateAgentPluginMcpTools(mcpServers, config.name);
    await saveSettings(tokens.accessToken, tokens.rootFolderId, { ...settings, agentPlugins, mcpServers });
    const result = publicPreview(preview);
    return Response.json({
      success: true,
      config,
      cacheFiles: installed.cacheFiles,
      ...result,
      warnings: [...result.warnings, ...mcpWarnings],
    }, { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent Plugin operation failed";
    return Response.json({ error: message }, { status: error instanceof AgentPluginClientError ? 400 : 500 });
  }
}
