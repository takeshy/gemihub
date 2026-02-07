import { useState, useEffect, useCallback } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/settings";
import { requireAuth, getSession, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import type {
  UserSettings,
  McpServerConfig,
  EncryptionSettings,
  EditHistorySettings,
  RagSetting,
  ApiPlan,
  ModelType,
  Language,
  FontSize,
  Theme,
} from "~/types/settings";
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_RAG_SETTING,
  getAvailableModels,
  getDefaultModelForPlan,
  isModelAllowedForPlan,
  SUPPORTED_LANGUAGES,
  FONT_SIZE_OPTIONS,
  THEME_OPTIONS,
} from "~/types/settings";
import { I18nProvider, useI18n } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { ensureRootFolder } from "~/services/google-drive.server";
import {
  ArrowLeft,
  Settings as SettingsIcon,
  Server,
  Database,
  Lock,
  History,
  Terminal,
  Plus,
  Trash2,
  TestTube,
  RefreshCw,
  BarChart3,
  Scissors,
  Save,
  Check,
  AlertCircle,
  Loader2,
  Pencil,
  FileBox,
} from "lucide-react";
import { CommandsTab } from "~/components/settings/CommandsTab";
import { TempFilesDialog } from "~/components/settings/TempFilesDialog";
import { UntrackedFilesDialog } from "~/components/settings/UntrackedFilesDialog";
import { invalidateIndexCache } from "~/routes/_index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}

type TabId = "general" | "mcp" | "rag" | "encryption" | "editHistory" | "commands" | "sync";

import type { TranslationStrings } from "~/i18n/translations";

const TABS: { id: TabId; labelKey: keyof TranslationStrings; icon: typeof SettingsIcon }[] = [
  { id: "general", labelKey: "settings.tab.general", icon: SettingsIcon },
  { id: "sync", labelKey: "settings.tab.sync", icon: RefreshCw },
  { id: "mcp", labelKey: "settings.tab.mcp", icon: Server },
  { id: "rag", labelKey: "settings.tab.rag", icon: Database },
  { id: "encryption", labelKey: "settings.tab.encryption", icon: Lock },
  { id: "editHistory", labelKey: "settings.tab.editHistory", icon: History },
  { id: "commands", labelKey: "settings.tab.commands", icon: Terminal },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, tokens);
  const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  return {
    settings,
    hasApiKey: !!validTokens.geminiApiKey,
    maskedKey: validTokens.geminiApiKey ? maskApiKey(validTokens.geminiApiKey) : null,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, tokens);
  const currentSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  const formData = await request.formData();
  const _action = formData.get("_action") as string;

  try {
    switch (_action) {
      case "saveGeneral": {
        const apiPlan = (formData.get("apiPlan") as ApiPlan) || currentSettings.apiPlan;
        const selectedModel = (formData.get("selectedModel") as ModelType) || null;
        const systemPrompt = (formData.get("systemPrompt") as string) || "";
        const geminiApiKey = (formData.get("geminiApiKey") as string)?.trim() || "";
        const rootFolderName = (formData.get("rootFolderName") as string)?.trim() || currentSettings.rootFolderName || "GeminiHub";
        const language = (formData.get("language") as Language) || currentSettings.language;
        const fontSize = Number(formData.get("fontSize")) as FontSize || currentSettings.fontSize;
        const theme = (formData.get("theme") as Theme) || currentSettings.theme || "system";

        const updatedSettings: UserSettings = {
          ...currentSettings,
          apiPlan,
          selectedModel: selectedModel && isModelAllowedForPlan(apiPlan, selectedModel)
            ? selectedModel
            : getDefaultModelForPlan(apiPlan),
          systemPrompt,
          rootFolderName,
          language,
          fontSize,
          theme,
        };

        // If root folder name changed, ensure the new folder exists and update session
        let newRootFolderId = validTokens.rootFolderId;
        if (rootFolderName !== currentSettings.rootFolderName) {
          newRootFolderId = await ensureRootFolder(validTokens.accessToken, rootFolderName);
        }

        await saveSettings(validTokens.accessToken, newRootFolderId, updatedSettings);

        // Update session with API key and plan/model
        const session = await getSession(request);
        if (geminiApiKey) {
          session.set("geminiApiKey", geminiApiKey);
        }
        session.set("apiPlan", apiPlan);
        session.set("selectedModel", updatedSettings.selectedModel);
        if (rootFolderName !== currentSettings.rootFolderName) {
          session.set("rootFolderId", newRootFolderId);
        }

        return new Response(
          JSON.stringify({ success: true, message: "General settings saved." }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": await commitSession(session),
            },
          }
        );
      }

      case "saveMcp": {
        const mcpJson = formData.get("mcpServers") as string;
        const mcpServers: McpServerConfig[] = mcpJson ? JSON.parse(mcpJson) : [];
        const updatedSettings: UserSettings = { ...currentSettings, mcpServers };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return { success: true, message: "MCP server settings saved." };
      }

      case "saveRag": {
        const ragEnabled = formData.get("ragEnabled") === "on";
        const ragTopK = Math.min(20, Math.max(1, Number(formData.get("ragTopK")) || 5));
        const ragSettingsJson = formData.get("ragSettings") as string;
        const ragSettings: Record<string, RagSetting> = ragSettingsJson
          ? JSON.parse(ragSettingsJson)
          : currentSettings.ragSettings;
        const selectedRagSetting = (formData.get("selectedRagSetting") as string) || null;

        const updatedSettings: UserSettings = {
          ...currentSettings,
          ragEnabled,
          ragTopK,
          ragSettings,
          selectedRagSetting,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return { success: true, message: "RAG settings saved." };
      }

      case "saveEncryption": {
        const encryptionJson = formData.get("encryption") as string;
        const encryption: EncryptionSettings = encryptionJson
          ? JSON.parse(encryptionJson)
          : currentSettings.encryption;
        const updatedSettings: UserSettings = { ...currentSettings, encryption };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return { success: true, message: "Encryption settings saved." };
      }

      case "saveEditHistory": {
        const editHistoryJson = formData.get("editHistory") as string;
        const editHistory: EditHistorySettings = editHistoryJson
          ? JSON.parse(editHistoryJson)
          : currentSettings.editHistory;
        const updatedSettings: UserSettings = { ...currentSettings, editHistory };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return { success: true, message: "Edit history settings saved." };
      }

      case "saveSync": {
        const syncExcludePatterns = (formData.get("syncExcludePatterns") as string || "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const syncConflictFolder = (formData.get("syncConflictFolder") as string)?.trim() || "sync_conflicts";
        const updatedSettings: UserSettings = {
          ...currentSettings,
          syncExcludePatterns,
          syncConflictFolder,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return { success: true, message: "Sync settings saved." };
      }

      case "saveCommands": {
        const commandsJson = formData.get("slashCommands") as string;
        const slashCommands = commandsJson ? JSON.parse(commandsJson) : [];
        const updatedSettings: UserSettings = { ...currentSettings, slashCommands };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return { success: true, message: "Command settings saved." };
      }

      default:
        return { success: false, message: "Unknown action." };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return { success: false, message };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const { settings, hasApiKey, maskedKey } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<TabId>("general");

  useApplySettings(settings.language, settings.fontSize, settings.theme);

  return (
    <I18nProvider language={settings.language}>
      <SettingsInner
        settings={settings}
        hasApiKey={hasApiKey}
        maskedKey={maskedKey}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    </I18nProvider>
  );
}

function SettingsInner({
  settings,
  hasApiKey,
  maskedKey,
  activeTab,
  setActiveTab,
}: {
  settings: UserSettings;
  hasApiKey: boolean;
  maskedKey: string | null;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("settings.title")}</h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Settings tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:border-gray-300"
                  }`}
                >
                  <Icon size={16} />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {activeTab === "general" && (
          <GeneralTab settings={settings} hasApiKey={hasApiKey} maskedKey={maskedKey} />
        )}
        {activeTab === "sync" && <SyncTab settings={settings} />}
        {activeTab === "mcp" && <McpTab settings={settings} />}
        {activeTab === "rag" && <RagTab settings={settings} />}
        {activeTab === "encryption" && <EncryptionTab settings={settings} />}
        {activeTab === "editHistory" && <EditHistoryTab settings={settings} />}
        {activeTab === "commands" && <CommandsTab settings={settings} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI Pieces
// ---------------------------------------------------------------------------

function StatusBanner({ fetcher }: { fetcher: ReturnType<typeof useFetcher> }) {
  const data = fetcher.data as { success?: boolean; message?: string } | undefined;

  useEffect(() => {
    if (data?.success) {
      invalidateIndexCache();
    }
  }, [data]);

  if (!data) return null;
  return (
    <div
      className={`mb-6 p-3 rounded-md border text-sm ${
        data.success
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
          : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
      }`}
    >
      <div className="flex items-center gap-2">
        {data.success ? <Check size={16} /> : <AlertCircle size={16} />}
        {data.message}
      </div>
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      {children}
    </div>
  );
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
    >
      {children}
    </label>
  );
}

function SaveButton({ loading }: { loading?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
      Save
    </button>
  );
}

const inputClass =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
const checkboxClass =
  "h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500";

// ---------------------------------------------------------------------------
// General Tab
// ---------------------------------------------------------------------------

function GeneralTab({
  settings,
  hasApiKey,
  maskedKey,
}: {
  settings: UserSettings;
  hasApiKey: boolean;
  maskedKey: string | null;
}) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const [apiPlan, setApiPlan] = useState<ApiPlan>(settings.apiPlan);
  const [selectedModel, setSelectedModel] = useState<ModelType | "">(
    settings.selectedModel || ""
  );
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [rootFolderName, setRootFolderName] = useState(settings.rootFolderName || "GeminiHub");
  const [language, setLanguage] = useState<Language>(settings.language);
  const [fontSize, setFontSize] = useState<FontSize>(settings.fontSize);
  const [theme, setTheme] = useState<Theme>(settings.theme || "system");
  const availableModels = getAvailableModels(apiPlan);

  // When plan changes, reset model if it's not available
  useEffect(() => {
    if (selectedModel && !isModelAllowedForPlan(apiPlan, selectedModel as ModelType)) {
      setSelectedModel(getDefaultModelForPlan(apiPlan));
    }
  }, [apiPlan, selectedModel]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      <fetcher.Form method="post">
        <input type="hidden" name="_action" value="saveGeneral" />

        {/* API Key */}
        <div className="mb-6">
          <Label htmlFor="geminiApiKey">{t("settings.general.apiKey")}</Label>
          {hasApiKey && (
            <p className="text-xs text-green-600 dark:text-green-400 mb-1">
              Current key: <code className="font-mono">{maskedKey}</code>
            </p>
          )}
          <input
            type="password"
            id="geminiApiKey"
            name="geminiApiKey"
            placeholder={hasApiKey ? t("settings.general.apiKeyKeep") : t("settings.general.apiKeyPlaceholder")}
            className={inputClass}
          />
        </div>

        {/* API Plan */}
        <div className="mb-6">
          <Label>{t("settings.general.apiPlan")}</Label>
          <div className="flex gap-6 mt-1">
            {(["paid", "free"] as ApiPlan[]).map((plan) => (
              <label key={plan} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="apiPlan"
                  value={plan}
                  checked={apiPlan === plan}
                  onChange={() => setApiPlan(plan)}
                  className="text-blue-600 focus:ring-blue-500"
                />
                {plan === "paid" ? t("settings.general.paid") : t("settings.general.free")}
              </label>
            ))}
          </div>
        </div>

        {/* Model */}
        <div className="mb-6">
          <Label htmlFor="selectedModel">{t("settings.general.defaultModel")}</Label>
          <select
            id="selectedModel"
            name="selectedModel"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as ModelType)}
            className={inputClass}
          >
            <option value="">{t("settings.general.usePlanDefault")} ({getDefaultModelForPlan(apiPlan)})</option>
            {availableModels.map((m) => (
              <option key={m.name} value={m.name}>
                {m.displayName} -- {m.description}
              </option>
            ))}
          </select>
        </div>

        {/* System Prompt */}
        <div className="mb-6">
          <Label htmlFor="systemPrompt">{t("settings.general.systemPrompt")}</Label>
          <textarea
            id="systemPrompt"
            name="systemPrompt"
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={t("settings.general.systemPromptPlaceholder")}
            className={inputClass + " resize-y"}
          />
        </div>

        {/* Root Folder Name */}
        <div className="mb-6">
          <Label htmlFor="rootFolderName">{t("settings.general.rootFolderName")}</Label>
          <input
            type="text"
            id="rootFolderName"
            name="rootFolderName"
            value={rootFolderName}
            onChange={(e) => setRootFolderName(e.target.value)}
            placeholder="GeminiHub"
            className={inputClass + " max-w-[300px]"}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.general.rootFolderDescription")}
          </p>
        </div>

        {/* Language */}
        <div className="mb-6">
          <Label htmlFor="language">{t("settings.general.language")}</Label>
          <select
            id="language"
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className={inputClass + " max-w-[300px]"}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div className="mb-6">
          <Label htmlFor="fontSize">{t("settings.general.fontSize")}</Label>
          <select
            id="fontSize"
            name="fontSize"
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value) as FontSize)}
            className={inputClass + " max-w-[300px]"}
          >
            {FONT_SIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Theme */}
        <div className="mb-6">
          <Label htmlFor="theme">{t("settings.general.theme")}</Label>
          <select
            id="theme"
            name="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className={inputClass + " max-w-[300px]"}
          >
            {THEME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <SaveButton loading={loading} />
      </fetcher.Form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Sync Tab
// ---------------------------------------------------------------------------

function SyncTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const [excludePatterns, setExcludePatterns] = useState(
    (settings.syncExcludePatterns ?? []).join("\n")
  );
  const [conflictFolder, setConflictFolder] = useState(
    settings.syncConflictFolder || "sync_conflicts"
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [showTempFiles, setShowTempFiles] = useState(false);
  const [untrackedFiles, setUntrackedFiles] = useState<Array<{ id: string; name: string; mimeType: string; modifiedTime: string }> | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Load lastUpdatedAt from IndexedDB
  useEffect(() => {
    (async () => {
      try {
        const { getLocalSyncMeta } = await import("~/services/indexeddb-cache");
        const meta = await getLocalSyncMeta();
        setLastUpdatedAt(meta?.lastUpdatedAt ?? null);
      } catch {
        // ignore
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  const handleClearConflicts = useCallback(async () => {
    if (!confirm(t("settings.sync.clearConflictsConfirm"))) return;
    setActionLoading("clearConflicts");
    setActionMsg(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearConflicts" }),
      });
      const data = await res.json();
      setActionMsg(t("settings.sync.conflictsCleared").replace("{count}", String(data.deleted)));
    } catch {
      setActionMsg("Failed to clear conflicts.");
    } finally {
      setActionLoading(null);
    }
  }, [t]);

  const handleFullPush = useCallback(async () => {
    if (!confirm(t("settings.sync.fullPushConfirm"))) return;
    setActionLoading("fullPush");
    setActionMsg(null);
    try {
      const { useSync } = await import("~/hooks/useSync");
      // Directly call the API since we can't use hooks here
      await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "applyAll" }),
      });
      const { getLocalSyncMeta } = await import("~/services/indexeddb-cache");
      const localMeta = await getLocalSyncMeta();
      if (!localMeta) {
        setActionMsg("No local data to push.");
        return;
      }
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fullPush",
          localMeta: { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files },
        }),
      });
      if (!res.ok) throw new Error("Full push failed");
      setActionMsg("Full push completed.");
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Full push failed.");
    } finally {
      setActionLoading(null);
    }
  }, [t]);

  const handleFullPull = useCallback(async () => {
    if (!confirm(t("settings.sync.fullPullConfirm"))) return;
    setActionLoading("fullPull");
    setActionMsg(null);
    try {
      const { getAllCachedFiles, setCachedFile, setLocalSyncMeta } = await import("~/services/indexeddb-cache");
      const cachedFiles = await getAllCachedFiles();
      const skipHashes: Record<string, string> = {};
      for (const f of cachedFiles) {
        if (f.md5Checksum) skipHashes[f.fileId] = f.md5Checksum;
      }
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fullPull", skipHashes }),
      });
      if (!res.ok) throw new Error("Full pull failed");
      const data = await res.json();

      const updatedMeta = {
        id: "current" as const,
        lastUpdatedAt: new Date().toISOString(),
        files: {} as Record<string, { md5Checksum: string; modifiedTime: string }>,
      };
      for (const [fileId, fileMeta] of Object.entries(data.remoteMeta.files as Record<string, { md5Checksum: string; modifiedTime: string }>)) {
        updatedMeta.files[fileId] = {
          md5Checksum: fileMeta.md5Checksum,
          modifiedTime: fileMeta.modifiedTime,
        };
      }
      for (const file of data.files) {
        await setCachedFile({
          fileId: file.fileId,
          content: file.content,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          cachedAt: Date.now(),
          fileName: file.fileName,
        });
      }
      await setLocalSyncMeta(updatedMeta);
      setLastUpdatedAt(updatedMeta.lastUpdatedAt);
      setActionMsg(`Full pull completed. Downloaded ${data.files.length} file(s).`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Full pull failed.");
    } finally {
      setActionLoading(null);
    }
  }, [t]);

  const handleDetectUntracked = useCallback(async () => {
    setActionLoading("detectUntracked");
    setActionMsg(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detectUntracked" }),
      });
      if (!res.ok) throw new Error("Detection failed");
      const data = await res.json();
      setUntrackedFiles(data.untrackedFiles);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Detection failed.");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("_action", "saveSync");
    fd.set("syncExcludePatterns", excludePatterns);
    fd.set("syncConflictFolder", conflictFolder);
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, excludePatterns, conflictFolder]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Sync Status */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
          {t("settings.sync.status")}
        </h3>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium">{t("settings.sync.lastUpdatedAt")}:</span>{" "}
          {loadingMeta ? (
            <Loader2 size={14} className="inline animate-spin" />
          ) : lastUpdatedAt ? (
            new Date(lastUpdatedAt).toLocaleString()
          ) : (
            <span className="italic text-gray-400">{t("settings.sync.notSynced")}</span>
          )}
        </div>
      </div>

      {/* Exclude Patterns */}
      <div className="mb-6">
        <Label htmlFor="syncExcludePatterns">{t("settings.sync.excludePatterns")}</Label>
        <textarea
          id="syncExcludePatterns"
          rows={3}
          value={excludePatterns}
          onChange={(e) => setExcludePatterns(e.target.value)}
          placeholder="\.tmp$\n^temp_"
          className={inputClass + " font-mono resize-y"}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("settings.sync.excludePatternsDescription")}
        </p>
      </div>

      {/* Conflict Resolution */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
          {t("settings.sync.conflictResolution")}
        </h3>
        <div className="mb-3">
          <Label htmlFor="syncConflictFolder">{t("settings.sync.conflictFolder")}</Label>
          <input
            type="text"
            id="syncConflictFolder"
            value={conflictFolder}
            onChange={(e) => setConflictFolder(e.target.value)}
            className={inputClass + " max-w-[300px]"}
          />
        </div>
        <button
          type="button"
          onClick={handleClearConflicts}
          disabled={actionLoading === "clearConflicts"}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm disabled:opacity-50"
        >
          {actionLoading === "clearConflicts" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
          {t("settings.sync.clearConflicts")}
        </button>
      </div>

      {/* Full Sync Operations */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
          {t("settings.sync.fullSyncOps")}
        </h3>
        <div className="flex flex-wrap gap-3">
          <div>
            <button
              type="button"
              onClick={handleFullPush}
              disabled={!!actionLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm disabled:opacity-50"
            >
              {actionLoading === "fullPush" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t("settings.sync.fullPush")}
            </button>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.sync.fullPushDescription")}
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={handleFullPull}
              disabled={!!actionLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm disabled:opacity-50"
            >
              {actionLoading === "fullPull" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t("settings.sync.fullPull")}
            </button>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.sync.fullPullDescription")}
            </p>
          </div>
        </div>
      </div>

      {/* Temporary Files */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
          {t("settings.sync.tempFiles")}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t("settings.general.tempFilesDescription")}
        </p>
        <button
          type="button"
          onClick={() => setShowTempFiles(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
        >
          <FileBox size={14} />
          {t("settings.sync.manageTempFiles")}
        </button>
      </div>

      {/* Untracked Files */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
          {t("settings.sync.untrackedFiles")}
        </h3>
        <button
          type="button"
          onClick={handleDetectUntracked}
          disabled={actionLoading === "detectUntracked"}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm disabled:opacity-50"
        >
          {actionLoading === "detectUntracked" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {t("settings.sync.detectUntracked")}
        </button>
      </div>

      {actionMsg && (
        <div className="mb-6 p-3 rounded-md border text-sm bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
          {actionMsg}
        </div>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={handleSubmit}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {t("settings.sync.save")}
      </button>

      {showTempFiles && (
        <TempFilesDialog onClose={() => setShowTempFiles(false)} />
      )}

      {untrackedFiles !== null && (
        <UntrackedFilesDialog
          files={untrackedFiles}
          onClose={() => setUntrackedFiles(null)}
          onRefresh={handleDetectUntracked}
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// MCP Servers Tab
// ---------------------------------------------------------------------------

interface McpFormEntry {
  name: string;
  url: string;
  headers: string; // JSON string
  enabled: boolean;
}

const emptyMcpEntry: McpFormEntry = { name: "", url: "", headers: "{}", enabled: true };

function McpTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const [servers, setServers] = useState<McpServerConfig[]>(settings.mcpServers);
  const [adding, setAdding] = useState(false);
  const [newEntry, setNewEntry] = useState<McpFormEntry>({ ...emptyMcpEntry });
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string }>>({});

  const addServer = useCallback(() => {
    if (!newEntry.name.trim() || !newEntry.url.trim()) return;
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(newEntry.headers);
    } catch {
      // ignore parse error, use empty
    }
    setServers((prev) => [...prev, { name: newEntry.name.trim(), url: newEntry.url.trim(), headers, enabled: newEntry.enabled }]);
    setNewEntry({ ...emptyMcpEntry });
    setAdding(false);
  }, [newEntry]);

  const removeServer = useCallback((idx: number) => {
    setServers((prev) => prev.filter((_, i) => i !== idx));
    setTestResults((prev) => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
  }, []);

  const toggleServer = useCallback((idx: number) => {
    setServers((prev) => prev.map((s, i) => (i === idx ? { ...s, enabled: !s.enabled } : s)));
  }, []);

  const testConnection = useCallback(async (idx: number) => {
    const server = servers[idx];
    if (!server) return;
    setTestResults((prev) => ({ ...prev, [idx]: { ok: false, msg: "Testing..." } }));
    try {
      const res = await fetch("/api/settings/mcp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: server.url, headers: server.headers }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [idx]: { ok: res.ok, msg: data.message || (res.ok ? "Connected" : "Failed") },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [idx]: { ok: false, msg: err instanceof Error ? err.message : "Network error" },
      }));
    }
  }, [servers]);

  const handleSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("_action", "saveMcp");
    fd.set("mcpServers", JSON.stringify(servers));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, servers]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Server list */}
      {servers.length === 0 && !adding && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {t("settings.mcp.noServers")}
        </p>
      )}

      <div className="space-y-3 mb-6">
        {servers.map((server, idx) => (
          <div
            key={idx}
            className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/50"
          >
            <input
              type="checkbox"
              checked={server.enabled}
              onChange={() => toggleServer(idx)}
              className={checkboxClass}
              title="Enabled"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {server.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{server.url}</p>
              {testResults[idx] && (
                <p
                  className={`text-xs mt-1 ${
                    testResults[idx].ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {testResults[idx].msg}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => testConnection(idx)}
              className="p-1.5 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
              title="Test connection"
            >
              <TestTube size={16} />
            </button>
            <button
              type="button"
              onClick={() => removeServer(idx)}
              className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400"
              title="Remove"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Add server inline form */}
      {adding ? (
        <div className="mb-6 p-4 border border-blue-200 dark:border-blue-800 rounded-md bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
          <div>
            <Label htmlFor="mcp-name">{t("settings.mcp.name")}</Label>
            <input
              id="mcp-name"
              type="text"
              value={newEntry.name}
              onChange={(e) => setNewEntry((p) => ({ ...p, name: e.target.value }))}
              placeholder="my-server"
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="mcp-url">{t("settings.mcp.url")}</Label>
            <input
              id="mcp-url"
              type="text"
              value={newEntry.url}
              onChange={(e) => setNewEntry((p) => ({ ...p, url: e.target.value }))}
              placeholder="http://localhost:3001/sse"
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="mcp-headers">{t("settings.mcp.headers")}</Label>
            <textarea
              id="mcp-headers"
              rows={2}
              value={newEntry.headers}
              onChange={(e) => setNewEntry((p) => ({ ...p, headers: e.target.value }))}
              className={inputClass + " font-mono resize-y"}
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="mcp-enabled"
              checked={newEntry.enabled}
              onChange={(e) => setNewEntry((p) => ({ ...p, enabled: e.target.checked }))}
              className={checkboxClass}
            />
            <Label htmlFor="mcp-enabled">{t("settings.mcp.enabled")}</Label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addServer}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
            >
              {t("settings.mcp.add")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewEntry({ ...emptyMcpEntry });
              }}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 text-sm"
        >
          <Plus size={16} />
          {t("settings.mcp.addServer")}
        </button>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={handleSubmit}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {t("settings.mcp.save")}
      </button>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// RAG Tab
// ---------------------------------------------------------------------------

function RagTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const [ragTopK, setRagTopK] = useState(settings.ragTopK);
  const [ragSettings, setRagSettings] = useState<Record<string, RagSetting>>(settings.ragSettings);
  const [selectedRagSetting, setSelectedRagSetting] = useState<string | null>(settings.selectedRagSetting);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const settingNames = Object.keys(ragSettings);

  const addRagSetting = useCallback(() => {
    // Auto-generate a unique name
    let idx = settingNames.length + 1;
    let name = `setting-${idx}`;
    while (ragSettings[name]) {
      idx++;
      name = `setting-${idx}`;
    }
    setRagSettings((prev) => ({ ...prev, [name]: { ...DEFAULT_RAG_SETTING } }));
    setSelectedRagSetting(name);
    // Start rename immediately so user can type a proper name
    setRenamingKey(name);
    setRenameValue(name);
  }, [ragSettings, settingNames]);

  const removeRagSetting = useCallback(
    (name: string) => {
      setRagSettings((prev) => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      if (selectedRagSetting === name) {
        const remaining = settingNames.filter((n) => n !== name);
        setSelectedRagSetting(remaining.length > 0 ? remaining[0] : null);
      }
      if (renamingKey === name) setRenamingKey(null);
    },
    [selectedRagSetting, settingNames, renamingKey]
  );

  const commitRename = useCallback(() => {
    if (!renamingKey) return;
    const newName = renameValue.trim();
    if (!newName || newName === renamingKey) {
      setRenamingKey(null);
      return;
    }
    if (ragSettings[newName]) {
      // Name already exists, cancel
      setRenamingKey(null);
      return;
    }
    setRagSettings((prev) => {
      const copy: Record<string, RagSetting> = {};
      for (const [k, v] of Object.entries(prev)) {
        copy[k === renamingKey ? newName : k] = v;
      }
      return copy;
    });
    if (selectedRagSetting === renamingKey) setSelectedRagSetting(newName);
    setRenamingKey(null);
  }, [renamingKey, renameValue, ragSettings, selectedRagSetting]);

  const updateCurrentSetting = useCallback(
    (patch: Partial<RagSetting>) => {
      if (!selectedRagSetting) return;
      setRagSettings((prev) => ({
        ...prev,
        [selectedRagSetting]: { ...prev[selectedRagSetting], ...patch },
      }));
    },
    [selectedRagSetting]
  );

  const currentSetting = selectedRagSetting ? ragSettings[selectedRagSetting] : null;

  const handleSync = useCallback(async () => {
    if (!selectedRagSetting || !ragSettings[selectedRagSetting]) {
      setSyncMsg("No RAG setting selected.");
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      // Save settings to Drive first so the sync API can find them
      const hasSettings = Object.keys(ragSettings).length > 0;
      const fd = new FormData();
      fd.set("_action", "saveRag");
      fd.set("ragEnabled", hasSettings ? "on" : "off");
      fd.set("ragTopK", String(ragTopK));
      fd.set("ragSettings", JSON.stringify(ragSettings));
      fd.set("selectedRagSetting", selectedRagSetting || "");
      const saveRes = await fetch("/settings", { method: "POST", body: fd });
      if (!saveRes.ok) {
        setSyncMsg("Failed to save settings before sync.");
        return;
      }

      const res = await fetch("/api/settings/rag-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragSettingName: selectedRagSetting }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSyncMsg(data.error || "Sync failed.");
        return;
      }

      // Response is SSE stream — read events
      const reader = res.body?.getReader();
      if (!reader) {
        setSyncMsg("No response body.");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.message) setSyncMsg(evt.message);
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : "Sync error.");
    } finally {
      setSyncing(false);
    }
  }, [selectedRagSetting, ragSettings, ragTopK]);

  const handleSubmit = useCallback(() => {
    const hasSettings = Object.keys(ragSettings).length > 0;
    const fd = new FormData();
    fd.set("_action", "saveRag");
    fd.set("ragEnabled", hasSettings ? "on" : "off");
    fd.set("ragTopK", String(ragTopK));
    fd.set("ragSettings", JSON.stringify(ragSettings));
    fd.set("selectedRagSetting", selectedRagSetting || "");
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, ragTopK, ragSettings, selectedRagSetting]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Top-K */}
      <div className="mb-6">
        <Label htmlFor="ragTopK">{t("settings.rag.topK")}</Label>
        <input
          id="ragTopK"
          type="number"
          min={1}
          max={20}
          value={ragTopK}
          onChange={(e) => setRagTopK(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
          className={inputClass + " max-w-[120px]"}
        />
      </div>

      {/* RAG settings list */}
      <div className="mb-6">
        <Label>{t("settings.rag.settings")}</Label>
        <div className="flex flex-wrap items-center gap-2 mt-1 mb-3">
          {settingNames.map((name) => (
            <div
              key={name}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm cursor-pointer border ${
                selectedRagSetting === name
                  ? "bg-blue-100 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300"
                  : "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-300"
              }`}
              onClick={() => setSelectedRagSetting(name)}
            >
              {renamingKey === name ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                    if (e.key === "Escape") setRenamingKey(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-none outline-none text-sm w-24 focus:ring-0 p-0"
                  autoFocus
                />
              ) : (
                <>
                  {name}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingKey(name);
                      setRenameValue(name);
                    }}
                    className="ml-0.5 text-gray-400 hover:text-blue-500"
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRagSetting(name);
                }}
                className="ml-0.5 text-gray-400 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRagSetting}
            className="inline-flex items-center gap-1 px-3 py-1 border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-full hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 text-sm"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Selected setting editor */}
      {currentSetting && selectedRagSetting && (
        <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-md space-y-4">
          {/* Internal / External toggle */}
          <div>
            <Label>Type</Label>
            <div className="flex gap-4 mt-1">
              {[
                { value: false, label: "Internal (Google Drive folders)" },
                { value: true, label: "External (store IDs)" },
              ].map((opt) => (
                <label
                  key={String(opt.value)}
                  className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  <input
                    type="radio"
                    checked={currentSetting.isExternal === opt.value}
                    onChange={() => updateCurrentSetting({ isExternal: opt.value })}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {currentSetting.isExternal ? (
            <div>
              <Label htmlFor="rag-storeIds">Store IDs (one per line)</Label>
              <textarea
                id="rag-storeIds"
                rows={3}
                value={currentSetting.storeIds.join("\n")}
                onChange={(e) =>
                  updateCurrentSetting({
                    storeIds: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={inputClass + " font-mono resize-y"}
              />
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="rag-targetFolders">Target Folders (one per line, name or ID)</Label>
                <textarea
                  id="rag-targetFolders"
                  rows={3}
                  value={currentSetting.targetFolders.join("\n")}
                  onChange={(e) =>
                    updateCurrentSetting({
                      targetFolders: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className={inputClass + " font-mono resize-y"}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Folder names (e.g. <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">workflows</code>) or Drive folder IDs. Leave empty to use the root folder.
                </p>
              </div>
              <div>
                <Label htmlFor="rag-excludePatterns">Exclude Patterns (one per line)</Label>
                <textarea
                  id="rag-excludePatterns"
                  rows={2}
                  value={currentSetting.excludePatterns.join("\n")}
                  onChange={(e) =>
                    updateCurrentSetting({
                      excludePatterns: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className={inputClass + " font-mono resize-y"}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Regex patterns matched against file names. e.g. <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">\.pdf$</code> <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">^temp_</code> <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">\.tmp$</code>
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sync */}
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          disabled={syncing}
          onClick={handleSync}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          Sync
        </button>
        {syncMsg && <span className="text-xs text-gray-500 dark:text-gray-400">{syncMsg}</span>}
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={handleSubmit}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {t("settings.rag.save")}
      </button>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Encryption Tab
// ---------------------------------------------------------------------------

function EncryptionTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const [encryption, setEncryption] = useState<EncryptionSettings>(settings.encryption);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const isSetup = encryption.enabled && !!encryption.publicKey;

  const handleSetup = useCallback(async () => {
    if (!password || password !== confirmPassword) {
      setSetupError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setSetupError("Password must be at least 8 characters.");
      return;
    }
    setSetupError(null);
    setSetting(true);
    try {
      const res = await fetch("/api/settings/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSetupError(data.error || data.message || "Setup failed.");
        return;
      }
      setEncryption({
        ...encryption,
        enabled: true,
        publicKey: data.publicKey || encryption.publicKey,
        encryptedPrivateKey: data.encryptedPrivateKey || encryption.encryptedPrivateKey,
        salt: data.salt || encryption.salt,
      });
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Error setting up encryption.");
    } finally {
      setSetting(false);
    }
  }, [password, confirmPassword, encryption]);

  const handleReset = useCallback(() => {
    setEncryption({
      enabled: false,
      encryptChatHistory: false,
      encryptWorkflowHistory: false,
      publicKey: "",
      encryptedPrivateKey: "",
      salt: "",
    });
    setConfirmReset(false);
  }, []);

  const handleSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("_action", "saveEncryption");
    fd.set("encryption", JSON.stringify(encryption));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, encryption]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Setup or status */}
      {!isSetup ? (
        <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-md space-y-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("settings.encryption.setup")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("settings.encryption.setupDescription")}
          </p>
          {setupError && (
            <p className="text-xs text-red-600 dark:text-red-400">{setupError}</p>
          )}
          <div>
            <Label htmlFor="enc-password">{t("settings.encryption.password")}</Label>
            <input
              id="enc-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="enc-confirm">{t("settings.encryption.confirmPassword")}</Label>
            <input
              id="enc-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            disabled={setting}
            onClick={handleSetup}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {setting ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            {t("settings.encryption.generateKeys")}
          </button>
        </div>
      ) : (
        <div className="mb-6 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
          <p className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
            <Check size={16} />
            {t("settings.encryption.configured")}
          </p>
        </div>
      )}

      {/* Toggles */}
      <div className="mb-4 flex items-center gap-3">
        <input
          type="checkbox"
          id="encryptChatHistory"
          checked={encryption.encryptChatHistory}
          onChange={(e) => setEncryption((p) => ({ ...p, encryptChatHistory: e.target.checked }))}
          className={checkboxClass}
        />
        <Label htmlFor="encryptChatHistory">{t("settings.encryption.encryptChat")}</Label>
      </div>
      <div className="mb-6 flex items-center gap-3">
        <input
          type="checkbox"
          id="encryptWorkflowHistory"
          checked={encryption.encryptWorkflowHistory}
          onChange={(e) => setEncryption((p) => ({ ...p, encryptWorkflowHistory: e.target.checked }))}
          className={checkboxClass}
        />
        <Label htmlFor="encryptWorkflowHistory">{t("settings.encryption.encryptWorkflow")}</Label>
      </div>

      {/* Reset */}
      {isSetup && (
        <div className="mb-6">
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              {t("settings.encryption.reset")}
            </button>
          ) : (
            <div className="p-3 border border-red-200 dark:border-red-800 rounded-md bg-red-50 dark:bg-red-900/20 space-y-2">
              <p className="text-sm text-red-700 dark:text-red-300">
                {t("settings.encryption.resetWarning")}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
                >
                  {t("settings.encryption.confirmReset")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={handleSubmit}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {t("settings.encryption.save")}
      </button>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Edit History Tab
// ---------------------------------------------------------------------------

function EditHistoryTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const [editHistory, setEditHistory] = useState<EditHistorySettings>(settings.editHistory);
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const handlePrune = useCallback(async () => {
    setPruning(true);
    setPruneMsg(null);
    try {
      const res = await fetch("/api/settings/edit-history-prune", { method: "POST" });
      const data = await res.json();
      setPruneMsg(data.message || (res.ok ? "Prune complete." : "Prune failed."));
    } catch (err) {
      setPruneMsg(err instanceof Error ? err.message : "Prune error.");
    } finally {
      setPruning(false);
    }
  }, []);

  const handleStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/settings/edit-history-stats");
      const data = await res.json();
      setStats(data);
    } catch {
      setStats({ error: "Failed to load stats." });
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("_action", "saveEditHistory");
    fd.set("editHistory", JSON.stringify(editHistory));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, editHistory]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Max age */}
      <div className="mb-6">
        <Label htmlFor="maxAgeInDays">{t("settings.editHistory.maxAge")}</Label>
        <input
          id="maxAgeInDays"
          type="number"
          min={1}
          value={editHistory.retention.maxAgeInDays}
          onChange={(e) =>
            setEditHistory((p) => ({
              ...p,
              retention: { ...p.retention, maxAgeInDays: Math.max(1, Number(e.target.value) || 1) },
            }))
          }
          className={inputClass + " max-w-[120px]"}
        />
      </div>

      {/* Max entries */}
      <div className="mb-6">
        <Label htmlFor="maxEntriesPerFile">{t("settings.editHistory.maxEntries")}</Label>
        <input
          id="maxEntriesPerFile"
          type="number"
          min={1}
          value={editHistory.retention.maxEntriesPerFile}
          onChange={(e) =>
            setEditHistory((p) => ({
              ...p,
              retention: {
                ...p.retention,
                maxEntriesPerFile: Math.max(1, Number(e.target.value) || 1),
              },
            }))
          }
          className={inputClass + " max-w-[120px]"}
        />
      </div>

      {/* Context lines */}
      <div className="mb-6">
        <Label htmlFor="contextLines">{t("settings.editHistory.contextLines")}</Label>
        <input
          id="contextLines"
          type="number"
          min={0}
          max={10}
          value={editHistory.diff.contextLines}
          onChange={(e) =>
            setEditHistory((p) => ({
              ...p,
              diff: { ...p.diff, contextLines: Math.min(10, Math.max(0, Number(e.target.value) || 0)) },
            }))
          }
          className={inputClass + " max-w-[120px]"}
        />
      </div>

      {/* Prune & Stats */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pruning}
          onClick={handlePrune}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm disabled:opacity-50"
        >
          <Scissors size={14} className={pruning ? "animate-pulse" : ""} />
          {t("settings.editHistory.prune")}
        </button>
        <button
          type="button"
          disabled={loadingStats}
          onClick={handleStats}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm disabled:opacity-50"
        >
          <BarChart3 size={14} />
          {t("settings.editHistory.stats")}
        </button>
        {pruneMsg && <span className="text-xs text-gray-500 dark:text-gray-400">{pruneMsg}</span>}
      </div>

      {/* Stats display */}
      {stats && (
        <div className="mb-6 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/50">
          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
            {JSON.stringify(stats, null, 2)}
          </pre>
        </div>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={handleSubmit}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {t("settings.editHistory.save")}
      </button>
    </SectionCard>
  );
}
