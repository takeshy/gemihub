import { setCachedFile, type LocalSyncMeta, type CachedRemoteMeta } from "~/services/indexeddb-cache";

import { isSyncExcludedPath as isCoreSyncExcludedPath } from "gemihub-sync-core/paths";

// Path / file type rules are shared with the other GemiHub clients through
// gemihub-sync-core.
export {
  SYNC_EXCLUDED_FILE_NAMES,
  SYNC_EXCLUDED_PREFIXES,
  isGoogleWorkspaceMimeType,
  isProjectInternalPath,
} from "gemihub-sync-core/paths";
export {
  isBinaryMimeType,
  isBinaryFileName,
  isTextFileName,
  shouldTreatAsBinaryFile,
  looksLikeBinary,
  guessMimeType,
  LARGE_FILE_CACHE_THRESHOLD,
  isLargeFile,
  isImageFileName,
} from "gemihub-sync-core/files";

// GCS project paths carry the managed root as a literal prefix
// ("gemihub/history/…"), while Drive paths are relative to the gemihub root
// folder and never include it. Strip it so both identities share one rule.
export function isSyncExcludedPath(fileName: string): boolean {
  return isCoreSyncExcludedPath(fileName, { managedRootPrefixes: ["gemihub/"] });
}

/**
 * Upload binary content directly to Google Drive, update IndexedDB cache,
 * and mutate localMeta/remoteMeta objects in-place (caller must persist them).
 * Returns true on success.
 */
export async function applyBinaryTempFile(
  fileId: string,
  content: string,
  fileName: string,
  localMeta?: LocalSyncMeta | null,
  remoteMeta?: CachedRemoteMeta | null,
): Promise<boolean> {
  const res = await fetch("/api/drive/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateBinary", fileId, content }),
  });
  if (!res.ok) return false;
  const data = await res.json();

  await setCachedFile({
    fileId,
    content,
    md5Checksum: data.md5Checksum || "",
    modifiedTime: data.file?.modifiedTime || "",
    cachedAt: Date.now(),
    fileName,
    encoding: "base64",
  });

  // Mutate localMeta in-place
  if (localMeta) {
    localMeta.files[fileId] = {
      md5Checksum: data.md5Checksum || "",
      modifiedTime: data.file?.modifiedTime || "",
    };
    localMeta.lastUpdatedAt = data.meta?.lastUpdatedAt || new Date().toISOString();
  }

  // Mutate remoteMeta in-place
  if (remoteMeta && data.meta?.files) {
    for (const [fid, fmeta] of Object.entries(data.meta.files as Record<string, Record<string, string>>)) {
      remoteMeta.files[fid] = { ...remoteMeta.files[fid], ...fmeta };
    }
    remoteMeta.lastUpdatedAt = data.meta.lastUpdatedAt;
    remoteMeta.cachedAt = Date.now();
  }

  window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId } }));
  return true;
}

export type SyncCompletionStatus = "idle" | "warning";

export function getSyncCompletionStatus(
  skippedCount: number,
  label: "Push" | "Full push"
): { status: SyncCompletionStatus; error: string | null } {
  if (skippedCount > 0) {
    return {
      status: "warning",
      error: `${label} completed with warning: skipped ${skippedCount} file(s).`,
    };
  }
  return { status: "idle", error: null };
}
