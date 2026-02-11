import { useState, useEffect, useCallback, useRef } from "react";
import { Lock, Unlock, Loader2, Upload, Download, ShieldOff } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { EncryptionSettings } from "~/types/settings";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import {
  decryptFileContent,
  decryptPrivateKey,
  encryptFileContent,
  isEncryptedFile,
  unwrapEncryptedFile,
} from "~/services/crypto-core";
import { cryptoCache } from "~/services/crypto-cache";
import { TempDiffModal } from "./TempDiffModal";

interface EncryptedFileViewerProps {
  fileId: string;
  fileName: string;
  encryptedContent: string;
  encryptionSettings: EncryptionSettings;
  saveToCache: (content: string) => Promise<void>;
  forceRefresh: () => Promise<void>;
}

export function EncryptedFileViewer({
  fileId,
  fileName,
  encryptedContent,
  encryptionSettings,
  saveToCache,
  forceRefresh,
}: EncryptedFileViewerProps) {
  const { t } = useI18n();
  const { setActiveFileContent, setActiveFileName, setActiveSelection } = useEditorContext();

  // Is the raw content actually encrypted, or plain text with .encrypted extension?
  const contentIsEncrypted = isEncryptedFile(encryptedContent);

  const [password, setPassword] = useState("");
  // If content is plain text, skip password — go straight to editor
  const [decryptedContent, setDecryptedContent] = useState<string | null>(
    contentIsEncrypted ? null : encryptedContent
  );
  const [editedContent, setEditedContent] = useState(
    contentIsEncrypted ? "" : encryptedContent
  );
  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [decryptingPermanent, setDecryptingPermanent] = useState(false);
  const [tempDiffData, setTempDiffData] = useState<{
    fileName: string;
    fileId: string;
    currentContent: string;
    tempContent: string;
    tempSavedAt: string;
    currentModifiedTime: string;
    isBinary: boolean;
  } | null>(null);

  const prevFileIdRef = useRef(fileId);
  const prevContentRef = useRef(encryptedContent);
  const refreshedRef = useRef(false);

  // Reset state when file or content changes
  useEffect(() => {
    if (prevFileIdRef.current !== fileId || prevContentRef.current !== encryptedContent) {
      const encrypted = isEncryptedFile(encryptedContent);
      setDecryptedContent(encrypted ? null : encryptedContent);
      setEditedContent(encrypted ? "" : encryptedContent);
      setError(null);
      setPassword("");
      if (prevFileIdRef.current !== fileId) {
        refreshedRef.current = false;
      }
      prevFileIdRef.current = fileId;
      prevContentRef.current = encryptedContent;
    }
  }, [fileId, encryptedContent]);

  // Stale cache detection → force refresh from Drive
  // Case 1: .encrypted extension but plain content (encrypt ran, cache stale)
  // Case 2: no .encrypted extension but encrypted content (decrypt ran, cache stale)
  useEffect(() => {
    const stale =
      (fileName.endsWith(".encrypted") && !contentIsEncrypted) ||
      (!fileName.endsWith(".encrypted") && contentIsEncrypted);
    if (stale && !refreshedRef.current) {
      refreshedRef.current = true;
      forceRefresh();
    }
  }, [fileName, contentIsEncrypted, forceRefresh]);

  // Auto-decrypt if password is cached and content is encrypted
  useEffect(() => {
    if (decryptedContent !== null) return;
    if (!isEncryptedFile(encryptedContent)) return;
    const cached = cryptoCache.getPassword();
    if (!cached) return;

    let cancelled = false;
    setDecrypting(true);
    setError(null);

    decryptFileContent(encryptedContent, cached)
      .then((plain) => {
        if (cancelled) return;
        setDecryptedContent(plain);
        setEditedContent(plain);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[EncryptedFileViewer] auto-decrypt failed:", e);
        cryptoCache.clear();
      })
      .finally(() => {
        if (!cancelled) setDecrypting(false);
      });

    return () => { cancelled = true; };
  }, [encryptedContent, fileId, decryptedContent]);

  // Push decrypted content to EditorContext
  useEffect(() => {
    if (decryptedContent !== null) {
      setActiveFileContent(editedContent);
      setActiveFileName(fileName);
      setActiveSelection(null);
    }
  }, [editedContent, fileName, decryptedContent, setActiveFileContent, setActiveFileName, setActiveSelection]);

  const handleUnlock = useCallback(async () => {
    if (!password) return;
    setDecrypting(true);
    setError(null);
    try {
      const parsed = unwrapEncryptedFile(encryptedContent);
      if (!parsed) {
        setError(t("crypt.wrongPassword"));
        return;
      }
      const plain = await decryptFileContent(encryptedContent, password);
      cryptoCache.setPassword(password);
      const pk = await decryptPrivateKey(parsed.key, parsed.salt, password);
      cryptoCache.setPrivateKey(pk);
      setDecryptedContent(plain);
      setEditedContent(plain);
    } catch (e) {
      console.error("[EncryptedFileViewer] decrypt failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      setError(`${t("crypt.wrongPassword")} (${msg})`);
    } finally {
      setDecrypting(false);
    }
  }, [password, encryptedContent, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleUnlock();
    },
    [handleUnlock]
  );

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      setActiveSelection(
        sel ? { text: sel, start: ta.selectionStart, end: ta.selectionEnd } : null
      );
    },
    [setActiveSelection]
  );

  // Encrypt and upload — does NOT require password (only publicKey from settings)
  const handleTempUpload = useCallback(async () => {
    setUploading(true);
    try {
      const reEncrypted = await encryptFileContent(
        editedContent,
        encryptionSettings.publicKey,
        encryptionSettings.encryptedPrivateKey,
        encryptionSettings.salt
      );
      await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", fileName, fileId, content: reEncrypted }),
      });
      await saveToCache(reEncrypted);
      // Go back to password screen (lock the file)
      setDecryptedContent(null);
      setEditedContent("");
      setPassword("");
    } finally {
      setUploading(false);
    }
  }, [editedContent, fileName, fileId, encryptionSettings, saveToCache]);

  const handleTempDownload = useCallback(async () => {
    try {
      const res = await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", fileName }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.found) {
        alert(t("contextMenu.noTempFile"));
        return;
      }
      const { payload } = data.tempFile;
      // Decrypt the temp content for diff
      const pw = cryptoCache.getPassword();
      let tempPlain = payload.content;
      if (pw && isEncryptedFile(payload.content)) {
        try {
          tempPlain = await decryptFileContent(payload.content, pw);
        } catch {
          // If decryption fails, show raw
        }
      }
      setTempDiffData({
        fileName,
        fileId,
        currentContent: editedContent,
        tempContent: tempPlain,
        tempSavedAt: payload.savedAt,
        currentModifiedTime: "",
        isBinary: false,
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, editedContent, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    setEditedContent(tempDiffData.tempContent);
    // Re-encrypt and save to cache
    const reEncrypted = await encryptFileContent(
      tempDiffData.tempContent,
      encryptionSettings.publicKey,
      encryptionSettings.encryptedPrivateKey,
      encryptionSettings.salt
    );
    await saveToCache(reEncrypted);
    setTempDiffData(null);
  }, [tempDiffData, encryptionSettings, saveToCache]);

  // Permanently decrypt: send plaintext to server, remove .encrypted extension
  const handlePermanentDecrypt = useCallback(async () => {
    if (!confirm(t("crypt.decryptConfirm"))) return;
    setDecryptingPermanent(true);
    try {
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decrypt", fileId, content: editedContent }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        if (res.status === 409 && errData?.error === "duplicate") {
          alert(t("crypt.decryptDuplicate").replace("{name}", errData.name));
        } else {
          alert(t("crypt.decryptFailed"));
        }
        return;
      }
      const data = await res.json();
      const newName = data.file?.name as string | undefined;
      // Update cache with plaintext
      await saveToCache(editedContent);
      // Dispatch event so tree and _index update
      window.dispatchEvent(
        new CustomEvent("file-decrypted", {
          detail: { fileId, newName, meta: data.meta },
        })
      );
    } catch {
      alert(t("crypt.decryptFailed"));
    } finally {
      setDecryptingPermanent(false);
    }
  }, [fileId, editedContent, saveToCache, t]);

  // ---------- Password input UI (only for actually encrypted content) ----------
  if (decryptedContent === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-full max-w-sm mx-auto p-6">
          <div className="flex flex-col items-center gap-4">
            <Lock size={48} className="text-gray-400 dark:text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              {t("crypt.enterPassword")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              {t("crypt.enterPasswordDesc")}
            </p>

            <div className="w-full space-y-3">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={t("crypt.passwordPlaceholder")}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
                disabled={decrypting}
              />

              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}

              <button
                onClick={handleUnlock}
                disabled={!password || decrypting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {decrypting ? (
                  <>
                    <Loader2 size={ICON.MD} className="animate-spin" />
                    {t("crypt.decrypting")}
                  </>
                ) : (
                  <>
                    <Unlock size={ICON.MD} />
                    {t("crypt.unlock")}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Decrypted / plain-text editor UI ----------
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Loading overlay during encryption/upload */}
      {uploading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 dark:bg-gray-950/70">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={32} className="animate-spin text-blue-600" />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {t("crypt.encrypting")}
            </span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <button
          onClick={handleTempUpload}
          disabled={uploading}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          title={t("contextMenu.tempUpload")}
        >
          <Upload size={ICON.SM} />
          {t("contextMenu.tempUpload")}
        </button>
        <button
          onClick={handleTempDownload}
          disabled={uploading}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          title={t("contextMenu.tempDownload")}
        >
          <Download size={ICON.SM} />
          {t("contextMenu.tempDownload")}
        </button>
        <button
          onClick={handlePermanentDecrypt}
          disabled={uploading || decryptingPermanent}
          className="flex items-center gap-1 px-2 py-1 text-xs text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-600 rounded hover:bg-orange-50 dark:hover:bg-orange-900/30 disabled:opacity-50"
          title={t("crypt.decrypt")}
        >
          {decryptingPermanent ? <Loader2 size={ICON.SM} className="animate-spin" /> : <ShieldOff size={ICON.SM} />}
          {t("crypt.decrypt")}
        </button>
      </div>

      {/* Text editor */}
      <div className="flex-1 p-4">
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          onSelect={handleSelect}
          className="w-full h-full font-mono text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
          spellCheck={false}
          disabled={uploading}
        />
      </div>

      {tempDiffData && (
        <TempDiffModal
          fileName={tempDiffData.fileName}
          currentContent={tempDiffData.currentContent}
          tempContent={tempDiffData.tempContent}
          tempSavedAt={tempDiffData.tempSavedAt}
          currentModifiedTime={tempDiffData.currentModifiedTime}
          isBinary={tempDiffData.isBinary}
          onAccept={handleTempDiffAccept}
          onReject={() => setTempDiffData(null)}
        />
      )}
    </div>
  );
}
