import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { KeyRound, Lock, Check, Zap } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { invalidateIndexCache } from "~/utils/index-cache";
import {
  SectionCard,
  Label,
  SaveButton,
  NotifyDialog,
  inputClass,
  checkboxClass,
} from "~/components/settings/shared";
import type {
  UserSettings,
  ApiPlan,
  ModelType,
  Language,
  FontSize,
  Theme,
} from "~/types/settings";
import {
  getAvailableModels,
  getDefaultModelForPlan,
  isModelAllowedForPlan,
  SUPPORTED_LANGUAGES,
  FONT_SIZE_OPTIONS,
  THEME_OPTIONS,
} from "~/types/settings";
import { THIRD_PARTY_NOTICES } from "~/third-party-notices";
import {
  VERTEX_TOPUP_UNIT_CHOICES,
  VERTEX_TOPUP_UNIT_JPY,
  VERTEX_TOPUP_UNIT_USD,
} from "~/types/hubwork";
import { hasVertexPrice } from "~/services/ai/models";


export function GeneralTab({
  settings,
  hasApiKey,
  maskedKey,
  onLanguageChange,
  hideGeminiSettings = false,
}: {
  settings: UserSettings;
  hasApiKey: boolean;
  maskedKey: string | null;
  onLanguageChange: (lang: Language) => void;
  hideGeminiSettings?: boolean;
}) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t, language } = useI18n();

  const [apiPlan, setApiPlan] = useState<ApiPlan>(settings.apiPlan);
  const [selectedModel, setSelectedModel] = useState<ModelType | "">(
    settings.selectedModel || ""
  );
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [showManagementFolders, setShowManagementFolders] = useState(settings.showManagementFolders ?? false);
  const [dashboardEnabled, setDashboardEnabled] = useState(settings.dashboardEnabled ?? false);
  const [workflowEnabled, setWorkflowEnabled] = useState(settings.workflowEnabled ?? false);
  const [ragFeatureEnabled, setRagFeatureEnabled] = useState(settings.ragFeatureEnabled ?? false);
  const [webpageBuilderEnabled, setWebpageBuilderEnabled] = useState(settings.webpageBuilderEnabled ?? false);
  const [usePersonalVertex, setUsePersonalVertex] = useState(settings.usePersonalVertex ?? false);
  const [personalBalance, setPersonalBalance] = useState<number | null>(null);
  // null until the balance endpoint answers; false on a self-hosted install
  // with no Firestore, where there is no prepaid balance to sell or spend.
  const [vertexAvailable, setVertexAvailable] = useState<boolean | null>(null);
  const [topupHistory, setTopupHistory] = useState<Array<{ id: string; usd: number; createdAt: number }> | null>(null);
  const [fontSize, setFontSize] = useState<FontSize>(settings.fontSize);
  const [theme, setTheme] = useState<Theme>(settings.theme || "system");
  const availableModels = getAvailableModels(apiPlan);
  // Personal Vertex has neither Gemini File Search (that needs the user's own
  // API key) nor a project vector index, so RAG cannot work there. A disabled
  // checkbox submits nothing, which is exactly the "off" we want persisted.
  // Only on the Drive mount: an org project's chat also runs on Vertex, but
  // there RAG is the Firestore vector index and works fine.
  const ragBlockedByVertex = !hideGeminiSettings && usePersonalVertex;

  // Top-ups are sold in the currency of the UI language, so the amount is one
  // choice instead of two.
  const topUpCurrency = language === "ja" ? "jpy" : "usd";
  const formatTopUpAmount = (units: number) =>
    topUpCurrency === "jpy"
      ? `+¥${(units * VERTEX_TOPUP_UNIT_JPY).toLocaleString("ja-JP")}`
      : `+$${units * VERTEX_TOPUP_UNIT_USD}`;

  // Personal Vertex spends a prepaid balance, so it can only offer models the
  // usage recorder knows a price for.
  const vertexModels = availableModels.filter((model) => hasVertexPrice(model.name));

  // Sensitive field state (controlled to survive re-renders after fetcher submission)
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [apiKeyEdited, setApiKeyEdited] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Encryption state
  const [encryptChatHistory, setEncryptChatHistory] = useState(settings.encryption.encryptChatHistory);
  const [encryptWorkflowHistory, setEncryptWorkflowHistory] = useState(settings.encryption.encryptWorkflowHistory);
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // An encrypted key is stored in settings.json. NOT the same as `hasApiKey`,
  // which is the loader's view of the DECRYPTED key in this session — that one
  // is empty until the user unlocks, and on any new session. Mixing the two
  // made the panel claim "API Key & Encryption configured" while the field
  // below invited the user to enter a key they had already saved.
  const hasStoredApiKey = !!settings.encryptedApiKey;
  const isEncryptionSetup = hasStoredApiKey;

  // AI provider sub-tab. The balance arrives after mount, so it cannot take
  // part in the initial value — only the saved opt-in can.
  const hasVertexBalance = personalBalance != null && personalBalance > 0;
  const [aiTab, setAiTab] = useState<"apikey" | "vertex">(
    settings.usePersonalVertex === true ? "vertex" : "apikey",
  );


  // When plan changes, reset model if it's not available
  useEffect(() => {
    if (selectedModel && !isModelAllowedForPlan(apiPlan, selectedModel as ModelType)) {
      setSelectedModel(getDefaultModelForPlan(apiPlan));
    }
  }, [apiPlan, selectedModel]);

  // Load personal Vertex balance and history (always, so the sub-tab can
  // show data even before the user switches to it)
  useEffect(() => {
    fetch("/api/personal-vertex/balance")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) { setVertexAvailable(false); return; }
        setVertexAvailable(data.available !== false);
        if (data.balanceUsd != null) setPersonalBalance(data.balanceUsd);
        // Nothing here can run on Vertex, so do not leave the user parked on
        // a tab whose only outcome is a failing chat.
        if (data.available === false) { setAiTab("apikey"); setUsePersonalVertex(false); }
      })
      .catch(() => setVertexAvailable(false));
    fetch("/api/personal-vertex/history")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.events) setTopupHistory(data.events); })
      .catch(() => {});
  }, []);

  // Show error dialog, reload confirm (API key change), or success banner.
  // Use a ref for `t` so the effect only re-runs when fetcher.data changes,
  // preventing stale error data from being reprocessed when `t` updates.
  const tRef = useRef(t);
  tRef.current = t;
  const fetcherData = fetcher.data as { success?: boolean; message?: string; apiKeyUpdated?: boolean } | undefined;
  useEffect(() => {
    if (!fetcherData) return;
    if (fetcherData.success) {
      // Clear sensitive fields on success
      setGeminiApiKey("");
      setApiKeyEdited(false);
      setPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      setNewPassword("");
      invalidateIndexCache();
      if (fetcherData.apiKeyUpdated) {
        window.location.href = "/";
      }
    } else if (fetcherData.message) {
      const key = `settings.general.${fetcherData.message}` as Parameters<typeof t>[0];
      const translated = tRef.current(key);
      setErrorMessage(translated !== key ? translated : fetcherData.message);
    }
  }, [fetcherData]);


  return (
    <SectionCard>
      {/* Success banner (non-API-key saves only; API key saves redirect) */}
      {fetcherData?.success && !fetcherData.apiKeyUpdated && (
        <div className="mb-6 p-3 rounded-md border text-sm bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300">
          <div className="flex items-center gap-2">
            <Check size={16} />
            {t("settings.general.generalSaved")}
          </div>
        </div>
      )}

      {/* Error dialog (modal) */}
      {errorMessage && (
        <NotifyDialog message={errorMessage} variant="error" onClose={() => setErrorMessage(null)} />
      )}

      <fetcher.Form method="post">
        <input type="hidden" name="_action" value="saveGeneral" />
        <input type="hidden" name="apiKeyEdited" value={apiKeyEdited ? "true" : "false"} />

        {!hideGeminiSettings && <>
        {/* AI Provider Sub-Tabs */}
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <KeyRound size={16} />
          {t("settings.general.aiProvider")}
        </h3>
        <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => { setAiTab("apikey"); setUsePersonalVertex(false); }}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${aiTab === "apikey" ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}
          >
            {t("settings.general.tabApikey")}
          </button>
          {vertexAvailable !== false && (
            <button
              type="button"
              onClick={() => { setAiTab("vertex"); setUsePersonalVertex(true); }}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${aiTab === "vertex" ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}
            >
              <Zap size={12} className="inline mr-1" />
              {t("settings.general.tabVertex")}
              {hasVertexBalance && personalBalance != null && (
                <span className="ml-1 text-xs text-gray-400">${personalBalance.toFixed(2)}</span>
              )}
            </button>
          )}
        </div>
        <input type="hidden" name="usePersonalVertex" value={usePersonalVertex ? "on" : ""} />

        {aiTab === "apikey" && <>
        {!isEncryptionSetup && (
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.general.apiKeyOptional")}
          </p>
        )}

        {/* API Key */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="geminiApiKey">{t("settings.general.apiKey")}</Label>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("settings.general.apiKeyGetLink")} ↗
            </a>
          </div>
          {hasApiKey ? (
            <p className="text-xs text-green-600 dark:text-green-400 mb-1">
              Current key: <code className="font-mono">{maskedKey}</code>
            </p>
          ) : hasStoredApiKey ? (
            /* Saved but not unlocked in this session, so there is no masked
               value to show — say it is saved rather than looking empty. */
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t("settings.general.apiKeySavedLocked")}
            </p>
          ) : null}
          <input
            type="password"
            id="geminiApiKey"
            name="geminiApiKey"
            value={geminiApiKey}
            onChange={(e) => {
              setGeminiApiKey(e.target.value);
              setApiKeyEdited(true);
            }}
            autoComplete="off"
            placeholder={hasStoredApiKey ? t("settings.general.apiKeyKeep") : t("settings.general.apiKeyPlaceholder")}
            className={inputClass}
          />
        </div>

        {/* Password fields */}
        {!isEncryptionSetup ? (
          /* Initial setup: password + confirm */
          <>
            <div className="mb-4">
              <Label htmlFor="password">
                {t("settings.general.password")}
                {geminiApiKey && <span className="text-red-500 ml-1">*</span>}
              </Label>
              <input
                type="password"
                id="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={t("settings.general.password")}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings.general.passwordRequired")}
              </p>
            </div>
            <div className="mb-6">
              <Label htmlFor="confirmPassword">
                {t("settings.general.confirmPassword")}
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={t("settings.general.confirmPassword")}
                className={inputClass}
              />
            </div>
          </>
        ) : (
          /* Already setup: show configured status, current password, and password change option */
          <div className="mb-6">
            <div className="mb-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
              <p className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
                <Check size={16} />
                {t("settings.general.configured")}
              </p>
            </div>
            <div className="mb-4">
              <Label htmlFor="currentPassword">{t("settings.general.currentPassword")}</Label>
              <input
                type="password"
                id="currentPassword"
                name="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={t("settings.general.currentPassword")}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings.general.currentPasswordRequired")}
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
                  <Label htmlFor="newPassword">{t("settings.general.newPassword")}</Label>
                  <input
                    type="password"
                    id="newPassword"
                    name="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
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
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={t("settings.general.confirmPassword")}
                    className={inputClass}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordChange(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
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
        </>}

        {aiTab === "vertex" && (
          <div className="mb-6">
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.general.enableVertexAiDescription")}
            </p>
            {/* Model — the API key tab's selector is unmounted here, and the
                model decides how fast the prepaid balance drains, so the
                choice has to be reachable from this tab too. Only models the
                budget can be charged for are offered. */}
            <div className="mb-4">
              <Label htmlFor="vertexSelectedModel">{t("settings.general.defaultModel")}</Label>
              <select
                id="vertexSelectedModel"
                name="selectedModel"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as ModelType)}
                className={inputClass}
              >
                <option value="">{t("settings.general.usePlanDefault")} ({getDefaultModelForPlan(apiPlan)})</option>
                {vertexModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.displayName} -- {m.description}
                  </option>
                ))}
              </select>
            </div>
            {/* Balance */}
            <div className="mb-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("settings.general.vertexBalance")}</span>
                <span className={`text-lg font-bold ${hasVertexBalance ? "text-gray-900 dark:text-gray-100" : "text-red-600 dark:text-red-400"}`}>
                  {personalBalance == null
                    ? "—"
                    : personalBalance < 0
                      ? `-$${Math.abs(personalBalance).toFixed(2)}`
                      : `$${personalBalance.toFixed(2)}`}
                </span>
              </div>
              {!hasVertexBalance && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {t("settings.general.vertexBalanceEmpty")}
                </p>
              )}
            </div>
            {/* Top-up form — one amount dropdown. The currency follows the UI
                language rather than asking, which made a two-dropdown form out
                of a single choice. */}
            <form method="POST" action="/hubwork/api/stripe/checkout" className="mb-4 flex flex-wrap items-center gap-2">
              <input type="hidden" name="plan" value="personal-vertex-topup" />
              <input type="hidden" name="currency" value={topUpCurrency} />
              <select name="units" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="1">
                {VERTEX_TOPUP_UNIT_CHOICES.map((n) => (
                  <option key={n} value={n}>{formatTopUpAmount(n)}</option>
                ))}
              </select>
              <button type="submit" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                {t("settings.general.buyVertexCredit")}
              </button>
            </form>
            {/* Purchase history */}
            {topupHistory && topupHistory.length > 0 && (
              <details className="rounded-lg border border-gray-200 dark:border-gray-700">
                <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                  {t("settings.general.purchaseHistory")}
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="p-2">{t("settings.general.historyDate")}</th>
                        <th className="p-2">{t("settings.general.historyAmount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topupHistory.map((event) => (
                        <tr key={event.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="p-2 text-gray-600 dark:text-gray-400">
                            {new Date(event.createdAt).toLocaleString(language === "ja" ? "ja-JP" : "en-US")}
                          </td>
                          <td className="p-2 font-medium">+${event.usd.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}

        {aiTab === "vertex" && (
          <hr className="my-6 border-gray-200 dark:border-gray-700" />
        )}
        </>}

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

        {/* Show management folders */}
        <div className="mb-6 flex items-center gap-3">
          <input
            type="checkbox"
            id="showManagementFolders"
            name="showManagementFolders"
            checked={showManagementFolders}
            onChange={(e) => setShowManagementFolders(e.target.checked)}
            className={checkboxClass}
          />
          <div>
            <Label htmlFor="showManagementFolders">{t("settings.general.showManagementFolders")}</Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings.general.showManagementFoldersDescription")}
            </p>
          </div>
        </div>

        {/* Optional advanced features */}
        <div className="mb-6 rounded-md border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("settings.general.advancedFeatures")}
          </h3>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.general.advancedFeaturesDescription")}
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="dashboardEnabled"
                name="dashboardEnabled"
                checked={dashboardEnabled}
                onChange={(e) => setDashboardEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="dashboardEnabled">{t("settings.general.enableDashboard")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.general.enableDashboardDescription")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="workflowEnabled"
                name="workflowEnabled"
                checked={workflowEnabled}
                onChange={(e) => setWorkflowEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="workflowEnabled">{t("settings.general.enableWorkflow")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.general.enableWorkflowDescription")}
                </p>
              </div>
            </div>
            <div className={`flex items-center gap-3 ${ragBlockedByVertex ? "opacity-60" : ""}`}>
              <input
                type="checkbox"
                id="ragFeatureEnabled"
                name="ragFeatureEnabled"
                checked={ragBlockedByVertex ? false : ragFeatureEnabled}
                disabled={ragBlockedByVertex}
                onChange={(e) => setRagFeatureEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="ragFeatureEnabled">{t("settings.general.enableRag")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {ragBlockedByVertex
                    ? t("settings.general.ragUnavailableOnVertex")
                    : t("settings.general.enableRagDescription")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="webpageBuilderEnabled"
                name="webpageBuilderEnabled"
                checked={webpageBuilderEnabled}
                onChange={(e) => setWebpageBuilderEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="webpageBuilderEnabled">{t("settings.general.enableWebpageBuilder")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.general.enableWebpageBuilderDescription")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <hr className="my-6 border-gray-200 dark:border-gray-700" />
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

        <hr className="my-6 border-gray-200 dark:border-gray-700" />

        {/* Language */}
        <div className="mb-6">
          <Label htmlFor="language">{t("settings.general.language")}</Label>
          <select
            id="language"
            name="language"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as Language)}
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
      <details className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800 dark:text-gray-200">
          {language === "ja" ? "第三者ライセンス通知" : "Third-party notices"}
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          {THIRD_PARTY_NOTICES}
        </pre>
      </details>
    </SectionCard>
  );
}
