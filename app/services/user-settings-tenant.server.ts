// User settings CRUD — enterprise-only (GCS-backed).
// Legacy Google Drive paths removed in Phase 5f.

import {
  DEFAULT_USER_SETTINGS,
  normalizeDeprecatedModelName,
  normalizeMcpServers,
  normalizeSelectedMcpServerIds,
  type UserSettings,
} from "~/types/settings";
import {
  GcsObjectNotFoundError,
  readObject,
  writeObject,
} from "./gcs-storage.server";
import type { ProjectAccessContext } from "~/types/enterprise";

const SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear settings cache (call at end of request if needed)
 */
export function clearSettingsCache(): void {
  tenantSettingsCache.clear();
}

// ===========================================================================
// Enterprise (GCS-backed) settings
// ===========================================================================

/**
 * Settings live at `gemihub/settings.json` under the project prefix in the
 * tenant bucket. Same filename / placement convention as the legacy Drive
 * world (rooted at `gemihub/` per docs/enterprise.md §5.1) so other gemihub-
 * namespaced files (chats / workflows / plugins / etc.) sit alongside.
 */
const ENTERPRISE_SETTINGS_PATH = "gemihub/settings.json";

const tenantSettingsCache = new Map<
  string,
  { settings: UserSettings; cachedAt: number }
>();

function tenantCacheKey(ctx: ProjectAccessContext): string {
  return `${ctx.orgId}/${ctx.projectId}`;
}

function applySettingsMigrations(parsed: Partial<UserSettings>): UserSettings {
  // Same model-name renames + DEFAULT merge as the legacy getSettings.
  const normalizedMcpServers = normalizeMcpServers(parsed.mcpServers || []);
  const normalizedSlashCommands = (parsed.slashCommands || []).map((cmd) => {
    const normalizedIds = normalizeSelectedMcpServerIds(
      cmd.enabledMcpServers,
      normalizedMcpServers,
    );
    return {
      ...cmd,
      model: normalizeDeprecatedModelName(cmd.model),
      enabledMcpServers: normalizedIds.length > 0 ? normalizedIds : null,
    };
  });
  parsed.selectedModel = normalizeDeprecatedModelName(parsed.selectedModel) ?? null;
  return {
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
}

/**
 * Load user settings from the tenant bucket, throwing when the stored file
 * exists but cannot be read.
 *
 * Only a genuine 404 yields DEFAULT_USER_SETTINGS (first write happens on
 * saveSettingsForTenant). Every read-modify-write caller MUST use this
 * variant: treating a transient read failure as "no settings" and saving the
 * result would overwrite the project's real settings.json with defaults.
 */
export async function getSettingsForTenantStrict(
  ctx: ProjectAccessContext,
): Promise<UserSettings> {
  const key = tenantCacheKey(ctx);
  const cached = tenantSettingsCache.get(key);
  if (cached && Date.now() - cached.cachedAt < SETTINGS_CACHE_TTL) {
    return cached.settings;
  }
  try {
    const { bytes } = await readObject(ctx, ENTERPRISE_SETTINGS_PATH);
    const text = new TextDecoder("utf-8").decode(bytes);
    const parsed = JSON.parse(text) as Partial<UserSettings>;
    const settings = applySettingsMigrations(parsed);
    tenantSettingsCache.set(key, { settings, cachedAt: Date.now() });
    return settings;
  } catch (err) {
    if (err instanceof GcsObjectNotFoundError) {
      tenantSettingsCache.set(key, { settings: DEFAULT_USER_SETTINGS, cachedAt: Date.now() });
      return DEFAULT_USER_SETTINGS;
    }
    throw err;
  }
}

/**
 * Read-only variant: degrades to the expired cache, then to defaults, so a
 * transient storage glitch does not break the IDE. Never use it as the base
 * of a save — see getSettingsForTenantStrict.
 */
export async function getSettingsForTenant(
  ctx: ProjectAccessContext,
): Promise<UserSettings> {
  try {
    return await getSettingsForTenantStrict(ctx);
  } catch (err) {
    const cached = tenantSettingsCache.get(tenantCacheKey(ctx));
    if (cached) return cached.settings;
    console.warn("[user-settings-tenant] read failed, serving defaults:", err);
    return DEFAULT_USER_SETTINGS;
  }
}

/**
 * Save user settings to the tenant bucket. Creates the object on first
 * write (no equivalent of ensureSettingsFile is needed — writeObject does
 * the right thing).
 */
export async function saveSettingsForTenant(
  ctx: ProjectAccessContext,
  settings: UserSettings,
): Promise<void> {
  const normalizedMcpServers = normalizeMcpServers(settings.mcpServers || []);
  const normalizedSettings: UserSettings = {
    ...settings,
    mcpServers: normalizedMcpServers,
    slashCommands: (settings.slashCommands || []).map((cmd) => {
      const normalizedIds = normalizeSelectedMcpServerIds(
        cmd.enabledMcpServers,
        normalizedMcpServers,
      );
      return {
        ...cmd,
        model: normalizeDeprecatedModelName(cmd.model),
        enabledMcpServers: normalizedIds.length > 0 ? normalizedIds : null,
      };
    }),
  };
  const content = JSON.stringify(normalizedSettings, null, 2);
  await writeObject(ctx, ENTERPRISE_SETTINGS_PATH, content, "application/json", {
    updatedBy: ctx.uid,
  });
  tenantSettingsCache.set(tenantCacheKey(ctx), {
    settings: normalizedSettings,
    cachedAt: Date.now(),
  });
}
