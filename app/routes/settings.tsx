import { useState, useEffect, useCallback } from "react";
import { data, Link, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/settings";
import { requireAuth, getSession, commitSession, setGeminiApiKey, setTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { rebuildSyncMeta } from "~/services/sync-meta.server";
import type {
  UserSettings,
  McpServerConfig,
  RagSetting,
  ApiPlan,
  ModelType,
  Language,
  FontSize,
  Theme,
  OAuthConfig,
  OAuthTokens,
  McpToolInfo,
} from "~/types/settings";
import {
  DEFAULT_RAG_SETTING,
  DEFAULT_RAG_STORE_KEY,
  DEFAULT_ENCRYPTION_SETTINGS,
  getAvailableModels,
  getDefaultModelForPlan,
  isModelAllowedForPlan,
  SUPPORTED_LANGUAGES,
  FONT_SIZE_OPTIONS,
  THEME_OPTIONS,
} from "~/types/settings";
import { I18nProvider, useI18n } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { getLocalPlugins } from "~/services/local-plugins.server";
import {
  encryptPrivateKey,
  decryptPrivateKey,
  generateKeyPair,
} from "~/services/crypto-core";
import {
  ArrowLeft,
  Settings as SettingsIcon,
  Server,
  Database,
  Lock,
  Terminal,
  Plus,
  Trash2,
  TestTube,
  RefreshCw,
  BarChart3,
  Scissors,
  Save,
  Check,
  Copy,
  AlertCircle,
  Loader2,
  Pencil,
  FileBox,
  ShieldCheck,
  KeyRound,
  Puzzle,
  X,
  Search,
} from "lucide-react";
import { CommandsTab } from "~/components/settings/CommandsTab";
import { PluginsTab } from "~/components/settings/PluginsTab";
import { TempFilesDialog } from "~/components/settings/TempFilesDialog";
import { UntrackedFilesDialog } from "~/components/settings/UntrackedFilesDialog";
import { TrashDialog } from "~/components/settings/TrashDialog";
import { ConflictsDialog } from "~/components/settings/ConflictsDialog";
import { RagFilesDialog } from "~/components/settings/RagFilesDialog";
import { invalidateIndexCache } from "~/routes/_index";
import { PluginProvider } from "~/contexts/PluginContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}

type TabId = "general" | "mcp" | "rag" | "commands" | "plugins" | "sync";

import type { TranslationStrings } from "~/i18n/translations";

const TABS: { id: TabId; labelKey: keyof TranslationStrings; icon: typeof SettingsIcon }[] = [
  { id: "general", labelKey: "settings.tab.general", icon: SettingsIcon },
  { id: "sync", labelKey: "settings.tab.sync", icon: RefreshCw },
  { id: "mcp", labelKey: "settings.tab.mcp", icon: Server },
  { id: "rag", labelKey: "settings.tab.rag", icon: Database },
  { id: "commands", labelKey: "settings.tab.commands", icon: Terminal },
  { id: "plugins", labelKey: "settings.tab.plugins", icon: Puzzle },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const driveSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  // Merge local plugins (dev only)
  const localPlugins = getLocalPlugins();
  const localIds = new Set(localPlugins.map((p) => p.id));
  const mergedPlugins = [
    ...localPlugins,
    ...(driveSettings.plugins || []).filter((p) => !localIds.has(p.id)),
  ];
  const settings = { ...driveSettings, plugins: mergedPlugins };

  return data(
    {
      settings,
      hasApiKey: !!validTokens.geminiApiKey,
      maskedKey: validTokens.geminiApiKey ? maskApiKey(validTokens.geminiApiKey) : null,
    },
    { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined }
  );
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  // Build a base session that already includes refreshed tokens (if any).
  // Action cases that modify the session should build on top of this.
  const baseSession = setCookieHeader
    ? await setTokens(request, validTokens)
    : await getSession(request);
  const jsonWithCookie = async (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    // If tokens were refreshed but no action-specific Set-Cookie was provided,
    // commit the base session so refreshed tokens are persisted.
    if (setCookieHeader && !headers.has("Set-Cookie")) {
      headers.set("Set-Cookie", await commitSession(baseSession));
    }
    return Response.json(data, { ...init, headers });
  };
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
        const language = (formData.get("language") as Language) || currentSettings.language;
        const fontSize = Number(formData.get("fontSize")) as FontSize || currentSettings.fontSize;
        const theme = (formData.get("theme") as Theme) || currentSettings.theme || "system";

        // Encryption-related fields
        const password = (formData.get("password") as string)?.trim() || "";
        const confirmPassword = (formData.get("confirmPassword") as string)?.trim() || "";
        const currentPassword = (formData.get("currentPassword") as string)?.trim() || "";
        const newPassword = (formData.get("newPassword") as string)?.trim() || "";
        const encryptChatHistory = formData.get("encryptChatHistory") === "on";
        const encryptWorkflowHistory = formData.get("encryptWorkflowHistory") === "on";

        const updatedSettings: UserSettings = {
          ...currentSettings,
          apiPlan,
          selectedModel: selectedModel && isModelAllowedForPlan(apiPlan, selectedModel)
            ? selectedModel
            : getDefaultModelForPlan(apiPlan),
          systemPrompt,
          language,
          fontSize,
          theme,
        };

        // Update file encryption toggles
        updatedSettings.encryption = {
          ...updatedSettings.encryption,
          encryptChatHistory,
          encryptWorkflowHistory,
        };

        let effectiveApiKey = geminiApiKey;

        const isInitialSetup = !currentSettings.encryptedApiKey && geminiApiKey && password;
        const isPasswordChange = !!currentSettings.encryptedApiKey && currentPassword && newPassword;

        if (isInitialSetup) {
          // Initial setup: encrypt API key + generate RSA key pair
          if (password !== confirmPassword) {
            return jsonWithCookie({ success: false, message: "Passwords do not match." });
          }
          if (password.length < 8) {
            return jsonWithCookie({ success: false, message: "Password must be at least 8 characters." });
          }

          const { encryptedPrivateKey: encApiKey, salt: apiSalt } = await encryptPrivateKey(geminiApiKey, password);
          updatedSettings.encryptedApiKey = encApiKey;
          updatedSettings.apiKeySalt = apiSalt;

          // Generate RSA key pair
          const keyPair = await generateKeyPair();
          const { encryptedPrivateKey: encRsaKey, salt: rsaSalt } = await encryptPrivateKey(keyPair.privateKey, password);
          updatedSettings.encryption = {
            ...updatedSettings.encryption,
            enabled: true,
            publicKey: keyPair.publicKey,
            encryptedPrivateKey: encRsaKey,
            salt: rsaSalt,
          };
        } else if (isPasswordChange) {
          // Password change: decrypt with old, re-encrypt with new
          if (newPassword !== confirmPassword) {
            return jsonWithCookie({ success: false, message: "Passwords do not match." });
          }
          if (newPassword.length < 8) {
            return jsonWithCookie({ success: false, message: "Password must be at least 8 characters." });
          }

          try {
            const decryptedApiKey = await decryptPrivateKey(
              currentSettings.encryptedApiKey, currentSettings.apiKeySalt, currentPassword
            );
            effectiveApiKey = geminiApiKey || decryptedApiKey;

            const { encryptedPrivateKey: encApiKey, salt: apiSalt } = await encryptPrivateKey(effectiveApiKey, newPassword);
            updatedSettings.encryptedApiKey = encApiKey;
            updatedSettings.apiKeySalt = apiSalt;

            // Re-encrypt RSA private key if exists
            if (currentSettings.encryption.encryptedPrivateKey && currentSettings.encryption.salt) {
              const rsaPrivateKey = await decryptPrivateKey(
                currentSettings.encryption.encryptedPrivateKey, currentSettings.encryption.salt, currentPassword
              );
              const { encryptedPrivateKey: encRsaKey, salt: rsaSalt } = await encryptPrivateKey(rsaPrivateKey, newPassword);
              updatedSettings.encryption = {
                ...updatedSettings.encryption,
                encryptedPrivateKey: encRsaKey,
                salt: rsaSalt,
              };
            }
          } catch {
            return jsonWithCookie({ success: false, message: "Current password is incorrect." });
          }
        }

        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);

        // Update session with API key and plan/model
        // Use baseSession which already has refreshed tokens if applicable
        if (effectiveApiKey) {
          const keySession = await setGeminiApiKey(request, effectiveApiKey);
          baseSession.set("geminiApiKey", keySession.get("geminiApiKey"));
        }
        baseSession.set("apiPlan", apiPlan);
        baseSession.set("selectedModel", updatedSettings.selectedModel);

        return jsonWithCookie(
          { success: true, message: "General settings saved." },
          { headers: { "Set-Cookie": await commitSession(baseSession) } }
        );
      }

      case "saveMcp": {
        const mcpJson = formData.get("mcpServers") as string;
        let mcpServers: McpServerConfig[];
        try {
          mcpServers = mcpJson ? JSON.parse(mcpJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid MCP servers JSON." });
        }
        const updatedSettings: UserSettings = { ...currentSettings, mcpServers };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "MCP server settings saved." });
      }

      case "saveRag": {
        const ragEnabled = formData.get("ragEnabled") === "on";
        const ragTopK = Math.min(20, Math.max(1, Number(formData.get("ragTopK")) || 5));
        const ragSettingsJson = formData.get("ragSettings") as string;
        let ragSettings: Record<string, RagSetting>;
        try {
          ragSettings = ragSettingsJson
            ? JSON.parse(ragSettingsJson)
            : currentSettings.ragSettings;
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid RAG settings JSON." });
        }
        const selectedRagSetting = (formData.get("selectedRagSetting") as string) || null;
        const ragRegistrationOnPush = formData.get("ragRegistrationOnPush") === "on";

        const updatedSettings: UserSettings = {
          ...currentSettings,
          ragEnabled,
          ragTopK,
          ragSettings,
          selectedRagSetting,
          ragRegistrationOnPush,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "RAG settings saved." });
      }

      case "saveEncryptionReset": {
        const updatedSettings: UserSettings = {
          ...currentSettings,
          encryptedApiKey: "",
          apiKeySalt: "",
          encryption: { ...DEFAULT_ENCRYPTION_SETTINGS },
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);

        // Clear API key from session too
        // Use baseSession which already has refreshed tokens if applicable
        baseSession.unset("geminiApiKey");
        return jsonWithCookie(
          { success: true, message: "Encryption has been reset." },
          { headers: { "Set-Cookie": await commitSession(baseSession) } }
        );
      }

      case "saveCommands": {
        const commandsJson = formData.get("slashCommands") as string;
        let slashCommands;
        try {
          slashCommands = commandsJson ? JSON.parse(commandsJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid commands JSON." });
        }
        const updatedSettings: UserSettings = { ...currentSettings, slashCommands };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Command settings saved." });
      }

      case "rebuildTree": {
        await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        return jsonWithCookie({ success: true, message: "Sync meta rebuilt." });
      }

      default:
        return jsonWithCookie({ success: false, message: "Unknown action." });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return jsonWithCookie({ success: false, message });
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
      <PluginProvider pluginConfigs={settings.plugins || []} language={settings.language}>
        <SettingsInner
          settings={settings}
          hasApiKey={hasApiKey}
          maskedKey={maskedKey}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      </PluginProvider>
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
          <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Settings tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
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
      <main className="max-w-5xl mx-auto px-4 py-4 sm:py-8">
        {activeTab === "general" && (
          <GeneralTab settings={settings} hasApiKey={hasApiKey} maskedKey={maskedKey} />
        )}
        {activeTab === "sync" && <SyncTab settings={settings} />}
        {activeTab === "mcp" && <McpTab settings={settings} />}
        {activeTab === "rag" && <RagTab settings={settings} />}
        {activeTab === "commands" && <CommandsTab settings={settings} />}
        {activeTab === "plugins" && <PluginsTab settings={settings} />}
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
  const [language, setLanguage] = useState<Language>(settings.language);
  const [fontSize, setFontSize] = useState<FontSize>(settings.fontSize);
  const [theme, setTheme] = useState<Theme>(settings.theme || "system");
  const availableModels = getAvailableModels(apiPlan);

  // Encryption state
  const [encryptChatHistory, setEncryptChatHistory] = useState(settings.encryption.encryptChatHistory);
  const [encryptWorkflowHistory, setEncryptWorkflowHistory] = useState(settings.encryption.encryptWorkflowHistory);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const isEncryptionSetup = !!settings.encryptedApiKey;
  const isRsaSetup = settings.encryption.enabled && !!settings.encryption.publicKey;

  // When plan changes, reset model if it's not available
  useEffect(() => {
    if (selectedModel && !isModelAllowedForPlan(apiPlan, selectedModel as ModelType)) {
      setSelectedModel(getDefaultModelForPlan(apiPlan));
    }
  }, [apiPlan, selectedModel]);

  const handleResetEncryption = useCallback(() => {
    // Reset encryption by submitting with cleared values
    const fd = new FormData();
    fd.set("_action", "saveEncryptionReset");
    fetcher.submit(fd, { method: "post" });
    setConfirmReset(false);
  }, [fetcher]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      <fetcher.Form method="post">
        <input type="hidden" name="_action" value="saveGeneral" />

        {/* API Key & Password Section */}
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
          <KeyRound size={16} />
          {t("settings.general.apiKeyPasswordSection")}
        </h3>

        {/* API Key */}
        <div className="mb-4">
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

        {/* Password fields */}
        {!isEncryptionSetup ? (
          /* Initial setup: password + confirm */
          <>
            <div className="mb-4">
              <Label htmlFor="password">{t("settings.general.password")}</Label>
              <input
                type="password"
                id="password"
                name="password"
                placeholder={t("settings.general.password")}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings.general.passwordRequired")}
              </p>
            </div>
            <div className="mb-6">
              <Label htmlFor="confirmPassword">{t("settings.general.confirmPassword")}</Label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                placeholder={t("settings.general.confirmPassword")}
                className={inputClass}
              />
            </div>
          </>
        ) : (
          /* Already setup: show configured status and password change option */
          <div className="mb-6">
            <div className="mb-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
              <p className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
                <Check size={16} />
                {t("settings.general.configured")}
              </p>
            </div>
            {!showPasswordChange ? (
              <button
                type="button"
                onClick={() => setShowPasswordChange(true)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                {t("settings.general.changePassword")}
              </button>
            ) : (
              <div className="space-y-3 p-4 border border-gray-200 dark:border-gray-700 rounded-md">
                <div>
                  <Label htmlFor="currentPassword">{t("settings.general.currentPassword")}</Label>
                  <input
                    type="password"
                    id="currentPassword"
                    name="currentPassword"
                    placeholder={t("settings.general.currentPassword")}
                    className={inputClass}
                  />
                </div>
                <div>
                  <Label htmlFor="newPassword">{t("settings.general.newPassword")}</Label>
                  <input
                    type="password"
                    id="newPassword"
                    name="newPassword"
                    placeholder={t("settings.general.newPassword")}
                    className={inputClass}
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">{t("settings.general.confirmPassword")}</Label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    placeholder={t("settings.general.confirmPassword")}
                    className={inputClass}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasswordChange(false)}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
          </div>
        )}

        <hr className="my-6 border-gray-200 dark:border-gray-700" />

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

        <hr className="my-6 border-gray-200 dark:border-gray-700" />

        {/* File Encryption Section */}
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
          <Lock size={16} />
          {t("settings.general.encryptionSection")}
        </h3>

        <div className="mb-4 flex items-center gap-3">
          <input
            type="checkbox"
            id="encryptChatHistory"
            name="encryptChatHistory"
            checked={encryptChatHistory}
            onChange={(e) => setEncryptChatHistory(e.target.checked)}
            className={checkboxClass}
          />
          <Label htmlFor="encryptChatHistory">{t("settings.encryption.encryptChat")}</Label>
        </div>
        <div className="mb-6 flex items-center gap-3">
          <input
            type="checkbox"
            id="encryptWorkflowHistory"
            name="encryptWorkflowHistory"
            checked={encryptWorkflowHistory}
            onChange={(e) => setEncryptWorkflowHistory(e.target.checked)}
            className={checkboxClass}
          />
          <Label htmlFor="encryptWorkflowHistory">{t("settings.encryption.encryptWorkflow")}</Label>
        </div>

        {/* Reset encryption keys */}
        {isRsaSetup && (
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
                    onClick={handleResetEncryption}
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

        <hr className="my-6 border-gray-200 dark:border-gray-700" />

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

function SyncTab({ settings: _settings }: { settings: UserSettings }) {
  const { t } = useI18n();

  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [showTempFiles, setShowTempFiles] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [untrackedFiles, setUntrackedFiles] = useState<Array<{ id: string; name: string; mimeType: string; modifiedTime: string }> | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);
  const [historyStats, setHistoryStats] = useState<Record<string, unknown> | null>(null);

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

  const handleFullPush = useCallback(async () => {
    if (!confirm(t("settings.sync.fullPushConfirm"))) return;
    setActionLoading("fullPush");
    setActionMsg(null);
    try {
      const { getLocalSyncMeta, setLocalSyncMeta, getLocallyModifiedFileIds, getCachedFile, setCachedFile, clearAllEditHistory } = await import("~/services/indexeddb-cache");
      const modifiedIds = await getLocallyModifiedFileIds();
      const localMeta = (await getLocalSyncMeta()) ?? {
        id: "current" as const,
        lastUpdatedAt: new Date().toISOString(),
        files: {} as Record<string, { md5Checksum: string; modifiedTime: string }>,
      };

      for (const fid of modifiedIds) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", fileId: fid, content: cached.content }),
        });
        if (!res.ok) throw new Error(`Failed to update file ${cached.fileName ?? fid}`);
        const data = await res.json();
        localMeta.files[fid] = { md5Checksum: data.md5Checksum, modifiedTime: data.file.modifiedTime };
        await setCachedFile({ ...cached, md5Checksum: data.md5Checksum, modifiedTime: data.file.modifiedTime, cachedAt: Date.now() });
      }

      localMeta.lastUpdatedAt = new Date().toISOString();
      await setLocalSyncMeta(localMeta);

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fullPush",
          localMeta: { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files },
        }),
      });
      if (!res.ok) throw new Error("Full push failed");

      await clearAllEditHistory();
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

  const handleRebuildTree = useCallback(async () => {
    setActionLoading("rebuildTree");
    setActionMsg(null);
    try {
      const fd = new FormData();
      fd.set("_action", "rebuildTree");
      const res = await fetch("/settings", { method: "POST", body: fd });
      const resData = await res.json();
      if (res.ok && resData.success) {
        setActionMsg(resData.message);
      } else {
        setActionMsg(resData.message || "Rebuild failed.");
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Rebuild failed.");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handlePrune = useCallback(async () => {
    setActionLoading("prune");
    setPruneMsg(null);
    try {
      const res = await fetch("/api/settings/edit-history-prune", { method: "POST" });
      const data = await res.json();
      setPruneMsg(data.message || (res.ok ? "Prune complete." : "Prune failed."));
    } catch (err) {
      setPruneMsg(err instanceof Error ? err.message : "Prune error.");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleHistoryStats = useCallback(async () => {
    setActionLoading("historyStats");
    try {
      const res = await fetch("/api/settings/edit-history-stats");
      const data = await res.json();
      setHistoryStats(data);
    } catch {
      setHistoryStats({ error: "Failed to load stats." });
    } finally {
      setActionLoading(null);
    }
  }, []);

  const actionBtnClass = "inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm disabled:opacity-50";
  const dangerBtnClass = "inline-flex items-center gap-2 px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 text-sm disabled:opacity-50";

  return (
    <div className="space-y-6">
      {/* Status message */}
      {actionMsg && (
        <div className="p-3 rounded-md border text-sm bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
          {actionMsg}
        </div>
      )}

      {/* Sync Status */}
      <SectionCard>
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw size={16} className="text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("settings.sync.status")}
          </h3>
        </div>
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
      </SectionCard>

      {/* Data Management */}
      <SectionCard>
        <div className="flex items-center gap-2 mb-4">
          <FileBox size={16} className="text-gray-600 dark:text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("settings.sync.dataManagement")}
          </h3>
        </div>
        <div className="space-y-4">
          {/* Rebuild Sync Meta */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.sync.rebuildTree")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.sync.rebuildTreeDescription")}</p>
            </div>
            <button
              type="button"
              onClick={handleRebuildTree}
              disabled={actionLoading === "rebuildTree"}
              className={actionBtnClass}
            >
              {actionLoading === "rebuildTree" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("settings.sync.rebuild")}
            </button>
          </div>
          {/* Temporary Files */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.sync.tempFiles")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.general.tempFilesDescription")}</p>
            </div>
            <button type="button" onClick={() => setShowTempFiles(true)} className={actionBtnClass}>
              <FileBox size={14} />
              {t("settings.sync.manageTempFiles")}
            </button>
          </div>
          {/* Untracked Files */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.sync.untrackedFiles")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.sync.untrackedDescription")}</p>
            </div>
            <button
              type="button"
              onClick={handleDetectUntracked}
              disabled={actionLoading === "detectUntracked"}
              className={actionBtnClass}
            >
              {actionLoading === "detectUntracked" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("settings.sync.detectUntracked")}
            </button>
          </div>
          {/* Trash */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.sync.trashTitle")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.sync.trashDescription")}</p>
            </div>
            <button type="button" onClick={() => setShowTrash(true)} className={actionBtnClass}>
              <Trash2 size={14} />
              {t("settings.sync.manage")}
            </button>
          </div>
          {/* Conflicts */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.sync.conflictsTitle")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.sync.conflictsDescription")}</p>
            </div>
            <button type="button" onClick={() => setShowConflicts(true)} className={actionBtnClass}>
              <RefreshCw size={14} />
              {t("settings.sync.manage")}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Edit History */}
      <SectionCard>
        <div className="flex items-center gap-2 mb-4">
          <Scissors size={16} className="text-gray-600 dark:text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("settings.editHistory.sectionTitle")}
          </h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.editHistory.pruneLabel")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.editHistory.pruneDescription")}</p>
            </div>
            <div className="flex items-center gap-2">
              {pruneMsg && <span className="text-xs text-gray-500 dark:text-gray-400">{pruneMsg}</span>}
              <button type="button" disabled={actionLoading === "prune"} onClick={handlePrune} className={actionBtnClass}>
                <Scissors size={14} className={actionLoading === "prune" ? "animate-pulse" : ""} />
                {t("settings.editHistory.prune")}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.editHistory.statsLabel")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.editHistory.statsDescription")}</p>
            </div>
            <button type="button" disabled={actionLoading === "historyStats"} onClick={handleHistoryStats} className={actionBtnClass}>
              {actionLoading === "historyStats" ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
              {t("settings.editHistory.stats")}
            </button>
          </div>
        </div>
        {historyStats && (
          <div className="mt-4 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/50">
            <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
              {JSON.stringify(historyStats, null, 2)}
            </pre>
          </div>
        )}
      </SectionCard>

      {/* Danger Zone */}
      <SectionCard>
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle size={16} className="text-red-600 dark:text-red-400" />
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
            {t("settings.sync.dangerZone")}
          </h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {t("settings.sync.dangerZoneDescription")}
        </p>
        <div className="space-y-4">
          {/* Full Push */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.sync.fullPush")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.sync.fullPushDescription")}</p>
            </div>
            <button type="button" onClick={handleFullPush} disabled={!!actionLoading} className={dangerBtnClass}>
              {actionLoading === "fullPush" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("settings.sync.fullPush")}
            </button>
          </div>
          {/* Full Pull */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t("settings.sync.fullPull")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.sync.fullPullDescription")}</p>
            </div>
            <button type="button" onClick={handleFullPull} disabled={!!actionLoading} className={dangerBtnClass}>
              {actionLoading === "fullPull" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("settings.sync.fullPull")}
            </button>
          </div>
        </div>
      </SectionCard>

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

      {showTrash && (
        <TrashDialog onClose={() => setShowTrash(false)} />
      )}
      {showConflicts && (
        <ConflictsDialog onClose={() => setShowConflicts(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP Servers Tab
// ---------------------------------------------------------------------------

interface McpFormEntry {
  name: string;
  url: string;
  headers: string; // JSON string
}

const emptyMcpEntry: McpFormEntry = { name: "", url: "", headers: "{}" };

// PKCE utilities for OAuth flow

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function McpTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const { t } = useI18n();

  const [servers, setServers] = useState<McpServerConfig[]>(settings.mcpServers);
  const [adding, setAdding] = useState(false);
  const [newEntry, setNewEntry] = useState<McpFormEntry>({ ...emptyMcpEntry });
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string }>>({});
  const [addTestResult, setAddTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addTesting, setAddTesting] = useState(false);

  const saveServers = useCallback((updated: McpServerConfig[]) => {
    const fd = new FormData();
    fd.set("_action", "saveMcp");
    fd.set("mcpServers", JSON.stringify(updated));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher]);

  const removeServer = useCallback((idx: number) => {
    const updated = servers.filter((_, i) => i !== idx);
    setServers(updated);
    setTestResults((prev) => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
    saveServers(updated);
  }, [servers, saveServers]);

  const startAddOAuthFlow = useCallback(async (
    oauthConfig: OAuthConfig,
  ): Promise<OAuthTokens | null> => {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);
    const redirectUri = `${window.location.origin}/auth/mcp-oauth-callback`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (oauthConfig.scopes.length > 0) {
      params.set("scope", oauthConfig.scopes.join(" "));
    }

    const authUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;

    setAddTestResult({ ok: false, msg: t("settings.mcp.oauthAuthenticating") });

    const popup = window.open(authUrl, "mcp-oauth", "width=600,height=700,popup=yes");

    return new Promise((resolve) => {
      let resolved = false;

      const onMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== "mcp-oauth-callback") return;
        if (resolved) return;
        resolved = true;
        cleanup();

        if (event.data.error) {
          setAddTestResult({
            ok: false,
            msg: t("settings.mcp.oauthFailed").replace("{{error}}", event.data.errorDescription || event.data.error),
          });
          resolve(null);
          return;
        }

        if (event.data.state !== state) {
          setAddTestResult({ ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "State mismatch") });
          resolve(null);
          return;
        }

        try {
          const tokenRes = await fetch("/api/settings/mcp-oauth-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tokenUrl: oauthConfig.tokenUrl,
              clientId: oauthConfig.clientId,
              clientSecret: oauthConfig.clientSecret,
              code: event.data.code,
              codeVerifier,
              redirectUri,
            }),
          });
          const tokenData = await tokenRes.json();
          if (!tokenRes.ok || !tokenData.tokens) {
            setAddTestResult({
              ok: false,
              msg: t("settings.mcp.oauthFailed").replace("{{error}}", tokenData.error || "Token exchange failed"),
            });
            resolve(null);
            return;
          }

          resolve(tokenData.tokens as OAuthTokens);
        } catch (err) {
          setAddTestResult({
            ok: false,
            msg: t("settings.mcp.oauthFailed").replace("{{error}}", err instanceof Error ? err.message : "Token exchange error"),
          });
          resolve(null);
        }
      };

      const onStorage = (event: StorageEvent) => {
        if (event.key !== "mcp-oauth-callback" || !event.newValue) return;
        try {
          const msg = JSON.parse(event.newValue);
          if (msg.type === "mcp-oauth-callback") {
            onMessage({ data: msg, origin: window.location.origin } as MessageEvent);
          }
        } catch { /* ignore parse errors */ }
      };

      window.addEventListener("message", onMessage);
      window.addEventListener("storage", onStorage);

      const checkClosedInterval = setInterval(() => {
        if (popup && popup.closed && !resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, 500);

      function cleanup() {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("storage", onStorage);
        clearInterval(checkClosedInterval);
      }
    });
  }, [t]);

  const testAndAddServer = useCallback(async () => {
    if (!newEntry.name.trim() || !newEntry.url.trim()) return;
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(newEntry.headers);
    } catch {
      // ignore parse error, use empty
    }

    setAddTesting(true);
    setAddTestResult({ ok: false, msg: "Testing..." });

    try {
      const res = await fetch("/api/settings/mcp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newEntry.url.trim(), headers }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const newServer: McpServerConfig = {
          name: newEntry.name.trim(),
          url: newEntry.url.trim(),
          headers,
          tools: data.tools as McpToolInfo[],
        };
        const updated = [...servers, newServer];
        setServers(updated);
        saveServers(updated);
        setNewEntry({ ...emptyMcpEntry });
        setAdding(false);
        setAddTestResult(null);
      } else if (data.needsOAuth && data.oauthDiscovery) {
        // Server requires OAuth — start OAuth flow for the new server
        const oauthConfig: OAuthConfig = data.oauthDiscovery.config;

        if (!oauthConfig.clientId) {
          setAddTestResult({ ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "No client ID (registration failed)") });
          return;
        }

        const tokens = await startAddOAuthFlow(oauthConfig);
        if (!tokens) return;

        setAddTestResult({ ok: false, msg: t("settings.mcp.oauthSuccess") + " Retesting..." });
        // Retry test with new tokens
        const retryRes = await fetch("/api/settings/mcp-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: newEntry.url.trim(),
            headers,
            oauth: oauthConfig,
            oauthTokens: tokens,
          }),
        });
        const retryData = await retryRes.json();

        if (retryRes.ok && retryData.success) {
          const newServer: McpServerConfig = {
            name: newEntry.name.trim(),
            url: newEntry.url.trim(),
            headers,
            tools: retryData.tools as McpToolInfo[],
            oauth: oauthConfig,
            oauthTokens: tokens,
          };
          const updated = [...servers, newServer];
          setServers(updated);
          saveServers(updated);
          setNewEntry({ ...emptyMcpEntry });
          setAdding(false);
          setAddTestResult(null);
        } else {
          setAddTestResult({ ok: false, msg: retryData.message || "Connection failed after OAuth" });
        }
      } else {
        setAddTestResult({ ok: false, msg: data.message || "Connection failed" });
      }
    } catch (err) {
      setAddTestResult({ ok: false, msg: err instanceof Error ? err.message : "Network error" });
    } finally {
      setAddTesting(false);
    }
  }, [newEntry, servers, saveServers, startAddOAuthFlow, t]);

  const startOAuthFlow = useCallback(async (
    idx: number,
    oauthConfig: OAuthConfig,
  ): Promise<OAuthTokens | null> => {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);
    const redirectUri = `${window.location.origin}/auth/mcp-oauth-callback`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (oauthConfig.scopes.length > 0) {
      params.set("scope", oauthConfig.scopes.join(" "));
    }

    const authUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;

    setTestResults((prev) => ({
      ...prev,
      [idx]: { ok: false, msg: t("settings.mcp.oauthAuthenticating") },
    }));

    const popup = window.open(authUrl, "mcp-oauth", "width=600,height=700,popup=yes");

    return new Promise((resolve) => {
      let resolved = false;

      const onMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== "mcp-oauth-callback") return;
        if (resolved) return;
        resolved = true;
        cleanup();

        if (event.data.error) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: {
              ok: false,
              msg: t("settings.mcp.oauthFailed").replace("{{error}}", event.data.errorDescription || event.data.error),
            },
          }));
          resolve(null);
          return;
        }

        if (event.data.state !== state) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: { ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "State mismatch") },
          }));
          resolve(null);
          return;
        }

        try {
          const tokenRes = await fetch("/api/settings/mcp-oauth-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tokenUrl: oauthConfig.tokenUrl,
              clientId: oauthConfig.clientId,
              clientSecret: oauthConfig.clientSecret,
              code: event.data.code,
              codeVerifier,
              redirectUri,
            }),
          });
          const tokenData = await tokenRes.json();

          if (!tokenRes.ok || !tokenData.tokens) {
            setTestResults((prev) => ({
              ...prev,
              [idx]: {
                ok: false,
                msg: t("settings.mcp.oauthFailed").replace("{{error}}", tokenData.error || "Token exchange failed"),
              },
            }));
            resolve(null);
            return;
          }

          resolve(tokenData.tokens as OAuthTokens);
        } catch (err) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: {
              ok: false,
              msg: t("settings.mcp.oauthFailed").replace("{{error}}", err instanceof Error ? err.message : "Token exchange error"),
            },
          }));
          resolve(null);
        }
      };

      const onStorage = (event: StorageEvent) => {
        if (event.key !== "mcp-oauth-callback" || !event.newValue) return;
        try {
          const msg = JSON.parse(event.newValue);
          if (msg.type === "mcp-oauth-callback") {
            onMessage({ data: msg, origin: window.location.origin } as MessageEvent);
          }
        } catch { /* ignore parse errors */ }
      };

      window.addEventListener("message", onMessage);
      window.addEventListener("storage", onStorage);

      const checkClosedInterval = setInterval(() => {
        if (popup && popup.closed && !resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, 500);

      function cleanup() {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("storage", onStorage);
        clearInterval(checkClosedInterval);
      }
    });
  }, [t]);

  const testConnection = useCallback(async (idx: number) => {
    const server = servers[idx];
    if (!server) return;
    setTestResults((prev) => ({ ...prev, [idx]: { ok: false, msg: "Testing..." } }));
    try {
      const res = await fetch("/api/settings/mcp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: server.url,
          headers: server.headers,
          oauth: server.oauth,
          oauthTokens: server.oauthTokens,
        }),
      });
      const data = await res.json();

      // Handle refreshed tokens from server
      if (data.tokens) {
        const updated = servers.map((s, i) => i === idx ? { ...s, oauthTokens: data.tokens } : s);
        setServers(updated);
        saveServers(updated);
      }

      // Handle OAuth requirement
      if (data.needsOAuth && data.oauthDiscovery) {
        const oauthConfig: OAuthConfig = data.oauthDiscovery.config;

        if (!oauthConfig.clientId) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: { ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "No client ID (registration failed)") },
          }));
          return;
        }

        // Start OAuth popup flow
        const tokens = await startOAuthFlow(idx, oauthConfig);
        if (!tokens) return;

        // Store oauth config and tokens on the server entry
        const oauthUpdated = servers.map((s, i) =>
          i === idx ? { ...s, oauth: oauthConfig, oauthTokens: tokens } : s
        );
        setServers(oauthUpdated);
        saveServers(oauthUpdated);

        setTestResults((prev) => ({
          ...prev,
          [idx]: { ok: false, msg: t("settings.mcp.oauthSuccess") + " Retesting..." },
        }));

        // Retry test with the new tokens
        const retryRes = await fetch("/api/settings/mcp-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: server.url,
            headers: server.headers,
            oauth: oauthConfig,
            oauthTokens: tokens,
          }),
        });
        const retryData = await retryRes.json();

        setTestResults((prev) => ({
          ...prev,
          [idx]: { ok: retryRes.ok, msg: retryData.message || (retryRes.ok ? "Connected" : "Failed") },
        }));

        if (retryRes.ok && retryData.tools) {
          const retryUpdated = oauthUpdated.map((s, i) => i === idx ? { ...s, tools: retryData.tools as McpToolInfo[] } : s);
          setServers(retryUpdated);
          saveServers(retryUpdated);
        }
        return;
      }

      setTestResults((prev) => ({
        ...prev,
        [idx]: { ok: res.ok, msg: data.message || (res.ok ? "Connected" : "Failed") },
      }));
      if (res.ok && data.tools) {
        const updated = servers.map((s, i) => i === idx ? { ...s, tools: data.tools as McpToolInfo[] } : s);
        setServers(updated);
        saveServers(updated);
      } else if (!res.ok) {
        setServers((prev) => prev.map((s, i) => i === idx ? { ...s, tools: undefined } : s));
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [idx]: { ok: false, msg: err instanceof Error ? err.message : "Network error" },
      }));
      setServers((prev) => prev.map((s, i) => i === idx ? { ...s, tools: undefined } : s));
    }
  }, [servers, startOAuthFlow, saveServers, t]);

  const reauthorize = useCallback(async (idx: number) => {
    const server = servers[idx];
    if (!server?.oauth) return;

    const tokens = await startOAuthFlow(idx, server.oauth);
    if (!tokens) return;

    const updated = servers.map((s, i) =>
      i === idx ? { ...s, oauthTokens: tokens } : s
    );
    setServers(updated);
    saveServers(updated);
    setTestResults((prev) => ({
      ...prev,
      [idx]: { ok: true, msg: t("settings.mcp.oauthSuccess") },
    }));
  }, [servers, startOAuthFlow, saveServers, t]);

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
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {server.name}
                </p>
                {server.oauthTokens && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                    <ShieldCheck size={10} />
                    {t("settings.mcp.oauthAuthenticated")}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{server.url}</p>
              {server.tools && server.tools.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate" title={server.tools.map(t => t.name).join(", ")}>
                  {t("settings.mcp.tools").replace("{{tools}}", server.tools.map(t => t.name).join(", "))}
                </p>
              )}
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
            <div className="flex items-center gap-1">
              {server.oauthTokens && (
                <button
                  type="button"
                  onClick={() => reauthorize(idx)}
                  className="p-1.5 text-gray-500 hover:text-orange-600 dark:hover:text-orange-400"
                  title={t("settings.mcp.oauthReauthorize")}
                >
                  <KeyRound size={16} />
                </button>
              )}
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
          {addTestResult && (
            <p
              className={`text-xs ${
                addTestResult.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {addTestResult.msg}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={testAndAddServer}
              disabled={addTesting || !newEntry.name.trim() || !newEntry.url.trim()}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {addTesting ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
              {t("settings.mcp.testAndAdd")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewEntry({ ...emptyMcpEntry });
                setAddTestResult(null);
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
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 text-sm"
        >
          <Plus size={16} />
          {t("settings.mcp.addServer")}
        </button>
      )}

    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// RAG Tab
// ---------------------------------------------------------------------------

function RagTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const settingsFetcher = useFetcher();
  const { t } = useI18n();

  const [ragTopK, setRagTopK] = useState(settings.ragTopK);
  const [ragSettings, setRagSettings] = useState<Record<string, RagSetting>>(settings.ragSettings);
  const [selectedRagSetting, setSelectedRagSetting] = useState<string | null>(
    settings.ragSettings[DEFAULT_RAG_STORE_KEY] ? DEFAULT_RAG_STORE_KEY : settings.selectedRagSetting
  );
  const [syncing, setSyncing] = useState(false);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [copiedStoreId, setCopiedStoreId] = useState<string | null>(null);
  const [editingTopK, setEditingTopK] = useState(false);
  const [topKDraft, setTopKDraft] = useState(settings.ragTopK);
  const [showAutoRagModal, setShowAutoRagModal] = useState(false);

  const settingNames = Object.keys(ragSettings).sort((a, b) => {
    if (a === DEFAULT_RAG_STORE_KEY) return -1;
    if (b === DEFAULT_RAG_STORE_KEY) return 1;
    return a.localeCompare(b);
  });

  const saveRagSettings = useCallback((overrides?: {
    ragSettings?: Record<string, RagSetting>;
    selectedRagSetting?: string | null;
    ragTopK?: number;
  }) => {
    const rs = overrides?.ragSettings ?? ragSettings;
    const sel = overrides?.selectedRagSetting !== undefined ? overrides.selectedRagSetting : selectedRagSetting;
    const topK = overrides?.ragTopK ?? ragTopK;
    const hasGemihub = !!rs[DEFAULT_RAG_STORE_KEY];
    const hasSettings = Object.keys(rs).length > 0;
    const fd = new FormData();
    fd.set("_action", "saveRag");
    fd.set("ragEnabled", hasSettings ? "on" : "off");
    fd.set("ragTopK", String(topK));
    fd.set("ragSettings", JSON.stringify(rs));
    fd.set("selectedRagSetting", sel || "");
    fd.set("ragRegistrationOnPush", hasGemihub ? "on" : "off");
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, ragTopK, ragSettings, selectedRagSetting]);

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
    setEditingKey(name);
    // Start rename immediately so user can type a proper name
    setRenamingKey(name);
    setRenameValue(name);
  }, [ragSettings, settingNames]);

  const removeRagSetting = useCallback(
    (name: string) => {
      const newSettings: Record<string, RagSetting> = {};
      for (const [k, v] of Object.entries(ragSettings)) {
        if (k !== name) newSettings[k] = v;
      }
      setRagSettings(newSettings);
      let newSelected = selectedRagSetting;
      if (selectedRagSetting === name) {
        const remaining = settingNames.filter((n) => n !== name);
        newSelected = remaining.length > 0 ? remaining[0] : null;
        setSelectedRagSetting(newSelected);
      }
      if (editingKey === name) setEditingKey(null);
      if (renamingKey === name) setRenamingKey(null);
      saveRagSettings({ ragSettings: newSettings, selectedRagSetting: newSelected });
    },
    [selectedRagSetting, settingNames, renamingKey, editingKey, ragSettings, saveRagSettings]
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
    const newSettings: Record<string, RagSetting> = {};
    for (const [k, v] of Object.entries(ragSettings)) {
      newSettings[k === renamingKey ? newName : k] = v;
    }
    setRagSettings(newSettings);
    const newSelected = selectedRagSetting === renamingKey ? newName : selectedRagSetting;
    if (selectedRagSetting === renamingKey) setSelectedRagSetting(newName);
    if (editingKey === renamingKey) setEditingKey(newName);
    setRenamingKey(null);
    saveRagSettings({ ragSettings: newSettings, selectedRagSetting: newSelected });
  }, [renamingKey, renameValue, ragSettings, selectedRagSetting, editingKey, saveRagSettings]);

  const updateCurrentSettingByKey = useCallback(
    (key: string, patch: Partial<RagSetting>) => {
      setRagSettings((prev) => ({
        ...prev,
        [key]: { ...prev[key], ...patch },
      }));
    },
    []
  );

  const handleSyncByKey = useCallback(async (key: string, settingsOverride?: Record<string, RagSetting>) => {
    const rs = settingsOverride ?? ragSettings;
    if (!rs[key]) return;
    setSyncing(true);
    setSyncingKey(key);
    setSyncMsg(null);
    try {
      const hasGemihub = !!rs[DEFAULT_RAG_STORE_KEY];
      const hasSettings = Object.keys(rs).length > 0;
      const fd = new FormData();
      fd.set("_action", "saveRag");
      fd.set("ragEnabled", hasSettings ? "on" : "off");
      fd.set("ragTopK", String(ragTopK));
      fd.set("ragSettings", JSON.stringify(rs));
      fd.set("selectedRagSetting", key);
      fd.set("ragRegistrationOnPush", hasGemihub ? "on" : "off");
      const saveRes = await fetch("/settings", { method: "POST", body: fd });
      if (!saveRes.ok) {
        setSyncMsg("Failed to save settings before sync.");
        return;
      }

      const res = await fetch("/api/settings/rag-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragSettingName: key }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSyncMsg(data.error || "Sync failed.");
        return;
      }

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
            // skip
          }
        }
      }
      // Re-fetch settings to get updated file statuses
      settingsFetcher.load("/settings");
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : "Sync error.");
    } finally {
      setSyncing(false);
    }
  }, [ragSettings, ragTopK, settingsFetcher]);

  useEffect(() => {
    const d = settingsFetcher.data as { settings?: UserSettings } | undefined;
    if (d?.settings?.ragSettings) {
      setRagSettings(d.settings.ragSettings);
    }
  }, [settingsFetcher.data]);

  const [ragFilesDialogKey, setRagFilesDialogKey] = useState<string | null>(null);

  const getFileCounts = useCallback((key: string) => {
    const s = ragSettings[key];
    if (!s) return { total: 0, registered: 0, pending: 0 };
    const files = Object.values(s.files ?? {});
    const total = files.length;
    const registered = files.filter((f) => f.status === "registered").length;
    return { total, registered, pending: total - registered };
  }, [ragSettings]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Search tip */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
        <Search size={14} className="mt-0.5 flex-shrink-0" />
        <span>{t("settings.rag.searchTip")}</span>
      </div>

      {/* Auto RAG Registration button (only when gemihub setting doesn't exist) */}
      {!ragSettings[DEFAULT_RAG_STORE_KEY] && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowAutoRagModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            <Database size={16} />
            {t("settings.rag.enableAutoRag")}
          </button>
        </div>
      )}

      {/* Auto RAG Modal */}
      {showAutoRagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAutoRagModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("settings.rag.autoRagModalTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowAutoRagModal(false)}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t("settings.rag.autoRagModalExcludeNote")}
            </p>

            <div className="space-y-3">
              {/* All files option */}
              <button
                type="button"
                onClick={() => {
                  const newSettings = { ...ragSettings, [DEFAULT_RAG_STORE_KEY]: { ...DEFAULT_RAG_SETTING } };
                  setRagSettings(newSettings);
                  setSelectedRagSetting(DEFAULT_RAG_STORE_KEY);
                  setShowAutoRagModal(false);
                  handleSyncByKey(DEFAULT_RAG_STORE_KEY, newSettings);
                }}
                className="w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {t("settings.rag.autoRagAllFiles")}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("settings.rag.autoRagAllFilesDescription")}
                </p>
              </button>

              {/* Customize option */}
              <button
                type="button"
                onClick={() => {
                  const newSettings = { ...ragSettings, [DEFAULT_RAG_STORE_KEY]: { ...DEFAULT_RAG_SETTING } };
                  setRagSettings(newSettings);
                  setSelectedRagSetting(DEFAULT_RAG_STORE_KEY);
                  saveRagSettings({ ragSettings: newSettings, selectedRagSetting: DEFAULT_RAG_STORE_KEY });
                  setEditingKey(DEFAULT_RAG_STORE_KEY);
                  setShowAutoRagModal(false);
                }}
                className="w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {t("settings.rag.autoRagCustomize")}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("settings.rag.autoRagCustomizeDescription")}
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top-K inline edit */}
      <div className="mb-6">
        {editingTopK ? (
          <div className="flex items-center gap-2">
            <Label>{t("settings.rag.topK")}:</Label>
            <input
              type="number"
              min={1}
              max={20}
              value={topKDraft}
              onChange={(e) => setTopKDraft(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
              className={inputClass + " max-w-[80px]"}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setRagTopK(topKDraft);
                  saveRagSettings({ ragTopK: topKDraft });
                  setEditingTopK(false);
                }
                if (e.key === "Escape") setEditingTopK(false);
              }}
            />
            <button
              type="button"
              onClick={() => {
                setRagTopK(topKDraft);
                saveRagSettings({ ragTopK: topKDraft });
                setEditingTopK(false);
              }}
              className="p-1 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
              title="Apply"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={() => setEditingTopK(false)}
              className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Cancel"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("settings.rag.topK")}: <span className="font-medium">{ragTopK}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setTopKDraft(ragTopK);
                  setEditingTopK(true);
                }}
                className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Edit"
              >
                <Pencil size={14} />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t("settings.rag.topKDescription")}
            </p>
          </div>
        )}
      </div>

      {/* RAG settings list */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <Label>{t("settings.rag.settings")}</Label>
          <button
            type="button"
            onClick={addRagSetting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            <Plus size={14} />
            Add Setting
          </button>
        </div>

        {settingNames.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">No RAG settings configured.</p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-md divide-y divide-gray-200 dark:divide-gray-700">
            {settingNames.map((name) => {
              const s = ragSettings[name];
              const isEditing = editingKey === name;
              const isSelected = selectedRagSetting === name;
              return (
                <div key={name}>
                  {/* Row */}
                  <div
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    }`}
                    onClick={() => setSelectedRagSetting(name)}
                  >
                    {/* Name */}
                    <div className="flex-1 min-w-0">
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
                          className="bg-transparent border border-blue-400 rounded px-1.5 py-0.5 outline-none text-sm w-full max-w-[200px] focus:ring-1 focus:ring-blue-500 dark:text-gray-100"
                          autoFocus
                        />
                      ) : (
                        <span
                          className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate block"
                          onDoubleClick={(e) => {
                            if (name === DEFAULT_RAG_STORE_KEY) return;
                            e.stopPropagation();
                            setRenamingKey(name);
                            setRenameValue(name);
                          }}
                        >
                          {name}
                        </span>
                      )}
                      {s.storeId && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-gray-400 font-mono truncate">{s.storeId}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(s.storeId!);
                              setCopiedStoreId(s.storeId!);
                              setTimeout(() => setCopiedStoreId(null), 1500);
                            }}
                            className="shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                            title="Copy Store ID"
                          >
                            {copiedStoreId === s.storeId ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-gray-400" />}
                          </button>
                        </div>
                      )}
                      {(() => {
                        const counts = getFileCounts(name);
                        if (counts.total === 0) return null;
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRagFilesDialogKey(name);
                            }}
                            className="text-xs mt-0.5 font-medium block text-left hover:underline cursor-pointer"
                          >
                            <span className="text-gray-600 dark:text-gray-300">
                              {t("settings.rag.fileCount").replace("{registered}", String(counts.registered)).replace("{total}", String(counts.total))}
                            </span>
                            {counts.pending > 0 && (
                              <span className="text-amber-600 dark:text-amber-400 ml-1">
                                {t("settings.rag.fileCountPending").replace("{count}", String(counts.pending))}
                              </span>
                            )}
                          </button>
                        );
                      })()}
                    </div>

                    {/* Auto badge for gemihub setting */}
                    {name === DEFAULT_RAG_STORE_KEY && (
                      <span className="shrink-0 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                        {t("settings.rag.autoLabel")}
                      </span>
                    )}

                    {/* Sync button */}
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRagSetting(name);
                        handleSyncByKey(name);
                      }}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-xs disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={syncing && syncingKey === name ? "animate-spin" : ""} />
                      Sync
                    </button>

                    {/* Edit (pencil) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRagSetting(name);
                        setEditingKey(isEditing ? null : name);
                      }}
                      className={`shrink-0 p-1.5 rounded ${
                        isEditing
                          ? "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30"
                          : "text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingKey === name) setEditingKey(null);
                        removeRagSetting(name);
                      }}
                      className="shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Expanded editor */}
                  {isEditing && (
                    <div className="px-4 py-4 bg-gray-50 dark:bg-gray-800/50 space-y-4 border-t border-gray-200 dark:border-gray-700">
                      <div>
                        <Label htmlFor={`rag-targetFolders-${name}`}>Target Folders (one per line, name or ID)</Label>
                        <textarea
                          id={`rag-targetFolders-${name}`}
                          rows={3}
                          value={s.targetFolders.join("\n")}
                          onChange={(e) =>
                            updateCurrentSettingByKey(name, {
                              targetFolders: e.target.value.split("\n"),
                            })
                          }
                          onBlur={(e) =>
                            updateCurrentSettingByKey(name, {
                              targetFolders: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean),
                            })
                          }
                          className={inputClass + " font-mono resize-y"}
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Folder names (e.g. <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">workflows</code>) or Drive folder IDs. Leave empty to use the root folder.
                        </p>
                      </div>
                      <div>
                        <Label htmlFor={`rag-excludePatterns-${name}`}>Exclude Patterns (one per line, regex)</Label>
                        <textarea
                          id={`rag-excludePatterns-${name}`}
                          rows={2}
                          value={s.excludePatterns.join("\n")}
                          onChange={(e) =>
                            updateCurrentSettingByKey(name, {
                              excludePatterns: e.target.value.split("\n"),
                            })
                          }
                          onBlur={(e) =>
                            updateCurrentSettingByKey(name, {
                              excludePatterns: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean),
                            })
                          }
                          className={inputClass + " font-mono resize-y"}
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t("settings.rag.excludePatternHint")}
                        </p>
                      </div>

                      {/* Apply & Sync */}
                      <button
                        type="button"
                        disabled={syncing}
                        onClick={() => handleSyncByKey(name)}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={syncing && syncingKey === name ? "animate-spin" : ""} />
                        {t("settings.rag.applyAndSync")}
                      </button>

                      {/* Sync message */}
                      {syncMsg && syncingKey === name && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{syncMsg}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Register & Sync button for new internal settings */}
        {selectedRagSetting && ragSettings[selectedRagSetting] && !ragSettings[selectedRagSetting].storeId && !ragSettings[selectedRagSetting].isExternal && (
          <div className="mt-3">
            <button
              type="button"
              disabled={syncing}
              onClick={() => handleSyncByKey(selectedRagSetting)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-50"
            >
              <FileBox size={14} className={syncing && syncingKey === selectedRagSetting ? "animate-spin" : ""} />
              {t("settings.rag.registerAndSync")}
            </button>
          </div>
        )}
      </div>

      {/* RAG Files Dialog */}
      {ragFilesDialogKey && ragSettings[ragFilesDialogKey] && (
        <RagFilesDialog
          settingName={ragFilesDialogKey}
          files={ragSettings[ragFilesDialogKey].files}
          onClose={() => setRagFilesDialogKey(null)}
        />
      )}
    </SectionCard>
  );
}
