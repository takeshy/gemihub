import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Lock, Unlock, Loader2, ShieldOff } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { EncryptionSettings } from "~/types/settings";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import {
  decryptData,
  decryptFileContent,
  decryptPrivateKey,
  decryptWithPrivateKey,
  encryptFileContent,
  isEncryptedFile,
  unwrapEncryptedFile,
} from "~/services/crypto-core";
import { cryptoCache } from "~/services/crypto-cache";
import { deleteCachedFile } from "~/services/indexeddb-cache";
import { TempDiffModal } from "./TempDiffModal";
import { EditorToolbarActions } from "./EditorToolbarActions";
import { unescapeMarkdown } from "wysimark-lite";

interface EncryptedFileViewerProps {
  fileId: string;
  fileName: string;
  encryptedContent: string;
  encryptionSettings: EncryptionSettings;
  saveToCache: (content: string) => Promise<void>;
  forceRefresh: () => Promise<void>;
  onHistoryClick?: () => void;
}

export function EncryptedFileViewer({
  fileId,
  fileName,
  encryptedContent,
  encryptionSettings,
  saveToCache,
  forceRefresh,
  onHistoryClick,
}: EncryptedFileViewerProps) {
  const { t } = useI18n();
  const { setActiveFileContent, setActiveFileName, setActiveSelection } = useEditorContext();

  // Is the raw content actually encrypted, or plain text with .encrypted extension?
  const contentIsEncrypted = isEncryptedFile(encryptedContent);

  const [password, setPassword] = useState("");
  // If content is plain text, skip password — go straight to editor
  const [decryptedContent, setDecryptedContent] = useState<string | null>(
    contentIsEncrypted ? null : unescapeMarkdown(encryptedContent)
  );
  const [editedContent, setEditedContent] = useState(
    contentIsEncrypted ? "" : unescapeMarkdown(encryptedContent)
  );
  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [decryptingPermanent, setDecryptingPermanent] = useState(false);
  const [showDecryptConfirm, setShowDecryptConfirm] = useState(false);
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

  // Auto-save: debounced re-encrypt + saveToCache (5s to account for encryption cost)
  const autoSaveDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingContentRef = useRef<string | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  // Reset state when file or content changes
  useEffect(() => {
    if (prevFileIdRef.current !== fileId || prevContentRef.current !== encryptedContent) {
      const encrypted = isEncryptedFile(encryptedContent);
      setDecryptedContent(encrypted ? null : unescapeMarkdown(encryptedContent));
      setEditedContent(encrypted ? "" : unescapeMarkdown(encryptedContent));
      setError(null);
      setPassword("");
      setShowDecryptConfirm(false);
      if (prevFileIdRef.current !== fileId) {
        refreshedRef.current = false;
      }
      prevFileIdRef.current = fileId;
      prevContentRef.current = encryptedContent;
    }
  }, [fileId, encryptedContent]);

  // Stale cache detection → force refresh from Drive
  // .encrypted extension but plain content means encrypt ran but cache is stale
  // (no .encrypted extension with encrypted content is normal — content-based detection)
  useEffect(() => {
    const stale = fileName.endsWith(".encrypted") && !contentIsEncrypted;
    if (stale && !refreshedRef.current) {
      refreshedRef.current = true;
      forceRefresh();
    }
  }, [fileName, contentIsEncrypted, forceRefresh]);

  // Auto-decrypt if private key or password is cached and content is encrypted
  useEffect(() => {
    if (decryptedContent !== null) return;
    if (!isEncryptedFile(encryptedContent)) return;
    const cachedKey = cryptoCache.getPrivateKey();
    const cachedPw = cryptoCache.getPassword();
    if (!cachedKey && !cachedPw) return;

    let cancelled = false;
    setDecrypting(true);
    setError(null);

    const doDecrypt = cachedKey
      ? decryptWithPrivateKey(encryptedContent, cachedKey)
      : decryptFileContent(encryptedContent, cachedPw!);

    doDecrypt
      .then((plain) => {
        if (cancelled) return;
        const unescaped = unescapeMarkdown(plain);
        setDecryptedContent(unescaped);
        setEditedContent(unescaped);
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

  // Detect binary content (BINARY:{mimeType}\n{base64data})
  const binaryInfo = useMemo(() => {
    if (!decryptedContent || !decryptedContent.startsWith("BINARY:")) return null;
    const newlineIdx = decryptedContent.indexOf("\n");
    if (newlineIdx === -1) return null;
    return {
      mimeType: decryptedContent.slice(7, newlineIdx),
      base64Data: decryptedContent.slice(newlineIdx + 1),
    };
  }, [decryptedContent]);

  // Create blob URL for binary content
  const blobUrlRef = useRef<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (!binaryInfo) {
      setBlobUrl(null);
      return;
    }
    const byteString = atob(binaryInfo.base64Data);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: binaryInfo.mimeType });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    setBlobUrl(url);
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [binaryInfo]);

  // Push decrypted content to EditorContext (text files only)
  useEffect(() => {
    if (decryptedContent !== null && !binaryInfo) {
      setActiveFileContent(editedContent);
      setActiveFileName(fileName);
      setActiveSelection(null);
    }
  }, [editedContent, fileName, decryptedContent, binaryInfo, setActiveFileContent, setActiveFileName, setActiveSelection]);

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
      const pk = await decryptPrivateKey(parsed.key, parsed.salt, password);
      cryptoCache.setPassword(password);
      cryptoCache.setPrivateKey(pk);
      const plain = await decryptData(parsed.data, pk);
      const unescaped = unescapeMarkdown(plain);
      setDecryptedContent(unescaped);
      setEditedContent(unescaped);
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

  // Auto-save: re-encrypt and save to cache on content change.
  // Uses a Promise chain to serialize saves and prevent out-of-order writes.
  const doAutoSave = useCallback((plaintext: string) => {
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        const reEncrypted = await encryptFileContent(
          plaintext,
          encryptionSettings.publicKey,
          encryptionSettings.encryptedPrivateKey,
          encryptionSettings.salt
        );
        await saveToCache(reEncrypted);
        prevContentRef.current = reEncrypted;
      } catch (e) {
        console.error("[EncryptedFileViewer] auto-save encrypt failed:", e);
      }
    });
  }, [encryptionSettings, saveToCache]);

  // Debounced auto-save effect (only for decrypted text content, not binary)
  useEffect(() => {
    if (decryptedContent === null || binaryInfo) return;
    // Skip if content matches the initial decrypted value (no user edits yet)
    if (editedContent === decryptedContent) return;

    pendingContentRef.current = editedContent;
    if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current);
    const delay = fileId.startsWith("new:") ? 1000 : 5000;
    autoSaveDebounceRef.current = setTimeout(() => {
      doAutoSave(editedContent);
      pendingContentRef.current = null;
    }, delay);
    return () => {
      if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current);
    };
  }, [editedContent, decryptedContent, binaryInfo, fileId, doAutoSave]);

  // Flush pending auto-save on unmount or fileId change
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current);
        doAutoSave(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [doAutoSave]);

  const flushOnBlur = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current);
      doAutoSave(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [doAutoSave]);

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
      // Update ref so the reset effect doesn't fire when parent re-renders with new encrypted content
      prevContentRef.current = reEncrypted;
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
      let tempPlain = payload.content;
      if (isEncryptedFile(payload.content)) {
        const pk = cryptoCache.getPrivateKey();
        const pw = cryptoCache.getPassword();
        try {
          tempPlain = pk
            ? await decryptWithPrivateKey(payload.content, pk)
            : pw
              ? await decryptFileContent(payload.content, pw)
              : (() => { throw new Error("no key"); })();
        } catch {
          alert(t("crypt.wrongPassword"));
          return;
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
      // Update cache: for text save plaintext, for binary delete stale cache (MediaViewer will re-fetch)
      if (editedContent.startsWith("BINARY:")) {
        await deleteCachedFile(fileId);
      } else {
        await saveToCache(editedContent);
      }
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

  // ---------- Decrypted binary media viewer ----------
  if (binaryInfo) {
    const mime = binaryInfo.mimeType;
    return (
      <div className="relative flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        {/* Toolbar */}
        <div className="flex items-center justify-end px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setShowDecryptConfirm(true)}
              disabled={decryptingPermanent}
              className="flex items-center gap-1 px-2 py-1 text-xs text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-600 rounded hover:bg-orange-50 dark:hover:bg-orange-900/30 disabled:opacity-50"
              title={t("crypt.decrypt")}
            >
              {decryptingPermanent ? <Loader2 size={ICON.SM} className="animate-spin" /> : <ShieldOff size={ICON.SM} />}
              <span className="hidden sm:inline">{t("crypt.decrypt")}</span>
            </button>
          </div>
        </div>

        {showDecryptConfirm && (
          <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={() => setShowDecryptConfirm(false)}>
            <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                {t("crypt.decryptConfirm")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDecryptConfirm(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {t("fileTree.cancel")}
                </button>
                <button
                  onClick={() => { setShowDecryptConfirm(false); handlePermanentDecrypt(); }}
                  className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
                >
                  {t("common.ok")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Media content */}
        {blobUrl ? (
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            {mime.startsWith("image/") && (
              <img src={blobUrl} alt={fileName} className="max-w-full max-h-full object-contain" />
            )}
            {mime.startsWith("video/") && (
              <video src={blobUrl} controls className="max-w-full max-h-full" />
            )}
            {mime.startsWith("audio/") && (
              <audio src={blobUrl} controls />
            )}
            {mime === "application/pdf" && (
              <iframe src={blobUrl} className="w-full h-full border-0" title={fileName} />
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        )}
      </div>
    );
  }

  // ---------- Decrypted / plain-text editor UI ----------
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" onBlur={flushOnBlur}>
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
      <div className="flex items-center justify-end px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-1 sm:gap-2">
          <EditorToolbarActions
            onHistoryClick={onHistoryClick}
            onTempUpload={handleTempUpload}
            onTempDownload={handleTempDownload}
            uploading={uploading}
          />
          <button
            onClick={() => setShowDecryptConfirm(true)}
            disabled={uploading || decryptingPermanent}
            className="flex items-center gap-1 px-2 py-1 text-xs text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-600 rounded hover:bg-orange-50 dark:hover:bg-orange-900/30 disabled:opacity-50"
            title={t("crypt.decrypt")}
          >
            {decryptingPermanent ? <Loader2 size={ICON.SM} className="animate-spin" /> : <ShieldOff size={ICON.SM} />}
            <span className="hidden sm:inline">{t("crypt.decrypt")}</span>
          </button>
        </div>
      </div>

      {showDecryptConfirm && (
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={() => setShowDecryptConfirm(false)}>
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              {t("crypt.decryptConfirm")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDecryptConfirm(false)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {t("fileTree.cancel")}
              </button>
              <button
                onClick={() => { setShowDecryptConfirm(false); handlePermanentDecrypt(); }}
                className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
              >
                {t("common.ok")}
              </button>
            </div>
          </div>
        </div>
      )}

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
