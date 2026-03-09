import { useState, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import { KeyRound, Lock, Check } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { invalidateIndexCache } from "~/routes/_index";
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

export function GeneralTab({
  settings,
  hasApiKey,
  maskedKey,
  onLanguageChange,
}: {
  settings: UserSettings;
  hasApiKey: boolean;
  maskedKey: string | null;
  onLanguageChange: (lang: Language) => void;
}) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t, language } = useI18n();

  const [apiPlan, setApiPlan] = useState<ApiPlan>(settings.apiPlan);
  const [selectedModel, setSelectedModel] = useState<ModelType | "">(
    settings.selectedModel || ""
  );
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [skillsFolderName, setSkillsFolderName] = useState(settings.skillsFolderName || "skills");
  const [showManagementFolders, setShowManagementFolders] = useState(settings.showManagementFolders ?? false);
  const [fontSize, setFontSize] = useState<FontSize>(settings.fontSize);
  const [theme, setTheme] = useState<Theme>(settings.theme || "system");
  const availableModels = getAvailableModels(apiPlan);

  // Sensitive field state (controlled to survive re-renders after fetcher submission)
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Encryption state
  const [encryptChatHistory, setEncryptChatHistory] = useState(settings.encryption.encryptChatHistory);
  const [encryptWorkflowHistory, setEncryptWorkflowHistory] = useState(settings.encryption.encryptWorkflowHistory);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEncryptionSetup = !!settings.encryptedApiKey;
  const isRsaSetup = settings.encryption.enabled && !!settings.encryption.publicKey;

  // When plan changes, reset model if it's not available
  useEffect(() => {
    if (selectedModel && !isModelAllowedForPlan(apiPlan, selectedModel as ModelType)) {
      setSelectedModel(getDefaultModelForPlan(apiPlan));
    }
  }, [apiPlan, selectedModel]);

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

  const handleResetEncryption = useCallback(() => {
    // Reset encryption by submitting with cleared values
    const fd = new FormData();
    fd.set("_action", "saveEncryptionReset");
    fetcher.submit(fd, { method: "post" });
    setConfirmReset(false);
  }, [fetcher]);

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

        {/* API Key & Password Section */}
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
          <KeyRound size={16} />
          {t("settings.general.apiKeyPasswordSection")}
        </h3>
        {!isEncryptionSetup && (
          <p className="text-xs text-red-500 dark:text-red-400 mb-3">
            <span className="text-red-500">*</span> {t("settings.general.required")}
          </p>
        )}

        {/* API Key */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="geminiApiKey">
              {t("settings.general.apiKey")}
              {!isEncryptionSetup && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("settings.general.apiKeyGetLink")} ↗
            </a>
          </div>
          {hasApiKey && (
            <p className="text-xs text-green-600 dark:text-green-400 mb-1">
              Current key: <code className="font-mono">{maskedKey}</code>
            </p>
          )}
          <input
            type="password"
            id="geminiApiKey"
            name="geminiApiKey"
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            placeholder={hasApiKey ? t("settings.general.apiKeyKeep") : t("settings.general.apiKeyPlaceholder")}
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
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <input
                type="password"
                id="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

        {/* Skills Folder */}
        <div className="mb-6">
          <Label htmlFor="skillsFolderName">{t("settings.general.skillsFolder")}</Label>
          <input
            type="text"
            id="skillsFolderName"
            name="skillsFolderName"
            value={skillsFolderName}
            onChange={(e) => setSkillsFolderName(e.target.value)}
            placeholder="skills"
            className={inputClass + " max-w-[300px]"}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.general.skillsFolderDescription")}
          </p>
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
    </SectionCard>
  );
}
