import { useState, useCallback, useEffect } from "react";
import { X, Trash2, RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { parseConflictBackupName } from "gemihub-sync-core/conflict";
import { guessMimeType } from "gemihub-sync-core/files";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import {
  deleteLocalConflictBackup,
  listLocalConflictBackups,
  type ConflictBackup,
} from "~/services/indexeddb-cache";
import { findFileByNameLocal, saveBinaryFileLocal, writeFileLocal } from "~/services/drive-local";

interface FileEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

interface ConflictsDialogProps {
  onClose: () => void;
}

const PREVIEW_CHARS = 2000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Default restore name for a browser-local backup: the original path with a
 * conflict marker, so restoring never collides with the file that won.
 * "notes/daily.md" → "notes/daily (conflict 2026-09-25 1530).md"
 */
function defaultLocalRestoreName(backup: ConflictBackup): string {
  const date = new Date(backup.createdAt);
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
  const name = backup.fileName || backup.fileId;
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  return dot > slash + 1
    ? `${name.slice(0, dot)} (conflict ${stamp})${name.slice(dot)}`
    : `${name} (conflict ${stamp})`;
}

const checkboxClass = "h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600";
const renameInputClass = "flex-1 px-2 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100";
const restoreButtonClass = "inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs disabled:opacity-50";
const deleteButtonClass = "inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-xs disabled:opacity-50";
const sectionTitleClass = "text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400";

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function ConflictsDialog({ onClose }: ConflictsDialogProps) {
  const { t } = useI18n();
  // sync_conflicts/ lives in the personal Drive; never touch it from a project mount.
  const showDrive = useEnterpriseSelection() === null;

  const [localBackups, setLocalBackups] = useState<ConflictBackup[]>([]);
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const [localRenames, setLocalRenames] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set());

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renames, setRenames] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Original path from a conflict backup name (any client's format)
  const stripTimestamp = useCallback((name: string) => {
    return parseConflictBackupName(name).originalPath;
  }, []);

  const loadLocalBackups = useCallback(async () => {
    const backups = await listLocalConflictBackups();
    setLocalBackups(backups);
    const defaults: Record<string, string> = {};
    for (const backup of backups) defaults[backup.id] = defaultLocalRestoreName(backup);
    setLocalRenames((prev) => ({ ...defaults, ...prev }));
  }, []);

  const loadFiles = useCallback(async () => {
    if (!showDrive) return;
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listConflicts" }),
      });
      const data = await res.json();
      const fileList: FileEntry[] = data.files ?? [];
      setFiles(fileList);
      // Pre-fill rename map with timestamp-stripped names
      const newRenames: Record<string, string> = {};
      for (const f of fileList) {
        newRenames[f.id] = stripTimestamp(f.name);
      }
      setRenames((prev) => ({ ...newRenames, ...prev }));
    } catch {
      setFiles([]);
    }
  }, [showDrive, stripTimestamp]);

  useEffect(() => {
    Promise.all([loadLocalBackups(), loadFiles()]).finally(() => setInitialLoading(false));
  }, [loadLocalBackups, loadFiles]);

  // ---------------------------------------------------------------------------
  // Browser-local backups
  // ---------------------------------------------------------------------------

  const handleLocalRestore = useCallback(async () => {
    if (localSelected.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      for (const backup of localBackups.filter((b) => localSelected.has(b.id))) {
        const name = (localRenames[backup.id] ?? defaultLocalRestoreName(backup)).trim().replace(/^\/+/, "");
        if (!name) {
          setError(t("trash.restoreNameEmpty"));
          return;
        }
        // Restore never overwrites: the file that won the conflict usually
        // still exists under the original name.
        if (await findFileByNameLocal(name)) {
          setError(t("trash.restoreNameExists").replace("{name}", name));
          return;
        }
        if (backup.encoding === "base64") {
          await saveBinaryFileLocal(name, backup.content, guessMimeType(name));
        } else {
          await writeFileLocal(name, backup.content);
        }
        await deleteLocalConflictBackup(backup.id);
        setLocalSelected((prev) => {
          const next = new Set(prev);
          next.delete(backup.id);
          return next;
        });
      }
      window.dispatchEvent(new Event("tree-meta-updated"));
    } catch {
      setError(t("trash.restoreFailed"));
    } finally {
      await loadLocalBackups();
      setLoading(false);
    }
  }, [localBackups, localSelected, localRenames, loadLocalBackups, t]);

  const handleLocalDelete = useCallback(async () => {
    if (localSelected.size === 0) return;
    if (!confirm(t("trash.deleteBackupConfirm"))) return;
    setLoading(true);
    setError(null);
    try {
      for (const id of localSelected) await deleteLocalConflictBackup(id);
      setLocalSelected(new Set());
    } catch {
      setError(t("trash.deleteFailed"));
    } finally {
      await loadLocalBackups();
      setLoading(false);
    }
  }, [localSelected, loadLocalBackups, t]);

  // ---------------------------------------------------------------------------
  // Drive sync_conflicts/
  // ---------------------------------------------------------------------------

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return;
    if (!confirm(t("trash.permanentDeleteConfirm"))) return;
    setLoading(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "permanentDelete",
          fileIds: Array.from(selected),
        }),
      });
      setSelected(new Set());
      await loadFiles();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selected, loadFiles, t]);

  const handleRestore = useCallback(async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      // Build renames map for selected files
      const selectedRenames: Record<string, string> = {};
      for (const id of selected) {
        if (renames[id]) selectedRenames[id] = renames[id];
      }
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restoreConflict",
          fileIds: Array.from(selected),
          renames: selectedRenames,
        }),
      });
      setSelected(new Set());
      await loadFiles();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selected, renames, loadFiles]);

  const nothingAtAll = localBackups.length === 0 && (!showDrive || files.length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("trash.tabConflicts")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {initialLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : nothingAtAll ? (
            <p className="py-8 text-center text-sm text-gray-500">{t("trash.noConflicts")}</p>
          ) : (
            <div className="space-y-5">
              {error && (
                <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
              )}

              {/* Browser-local backups from conflict resolution */}
              <section>
                <h4 className={sectionTitleClass}>{t("trash.localBackupsTitle")}</h4>
                <p className="mt-1 mb-2 text-xs text-gray-500 dark:text-gray-400">{t("trash.localBackupsInfo")}</p>
                {localBackups.length === 0 ? (
                  <p className="py-2 text-xs text-gray-500">{t("trash.noLocalBackups")}</p>
                ) : (
                  <>
                    <label className="flex items-center gap-2 mb-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localSelected.size === localBackups.length}
                        onChange={() => setLocalSelected(
                          localSelected.size === localBackups.length ? new Set() : new Set(localBackups.map((b) => b.id)),
                        )}
                        className={checkboxClass}
                      />
                      {t("trash.selectAll")}
                    </label>
                    <div className="space-y-2">
                      {localBackups.map((backup) => {
                        const isOpen = previewOpen.has(backup.id);
                        return (
                          <div key={backup.id} className="px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={localSelected.has(backup.id)}
                                onChange={() => setLocalSelected((prev) => toggleIn(prev, backup.id))}
                                className={checkboxClass}
                              />
                              <button
                                type="button"
                                onClick={() => setPreviewOpen((prev) => toggleIn(prev, backup.id))}
                                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                                title={isOpen ? t("trash.hidePreview") : t("trash.showPreview")}
                              >
                                {isOpen ? <ChevronDown size={12} className="shrink-0 text-gray-400" /> : <ChevronRight size={12} className="shrink-0 text-gray-400" />}
                                <span className="truncate text-sm text-gray-700 dark:text-gray-300">
                                  {backup.fileName || backup.fileId}
                                </span>
                              </button>
                              <span className="text-[10px] text-gray-400 whitespace-nowrap">
                                {new Date(backup.createdAt).toLocaleString()}
                              </span>
                            </div>
                            {isOpen && (
                              backup.encoding === "base64" ? (
                                <p className="ml-6 mt-1 text-xs italic text-gray-500">{t("trash.binaryBackup")}</p>
                              ) : (
                                <pre className="ml-6 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                  {backup.content.length > PREVIEW_CHARS ? `${backup.content.slice(0, PREVIEW_CHARS)}…` : backup.content}
                                </pre>
                              )
                            )}
                            {localSelected.has(backup.id) && (
                              <div className="ml-6 mt-1 flex items-center gap-2">
                                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  {t("trash.restoreAs")}
                                </span>
                                <input
                                  type="text"
                                  value={localRenames[backup.id] ?? defaultLocalRestoreName(backup)}
                                  onChange={(e) => setLocalRenames((prev) => ({ ...prev, [backup.id]: e.target.value }))}
                                  className={renameInputClass}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={handleLocalRestore} disabled={loading || localSelected.size === 0} className={restoreButtonClass}>
                        {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        {t("trash.restore")}
                      </button>
                      <button onClick={handleLocalDelete} disabled={loading || localSelected.size === 0} className={deleteButtonClass}>
                        {loading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        {t("trash.permanentDelete")}
                      </button>
                    </div>
                  </>
                )}
              </section>

              {/* Drive sync_conflicts/ backups */}
              {showDrive && (
                <section>
                  <h4 className={sectionTitleClass}>{t("trash.driveBackupsTitle")}</h4>
                  <p className="mt-1 mb-2 text-xs text-gray-500 dark:text-gray-400">
                    {t("trash.conflictInfo")}
                  </p>
                  {files.length === 0 ? (
                    <p className="py-2 text-xs text-gray-500">{t("trash.noConflicts")}</p>
                  ) : (
                    <>
                      <label className="flex items-center gap-2 mb-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.size === files.length}
                          onChange={() => setSelected(selected.size === files.length ? new Set() : new Set(files.map((f) => f.id)))}
                          className={checkboxClass}
                        />
                        {t("trash.selectAll")}
                      </label>
                      <div className="space-y-2">
                        {files.map((f) => (
                          <div key={f.id} className="px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selected.has(f.id)}
                                onChange={() => setSelected((prev) => toggleIn(prev, f.id))}
                                className={checkboxClass}
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">
                                {f.name}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ""}
                              </span>
                            </label>
                            {selected.has(f.id) && (
                              <div className="ml-6 mt-1 flex items-center gap-2">
                                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  {t("trash.restoreAs")}
                                </span>
                                <input
                                  type="text"
                                  value={renames[f.id] ?? stripTimestamp(f.name)}
                                  onChange={(e) => setRenames((prev) => ({ ...prev, [f.id]: e.target.value }))}
                                  className={renameInputClass}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex justify-end gap-2">
                        <button onClick={handleRestore} disabled={loading || selected.size === 0} className={restoreButtonClass}>
                          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {t("trash.restore")}
                        </button>
                        <button onClick={handleDelete} disabled={loading || selected.size === 0} className={deleteButtonClass}>
                          {loading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          {t("trash.permanentDelete")}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
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
