/**
 * Migrates `new:` prefix files in IndexedDB to real Drive files.
 *
 * Exposed as a module-level singleton so both the migration hook (for
 * background triggers) and the push flow (for pre-push wait) share one
 * in-flight run. Serializes work via a single `inFlight` Promise and
 * retriggers when more pending files appear mid-run.
 */

import {
  getPendingNewFiles,
  getCachedFile,
  deleteCachedFile,
  setCachedFile,
  getEditHistoryForFile,
  setEditHistoryEntry,
  deleteEditHistoryEntry,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  getLocalSyncMeta,
  setLocalSyncMeta,
} from "./indexeddb-cache";

let inFlight: Promise<void> | null = null;
let pendingRetrigger = false;

async function runOnce(): Promise<void> {
  const pendingFiles = await getPendingNewFiles();
  if (pendingFiles.length === 0) return;

  let migratedCount = 0;

  for (const pf of pendingFiles) {
    try {
      // pf.fileId is "new:<fullPath>" e.g. "new:workflows/test.yaml"
      const fullName = pf.fileId.slice("new:".length);
      const baseName = fullName.split("/").pop() || fullName;
      const mimeType =
        baseName.endsWith(".yaml") || baseName.endsWith(".yml")
          ? "text/yaml"
          : "text/plain";

      // Create file on Drive (empty — content uploaded separately below).
      // dedup: true handles the case where a prior session's create succeeded
      // on Drive but the client reloaded before finishing the migration.
      const createRes = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: fullName,
          content: "",
          mimeType,
          dedup: true,
        }),
      });
      if (!createRes.ok) continue;

      const createData = await createRes.json();
      const file = createData.file;

      // Re-read cache — user may have edited since we started
      const latest = await getCachedFile(pf.fileId);
      if (!latest) continue;

      const currentContent = latest.content;
      const emptyMd5 = file.md5Checksum ?? "";
      const emptyModifiedTime = file.modifiedTime ?? "";

      // Migrate editHistory from new: ID to real Drive ID
      const editHistory = await getEditHistoryForFile(pf.fileId);
      if (editHistory) {
        await deleteEditHistoryEntry(pf.fileId);
        await setEditHistoryEntry({
          ...editHistory,
          fileId: file.id,
          filePath: file.name,
        });
      }

      await deleteCachedFile(pf.fileId);
      await setCachedFile({
        fileId: file.id,
        content: currentContent,
        md5Checksum: emptyMd5,
        modifiedTime: emptyModifiedTime,
        cachedAt: Date.now(),
        fileName: file.name,
      });

      const meta = await getCachedRemoteMeta();
      if (meta) {
        delete meta.files[pf.fileId];
        meta.files[file.id] = {
          name: file.name,
          mimeType: file.mimeType,
          md5Checksum: emptyMd5,
          modifiedTime: emptyModifiedTime,
          createdTime: file.createdTime ?? emptyModifiedTime,
        };
        await setCachedRemoteMeta(meta);
      }

      const localMeta = await getLocalSyncMeta();
      if (localMeta) {
        localMeta.files[file.id] = {
          md5Checksum: emptyMd5,
          modifiedTime: emptyModifiedTime,
        };
        await setLocalSyncMeta(localMeta);
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("file-id-migrated", {
            detail: {
              oldId: pf.fileId,
              newId: file.id,
              fileName: file.name,
              mimeType: file.mimeType,
            },
          })
        );
      }

      migratedCount++;
    } catch {
      // Individual file failure — retries on next trigger
    }
  }

  if (migratedCount > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("sync-complete"));
  }
}

/**
 * Migrate all pending `new:` files to Drive. Callers can await this before
 * starting a push so that no pending files are silently dropped.
 * Concurrent calls share the same in-flight Promise; if new pending files
 * are created mid-run, the migration loops again before resolving.
 */
export function migratePendingFiles(): Promise<void> {
  if (inFlight) {
    pendingRetrigger = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        pendingRetrigger = false;
        await runOnce();
      } while (pendingRetrigger);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
