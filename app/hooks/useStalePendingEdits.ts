import { useCallback, useEffect, useRef, useState } from "react";
import { getAllEditHistory } from "~/services/indexeddb-cache";
import { isSyncExcludedPath } from "~/services/sync-client-utils";

/**
 * Local edits live only in IndexedDB until a Push, and `editHistory` is the
 * ONLY record that a file changed — the md5 in sync meta still describes the
 * last-synced state. If that store is evicted (browser storage pressure, ITP,
 * "clear site data"), the edits stop looking modified and the next Pull
 * overwrites them silently. Warn once a pending edit has been sitting locally
 * long enough for that to be a real risk.
 */
export const STALE_PUSH_WARNING_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const RECHECK_INTERVAL_MS = 30 * 60 * 1000;
/** `file-modified` fires on every edit; a full history scan per keystroke is not worth it. */
const MIN_RECHECK_GAP_MS = 60 * 1000;

export interface StalePendingEdits {
  /** ISO timestamp of the oldest unpushed edit, or null when none is stale. */
  oldestEditAt: string | null;
  /** Whole days the oldest unpushed edit has been waiting. */
  days: number;
}

/** Oldest diff timestamp across every non-excluded edit-history entry. */
async function findOldestPendingEdit(): Promise<number | null> {
  const entries = await getAllEditHistory();
  let oldest: number | null = null;
  for (const entry of entries) {
    if (entry.filePath && isSyncExcludedPath(entry.filePath)) continue;
    for (const diff of entry.diffs) {
      const at = new Date(diff.timestamp).getTime();
      if (Number.isNaN(at)) continue;
      if (oldest === null || at < oldest) oldest = at;
    }
  }
  return oldest;
}

export function useStalePendingEdits(): StalePendingEdits {
  const [state, setState] = useState<StalePendingEdits>({ oldestEditAt: null, days: 0 });
  const lastCheckedAt = useRef(0);

  const recheck = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force && Date.now() - lastCheckedAt.current < MIN_RECHECK_GAP_MS) return;
    lastCheckedAt.current = Date.now();
    try {
      const oldest = await findOldestPendingEdit();
      if (oldest === null) {
        setState({ oldestEditAt: null, days: 0 });
        return;
      }
      const days = Math.floor((Date.now() - oldest) / DAY_MS);
      setState(
        days >= STALE_PUSH_WARNING_DAYS
          ? { oldestEditAt: new Date(oldest).toISOString(), days }
          : { oldestEditAt: null, days: 0 }
      );
    } catch {
      setState({ oldestEditAt: null, days: 0 });
    }
  }, []);

  useEffect(() => {
    void recheck({ force: true });
    // "sync-complete" covers pushes clearing history; "file-modified" covers a
    // first edit landing in an otherwise clean workspace. Both are throttled —
    // the warning is a days-scale signal, so a stale minute costs nothing.
    const onEvent = () => { void recheck(); };
    window.addEventListener("sync-complete", onEvent);
    window.addEventListener("file-modified", onEvent);
    const timer = window.setInterval(() => { void recheck({ force: true }); }, RECHECK_INTERVAL_MS);
    return () => {
      window.removeEventListener("sync-complete", onEvent);
      window.removeEventListener("file-modified", onEvent);
      window.clearInterval(timer);
    };
  }, [recheck]);

  return state;
}
