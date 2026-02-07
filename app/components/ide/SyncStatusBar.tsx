import { useState, useRef, useEffect, useCallback } from "react";
import { RefreshCw, ArrowUp, ArrowDown, AlertTriangle, Loader2 } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { SyncStatus, SyncDiff, ConflictInfo } from "~/hooks/useSync";
import {
  getCachedRemoteMeta,
  getLocallyModifiedFileIds,
  getCachedFile,
} from "~/services/indexeddb-cache";

interface SyncStatusBarProps {
  syncStatus: SyncStatus;
  diff: SyncDiff | null;
  lastSyncTime: string | null;
  error: string | null;
  localModifiedCount: number;
  onPush: () => void;
  onPull: () => void;
  onCheckSync: () => void;
  onShowConflicts: () => void;
  conflicts: ConflictInfo[];
}

interface FileListItem {
  id: string;
  name: string;
}

export function SyncStatusBar({
  syncStatus,
  diff,
  lastSyncTime,
  error,
  localModifiedCount,
  onPush,
  onPull,
  onCheckSync,
  onShowConflicts,
  conflicts,
}: SyncStatusBarProps) {
  const remotePushCount = diff ? diff.toPush.length + diff.localOnly.length : 0;
  const pushCount = remotePushCount + localModifiedCount;
  const pullCount = diff ? diff.toPull.length + diff.remoteOnly.length : 0;
  const conflictCount = conflicts.length;

  const isBusy = syncStatus === "checking" || syncStatus === "pushing" || syncStatus === "pulling";

  const [openList, setOpenList] = useState<"push" | "pull" | null>(null);
  const [listFiles, setListFiles] = useState<FileListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!openList) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenList(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openList]);

  const loadFileList = useCallback(async (type: "push" | "pull") => {
    if (openList === type) {
      setOpenList(null);
      return;
    }

    setListLoading(true);
    setOpenList(type);

    try {
      const remoteMeta = await getCachedRemoteMeta();
      const nameMap = remoteMeta?.files ?? {};

      const fileIds = new Set<string>();

      if (type === "push") {
        if (diff) {
          diff.toPush.forEach((id) => fileIds.add(id));
          diff.localOnly.forEach((id) => fileIds.add(id));
        }
        const localModified = await getLocallyModifiedFileIds();
        localModified.forEach((id) => fileIds.add(id));
      } else {
        if (diff) {
          diff.toPull.forEach((id) => fileIds.add(id));
          diff.remoteOnly.forEach((id) => fileIds.add(id));
        }
      }

      const files: FileListItem[] = [];
      for (const id of fileIds) {
        const meta = nameMap[id];
        if (meta?.name) {
          files.push({ id, name: meta.name });
        } else {
          const cached = await getCachedFile(id);
          files.push({ id, name: cached?.fileName ?? id });
        }
      }

      files.sort((a, b) => a.name.localeCompare(b.name));
      setListFiles(files);
    } catch {
      setListFiles([]);
    } finally {
      setListLoading(false);
    }
  }, [openList, diff]);

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
      {/* Sync check button */}
      <button
        onClick={onCheckSync}
        disabled={isBusy}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
        title="Check sync status"
      >
        {isBusy ? (
          <Loader2 size={ICON.SM} className="animate-spin" />
        ) : (
          <RefreshCw size={ICON.SM} />
        )}
      </button>

      {/* Push button + count badge */}
      <button
        onClick={onPush}
        disabled={isBusy}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        <ArrowUp size={ICON.SM} />
        Push
      </button>
      {pushCount > 0 && (
        <div className="relative" ref={openList === "push" ? popoverRef : undefined}>
          <button
            onClick={() => loadFileList("push")}
            className="rounded-full bg-blue-600 px-1.5 py-0 text-[10px] font-bold leading-4 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {pushCount}
          </button>
          {openList === "push" && (
            <FileListPopover files={listFiles} loading={listLoading} />
          )}
        </div>
      )}

      {/* Pull button + count badge */}
      <button
        onClick={onPull}
        disabled={isBusy}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        <ArrowDown size={ICON.SM} />
        Pull
      </button>
      {pullCount > 0 && (
        <div className="relative" ref={openList === "pull" ? popoverRef : undefined}>
          <button
            onClick={() => loadFileList("pull")}
            className="rounded-full bg-green-600 px-1.5 py-0 text-[10px] font-bold leading-4 text-white hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600"
          >
            {pullCount}
          </button>
          {openList === "pull" && (
            <FileListPopover files={listFiles} loading={listLoading} />
          )}
        </div>
      )}

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

      {/* Error */}
      {error && syncStatus === "error" && (
        <span className="text-xs text-red-500 truncate max-w-[120px]" title={error}>
          Sync error
        </span>
      )}

      {/* Last sync time */}
      {lastSyncTime && !error && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {formatLastSync(lastSyncTime)}
        </span>
      )}
    </div>
  );
}

function FileListPopover({
  files,
  loading,
}: {
  files: FileListItem[];
  loading: boolean;
}) {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 size={ICON.MD} className="animate-spin text-gray-400" />
        </div>
      ) : files.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-400">No files</div>
      ) : (
        <div className="max-h-48 overflow-y-auto py-1">
          {files.map((f) => (
            <div
              key={f.id}
              className="truncate px-3 py-1 text-xs text-gray-700 dark:text-gray-300"
              title={f.name}
            >
              {f.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
