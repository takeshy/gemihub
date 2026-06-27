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
  deleteEditHistoryEntry,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  getLocalSyncMeta,
  setLocalSyncMeta,
} from "./indexeddb-cache";
import { mimeTypeFromFileName } from "./drive-local";

let inFlight: Promise<void> | null = null;
let pendingRetrigger = false;

async function runOnce(): Promise<void> {
  // Every create call hits Drive; skip entirely when offline so per-file
  // fetches don't fail and spam retries on every "pending-files-created" event.
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  const pendingFiles = await getPendingNewFiles();
  if (pendingFiles.length === 0) return;

  let migratedCount = 0;

  for (const pf of pendingFiles) {
    try {
      const fullName = pf.fileId.slice("new:".length);
      const mimeType = mimeTypeFromFileName(fullName);

      // Create file on Drive; cached content is uploaded immediately after
      // the placeholder is resolved to a real Drive file ID.
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
      let file = createData.file;

      // Re-read cache — user may have edited since we started
      const latest = await getCachedFile(pf.fileId);
      if (!latest) {
        // The local draft was deleted while the Drive create request was in flight.
        // Remove the just-created remote placeholder so a deleted local PNG/binary
        // file does not reappear from remote metadata on the next tree refresh.
        await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", fileId: file.id, permanent: true }),
        }).catch(() => {});
        continue;
      }

      const currentContent = latest.content;

      const updateRes = latest.encoding === "base64"
        ? await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "updateBinary",
              fileId: file.id,
              content: currentContent,
            }),
          })
        : currentContent
          ? await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "update",
                fileId: file.id,
                content: currentContent,
                mimeType,
              }),
            })
          : null;

      if (updateRes && !updateRes.ok) {
        await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", fileId: file.id, permanent: true }),
        }).catch(() => {});
        continue;
      }
      if (updateRes) {
        const updateData = await updateRes.json();
        file = updateData.file ?? file;
      }

      const currentMd5 = file.md5Checksum ?? "";
      const currentModifiedTime = file.modifiedTime ?? "";

      const editHistory = await getEditHistoryForFile(pf.fileId);
      if (editHistory) {
        await deleteEditHistoryEntry(pf.fileId);
      }

      await deleteCachedFile(pf.fileId);
      await setCachedFile({
        fileId: file.id,
        content: currentContent,
        md5Checksum: currentMd5,
        modifiedTime: currentModifiedTime,
        cachedAt: Date.now(),
        fileName: file.name,
        ...(latest.encoding ? { encoding: latest.encoding } : {}),
      });

      const meta = await getCachedRemoteMeta();
      if (meta) {
        delete meta.files[pf.fileId];
        meta.files[file.id] = {
          name: file.name,
          mimeType: file.mimeType,
          md5Checksum: currentMd5,
          modifiedTime: currentModifiedTime,
          createdTime: file.createdTime ?? currentModifiedTime,
        };
        await setCachedRemoteMeta(meta);
      }

      const localMeta = await getLocalSyncMeta();
      if (localMeta) {
        delete localMeta.files[pf.fileId];
        localMeta.files[file.id] = {
          md5Checksum: currentMd5,
          modifiedTime: currentModifiedTime,
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

function startRun(): Promise<void> {
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

/**
 * Trigger a migration run. Callers that just created new pending work (e.g.
 * the `pending-files-created` event) use this — if a run is already in
 * flight, sets the retrigger flag so the loop re-scans after the current
 * iteration completes.
 */
export function migratePendingFiles(): Promise<void> {
  if (inFlight) {
    pendingRetrigger = true;
    return inFlight;
  }
  return startRun();
}

/**
 * Wait until no `new:` files remain. Callers that haven't added work
 * themselves (push flushing before diff) use this — it joins the current
 * run without forcing a retrigger, then re-checks and starts another run
 * if late arrivals slipped in.
 */
export async function awaitPendingMigrations(): Promise<void> {
  while (true) {
    if (inFlight) {
      await inFlight;
      continue;
    }
    const pending = await getPendingNewFiles();
    if (pending.length === 0) return;
    await startRun();
  }
}
