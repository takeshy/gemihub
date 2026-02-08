// Plugin manager — handles install, uninstall, file serving, and data storage via Google Drive

import {
  ensureSubFolder,
  listFiles,
  readFile,
  createFile,
  updateFile,
  deleteFile,
  findFileByExactName,
} from "./google-drive.server";
import type { PluginManifest } from "~/types/plugin";

const PLUGINS_FOLDER = "plugins";
const GITHUB_API = "https://api.github.com";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

/**
 * Ensure the plugins/ folder exists under root
 */
async function ensurePluginsFolder(
  accessToken: string,
  rootFolderId: string
): Promise<string> {
  return ensureSubFolder(accessToken, rootFolderId, PLUGINS_FOLDER);
}

/**
 * Fetch latest release info from GitHub
 */
async function fetchLatestRelease(repo: string): Promise<GitHubRelease> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch release for ${repo}: ${res.status}`);
  }
  return res.json();
}

/**
 * Download a file from a URL as text
 */
async function downloadAsset(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  return res.text();
}

/**
 * Install a plugin from a GitHub repo.
 * Downloads main.js, styles.css, manifest.json from the latest release
 * and saves them to Drive under plugins/{plugin-id}/
 */
export async function installPlugin(
  accessToken: string,
  rootFolderId: string,
  repo: string
): Promise<{ manifest: PluginManifest; version: string }> {
  const release = await fetchLatestRelease(repo);
  const version = release.tag_name;

  // Find required assets
  const manifestAsset = release.assets.find((a) => a.name === "manifest.json");
  const mainAsset = release.assets.find((a) => a.name === "main.js");
  const stylesAsset = release.assets.find((a) => a.name === "styles.css");

  if (!manifestAsset || !mainAsset) {
    throw new Error(
      "Release must contain at least manifest.json and main.js assets"
    );
  }

  // Download assets
  const [manifestContent, mainContent, stylesContent] = await Promise.all([
    downloadAsset(manifestAsset.browser_download_url),
    downloadAsset(mainAsset.browser_download_url),
    stylesAsset ? downloadAsset(stylesAsset.browser_download_url) : Promise.resolve(""),
  ]);

  const manifest: PluginManifest = JSON.parse(manifestContent);

  // Create plugin folder in Drive: plugins/{plugin-id}/
  const pluginsFolderId = await ensurePluginsFolder(accessToken, rootFolderId);
  const pluginFolderId = await ensureSubFolder(
    accessToken,
    pluginsFolderId,
    manifest.id
  );

  // Save files (create or update)
  await saveOrUpdateFile(accessToken, pluginFolderId, "manifest.json", manifestContent, "application/json");
  await saveOrUpdateFile(accessToken, pluginFolderId, "main.js", mainContent, "application/javascript");
  if (stylesContent) {
    await saveOrUpdateFile(accessToken, pluginFolderId, "styles.css", stylesContent, "text/css");
  }

  return { manifest, version };
}

/**
 * Create or update a file in a folder
 */
async function saveOrUpdateFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  content: string,
  mimeType: string
): Promise<void> {
  const existing = await findFileByExactName(accessToken, fileName, folderId);
  if (existing) {
    await updateFile(accessToken, existing.id, content, mimeType);
  } else {
    await createFile(accessToken, fileName, content, folderId, mimeType);
  }
}

/**
 * Uninstall a plugin by deleting its folder from Drive
 */
export async function uninstallPlugin(
  accessToken: string,
  rootFolderId: string,
  pluginId: string
): Promise<void> {
  const pluginsFolderId = await ensurePluginsFolder(accessToken, rootFolderId);
  const files = await listFiles(accessToken, pluginsFolderId);
  const pluginFolder = files.find(
    (f) =>
      f.name === pluginId &&
      f.mimeType === "application/vnd.google-apps.folder"
  );

  if (pluginFolder) {
    // Delete all files in the plugin folder first
    const pluginFiles = await listFiles(accessToken, pluginFolder.id);
    await Promise.all(pluginFiles.map((f) => deleteFile(accessToken, f.id)));
    // Delete the folder itself
    await deleteFile(accessToken, pluginFolder.id);
  }
}

/**
 * Get a plugin file content (main.js, styles.css, manifest.json)
 */
export async function getPluginFile(
  accessToken: string,
  rootFolderId: string,
  pluginId: string,
  fileName: string
): Promise<string | null> {
  const pluginsFolderId = await ensurePluginsFolder(accessToken, rootFolderId);
  const folders = await listFiles(accessToken, pluginsFolderId);
  const pluginFolder = folders.find(
    (f) =>
      f.name === pluginId &&
      f.mimeType === "application/vnd.google-apps.folder"
  );

  if (!pluginFolder) return null;

  const file = await findFileByExactName(
    accessToken,
    fileName,
    pluginFolder.id
  );
  if (!file) return null;

  return readFile(accessToken, file.id);
}

/**
 * Read plugin data.json
 */
export async function getPluginDataFile(
  accessToken: string,
  rootFolderId: string,
  pluginId: string
): Promise<Record<string, unknown>> {
  const content = await getPluginFile(
    accessToken,
    rootFolderId,
    pluginId,
    "data.json"
  );
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save plugin data.json
 */
export async function savePluginDataFile(
  accessToken: string,
  rootFolderId: string,
  pluginId: string,
  data: Record<string, unknown>
): Promise<void> {
  const pluginsFolderId = await ensurePluginsFolder(accessToken, rootFolderId);
  const folders = await listFiles(accessToken, pluginsFolderId);
  const pluginFolder = folders.find(
    (f) =>
      f.name === pluginId &&
      f.mimeType === "application/vnd.google-apps.folder"
  );

  if (!pluginFolder) {
    throw new Error(`Plugin folder not found: ${pluginId}`);
  }

  await saveOrUpdateFile(
    accessToken,
    pluginFolder.id,
    "data.json",
    JSON.stringify(data, null, 2),
    "application/json"
  );
}

/**
 * Check if a plugin has an update available on GitHub
 */
export async function checkPluginUpdate(
  repo: string,
  currentVersion: string
): Promise<{ hasUpdate: boolean; latestVersion: string }> {
  try {
    const release = await fetchLatestRelease(repo);
    const latestVersion = release.tag_name;
    const hasUpdate = latestVersion !== currentVersion;
    return { hasUpdate, latestVersion };
  } catch {
    return { hasUpdate: false, latestVersion: currentVersion };
  }
}
