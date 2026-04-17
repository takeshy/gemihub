/**
 * Process drive file events from local workflow execution.
 *
 * Data writes (IndexedDB cache, editHistory) are already handled by the
 * drive-local.ts / drive-tools-local.ts callers.  This function is
 * responsible only for dispatching browser events so the UI refreshes.
 *
 * IMPORTANT: We must NOT dispatch "sync-complete" for locally-created files.
 * "sync-complete" triggers fetchAndCacheTree() which fetches the tree from
 * the server and overwrites CachedRemoteMeta — erasing the local-only
 * "new:xxx" entries added by writeFileLocal().  Instead we dispatch
 * "tree-meta-updated" which rebuilds the tree from the current local
 * CachedRemoteMeta (preserving local-only entries).
 */
import type { DriveEvent } from "~/engine/local-executor";

export async function processDriveEvent(event: DriveEvent): Promise<void> {
  switch (event.type) {
    case "updated": {
      const { fileId, content } = event;
      if (content != null) {
        window.dispatchEvent(
          new CustomEvent("file-modified", { detail: { fileId } })
        );
        window.dispatchEvent(
          new CustomEvent("file-restored", { detail: { fileId, content } })
        );
      } else {
        dispatchTreeRefreshFromLocalMeta();
      }
      break;
    }
    case "created":
    case "deleted":
      // Rebuild tree from local CachedRemoteMeta (not server) so local-only
      // files appear immediately.
      dispatchTreeRefreshFromLocalMeta();
      // Notify sync counter so push count updates
      window.dispatchEvent(
        new CustomEvent("file-modified", { detail: { fileId: event.fileId } })
      );
      break;
  }
}

// Fire the event with NO payload — the handler re-reads CachedRemoteMeta fresh.
// Passing a meta snapshot here would race with concurrent writers (especially
// usePendingFileMigration, which deletes the `new:` entry after creating the
// real Drive file): a queued handler carrying a pre-migration snapshot could
// clobber the post-migration meta and resurrect the stale `new:` entry, which
// a subsequent fetchAndCacheTree then preserves alongside the real ID —
// producing two tree nodes with the same filename.
function dispatchTreeRefreshFromLocalMeta(): void {
  window.dispatchEvent(new CustomEvent("tree-meta-updated"));
}
