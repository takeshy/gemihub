import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { X, Loader2, Trash2, Download } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { getCachedFile, setCachedFile, getLocalSyncMeta, setLocalSyncMeta, getCachedRemoteMeta, setCachedRemoteMeta } from "~/services/indexeddb-cache";
import { saveLocalEdit } from "~/services/edit-history-local";
import { isBinaryMimeType, looksLikeBinary, isImageFileName, applyBinaryTempFile } from "~/services/sync-client-utils";

interface TempFileItem {
  tempFileId: string;
  fileName: string;
  displayName: string;
  payload: {
    fileId: string;
    content: string;
    savedAt: string;
  };
}

interface TempFilesDialogProps {
  onClose: () => void;
}

export function TempFilesDialog({ onClose }: TempFilesDialogProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<TempFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [binaryConfirmFiles, setBinaryConfirmFiles] = useState<Array<{ fileName: string; content: string; mimeType?: string }> | null>(null);
  const [pendingProcessFiles, setPendingProcessFiles] = useState<TempFileItem[] | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drive/temp?action=list");
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const toggleSelect = useCallback((tempFileId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tempFileId)) {
        next.delete(tempFileId);
      } else {
        next.add(tempFileId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === files.length) {
        return new Set();
      }
      return new Set(files.map((f) => f.tempFileId));
    });
  }, [files]);

  const processFiles = useCallback(async (filesToProcess: TempFileItem[]) => {
    setProcessing(true);
    try {
      const remoteMeta = await getCachedRemoteMeta();
      const localMeta = await getLocalSyncMeta();

      for (const file of filesToProcess) {
        const { fileId } = file.payload;
        const fileMeta = remoteMeta?.files?.[fileId];
        const cachedFile = await getCachedFile(fileId);
        const isBinary = isBinaryMimeType(fileMeta?.mimeType)
          || cachedFile?.encoding === "base64"
          || looksLikeBinary(file.payload.content);

        if (isBinary) {
          await applyBinaryTempFile(fileId, file.payload.content, file.fileName, localMeta, remoteMeta);
        } else {
          await saveLocalEdit(fileId, file.fileName, file.payload.content);
          await setCachedFile({
            fileId,
            content: file.payload.content,
            md5Checksum: cachedFile?.md5Checksum ?? "",
            modifiedTime: file.payload.savedAt,
            cachedAt: Date.now(),
            fileName: file.fileName,
          });
          window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId } }));
        }
      }

      if (localMeta) await setLocalSyncMeta(localMeta);
      if (remoteMeta) await setCachedRemoteMeta(remoteMeta);
    } catch {
      // ignore
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleDownloadSelected = useCallback(async () => {
    const selectedFiles = files.filter((f) => selected.has(f.tempFileId));
    if (selectedFiles.length === 0) return;

    // Scan for binary files
    const binaryEntries: Array<{ fileName: string; content: string; mimeType?: string }> = [];
    const remoteMeta = await getCachedRemoteMeta();
    for (const file of selectedFiles) {
      const { fileId } = file.payload;
      const fileMeta = remoteMeta?.files?.[fileId];
      const cachedFile = await getCachedFile(fileId);
      const isBinary = isBinaryMimeType(fileMeta?.mimeType)
        || cachedFile?.encoding === "base64"
        || looksLikeBinary(file.payload.content);
      if (isBinary) {
        binaryEntries.push({ fileName: file.fileName, content: file.payload.content, mimeType: fileMeta?.mimeType });
      }
    }

    if (binaryEntries.length > 0) {
      setBinaryConfirmFiles(binaryEntries);
      setPendingProcessFiles(selectedFiles);
      return;
    }

    await processFiles(selectedFiles);
  }, [files, selected, processFiles]);

  const handleBinaryConfirm = useCallback(async () => {
    if (pendingProcessFiles) {
      await processFiles(pendingProcessFiles);
    }
    setBinaryConfirmFiles(null);
    setPendingProcessFiles(null);
  }, [pendingProcessFiles, processFiles]);

  const handleBinaryCancel = useCallback(() => {
    setBinaryConfirmFiles(null);
    setPendingProcessFiles(null);
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (!confirm(t("tempFiles.confirmDelete"))) return;
    setProcessing(true);
    try {
      const ids = files
        .filter((f) => selected.has(f.tempFileId))
        .map((f) => f.tempFileId);
      const res = await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", tempFileIds: ids }),
      });
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => !selected.has(f.tempFileId)));
        setSelected(new Set());
      }
    } catch {
      // ignore
    } finally {
      setProcessing(false);
    }
  }, [files, selected, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("tempFiles.title")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={ICON.XL} className="animate-spin text-gray-400" />
            </div>
          ) : files.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              {t("tempFiles.noFiles")}
            </div>
          ) : (
            <div className="space-y-1">
              {/* Select all */}
              <label className="flex items-center gap-2 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.size === files.length}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                {t("tempFiles.selectAll")}
              </label>

              {files.map((file) => (
                <div
                  key={file.tempFileId}
                  className="flex items-center gap-2 rounded border border-gray-200 dark:border-gray-700 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(file.tempFileId)}
                    onChange={() => toggleSelect(file.tempFileId)}
                    className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                      {file.displayName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("tempFiles.savedAt")}: {formatDate(file.payload.savedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {files.length > 0 && (
            <>
              <button
                onClick={handleDownloadSelected}
                disabled={selected.size === 0 || processing}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                <Download size={ICON.SM} />
                {t("tempFiles.downloadSelected")}
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selected.size === 0 || processing}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 border border-red-300 dark:border-red-700 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                <Trash2 size={ICON.SM} />
                {t("tempFiles.deleteSelected")}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("editHistory.close")}
          </button>
        </div>
      </div>

      {binaryConfirmFiles && (
        <BinaryConfirmDialog
          files={binaryConfirmFiles}
          onConfirm={handleBinaryConfirm}
          onCancel={handleBinaryCancel}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BinaryConfirmDialog
// ---------------------------------------------------------------------------

function BinaryConfirmDialog({
  files,
  onConfirm,
  onCancel,
}: {
  files: Array<{ fileName: string; content: string; mimeType?: string }>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const blobUrlsRef = useRef<string[]>([]);

  // Build blob URLs for image thumbnails (memoised to avoid leaking on re-render)
  const items = useMemo(() => {
    // Revoke previous blob URLs before creating new ones
    for (const url of blobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    blobUrlsRef.current = [];

    return files.map((f) => {
      let thumbnailUrl: string | undefined;
      if (isImageFileName(f.fileName) && f.content) {
        try {
          const byteString = atob(f.content);
          const bytes = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i);
          }
          const mime = f.mimeType || "application/octet-stream";
          const blob = new Blob([bytes], { type: mime });
          thumbnailUrl = URL.createObjectURL(blob);
          blobUrlsRef.current.push(thumbnailUrl);
        } catch {
          // ignore decode errors
        }
      }
      return { fileName: f.fileName, thumbnailUrl };
    });
  }, [files]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900 flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("tempFiles.binaryConfirmTitle")}
          </h3>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            {t("tempFiles.binaryConfirmMessage")}
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.fileName}
                    className="h-8 w-8 rounded border border-gray-200 dark:border-gray-700 object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="h-8 w-8 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                    <span className="text-[10px] text-gray-400">BIN</span>
                  </div>
                )}
                <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                  {item.fileName}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("tempFiles.binaryConfirmCancel")}
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {t("tempFiles.binaryConfirmApply")}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
