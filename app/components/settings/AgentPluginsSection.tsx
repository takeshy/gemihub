import { useCallback, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Power, PowerOff, RefreshCw, Trash2, X } from "lucide-react";
import type { AgentPluginConfig } from "~/types/settings";
import { useI18n } from "~/i18n/context";
import { invalidateIndexCache } from "~/utils/index-cache";
import { cacheProvisionedSkillFiles, removeCachedFilesByPrefix } from "~/services/provisioned-skill-cache";

interface Preview {
  manifest: { name: string; version?: string; description?: string; author?: { name?: string } };
  repo: string;
  version: string;
  sourceType: "release" | "branch";
  sourceRef: string;
  commitSha: string;
  skills: Array<{ name: string; description: string }>;
  mcpServers: Array<{ name: string; url: string; headers?: Record<string, string> }>;
  warnings: string[];
}

const FLASH_KEY = "gemihub:agentPluginFlash";

type StatusMessage = { type: "error" | "success" | "warning"; text: string };
type ActionResponse = {
  error?: string;
  success?: boolean;
  enabled?: boolean;
  updateAvailable?: boolean;
  version?: string;
  commitSha?: string;
  sourceType?: "release" | "branch";
  sourceRef?: string;
  warnings?: string[];
  config?: AgentPluginConfig;
  cacheFiles?: Parameters<typeof cacheProvisionedSkillFiles>[0];
};

function readFlashMessage(): StatusMessage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return raw ? JSON.parse(raw) as StatusMessage : null;
  } catch { return null; }
}

function reloadWithMessage(message: StatusMessage): void {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify(message));
  window.location.reload();
}

export function AgentPluginsSection({ initialPlugins }: { initialPlugins: AgentPluginConfig[] }) {
  const { t } = useI18n();
  const [plugins, setPlugins] = useState(initialPlugins);
  const [repo, setRepo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<StatusMessage | null>(readFlashMessage);

  const requestPreview = useCallback(async () => {
    setBusy("preview"); setMessage(null);
    try {
      const response = await fetch("/api/agent-plugins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo, action: "preview" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("plugins.agent.previewFailed"));
      setPreview(data);
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : t("plugins.agent.previewFailed") }); }
    finally { setBusy(null); }
  }, [repo, t]);

  const install = useCallback(async () => {
    if (!preview) return;
    setBusy("install");
    try {
      const response = await fetch("/api/agent-plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: preview.repo,
          commitSha: preview.commitSha,
          sourceType: preview.sourceType,
          sourceRef: preview.sourceRef,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("plugins.installFailed"));
      await removeCachedFilesByPrefix(`agent-plugins/${data.config.name}`);
      if (Array.isArray(data.cacheFiles)) await cacheProvisionedSkillFiles(data.cacheFiles);
      setPlugins((current) => [...current.filter((item) => item.name !== data.config.name), data.config]);
      setRepo(""); setPreview(null); invalidateIndexCache();
      reloadWithMessage({
        type: data.warnings?.length ? "warning" : "success",
        text: data.warnings?.length ? `${t("plugins.agent.installed")} ${data.warnings.join(" ")}` : t("plugins.agent.installed"),
      });
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : t("plugins.installFailed") }); }
    finally { setBusy(null); }
  }, [preview, t]);

  const act = useCallback(async (plugin: AgentPluginConfig, action: "toggle" | "update" | "delete") => {
    if (action === "delete" && !confirm(t("plugins.agent.confirmUninstall"))) return;
    setBusy(`${action}:${plugin.name}`); setMessage(null);
    try {
      let response: Response;
      let data: ActionResponse;
      if (action === "update") {
        response = await fetch(`/api/agent-plugins/${encodeURIComponent(plugin.name)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check-update" }) });
        data = await response.json() as ActionResponse;
        if (!response.ok) throw new Error(data.error || t("plugins.agent.operationFailed"));
        if (!data.updateAvailable) {
          setMessage({ type: "success", text: t("plugins.agent.upToDate") });
          return;
        }
        const warningText = Array.isArray(data.warnings) && data.warnings.length ? `\n\n${data.warnings.join("\n")}` : "";
        if (!data.commitSha || !data.sourceType || !data.sourceRef) throw new Error(t("plugins.agent.operationFailed"));
        if (!confirm(`${t("plugins.agent.confirmUpdate")} ${String(data.version)} (${data.commitSha.slice(0, 7)})${warningText}`)) return;
        response = await fetch(`/api/agent-plugins/${encodeURIComponent(plugin.name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", commitSha: data.commitSha, sourceType: data.sourceType, sourceRef: data.sourceRef }),
        });
        data = await response.json() as ActionResponse;
      } else {
        response = await fetch(`/api/agent-plugins/${encodeURIComponent(plugin.name)}`, action === "delete" ? { method: "DELETE" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        data = await response.json() as ActionResponse;
      }
      if (!response.ok) throw new Error(data.error || t("plugins.agent.operationFailed"));
      if (action === "delete") await removeCachedFilesByPrefix(`agent-plugins/${plugin.name}`);
      if (action === "update" && data.cacheFiles) {
        await removeCachedFilesByPrefix(`agent-plugins/${plugin.name}`);
        await cacheProvisionedSkillFiles(data.cacheFiles);
      }
      if (action === "delete") setPlugins((current) => current.filter((item) => item.name !== plugin.name));
      else if (action === "toggle" && typeof data.enabled === "boolean") setPlugins((current) => current.map((item) => item.name === plugin.name ? { ...item, enabled: data.enabled! } : item));
      else if (data.config) setPlugins((current) => current.map((item) => item.name === plugin.name ? data.config! : item));
      invalidateIndexCache();
      const successText = action === "delete" ? t("plugins.agent.uninstalled") : action === "update" ? t("plugins.updated") : t("plugins.agent.toggled");
      reloadWithMessage({
        type: Array.isArray(data.warnings) && data.warnings.length ? "warning" : "success",
        text: Array.isArray(data.warnings) && data.warnings.length ? `${successText} ${data.warnings.join(" ")}` : successText,
      });
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : t("plugins.agent.operationFailed") }); }
    finally { setBusy(null); }
  }, [t]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("plugins.agent.title")}</h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("plugins.agent.description")}</p>
      {message && <div className={`mt-4 rounded border p-3 text-sm ${message.type === "error" ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" : message.type === "warning" ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300" : "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"}`}>{message.text}</div>}
      <div className="mt-4 flex gap-2">
        <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder={t("plugins.repoPlaceholder")} className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        <button type="button" onClick={requestPreview} disabled={!repo.trim() || busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{t("plugins.agent.preview")}</button>
      </div>
      {preview && <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
        <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{preview.manifest.name} <span className="text-xs text-gray-500">{preview.version}</span></div><p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{preview.manifest.description}</p><p className="mt-1 text-[11px] text-gray-500">{preview.sourceType}: {preview.sourceRef} · {preview.commitSha.slice(0, 7)}</p></div><button onClick={() => setPreview(null)}><X size={16} /></button></div>
        <div className="mt-3 text-xs"><strong>Skills:</strong> {preview.skills.length ? preview.skills.map((item) => item.name).join(", ") : t("plugins.agent.none")}</div>
        <div className="mt-1 text-xs"><strong>Streamable HTTP MCP (disabled until tested):</strong></div>
        {preview.mcpServers.length ? <div className="mt-1 space-y-1">{preview.mcpServers.map((item) => <code key={item.name} className="block break-all text-[11px]">{item.name}: {item.url}{item.headers && Object.keys(item.headers).length ? ` · headers: ${Object.keys(item.headers).join(", ")}` : ""}</code>)}</div> : <div className="mt-1 text-xs">{t("plugins.agent.none")}</div>}
        {preview.warnings.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300">{preview.warnings.map((warning) => <li key={warning} className="flex gap-1"><AlertTriangle size={13} className="shrink-0" />{warning}</li>)}</ul>}
        <button onClick={install} disabled={busy !== null} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy === "install" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{t("plugins.confirmInstall")}</button>
      </div>}
      <div className="mt-5 space-y-3">
        {plugins.length === 0 && <p className="text-sm text-gray-500">{t("plugins.agent.empty")}</p>}
        {plugins.map((plugin) => <div key={plugin.name} className={`flex items-center justify-between rounded-md border p-3 ${plugin.enabled ? "border-gray-200 dark:border-gray-700" : "opacity-60"}`}>
          <div className="min-w-0"><div className="text-sm font-medium">{plugin.name} <span className="text-xs font-normal text-gray-500">{plugin.version}</span></div><div className="truncate text-xs text-gray-500">{plugin.repo} · {plugin.sourceType}:{plugin.sourceRef} · {plugin.commitSha.slice(0, 7)}</div></div>
          <div className="ml-2 flex gap-1">
            <button title={plugin.enabled ? t("plugins.disable") : t("plugins.enable")} onClick={() => act(plugin, "toggle")} disabled={busy !== null} className="p-1.5 text-gray-500">{busy === `toggle:${plugin.name}` ? <Loader2 size={14} className="animate-spin" /> : plugin.enabled ? <Power size={14} /> : <PowerOff size={14} />}</button>
            <button title={t("plugins.update")} onClick={() => act(plugin, "update")} disabled={busy !== null} className="p-1.5 text-gray-500">{busy === `update:${plugin.name}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>
            <button title={t("plugins.uninstall")} onClick={() => act(plugin, "delete")} disabled={busy !== null} className="p-1.5 text-red-500">{busy === `delete:${plugin.name}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button>
          </div>
        </div>)}
      </div>
    </div>
  );
}
