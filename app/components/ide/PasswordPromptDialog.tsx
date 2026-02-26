import { useState, useCallback } from "react";
import { Lock, Loader2, AlertCircle } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { invalidateIndexCache, getCachedLoaderDataInMemory } from "~/routes/_index";
import { setCachedApiKey } from "~/services/api-key-cache";
import { decryptPrivateKey } from "~/services/crypto-core";
import { getCachedLoaderData } from "~/services/indexeddb-cache";

interface PasswordPromptDialogProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function PasswordPromptDialog({ onSuccess, onClose }: PasswordPromptDialogProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!password) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(t("unlock.error"));
        return;
      }
      invalidateIndexCache();
      // Decrypt and cache the API key client-side for local chat execution
      try {
        let settings: { encryptedApiKey?: string; apiKeySalt?: string } | undefined =
          getCachedLoaderDataInMemory()?.settings;
        if (!settings) {
          const cached = await getCachedLoaderData();
          settings = cached?.settings as { encryptedApiKey?: string; apiKeySalt?: string } | undefined;
        }
        if (settings?.encryptedApiKey && settings?.apiKeySalt) {
          const apiKey = await decryptPrivateKey(settings.encryptedApiKey, settings.apiKeySalt, password);
          setCachedApiKey(apiKey);
        }
      } catch { /* fallback: server will handle */ }
      onSuccess();
    } catch {
      setError(t("unlock.error"));
    } finally {
      setLoading(false);
    }
  }, [password, t, onSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={20} className="text-blue-600 dark:text-blue-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("unlock.title")}
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t("unlock.description")}
        </p>

        {error && (
          <div className="mb-3 p-2 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={t("unlock.title")}
          autoFocus
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm mb-4"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !password}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
            {t("unlock.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
