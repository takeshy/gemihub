import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, ArrowDown, AlertTriangle, Loader2 } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { SyncStatus, ConflictInfo } from "~/hooks/useSync";
import {
  getCachedRemoteMeta,
  getLocallyModifiedFileIds,
} from "~/services/indexeddb-cache";

interface SyncStatusBarProps {
  syncStatus: SyncStatus;
  lastSyncTime: string | null;
  error: string | null;
  localModifiedCount: number;
  onPush: () => void;
  onPull: () => void;
  onShowConflicts: () => void;
  onSelectFile?: (fileId: string, fileName: string, mimeType: string) => void;
  conflicts: ConflictInfo[];
  compact?: boolean;
}

interface FileListItem {
  id: string;
  name: string;
}

export function SyncStatusBar({
  syncStatus,
  lastSyncTime,
  error,
  localModifiedCount,
  onPush,
  onPull,
  onShowConflicts,
  onSelectFile,
  conflicts,
  compact = false,
}: SyncStatusBarProps) {
  const conflictCount = conflicts.length;
  const isBusy = syncStatus === "pushing" || syncStatus === "pulling";

  const [openList, setOpenList] = useState<"push" | null>(null);
  const [listFiles, setListFiles] = useState<FileListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  // Filtered local modified count (only files tracked in remoteMeta)
  const [filteredLocalModifiedCount, setFilteredLocalModifiedCount] = useState(0);
  const pushCount = filteredLocalModifiedCount;
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

  // Filter localModifiedCount to exclude files not in remoteMeta (e.g. history/logs)
  useEffect(() => {
    if (localModifiedCount === 0) {
      setFilteredLocalModifiedCount(0);
      return;
    }
    (async () => {
      try {
        const remoteMeta = await getCachedRemoteMeta();
        const tracked = remoteMeta?.files ?? {};
        const localModified = await getLocallyModifiedFileIds();
        let count = 0;
        for (const id of localModified) {
          if (tracked[id]) count++;
        }
        setFilteredLocalModifiedCount(count);
      } catch {
        setFilteredLocalModifiedCount(0);
      }
    })();
  }, [localModifiedCount]);

  const loadFileList = useCallback(async () => {
    if (openList === "push") {
      setOpenList(null);
      return;
    }

    setListLoading(true);
    setOpenList("push");

    try {
      const remoteMeta = await getCachedRemoteMeta();
      const nameMap = remoteMeta?.files ?? {};

      const localModified = await getLocallyModifiedFileIds();
      const files: FileListItem[] = [];
      // Only include files tracked in remoteMeta (exclude history/logs)
      for (const id of localModified) {
        if (nameMap[id]) {
          files.push({ id, name: nameMap[id].name ?? id });
        }
      }

      files.sort((a, b) => a.name.localeCompare(b.name));
      setListFiles(files);
    } catch {
      setListFiles([]);
    } finally {
      setListLoading(false);
    }
  }, [openList]);

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

      {/* Push button + count badge */}
      <button
        onClick={onPush}
        disabled={isBusy}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        <ArrowUp size={ICON.SM} />
        {!compact && "Push"}
      </button>
      {pushCount > 0 && (
        <div className="relative" ref={openList === "push" ? popoverRef : undefined}>
          <button
            onClick={() => loadFileList()}
            className="rounded-full bg-blue-600 px-1.5 py-0 text-[10px] font-bold leading-4 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {pushCount}
          </button>
          {openList === "push" && (
            <FileListPopover files={listFiles} loading={listLoading} onSelect={(f) => { setOpenList(null); onSelectFile?.(f.id, f.name, guessMimeType(f.name)); }} />
          )}
        </div>
      )}

      {/* Pull button */}
      <button
        onClick={onPull}
        disabled={isBusy}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        <ArrowDown size={ICON.SM} />
        {!compact && "Pull"}
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

      {/* Error */}
      {error && syncStatus === "error" && (
        <span className="text-xs text-red-500 truncate max-w-[120px]" title={error}>
          Sync error
        </span>
      )}

      {/* Last sync time */}
      {lastSyncTime && !error && !compact && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {formatLastSync(lastSyncTime)}
        </span>
      )}
    </div>
  );
}

function guessMimeType(name: string): string {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "text/yaml";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

function FileListPopover({
  files,
  loading,
  onSelect,
}: {
  files: FileListItem[];
  loading: boolean;
  onSelect?: (file: FileListItem) => void;
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
            <button
              key={f.id}
              className="block w-full truncate px-3 py-1 text-left text-xs text-blue-600 hover:bg-gray-100 hover:underline dark:text-blue-400 dark:hover:bg-gray-800"
              title={f.name}
              onClick={() => onSelect?.(f)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
