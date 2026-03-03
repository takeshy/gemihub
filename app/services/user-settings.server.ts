// User settings CRUD via Google Drive (settings.json in root folder)

import { listFiles, readFile, createFile, updateFile } from "./google-drive.server";
import {
  DEFAULT_USER_SETTINGS,
  normalizeMcpServers,
  normalizeSelectedMcpServerIds,
  type UserSettings,
} from "~/types/settings";
import { SETTINGS_FILE_NAME } from "./sync-diff";

// In-memory cache keyed by rootFolderId (stable across token refreshes)
const settingsCache = new Map<string, { settings: UserSettings; fileId: string | null; cachedAt: number }>();
const SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Find or create the settings.json file ID in the root folder
 */
async function getSettingsFileId(
  accessToken: string,
  rootFolderId: string
): Promise<string | null> {
  const files = await listFiles(accessToken, rootFolderId);
  const settingsFile = files.find((f) => f.name === SETTINGS_FILE_NAME);
  return settingsFile?.id ?? null;
}

/**
 * Load user settings from Drive. Returns defaults if not found.
 */
export async function getSettings(
  accessToken: string,
  rootFolderId: string
): Promise<UserSettings> {
  const cacheKey = rootFolderId;
  const cached = settingsCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < SETTINGS_CACHE_TTL) {
    return cached.settings;
  }

  try {
    const fileId = await getSettingsFileId(accessToken, rootFolderId);
    if (!fileId) {
      settingsCache.set(cacheKey, { settings: DEFAULT_USER_SETTINGS, fileId: null, cachedAt: Date.now() });
      return DEFAULT_USER_SETTINGS;
    }

    const content = await readFile(accessToken, fileId);
    const parsed = JSON.parse(content) as Partial<UserSettings>;
    const normalizedMcpServers = normalizeMcpServers(parsed.mcpServers || []);
    const normalizedSlashCommands = (parsed.slashCommands || []).map((cmd) => {
      const normalizedIds = normalizeSelectedMcpServerIds(
        cmd.enabledMcpServers,
        normalizedMcpServers
      );
      return {
        ...cmd,
        model: (cmd.model as string) === "gemini-3-pro-preview" ? "gemini-3.1-pro-preview"
          : (cmd.model as string) === "gemini-2.5-flash-image" ? "gemini-3.1-flash-image-preview"
          : cmd.model,
        enabledMcpServers: normalizedIds.length > 0 ? normalizedIds : null,
      };
    });

    // Migrate deprecated model names
    if ((parsed.selectedModel as string) === "gemini-3-pro-preview") {
      parsed.selectedModel = "gemini-3.1-pro-preview";
    }
    if ((parsed.selectedModel as string) === "gemini-2.5-flash-image") {
      parsed.selectedModel = "gemini-3.1-flash-image-preview";
    }

    // Merge with defaults to handle missing fields from older versions
    const settings: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      ...parsed,
      mcpServers: normalizedMcpServers,
      slashCommands: normalizedSlashCommands,
      encryption: { ...DEFAULT_USER_SETTINGS.encryption, ...parsed.encryption },
      editHistory: {
        ...DEFAULT_USER_SETTINGS.editHistory,
        ...parsed.editHistory,
        retention: {
          ...DEFAULT_USER_SETTINGS.editHistory.retention,
          ...parsed.editHistory?.retention,
        },
        diff: {
          ...DEFAULT_USER_SETTINGS.editHistory.diff,
          ...parsed.editHistory?.diff,
        },
      },
    };

    settingsCache.set(cacheKey, { settings, fileId, cachedAt: Date.now() });
    return settings;
  } catch {
    // Prefer expired cache over defaults — preserves the user's saved
    // language/settings even when Drive is temporarily unreachable.
    const expired = settingsCache.get(cacheKey);
    if (expired) return expired.settings;
    return DEFAULT_USER_SETTINGS;
  }
}

/**
 * Save user settings to Drive
 */
export async function saveSettings(
  accessToken: string,
  rootFolderId: string,
  settings: UserSettings
): Promise<void> {
  const normalizedMcpServers = normalizeMcpServers(settings.mcpServers || []);
  const normalizedSettings: UserSettings = {
    ...settings,
    mcpServers: normalizedMcpServers,
    slashCommands: (settings.slashCommands || []).map((cmd) => {
      const normalizedIds = normalizeSelectedMcpServerIds(
        cmd.enabledMcpServers,
        normalizedMcpServers
      );
      return {
        ...cmd,
        enabledMcpServers: normalizedIds.length > 0 ? normalizedIds : null,
      };
    }),
  };
  const content = JSON.stringify(normalizedSettings, null, 2);
  const fileId = await getSettingsFileId(accessToken, rootFolderId);

  if (fileId) {
    await updateFile(accessToken, fileId, content, "application/json");
  } else {
    await createFile(accessToken, SETTINGS_FILE_NAME, content, rootFolderId, "application/json");
  }

  // Update cache
  const cacheKey = rootFolderId;
  settingsCache.set(cacheKey, { settings: normalizedSettings, fileId, cachedAt: Date.now() });
}

/**
 * Clear settings cache (call at end of request if needed)
 */
export function clearSettingsCache(): void {
  settingsCache.clear();
}
