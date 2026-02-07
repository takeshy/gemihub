import { useState, useCallback } from "react";
import { X, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { useI18n } from "~/i18n/context";

interface UntrackedFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

interface UntrackedFilesDialogProps {
  files: UntrackedFile[];
  onClose: () => void;
  onRefresh: () => void;
}

export function UntrackedFilesDialog({
  files,
  onClose,
  onRefresh,
}: UntrackedFilesDialogProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const toggleAll = useCallback(() => {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.id)));
    }
  }, [files, selected.size]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteUntracked",
          fileIds: Array.from(selected),
        }),
      });
      setSelected(new Set());
      onRefresh();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selected, onRefresh]);

  const handleRestore = useCallback(async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restoreUntracked",
          fileIds: Array.from(selected),
        }),
      });
      setSelected(new Set());
      onRefresh();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selected, onRefresh]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("settings.sync.untrackedFiles")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {files.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              {t("settings.sync.noUntracked")}
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 mb-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.size === files.length}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600"
                />
                {t("tempFiles.selectAll")}
              </label>
              <div className="space-y-1">
                {files.map((f) => (
                  <label
                    key={f.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggleOne(f.id)}
                      className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">
                      {f.name}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ""}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {files.length > 0 && (
            <>
              <button
                onClick={handleRestore}
                disabled={loading || selected.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t("settings.sync.restoreSelected")}
              </button>
              <button
                onClick={handleDelete}
                disabled={loading || selected.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-xs disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t("settings.sync.deleteSelected")}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-xs"
          >
            {t("editHistory.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
