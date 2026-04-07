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
  previewPlugin,
  checkPluginUpdate,
  PluginClientError,
} from "~/services/plugin-manager.server";
import {
  getLocalPluginFile,
  isLocalPlugin,
  getLocalPluginData,
  saveLocalPluginData,
} from "~/services/local-plugins.server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { PluginAsset } from "~/types/plugin";

// ---------------------------------------------------------------------------
// Asset caching helpers
// ---------------------------------------------------------------------------

/** In-progress download guard so concurrent requests don't duplicate work */
const assetDownloads = new Map<string, Promise<void>>();

function assetCachePath(pluginId: string, name: string): string {
  return path.join(process.cwd(), "data", "plugins", pluginId, name);
}

function validateAssetUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid asset URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Asset URL must use HTTPS: ${url}`);
  }
  // Block private/internal IPs (metadata APIs, localhost, link-local, etc.)
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host === "169.254.169.254" ||
    host.startsWith("169.254.") ||
    host === "[::1]" ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error(`Asset URL points to a private/internal address: ${url}`);
  }
}

async function ensureAssetCached(
  pluginId: string,
  asset: PluginAsset
): Promise<void> {
  const cachePath = assetCachePath(pluginId, asset.name);
  if (fs.existsSync(cachePath)) return;

  validateAssetUrl(asset.url);

  const key = `${pluginId}/${asset.name}`;
  if (assetDownloads.has(key)) return assetDownloads.get(key)!;

  const promise = (async () => {
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = cachePath + ".tmp";

    const res = await fetch(asset.url);
    if (!res.ok)
      throw new Error(`Failed to fetch asset ${asset.url}: HTTP ${res.status}`);

    const buf = await res.arrayBuffer();
    fs.writeFileSync(tmp, Buffer.from(buf));
    fs.renameSync(tmp, cachePath); // atomic
  })();

  assetDownloads.set(key, promise);
  try {
    await promise;
  } finally {
    assetDownloads.delete(key);
  }
}

/** Remove all cached assets for a plugin */
function clearAssetCache(pluginId: string): void {
  const dir = path.join(process.cwd(), "data", "plugins", pluginId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "application/javascript",
    wasm: "application/wasm",
    json: "application/json",
    css: "text/css",
  };
  return map[ext] ?? "application/octet-stream";
}

function isValidPluginId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ---------------------------------------------------------------------------
// GET /api/plugins/:id?file=main.js  — serve plugin source files
// GET /api/plugins/:id?asset=name    — serve cached external assets
// ---------------------------------------------------------------------------

export async function loader({ request, params }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(
    request,
    tokens
  );

  const pluginId = params.id;
  if (!isValidPluginId(pluginId)) {
    return new Response("Invalid plugin ID", { status: 400 });
  }
  const url = new URL(request.url);
  const assetName = url.searchParams.get("asset");

  // ── Asset serving path ──────────────────────────────────────────────────
  if (assetName !== null) {
    // Reject path-traversal attempts
    if (assetName.includes("/") || assetName.includes("\\") || assetName.startsWith(".")) {
      return new Response("Invalid asset name", { status: 400 });
    }

    // Read the manifest to validate the requested asset is declared
    let manifestText: string | null = null;
    const localManifest = getLocalPluginFile(pluginId, "manifest.json");
    if (localManifest !== null) {
      manifestText = localManifest;
    } else {
      manifestText = await getPluginFile(
        validTokens.accessToken,
        validTokens.rootFolderId,
        pluginId,
        "manifest.json"
      );
    }

    if (manifestText === null) {
      return new Response("Plugin not found", { status: 404 });
    }

    let declared: PluginAsset | undefined;
    try {
      const raw = JSON.parse(manifestText) as { assets?: PluginAsset[] };
      declared = raw.assets?.find((a) => a.name === assetName);
    } catch {
      return new Response("Invalid manifest", { status: 500 });
    }
    if (!declared) {
      return new Response("Asset not declared in manifest", { status: 403 });
    }

    try {
      await ensureAssetCached(pluginId, declared);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Asset download failed: ${msg}`, { status: 502 });
    }

    const cachePath = assetCachePath(pluginId, assetName);
    const stat = fs.statSync(cachePath);
    const nodeStream = fs.createReadStream(cachePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": mimeFromName(assetName),
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=86400",
    };
    if (setCookieHeader) headers["Set-Cookie"] = setCookieHeader;

    return new Response(webStream, { headers });
  }

  // ── Plugin source file path ──────────────────────────────────────────────
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
// Per-plugin lock to serialize setData (prevents read-modify-write races)
// ---------------------------------------------------------------------------

const pluginDataLocks = new Map<string, Promise<void>>();

function withPluginLock<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
  const prev = pluginDataLocks.get(pluginId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  pluginDataLocks.set(pluginId, next.then(() => {}, () => {}));
  return next;
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
  if (!isValidPluginId(pluginId)) {
    return jsonWithCookie({ error: "Invalid plugin ID" }, { status: 400 });
  }

  if (request.method === "DELETE") {
    // Uninstall plugin
    try {
      if (isLocalPlugin(pluginId)) {
        return jsonWithCookie(
          {
            error:
              "Local plugins cannot be uninstalled from the UI. Remove plugins/{id}/ manually.",
          },
          { status: 400 }
        );
      }

      await uninstallPlugin(
        validTokens.accessToken,
        validTokens.rootFolderId,
        pluginId
      );
      clearAssetCache(pluginId);

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
        if (isLocalPlugin(pluginId)) {
          return jsonWithCookie({ data: getLocalPluginData(pluginId) });
        }
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
        if (typeof key !== "string" || !key) {
          return jsonWithCookie(
            { error: "Missing or invalid key" },
            { status: 400 }
          );
        }
        if (isLocalPlugin(pluginId)) {
          const localData = getLocalPluginData(pluginId);
          localData[key] = value;
          saveLocalPluginData(pluginId, localData);
          return jsonWithCookie({ success: true });
        }
        await withPluginLock(pluginId, async () => {
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
        });
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

        const { approvedPermissions } = body as { approvedPermissions?: string[] };

        // Preview the new version to check for permission changes
        const preview = await previewPlugin(plugin.repo);
        const newManifestPerms = preview.manifest.permissions ?? [];
        const oldPerms = new Set(plugin.permissions ?? []);
        const addedPermissions = newManifestPerms.filter((p) => !oldPerms.has(p));

        // If new permissions were added and not yet approved, ask the client
        if (addedPermissions.length > 0 && !approvedPermissions) {
          return jsonWithCookie({
            needsApproval: true,
            manifest: preview.manifest,
            version: preview.version,
            addedPermissions,
          });
        }

        // Clear cached assets so updated plugin re-downloads fresh ones
        clearAssetCache(pluginId);

        const { manifest, version } = await installPlugin(
          validTokens.accessToken,
          validTokens.rootFolderId,
          plugin.repo,
          plugin.id
        );

        // Update version and permissions in settings
        plugin.version = version;
        plugin.permissions = approvedPermissions ?? newManifestPerms;
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
    if (err instanceof PluginClientError) {
      return jsonWithCookie({ error: message }, { status: 400 });
    }
    return jsonWithCookie({ error: message }, { status: 500 });
  }
}
