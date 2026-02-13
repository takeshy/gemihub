import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trash2,
  Cloud,
  Copy,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { EditHistoryEntry } from "~/services/edit-history.server";
import { getEditHistoryForFile, getCachedFile, setCachedFile } from "~/services/indexeddb-cache";
import { reconstructContent, restoreToHistoryEntry } from "~/services/edit-history-local";
import { useI18n } from "~/i18n/context";
import { DiffView } from "~/components/shared/DiffView";

interface EditHistoryModalProps {
  fileId: string;
  filePath: string;
  fullFilePath: string;
  onClose: () => void;
  onFileCreated?: (file: { id: string; name: string; mimeType: string }) => void;
}

type DisplayEntry = {
  id: string;
  timestamp: string;
  diff: string;
  stats: { additions: number; deletions: number };
  origin: "local" | "remote";
};

export function EditHistoryModal({
  fileId,
  filePath,
  fullFilePath,
  onClose,
  onFileCreated,
}: EditHistoryModalProps) {
  const { t } = useI18n();
  const [localEntries, setLocalEntries] = useState<DisplayEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<DisplayEntry[]>([]);
  const [showRemote, setShowRemote] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saveAsDialog, setSaveAsDialog] = useState<{
    open: boolean;
    name: string;
    content: string;
  }>({ open: false, name: "", content: "" });
  const [saving, setSaving] = useState(false);

  // Load local entries from IndexedDB
  useEffect(() => {
    (async () => {
      try {
        const entry = await getEditHistoryForFile(fileId);
        if (entry) {
          setLocalEntries(
            entry.diffs
              .filter((d) => d.diff !== "")
              .map((d, i) => ({
                id: `local-${i}`,
                timestamp: d.timestamp,
                diff: d.diff,
                stats: d.stats,
                origin: "local" as const,
              }))
          );
        }
      } catch {
        // ignore
      } finally {
        setLoadingLocal(false);
      }
    })();
  }, [fileId]);

  const loadRemoteHistory = useCallback(async () => {
    setLoadingRemote(true);
    try {
      const res = await fetch(
        `/api/settings/edit-history?filePath=${encodeURIComponent(filePath)}`
      );
      if (res.ok) {
        const data = await res.json();
        const entries = (data.entries || []) as EditHistoryEntry[];
        setRemoteEntries(
          entries.map((e) => ({
            id: `remote-${e.id}`,
            timestamp: e.timestamp,
            diff: e.diff,
            stats: e.stats,
            origin: "remote" as const,
          }))
        );
      }
    } catch {
      // ignore
    } finally {
      setLoadingRemote(false);
      setShowRemote(true);
    }
  }, [filePath]);

  const handleClearAll = useCallback(async () => {
    if (!confirm(t("editHistory.confirmClearAll"))) return;
    try {
      await fetch("/api/settings/edit-history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      setRemoteEntries([]);
    } catch {
      // ignore
    }
  }, [filePath, t]);

  const allEntries = useMemo(
    () =>
      [
        ...localEntries,
        ...(showRemote ? remoteEntries : []),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [localEntries, remoteEntries, showRemote]
  );

  const handleRestore = useCallback(
    async (entry: DisplayEntry) => {
      const cached = await getCachedFile(fileId);
      if (!cached) return;

      const targetIdx = allEntries.indexOf(entry);
      if (targetIdx < 0) return;

      const diffsToApply = allEntries.slice(0, targetIdx + 1).map((e) => e.diff);
      const restoredContent = await restoreToHistoryEntry(fileId, cached.content, diffsToApply);
      if (restoredContent == null) {
        alert(t("editHistory.restoreFailed"));
        return;
      }

      // Update IndexedDB cache
      await setCachedFile({
        fileId,
        content: restoredContent,
        md5Checksum: cached.md5Checksum ?? "",
        modifiedTime: cached.modifiedTime ?? "",
        cachedAt: Date.now(),
        fileName: cached.fileName,
      });

      // Notify editor to update content
      window.dispatchEvent(
        new CustomEvent("file-restored", { detail: { fileId, content: restoredContent } })
      );
      window.dispatchEvent(
        new CustomEvent("file-modified", { detail: { fileId } })
      );

      onClose();
    },
    [fileId, onClose, allEntries, t]
  );

  const handleCopy = useCallback(
    async (entry: DisplayEntry) => {
      const cached = await getCachedFile(fileId);
      if (!cached) return;

      const targetIdx = allEntries.indexOf(entry);
      if (targetIdx < 0) return;

      const diffsToApply = allEntries.slice(0, targetIdx + 1).map((e) => e.diff);
      const restoredContent = reconstructContent(cached.content, diffsToApply);
      if (restoredContent == null) {
        alert(t("editHistory.restoreFailed"));
        return;
      }

      // Generate default name: "base (restored).ext"
      const lastDot = fullFilePath.lastIndexOf(".");
      const base = lastDot > 0 ? fullFilePath.slice(0, lastDot) : fullFilePath;
      const ext = lastDot > 0 ? fullFilePath.slice(lastDot) : "";
      const defaultName = `${base} (restored)${ext}`;

      setSaveAsDialog({ open: true, name: defaultName, content: restoredContent });
    },
    [fileId, allEntries, fullFilePath, t]
  );

  const handleSaveAs = useCallback(async () => {
    const name = saveAsDialog.name.trim();
    if (!name) return;

    setSaving(true);
    try {
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name, content: saveAsDialog.content }),
      });
      if (res.ok) {
        const data = await res.json();
        const file = data.file;
        onFileCreated?.({ id: file.id, name: file.name, mimeType: file.mimeType });
        setSaveAsDialog({ open: false, name: "", content: "" });
        onClose();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [saveAsDialog, onFileCreated, onClose]);

  const toggleExpand = useCallback(
    (id: string) => {
      setExpandedId(expandedId === id ? null : id);
    },
    [expandedId]
  );

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("editHistory.title")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-md">
              {filePath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loadingLocal ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={ICON.XL} className="animate-spin text-gray-400" />
            </div>
          ) : allEntries.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              {t("editHistory.noHistory")}
            </div>
          ) : (
            <div className="space-y-1">
              {allEntries.map((entry) => {
                const isExpanded = expandedId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className="rounded border border-gray-200 dark:border-gray-700"
                  >
                    {/* Entry header */}
                    <button
                      onClick={() => toggleExpand(entry.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown size={ICON.MD} className="text-gray-400" />
                      ) : (
                        <ChevronRight size={ICON.MD} className="text-gray-400" />
                      )}
                      <span className="text-xs text-gray-700 dark:text-gray-300">
                        {formatDate(entry.timestamp)}
                      </span>
                      <OriginBadge origin={entry.origin} />
                      <span className="text-xs text-gray-400">
                        <span className="text-green-600 dark:text-green-400">
                          +{entry.stats.additions}
                        </span>
                        {" / "}
                        <span className="text-red-600 dark:text-red-400">
                          -{entry.stats.deletions}
                        </span>
                      </span>
                      <span className="ml-auto flex items-center gap-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRestore(entry);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.stopPropagation(); handleRestore(entry); }
                          }}
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-500 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                        >
                          {t("editHistory.restore")}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(entry);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.stopPropagation(); handleCopy(entry); }
                          }}
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-500 hover:border-green-400 hover:bg-green-50 hover:text-green-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-green-500 dark:hover:bg-green-900/30 dark:hover:text-green-400"
                        >
                          <Copy size={10} className="inline -mt-0.5" />
                        </span>
                      </span>
                    </button>

                    {/* Expanded diff */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 dark:border-gray-700 overflow-x-auto">
                        <DiffView diff={entry.diff} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            {!showRemote && (
              <button
                onClick={loadRemoteHistory}
                disabled={loadingRemote}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
              >
                {loadingRemote ? (
                  <Loader2 size={ICON.SM} className="animate-spin" />
                ) : (
                  <Cloud size={ICON.SM} />
                )}
                {t("editHistory.showRemote")}
              </button>
            )}
            {showRemote && remoteEntries.length > 0 && (
              <button
                onClick={handleClearAll}
                className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
              >
                <Trash2 size={ICON.SM} />
                {t("editHistory.clearAll")}
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("editHistory.close")}
          </button>
        </div>
      </div>

      {/* Save As dialog */}
      {saveAsDialog.open && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50" onClick={() => setSaveAsDialog((prev) => ({ ...prev, open: false }))}>
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t("editHistory.saveAs")}
            </h3>
            <div className="mb-4">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("editHistory.saveAsName")}
              </label>
              <input
                type="text"
                value={saveAsDialog.name}
                onChange={(e) => setSaveAsDialog((prev) => ({ ...prev, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveAs();
                  if (e.key === "Escape") setSaveAsDialog((prev) => ({ ...prev, open: false }));
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSaveAsDialog((prev) => ({ ...prev, open: false }))}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSaveAs}
                disabled={!saveAsDialog.name.trim() || saving}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {saving && <Loader2 size={ICON.SM} className="animate-spin" />}
                {t("editHistory.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}

function OriginBadge({ origin }: { origin: "local" | "remote" }) {
  if (origin === "local") {
    return (
      <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
        local
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
      remote
    </span>
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
