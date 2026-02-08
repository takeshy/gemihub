import type { Route } from "./+types/api.plugins.$id";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import {
  getPluginFile,
  getPluginDataFile,
  savePluginDataFile,
  uninstallPlugin,
  installPlugin,
  checkPluginUpdate,
} from "~/services/plugin-manager.server";
import { getLocalPluginFile } from "~/services/local-plugins.server";

// ---------------------------------------------------------------------------
// GET /api/plugins/:id?file=main.js — serve plugin files
// ---------------------------------------------------------------------------

export async function loader({ request, params }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(
    request,
    tokens
  );

  const pluginId = params.id;
  const url = new URL(request.url);
  const fileName = url.searchParams.get("file") || "main.js";

  // Only allow specific files
  const allowedFiles = ["main.js", "styles.css", "manifest.json"];
  if (!allowedFiles.includes(fileName)) {
    return Response.json({ error: "File not allowed" }, { status: 400 });
  }

  const mimeTypes: Record<string, string> = {
    "main.js": "application/javascript",
    "styles.css": "text/css",
    "manifest.json": "application/json",
  };

  // Try local plugin first (dev only)
  const localContent = getLocalPluginFile(pluginId, fileName);
  if (localContent !== null) {
    const headers: Record<string, string> = {
      "Content-Type": mimeTypes[fileName] || "text/plain",
    };
    if (setCookieHeader) {
      headers["Set-Cookie"] = setCookieHeader;
    }
    return new Response(localContent, { headers });
  }

  const content = await getPluginFile(
    validTokens.accessToken,
    validTokens.rootFolderId,
    pluginId,
    fileName
  );

  if (content === null) {
    return new Response("Not found", {
      status: 404,
      headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined,
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": mimeTypes[fileName] || "text/plain",
  };
  if (setCookieHeader) {
    headers["Set-Cookie"] = setCookieHeader;
  }

  return new Response(content, { headers });
}

// ---------------------------------------------------------------------------
// POST /api/plugins/:id — toggle, getData, setData, update
// ---------------------------------------------------------------------------

export async function action({ request, params }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(
    request,
    tokens
  );
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.append("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  const pluginId = params.id;

  if (request.method === "DELETE") {
    // Uninstall plugin
    try {
      await uninstallPlugin(
        validTokens.accessToken,
        validTokens.rootFolderId,
        pluginId
      );

      // Remove from settings
      const settings = await getSettings(
        validTokens.accessToken,
        validTokens.rootFolderId
      );
      const plugins = (settings.plugins || []).filter(
        (p) => p.id !== pluginId
      );
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
        ...settings,
        plugins,
      });

      return jsonWithCookie({ success: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Uninstall failed";
      return jsonWithCookie({ error: message }, { status: 500 });
    }
  }

  if (request.method !== "POST") {
    return jsonWithCookie({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { action } = body as { action: string };

  try {
    switch (action) {
      case "toggle": {
        const settings = await getSettings(
          validTokens.accessToken,
          validTokens.rootFolderId
        );
        const plugins = settings.plugins || [];
        const plugin = plugins.find((p) => p.id === pluginId);
        if (!plugin) {
          return jsonWithCookie(
            { error: "Plugin not found" },
            { status: 404 }
          );
        }
        plugin.enabled = !plugin.enabled;
        await saveSettings(
          validTokens.accessToken,
          validTokens.rootFolderId,
          { ...settings, plugins }
        );
        return jsonWithCookie({ success: true, enabled: plugin.enabled });
      }

      case "getData": {
        const data = await getPluginDataFile(
          validTokens.accessToken,
          validTokens.rootFolderId,
          pluginId
        );
        return jsonWithCookie({ data });
      }

      case "setData": {
        const { key, value } = body as {
          key: string;
          value: unknown;
          action: string;
        };
        const data = await getPluginDataFile(
          validTokens.accessToken,
          validTokens.rootFolderId,
          pluginId
        );
        data[key] = value;
        await savePluginDataFile(
          validTokens.accessToken,
          validTokens.rootFolderId,
          pluginId,
          data
        );
        return jsonWithCookie({ success: true });
      }

      case "update": {
        const settings = await getSettings(
          validTokens.accessToken,
          validTokens.rootFolderId
        );
        const plugin = (settings.plugins || []).find(
          (p) => p.id === pluginId
        );
        if (!plugin) {
          return jsonWithCookie(
            { error: "Plugin not found" },
            { status: 404 }
          );
        }

        const { manifest, version } = await installPlugin(
          validTokens.accessToken,
          validTokens.rootFolderId,
          plugin.repo
        );

        // Update version in settings
        plugin.version = version;
        await saveSettings(
          validTokens.accessToken,
          validTokens.rootFolderId,
          settings
        );

        return jsonWithCookie({ success: true, manifest, version });
      }

      case "checkUpdate": {
        const settings = await getSettings(
          validTokens.accessToken,
          validTokens.rootFolderId
        );
        const plugin = (settings.plugins || []).find(
          (p) => p.id === pluginId
        );
        if (!plugin) {
          return jsonWithCookie(
            { error: "Plugin not found" },
            { status: 404 }
          );
        }
        const result = await checkPluginUpdate(plugin.repo, plugin.version);
        return jsonWithCookie(result);
      }

      default:
        return jsonWithCookie(
          { error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Operation failed";
    return jsonWithCookie({ error: message }, { status: 500 });
  }
}
