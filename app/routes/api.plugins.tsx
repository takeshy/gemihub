import type { Route } from "./+types/api.plugins";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { installPlugin, previewPlugin, PluginClientError } from "~/services/plugin-manager.server";
import type { PluginConfig } from "~/types/settings";
import { PLUGIN_PERMISSIONS } from "~/types/plugin";

// ---------------------------------------------------------------------------
// GET /api/plugins — list installed plugins
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(
    request,
    tokens
  );
  const settings = await getSettings(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  return Response.json(
    { plugins: settings.plugins || [] },
    { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined }
  );
}

// ---------------------------------------------------------------------------
// POST /api/plugins — install a plugin from GitHub repo
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(
    request,
    tokens
  );

  const body = await request.json();
  const { repo, action, permissions: approvedPermissions } = body as {
    repo: string;
    action?: string;
    permissions?: string[];
  };

  // Validate repo format: must be "owner/repo" with no extra segments or special chars
  const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  if (!repo || !repoPattern.test(repo)) {
    return Response.json(
      { error: "Invalid repo format. Use owner/repo" },
      { status: 400 }
    );
  }

  // Preview action: fetch manifest without installing
  if (action === "preview") {
    try {
      const { manifest, version } = await previewPlugin(repo);
      return Response.json(
        { manifest, version },
        {
          headers: setCookieHeader
            ? { "Set-Cookie": setCookieHeader }
            : undefined,
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      if (err instanceof PluginClientError) {
        return Response.json({ error: message }, { status: 400 });
      }
      return Response.json({ error: message }, { status: 500 });
    }
  }

  try {
    const { manifest, version } = await installPlugin(
      validTokens.accessToken,
      validTokens.rootFolderId,
      repo
    );

    // Update settings.json
    const settings = await getSettings(
      validTokens.accessToken,
      validTokens.rootFolderId
    );
    const plugins = settings.plugins || [];

    // Replace existing or add new
    const existingIdx = plugins.findIndex((p) => p.id === manifest.id);
    // Validate: only allow permissions declared in manifest
    const manifestPerms = new Set<string>(manifest.permissions ?? []);
    const knownPerms = new Set<string>(PLUGIN_PERMISSIONS);
    const validatedPermissions = approvedPermissions
      ? approvedPermissions.filter((p) => manifestPerms.has(p) && knownPerms.has(p))
      : (manifest.permissions as string[] | undefined) ?? [];

    const config: PluginConfig = {
      id: manifest.id,
      repo,
      version,
      enabled: true,
      permissions: validatedPermissions,
    };

    if (existingIdx >= 0) {
      plugins[existingIdx] = config;
    } else {
      plugins.push(config);
    }

    await saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
      ...settings,
      plugins,
    });

    return Response.json(
      { success: true, manifest, config },
      {
        headers: setCookieHeader
          ? { "Set-Cookie": setCookieHeader }
          : undefined,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Install failed";
    if (err instanceof PluginClientError) {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
