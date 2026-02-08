import { useState, useCallback, useEffect } from "react";
import { X, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { useI18n } from "~/i18n/context";

interface FileEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

interface ManageFilesDialogProps {
  onClose: () => void;
}

type Tab = "trash" | "conflicts";

export function ManageFilesDialog({ onClose }: ManageFilesDialogProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("trash");
  const [trashFiles, setTrashFiles] = useState<FileEntry[]>([]);
  const [conflictFiles, setConflictFiles] = useState<FileEntry[]>([]);
  const [trashSelected, setTrashSelected] = useState<Set<string>>(new Set());
  const [conflictSelected, setConflictSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [renames, setRenames] = useState<Record<string, string>>({});

  // Strip timestamp from conflict backup names: "file_20260208_123456.md" → "file.md"
  const stripTimestamp = useCallback((name: string) => {
    return name.replace(/_\d{8}_\d{6}(?=\.)/, "");
  }, []);

  const loadTrash = useCallback(async () => {
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listTrash" }),
      });
      const data = await res.json();
      setTrashFiles(data.files ?? []);
    } catch {
      setTrashFiles([]);
    }
  }, []);

  const loadConflicts = useCallback(async () => {
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listConflicts" }),
      });
      const data = await res.json();
      const files: FileEntry[] = data.files ?? [];
      setConflictFiles(files);
      // Pre-fill rename map with timestamp-stripped names
      const newRenames: Record<string, string> = {};
      for (const f of files) {
        newRenames[f.id] = stripTimestamp(f.name);
      }
      setRenames((prev) => ({ ...newRenames, ...prev }));
    } catch {
      setConflictFiles([]);
    }
  }, [stripTimestamp]);

  useEffect(() => {
    Promise.all([loadTrash(), loadConflicts()]).finally(() => setInitialLoading(false));
  }, [loadTrash, loadConflicts]);

  const toggleTrashAll = useCallback(() => {
    if (trashSelected.size === trashFiles.length) {
      setTrashSelected(new Set());
    } else {
      setTrashSelected(new Set(trashFiles.map((f) => f.id)));
    }
  }, [trashFiles, trashSelected.size]);

  const toggleTrashOne = useCallback((id: string) => {
    setTrashSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleConflictAll = useCallback(() => {
    if (conflictSelected.size === conflictFiles.length) {
      setConflictSelected(new Set());
    } else {
      setConflictSelected(new Set(conflictFiles.map((f) => f.id)));
    }
  }, [conflictFiles, conflictSelected.size]);

  const toggleConflictOne = useCallback((id: string) => {
    setConflictSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleTrashDelete = useCallback(async () => {
    if (trashSelected.size === 0) return;
    if (!confirm(t("trash.permanentDeleteConfirm"))) return;
    setLoading(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteUntracked",
          fileIds: Array.from(trashSelected),
        }),
      });
      setTrashSelected(new Set());
      await loadTrash();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [trashSelected, loadTrash, t]);

  const handleTrashRestore = useCallback(async () => {
    if (trashSelected.size === 0) return;
    setLoading(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restoreTrash",
          fileIds: Array.from(trashSelected),
        }),
      });
      setTrashSelected(new Set());
      await loadTrash();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [trashSelected, loadTrash]);

  const handleConflictDelete = useCallback(async () => {
    if (conflictSelected.size === 0) return;
    if (!confirm(t("trash.permanentDeleteConfirm"))) return;
    setLoading(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteUntracked",
          fileIds: Array.from(conflictSelected),
        }),
      });
      setConflictSelected(new Set());
      await loadConflicts();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [conflictSelected, loadConflicts, t]);

  const handleConflictRestore = useCallback(async () => {
    if (conflictSelected.size === 0) return;
    setLoading(true);
    try {
      // Build renames map for selected files
      const selectedRenames: Record<string, string> = {};
      for (const id of conflictSelected) {
        if (renames[id]) selectedRenames[id] = renames[id];
      }
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restoreConflict",
          fileIds: Array.from(conflictSelected),
          renames: selectedRenames,
        }),
      });
      setConflictSelected(new Set());
      await loadConflicts();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [conflictSelected, renames, loadConflicts]);

  const tabClass = (tabId: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === tabId
        ? "border-blue-500 text-blue-600 dark:text-blue-400"
        : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("trash.title")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button className={tabClass("trash")} onClick={() => setTab("trash")}>
            {t("trash.tabTrash")} {trashFiles.length > 0 && `(${trashFiles.length})`}
          </button>
          <button className={tabClass("conflicts")} onClick={() => setTab("conflicts")}>
            {t("trash.tabConflicts")} {conflictFiles.length > 0 && `(${conflictFiles.length})`}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {initialLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : tab === "trash" ? (
            trashFiles.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">{t("trash.noFiles")}</p>
            ) : (
              <>
                <label className="flex items-center gap-2 mb-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trashSelected.size === trashFiles.length}
                    onChange={toggleTrashAll}
                    className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600"
                  />
                  {t("trash.selectAll")}
                </label>
                <div className="space-y-1">
                  {trashFiles.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={trashSelected.has(f.id)}
                        onChange={() => toggleTrashOne(f.id)}
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
            )
          ) : conflictFiles.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">{t("trash.noConflicts")}</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t("trash.conflictInfo")}
              </p>
              <label className="flex items-center gap-2 mb-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conflictSelected.size === conflictFiles.length}
                  onChange={toggleConflictAll}
                  className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600"
                />
                {t("trash.selectAll")}
              </label>
              <div className="space-y-2">
                {conflictFiles.map((f) => (
                  <div key={f.id} className="px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={conflictSelected.has(f.id)}
                        onChange={() => toggleConflictOne(f.id)}
                        className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">
                        {f.name}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ""}
                      </span>
                    </label>
                    {conflictSelected.has(f.id) && (
                      <div className="ml-6 mt-1 flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {t("trash.restoreAs")}
                        </span>
                        <input
                          type="text"
                          value={renames[f.id] ?? stripTimestamp(f.name)}
                          onChange={(e) => setRenames((prev) => ({ ...prev, [f.id]: e.target.value }))}
                          className="flex-1 px-2 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {tab === "trash" && trashFiles.length > 0 && (
            <>
              <button
                onClick={handleTrashRestore}
                disabled={loading || trashSelected.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t("trash.restore")}
              </button>
              <button
                onClick={handleTrashDelete}
                disabled={loading || trashSelected.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-xs disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t("trash.permanentDelete")}
              </button>
            </>
          )}
          {tab === "conflicts" && conflictFiles.length > 0 && (
            <>
              <button
                onClick={handleConflictRestore}
                disabled={loading || conflictSelected.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t("trash.restore")}
              </button>
              <button
                onClick={handleConflictDelete}
                disabled={loading || conflictSelected.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-xs disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t("trash.permanentDelete")}
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
