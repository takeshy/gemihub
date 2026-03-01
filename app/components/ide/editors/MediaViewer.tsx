import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { getCachedFile, setCachedFile, getLocalSyncMeta, setLocalSyncMeta, getCachedRemoteMeta, setCachedRemoteMeta } from "~/services/indexeddb-cache";
import { applyBinaryTempFile, isImageFileName } from "~/services/sync-client-utils";
import { performTempUpload } from "~/services/temp-upload";
import { useTempEditConfirm } from "~/hooks/useTempEditConfirm";
import { TempEditUrlDialog } from "~/components/shared/TempEditUrlDialog";
import { guessMimeType, bytesToBase64, base64ToBytes } from "~/utils/media-utils";

export function MediaViewer({ fileId, fileName, mediaType, fileMimeType }: { fileId: string; fileName: string; mediaType: "pdf" | "video" | "audio" | "image"; fileMimeType: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const tempEditConfirm = useTempEditConfirm();
  const [tempPreview, setTempPreview] = useState<{ content: string; savedAt: string } | null>(null);
  const [tempPreviewUrl, setTempPreviewUrl] = useState<string | null>(null);

  // Cleanup temp preview blob URL on unmount
  useEffect(() => {
    return () => {
      setTempPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  useEffect(() => {
    // Revoke previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setSrc(null);
    setError(null);

    let cancelled = false;
    (async () => {
      const cached = await getCachedFile(fileId);
      if (cancelled) return;

      // Helper: create blob URL from bytes and set as src
      const showBlob = (buf: ArrayBuffer) => {
        const mime = fileMimeType || guessMimeType(fileName);
        const blob = new Blob([buf], { type: mime });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrlRef.current = url;
        setSrc(url);
      };

      if (cached?.encoding === "base64" && cached.content) {
        showBlob(base64ToBytes(cached.content).buffer as ArrayBuffer);
      } else {
        // Fetch binary and cache to IndexedDB for offline use
        try {
          const res = await fetch(`/api/drive/files?action=raw&fileId=${fileId}`);
          if (cancelled) return;
          if (!res.ok) {
            setError(t("mainViewer.loadError"));
            return;
          }
          const arrayBuffer = await res.arrayBuffer();
          if (cancelled) return;
          const bytes = new Uint8Array(arrayBuffer);
          // Cache in IndexedDB for offline use
          await setCachedFile({
            fileId,
            content: bytesToBase64(bytes),
            md5Checksum: "",
            modifiedTime: new Date().toISOString(),
            cachedAt: Date.now(),
            fileName,
            encoding: "base64",
          });
          if (cancelled) return;
          window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId } }));
          showBlob(arrayBuffer);
        } catch {
          // Network error (offline) - no cache available
          setError(t("mainViewer.offlineNoCache"));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, fileName, fileMimeType, t]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  const handleTempUpload = useCallback(async () => {
    try {
      const cached = await getCachedFile(fileId);
      const content = cached?.content ?? "";
      const feedback = await performTempUpload({ fileName, fileId, content, t, confirm: tempEditConfirm.confirm, onStart: () => setUploading(true) });
      alert(feedback);
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }, [fileName, fileId, t, tempEditConfirm.confirm]);

  const [downloading, setDownloading] = useState(false);

  const handleTempDownload = useCallback(async () => {
    setDownloading(true);
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

      // Build blob URL for image preview synchronously before setting state
      let previewUrl: string | null = null;
      if (isImageFileName(fileName) && payload.content) {
        try {
          const byteString = atob(payload.content);
          const bytes = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i);
          }
          const mime = fileMimeType || guessMimeType(fileName);
          const blob = new Blob([bytes], { type: mime });
          previewUrl = URL.createObjectURL(blob);
        } catch {
          // ignore decode errors
        }
      }
      // Revoke previous preview URL if any (guard against strict mode double-invoke)
      setTempPreviewUrl((prev) => {
        if (prev && prev !== previewUrl) URL.revokeObjectURL(prev);
        return previewUrl;
      });
      setTempPreview({ content: payload.content, savedAt: payload.savedAt });
    } catch { /* ignore */ }
    finally { setDownloading(false); }
  }, [fileName, fileMimeType, t]);

  const closeTempPreview = useCallback(() => {
    setTempPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setTempPreview(null);
  }, []);

  const handleTempPreviewAccept = useCallback(async () => {
    if (!tempPreview) return;
    try {
      const localMeta = await getLocalSyncMeta();
      const remoteMeta = await getCachedRemoteMeta();
      const ok = await applyBinaryTempFile(fileId, tempPreview.content, fileName, localMeta, remoteMeta);
      if (!ok) return;
      if (localMeta) await setLocalSyncMeta(localMeta);
      if (remoteMeta) await setCachedRemoteMeta(remoteMeta);
      closeTempPreview();
      window.location.reload();
    } catch { /* ignore */ }
  }, [tempPreview, fileId, fileName, closeTempPreview]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">
          {fileName}
        </span>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={handleTempUpload}
            disabled={uploading || !src}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            title={t("contextMenu.tempUpload")}
          >
            {t("contextMenu.tempUpload")}
          </button>
          <button
            onClick={handleTempDownload}
            disabled={downloading}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            title={t("contextMenu.tempDownload")}
          >
            {t("contextMenu.tempDownload")}
          </button>
        </div>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      ) : src === null ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {mediaType === "pdf" && (
            <iframe src={src} className="flex-1 w-full border-0" title={fileName} />
          )}
          {mediaType === "video" && (
            <div className="flex-1 flex items-center justify-center p-4">
              <video src={src} controls className="max-w-full max-h-full" />
            </div>
          )}
          {mediaType === "audio" && (
            <div className="flex-1 flex items-center justify-center p-4">
              <audio src={src} controls />
            </div>
          )}
          {mediaType === "image" && (
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
              <img src={src} alt={fileName} className="max-w-full max-h-full object-contain" />
            </div>
          )}
        </>
      )}

      {tempEditConfirm.visible && (
        <TempEditUrlDialog t={t} onYes={tempEditConfirm.onYes} onNo={tempEditConfirm.onNo} />
      )}

      {/* Binary temp file preview modal */}
      {tempPreview && createPortal(
        <div className="fixed inset-0 z-[60] flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900 flex flex-col">
            {/* Header */}
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("tempFiles.binaryConfirmTitle")}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{fileName}</p>
            </div>

            {/* Body */}
            <div className="px-4 py-3">
              {tempPreviewUrl ? (
                <div className="flex justify-center mb-3">
                  <img
                    src={tempPreviewUrl}
                    alt={fileName}
                    className="max-h-64 max-w-full rounded border border-gray-200 dark:border-gray-700 object-contain"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                    <span className="text-[10px] text-gray-400">BIN</span>
                  </div>
                  <div className="text-sm text-gray-900 dark:text-gray-100">
                    <span className="truncate block">{fileName}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {t("tempFiles.savedAt")}: {new Date(tempPreview.savedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t("tempFiles.binaryConfirmMessage")}
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
              <button
                onClick={closeTempPreview}
                className="rounded px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {t("tempFiles.binaryConfirmCancel")}
              </button>
              <button
                onClick={handleTempPreviewAccept}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {t("tempFiles.binaryConfirmApply")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
