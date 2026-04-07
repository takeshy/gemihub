import { useState, useCallback, useRef } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  Check,
  AlertCircle,
  Power,
  PowerOff,
  Settings,
  Shield,
  X,
} from "lucide-react";
import type { UserSettings, PluginConfig } from "~/types/settings";
import type { PluginManifest, PluginPermission } from "~/types/plugin";
import { PLUGIN_PERMISSIONS } from "~/types/plugin";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";
import { invalidateIndexCache } from "~/routes/_index";
import { clearPluginCache } from "~/services/plugin-loader";
import { usePlugins } from "~/contexts/PluginContext";
import { PanelErrorBoundary } from "~/components/shared/PanelErrorBoundary";

const inputClass =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";

const PERMISSION_I18N_KEYS: Record<PluginPermission, keyof TranslationStrings> = {
  gemini: "plugins.permissionGemini",
  drive: "plugins.permissionDrive",
  storage: "plugins.permissionStorage",
  calendar: "plugins.permissionCalendar",
  gmail: "plugins.permissionGmail",
  sheets: "plugins.permissionSheets",
};

interface PluginsTabProps {
  settings: UserSettings;
}

interface PreviewState {
  manifest: PluginManifest;
  version: string;
  repo: string;
}

interface UpdateApprovalState {
  pluginId: string;
  manifest: PluginManifest;
  version: string;
  addedPermissions: string[];
}

export function PluginsTab({ settings }: PluginsTabProps) {
  const { t, language } = useI18n();
  const { settingsTabs, getPluginAPI } = usePlugins();
  const [plugins, setPlugins] = useState<PluginConfig[]>(
    settings.plugins || []
  );
  const [repoInput, setRepoInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updateApproval, setUpdateApproval] = useState<UpdateApprovalState | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback(
    (type: "success" | "error", text: string) => {
      setStatusMessage({ type, text });
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setStatusMessage(null), 5000);
    },
    []
  );

  // Step 1: Preview — fetch manifest and show permission confirmation
  const handlePreview = useCallback(async () => {
    const repo = repoInput.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    if (!repo || !repo.includes("/")) {
      showStatus("error", t("plugins.invalidRepo"));
      return;
    }

    setPreviewing(true);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, action: "preview" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showStatus("error", data.error || t("plugins.previewFailed"));
        return;
      }
      setPreview({ manifest: data.manifest, version: data.version, repo });
    } catch (err) {
      showStatus(
        "error",
        err instanceof Error ? err.message : t("plugins.previewFailed")
      );
    } finally {
      setPreviewing(false);
    }
  }, [repoInput, showStatus, t]);

  // Step 2: Confirm and install
  const handleConfirmInstall = useCallback(async () => {
    if (!preview) return;

    setInstalling(true);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: preview.repo,
          permissions: preview.manifest.permissions ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showStatus("error", data.error || t("plugins.installFailed"));
        return;
      }
      setPlugins((prev) => {
        const existing = prev.findIndex((p) => p.id === data.config.id);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = data.config;
          return updated;
        }
        return [...prev, data.config];
      });
      setRepoInput("");
      setPreview(null);
      invalidateIndexCache();
      showStatus("success", t("plugins.installSuccess"));
      if (confirm(t("plugins.reloadConfirm"))) {
        window.location.reload();
      }
    } catch (err) {
      showStatus(
        "error",
        err instanceof Error ? err.message : t("plugins.installFailed")
      );
    } finally {
      setInstalling(false);
    }
  }, [preview, showStatus, t]);

  const handleToggle = useCallback(
    async (pluginId: string) => {
      setTogglingId(pluginId);
      try {
        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle" }),
        });
        const data = await res.json();
        if (data.success) {
          setPlugins((prev) =>
            prev.map((p) =>
              p.id === pluginId ? { ...p, enabled: data.enabled } : p
            )
          );
          invalidateIndexCache();
        }
      } catch {
        showStatus("error", t("plugins.toggleFailed"));
      } finally {
        setTogglingId(null);
      }
    },
    [showStatus, t]
  );

  const handleUninstall = useCallback(
    async (pluginId: string) => {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (plugin?.source === "local") {
        showStatus(
          "error",
          t("plugins.localCannotUninstall")
        );
        return;
      }
      if (!confirm(t("plugins.confirmUninstall"))) return;
      setDeletingId(pluginId);
      try {
        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.success) {
          setPlugins((prev) => prev.filter((p) => p.id !== pluginId));
          await clearPluginCache(pluginId);
          invalidateIndexCache();
          showStatus("success", t("plugins.uninstalled"));
        }
      } catch {
        showStatus("error", t("plugins.uninstallFailed"));
      } finally {
        setDeletingId(null);
      }
    },
    [plugins, showStatus, t]
  );

  const handleUpdate = useCallback(
    async (pluginId: string, approvedPermissions?: string[]) => {
      setUpdatingId(pluginId);
      try {
        const bodyPayload: Record<string, unknown> = { action: "update" };
        if (approvedPermissions) bodyPayload.approvedPermissions = approvedPermissions;

        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
        });
        const data = await res.json();

        // Server asks for permission approval before completing update
        if (data.needsApproval) {
          setUpdateApproval({
            pluginId,
            manifest: data.manifest,
            version: data.version,
            addedPermissions: data.addedPermissions,
          });
          return;
        }

        if (data.success) {
          setPlugins((prev) =>
            prev.map((p) =>
              p.id === pluginId ? { ...p, version: data.version } : p
            )
          );
          setUpdateApproval(null);
          invalidateIndexCache();
          showStatus("success", t("plugins.updated"));
          if (confirm(t("plugins.reloadConfirm"))) {
            window.location.reload();
          }
        } else {
          showStatus("error", data.error || t("plugins.updateFailed"));
        }
      } catch {
        showStatus("error", t("plugins.updateFailed"));
      } finally {
        setUpdatingId(null);
      }
    },
    [showStatus, t]
  );

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-md border text-sm ${
            statusMessage.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "success" ? (
              <Check size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            {statusMessage.text}
          </div>
        </div>
      )}

      {/* Install form */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t("plugins.addPlugin")}
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handlePreview();
              }
            }}
            placeholder={t("plugins.repoPlaceholder")}
            className={inputClass}
            disabled={previewing || installing}
          />
          <button
            onClick={handlePreview}
            disabled={previewing || installing || !repoInput.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm whitespace-nowrap"
          >
            {previewing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            {t("plugins.install")}
          </button>
        </div>
      </div>

      {/* Permission confirmation dialog */}
      {preview && (
        <div className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={18} className="text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {preview.manifest.name} <span className="font-normal text-gray-500 dark:text-gray-400">v{preview.version}</span>
            </h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {preview.manifest.description}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            by {preview.manifest.author}
          </p>

          <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
            {t("plugins.permissionsTitle")}
          </h4>

          {preview.manifest.permissions && preview.manifest.permissions.length > 0 ? (
            <>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                {t("plugins.permissionsDescription")}
              </p>
              <ul className="space-y-1 mb-4">
                {preview.manifest.permissions
                  .filter((p): p is PluginPermission => PLUGIN_PERMISSIONS.includes(p))
                  .map((perm) => (
                    <li
                      key={perm}
                      className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded"
                    >
                      <Shield size={14} className="text-amber-500 shrink-0" />
                      {t(PERMISSION_I18N_KEYS[perm])}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t("plugins.noPermissions")}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleConfirmInstall}
              disabled={installing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
            >
              {installing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Check size={16} />
              )}
              {t("plugins.confirmInstall")}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={installing}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors text-sm"
            >
              <X size={16} />
              {t("plugins.cancelInstall")}
            </button>
          </div>
        </div>
      )}

      {/* Update permission approval dialog */}
      {updateApproval && (
        <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={18} className="text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {updateApproval.manifest.name} <span className="font-normal text-gray-500 dark:text-gray-400">v{updateApproval.version}</span>
            </h3>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
            {t("plugins.updateNewPermissions")}
          </p>
          <ul className="space-y-1 mb-4">
            {updateApproval.addedPermissions
              .filter((p): p is PluginPermission => PLUGIN_PERMISSIONS.includes(p as PluginPermission))
              .map((perm) => (
                <li
                  key={perm}
                  className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 rounded"
                >
                  <Shield size={14} className="text-amber-500 shrink-0" />
                  {t(PERMISSION_I18N_KEYS[perm])}
                </li>
              ))}
          </ul>

          <div className="flex gap-2">
            <button
              onClick={() => {
                const plugin = plugins.find((p) => p.id === updateApproval.pluginId);
                const allPerms = [
                  ...(plugin?.permissions ?? []),
                  ...updateApproval.addedPermissions,
                ];
                handleUpdate(updateApproval.pluginId, allPerms);
              }}
              disabled={updatingId === updateApproval.pluginId}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors text-sm"
            >
              {updatingId === updateApproval.pluginId ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Check size={16} />
              )}
              {t("plugins.confirmUpdate")}
            </button>
            <button
              onClick={() => setUpdateApproval(null)}
              disabled={updatingId === updateApproval.pluginId}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors text-sm"
            >
              <X size={16} />
              {t("plugins.cancelInstall")}
            </button>
          </div>
        </div>
      )}

      {/* Plugin list */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t("plugins.installedPlugins")}
        </h3>

        {plugins.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("plugins.noPlugins")}
          </p>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => {
              const settingsTab = settingsTabs.find((t) => t.pluginId === plugin.id);
              const isSettingsOpen = openSettingsId === plugin.id;
              const api = settingsTab ? getPluginAPI(plugin.id) : null;

              return (
                <div key={plugin.id}>
                  <div
                    className={`flex items-center justify-between p-3 rounded-md border ${
                      plugin.enabled
                        ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                        : "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/30 opacity-60"
                    } ${isSettingsOpen ? "rounded-b-none" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {plugin.id}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {plugin.version}
                        </span>
                        {plugin.source === "local" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 font-medium">
                            {t("plugins.localBadge")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {plugin.source === "local" ? `plugins/${plugin.id}/` : plugin.repo}
                      </div>
                      {/* Show permissions for non-local plugins */}
                      {plugin.source !== "local" && plugin.permissions && plugin.permissions.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <Shield size={10} className="text-amber-500 shrink-0" />
                          {plugin.permissions
                            .filter((p): p is PluginPermission => PLUGIN_PERMISSIONS.includes(p as PluginPermission))
                            .map((perm) => (
                              <span
                                key={perm}
                                className="text-[10px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                              >
                                {perm}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {/* Settings */}
                      {settingsTab && (
                        <button
                          onClick={() => setOpenSettingsId(isSettingsOpen ? null : plugin.id)}
                          className={`p-1.5 rounded transition-colors ${
                            isSettingsOpen
                              ? "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20"
                              : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                          }`}
                          title={t("plugins.settings")}
                        >
                          <Settings size={14} />
                        </button>
                      )}
                      {plugin.source !== "local" && (
                        <>
                          {/* Toggle */}
                          <button
                            onClick={() => handleToggle(plugin.id)}
                            disabled={togglingId === plugin.id}
                            className={`p-1.5 rounded transition-colors ${
                              plugin.enabled
                                ? "text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                                : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                            }`}
                            title={
                              plugin.enabled
                                ? t("plugins.disable")
                                : t("plugins.enable")
                            }
                          >
                            {togglingId === plugin.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : plugin.enabled ? (
                              <Power size={14} />
                            ) : (
                              <PowerOff size={14} />
                            )}
                          </button>

                          {/* Update */}
                          <button
                            onClick={() => handleUpdate(plugin.id)}
                            disabled={updatingId === plugin.id}
                            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
                            title={t("plugins.update")}
                          >
                            {updatingId === plugin.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                          </button>
                        </>
                      )}
                      {/* Uninstall */}
                      {plugin.source !== "local" && (
                        <button
                          onClick={() => handleUninstall(plugin.id)}
                          disabled={deletingId === plugin.id}
                          className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                          title={t("plugins.uninstall")}
                        >
                          {deletingId === plugin.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Plugin settings panel */}
                  {isSettingsOpen && settingsTab && api && (
                    <div className="border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-md p-4 bg-white dark:bg-gray-900">
                      <PanelErrorBoundary fallbackLabel={`${plugin.id} settings error`}>
                        <settingsTab.component api={api} language={language} onClose={() => setOpenSettingsId(null)} />
                      </PanelErrorBoundary>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
