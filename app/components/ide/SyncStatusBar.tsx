import { useState, useCallback, useEffect, useRef } from "react";
import { ArrowUp, ArrowDown, AlertTriangle, Loader2 } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import type { SyncStatus, ConflictInfo } from "~/hooks/useSync";
import {
  getCachedRemoteMeta,
  getCachedFile,
  getLocallyModifiedFileIds,
  getLocalSyncMeta,
} from "~/services/indexeddb-cache";
import { hasNetContentChange } from "~/services/edit-history-local";
import { isSyncExcludedPath } from "~/services/sync-client-utils";
import { computeSyncDiff } from "~/services/sync-diff";
import { SyncDiffDialog } from "./SyncDiffDialog";
import type { FileListItem } from "./SyncDiffDialog";

interface SyncStatusBarProps {
  syncStatus: SyncStatus;
  lastSyncTime: string | null;
  error: string | null;
  localModifiedCount: number;
  remoteModifiedCount: number;
  onPush: () => void;
  onPull: () => void;
  onShowConflicts: () => void;
  onSelectFile?: (fileId: string, fileName: string, mimeType: string) => void;
  conflicts: ConflictInfo[];
  compact?: boolean;
  pullDialogTrigger?: number;
}

export function SyncStatusBar({
  syncStatus,
  lastSyncTime,
  error,
  localModifiedCount,
  remoteModifiedCount,
  onPush,
  onPull,
  onShowConflicts,
  onSelectFile,
  conflicts,
  compact = false,
  pullDialogTrigger = 0,
}: SyncStatusBarProps) {
  const { t } = useI18n();
  const conflictCount = conflicts.length;
  const isBusy = syncStatus === "pushing" || syncStatus === "pulling";

  const [dialogType, setDialogType] = useState<"push" | "pull" | null>(null);
  const [dialogFiles, setDialogFiles] = useState<FileListItem[]>([]);
  const [dialogLoading, setDialogLoading] = useState(false);
  const pushCount = localModifiedCount;
  const pullDialogTriggerRef = useRef(pullDialogTrigger);

  const openDiffDialog = useCallback(async (type: "push" | "pull") => {
    setDialogLoading(true);
    setDialogType(type);
    setDialogFiles([]);

    try {
      const remoteMeta = await getCachedRemoteMeta();
      const localMeta = await getLocalSyncMeta();
      const modifiedIds = await getLocallyModifiedFileIds();
      const diff = computeSyncDiff(localMeta ?? null, remoteMeta ? { lastUpdatedAt: remoteMeta.lastUpdatedAt, files: remoteMeta.files } : null, modifiedIds);

      if (type === "push") {
        const files: FileListItem[] = [];
        const remoteFiles = remoteMeta?.files ?? {};
        const localFiles = localMeta?.files ?? {};

        for (const id of diff.toPush) {
          // Skip files whose content was reverted to synced state (no net change)
          if (!(await hasNetContentChange(id))) continue;
          const cached = await getCachedFile(id);
          const name = cached?.fileName || remoteFiles[id]?.name || id;
          if (isSyncExcludedPath(name)) continue;
          const isNew = !localFiles[id];
          files.push({ id, name, type: isNew ? "new" : "modified" });
        }
        for (const id of diff.localOnly) {
          if (!modifiedIds.has(id)) continue;  // Skip remotely-deleted files
          const cached = await getCachedFile(id);
          const name = cached?.fileName || id;
          if (isSyncExcludedPath(name)) continue;
          files.push({ id, name, type: "new" });
        }
        files.sort((a, b) => a.name.localeCompare(b.name));
        setDialogFiles(files);
      } else {
        const files: FileListItem[] = [];
        const remoteFiles = remoteMeta?.files ?? {};
        const localFiles = localMeta?.files ?? {};

        for (const id of diff.remoteOnly) {
          files.push({ id, name: remoteFiles[id]?.name || id, type: "new" });
        }
        for (const id of diff.toPull) {
          files.push({ id, name: remoteFiles[id]?.name || id, type: "modified" });
        }
        // Only show files that exist in localMeta (remotely-deleted files).
        // Files only in editHistory are new local files — shown in push, not pull.
        for (const id of diff.localOnly) {
          if (!(id in localFiles)) continue;
          const cached = await getCachedFile(id);
          files.push({ id, name: cached?.fileName || id, type: "deleted" });
        }
        // Edit-delete conflicts: locally edited but remotely deleted
        for (const id of diff.editDeleteConflicts) {
          const cached = await getCachedFile(id);
          files.push({ id, name: cached?.fileName || id, type: "editDeleted" });
        }

        files.sort((a, b) => a.name.localeCompare(b.name));
        setDialogFiles(files);
      }
    } catch {
      setDialogFiles([]);
    } finally {
      setDialogLoading(false);
    }
  }, []);

  // External trigger to open pull diff dialog (e.g. from push-rejected dialog)
  useEffect(() => {
    if (pullDialogTrigger > 0 && pullDialogTrigger !== pullDialogTriggerRef.current) {
      pullDialogTriggerRef.current = pullDialogTrigger;
      openDiffDialog("pull");
    }
  }, [pullDialogTrigger, openDiffDialog]);

  const formatLastSync = (time: string | null) => {
    if (!time) return null;
    const d = Date.now() - new Date(time).getTime();
    const minutes = Math.floor(d / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="flex items-center gap-1">
      {/* Busy indicator */}
      {isBusy && (
        <Loader2 size={ICON.SM} className="animate-spin text-gray-400" />
      )}

      {/* Push button (opens modal) */}
      <button
        onClick={() => openDiffDialog("push")}
        disabled={isBusy || pushCount === 0}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        <ArrowUp size={ICON.SM} />
        {!compact && t("sync.pushLabel")}
        {pushCount > 0 && (
          <span className="rounded-full bg-blue-600 px-1.5 py-0 text-[10px] font-bold leading-4 text-white dark:bg-blue-500">
            {pushCount}
          </span>
        )}
      </button>

      {/* Pull button (opens modal) */}
      <button
        onClick={() => openDiffDialog("pull")}
        disabled={isBusy || remoteModifiedCount === 0}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        <ArrowDown size={ICON.SM} />
        {!compact && t("sync.pullLabel")}
        {remoteModifiedCount > 0 && (
          <span className="rounded-full bg-green-600 px-1.5 py-0 text-[10px] font-bold leading-4 text-white dark:bg-green-500">
            {remoteModifiedCount}
          </span>
        )}
      </button>

      {/* Conflict indicator */}
      {conflictCount > 0 && (
        <button
          onClick={onShowConflicts}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
          title={`${conflictCount} conflict${conflictCount > 1 ? "s" : ""}`}
        >
          <AlertTriangle size={ICON.SM} />
          <span>{conflictCount}</span>
        </button>
      )}

      {/* Error / warning (pushRejected is handled by a dedicated dialog) */}
      {error && syncStatus === "error" && error !== "settings.sync.pushRejected" && (
        <span className="text-xs text-red-500 truncate max-w-[120px]" title={error}>
          Sync error
        </span>
      )}
      {error && syncStatus === "warning" && (
        <span className="text-xs text-amber-600 truncate max-w-[160px] dark:text-amber-400" title={error}>
          Sync warning
        </span>
      )}

      {/* Last sync time */}
      {lastSyncTime && !error && !compact && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {formatLastSync(lastSyncTime)}
        </span>
      )}

      {/* Sync diff dialog */}
      {dialogType && !dialogLoading && (
        <SyncDiffDialog
          files={dialogFiles}
          type={dialogType}
          onClose={() => setDialogType(null)}
          onSelectFile={onSelectFile}
          onSync={dialogType === "push" ? onPush : onPull}
          syncDisabled={isBusy}
        />
      )}
      {dialogType && dialogLoading && (
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
          <div className="rounded-lg bg-white p-8 shadow-xl dark:bg-gray-900">
            <Loader2 size={ICON.XL} className="animate-spin text-gray-400" />
          </div>
        </div>
      )}
    </div>
  );
}
