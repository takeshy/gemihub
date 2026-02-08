import type { Route } from "./+types/api.plugins";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { installPlugin } from "~/services/plugin-manager.server";
import type { PluginConfig } from "~/types/settings";

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
  const { repo } = body as { repo: string };

  // Validate repo format: must be "owner/repo" with no extra segments or special chars
  const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  if (!repo || !repoPattern.test(repo)) {
    return Response.json(
      { error: "Invalid repo format. Use owner/repo" },
      { status: 400 }
    );
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
    const config: PluginConfig = {
      id: manifest.id,
      repo,
      version,
      enabled: true,
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
    return Response.json({ error: message }, { status: 500 });
  }
}
