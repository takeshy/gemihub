import { RefreshCw, ArrowUp, ArrowDown, AlertTriangle, Loader2 } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { SyncStatus, SyncDiff, ConflictInfo } from "~/hooks/useSync";

interface SyncStatusBarProps {
  syncStatus: SyncStatus;
  diff: SyncDiff | null;
  lastSyncTime: string | null;
  error: string | null;
  onPush: () => void;
  onPull: () => void;
  onCheckSync: () => void;
  onShowConflicts: () => void;
  conflicts: ConflictInfo[];
}

export function SyncStatusBar({
  syncStatus,
  diff,
  lastSyncTime,
  error,
  onPush,
  onPull,
  onCheckSync,
  onShowConflicts,
  conflicts,
}: SyncStatusBarProps) {
  const pushCount = diff ? diff.toPush.length + diff.localOnly.length : 0;
  const pullCount = diff ? diff.toPull.length + diff.remoteOnly.length : 0;
  const conflictCount = conflicts.length;

  const isBusy = syncStatus === "checking" || syncStatus === "pushing" || syncStatus === "pulling";

  const formatLastSync = (time: string | null) => {
    if (!time) return null;
    const diff = Date.now() - new Date(time).getTime();
    const minutes = Math.floor(diff / 60000);
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

      {/* Push button */}
      {pushCount > 0 && (
        <button
          onClick={onPush}
          disabled={isBusy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 disabled:opacity-50"
          title={`Push ${pushCount} change${pushCount > 1 ? "s" : ""}`}
        >
          <ArrowUp size={ICON.SM} />
          <span>{pushCount}</span>
        </button>
      )}

      {/* Pull button */}
      {pullCount > 0 && (
        <button
          onClick={onPull}
          disabled={isBusy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 disabled:opacity-50"
          title={`Pull ${pullCount} change${pullCount > 1 ? "s" : ""}`}
        >
          <ArrowDown size={ICON.SM} />
          <span>{pullCount}</span>
        </button>
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
