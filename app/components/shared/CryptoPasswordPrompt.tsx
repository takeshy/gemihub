import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { decryptPrivateKey } from "~/services/crypto-core";
import { cryptoCache } from "~/services/crypto-cache";
import { useI18n } from "~/i18n/context";

interface CryptoPasswordPromptProps {
  encryptedPrivateKey: string;
  salt: string;
  onUnlock: (privateKey: string) => void;
  onCancel: () => void;
}

export function CryptoPasswordPrompt({
  encryptedPrivateKey,
  salt,
  onUnlock,
  onCancel,
}: CryptoPasswordPromptProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const handleSubmit = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const privateKey = await decryptPrivateKey(encryptedPrivateKey, salt, password);
      cryptoCache.setPassword(password);
      cryptoCache.setPrivateKey(privateKey);
      onUnlock(privateKey);
    } catch {
      setError(t("crypt.wrongPassword"));
    } finally {
      setLoading(false);
    }
  }, [password, encryptedPrivateKey, salt, onUnlock, t]);

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !loading && onCancel()}
    >
      <div
        className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          {t("crypt.enterPassword")}
        </h3>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          placeholder={t("crypt.passwordPlaceholder")}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          autoFocus
          disabled={loading}
        />
        {error && (
          <p className="text-xs text-red-500 mt-1">{error}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!password || loading}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
          >
            {loading && <Loader2 size={ICON.SM} className="animate-spin" />}
            {loading ? t("crypt.decrypting") : t("crypt.unlock")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}
