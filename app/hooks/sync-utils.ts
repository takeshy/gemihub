import {
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  type LocalSyncMeta,
} from "~/services/indexeddb-cache";
import { type SyncMeta } from "~/services/sync-diff";

export function toLocalSyncMeta(remoteMeta: {
  lastUpdatedAt: string;
  files: Record<string, { name?: string; md5Checksum?: string; modifiedTime?: string; size?: string }>;
}): LocalSyncMeta {
  const files: LocalSyncMeta["files"] = {};
  for (const [id, f] of Object.entries(remoteMeta.files)) {
    files[id] = {
      md5Checksum: f.md5Checksum ?? "",
      modifiedTime: f.modifiedTime ?? "",
      name: f.name,
      size: f.size,
    };
  }
  return {
    id: "current",
    lastUpdatedAt: remoteMeta.lastUpdatedAt,
    files,
  };
}

export function collectTrackedIds(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Set<string> {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const id of Object.keys(source)) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Keep cachedRemoteMeta in sync after push/pull/resolve/fullPull.
 * Without this, refreshSyncCounts uses stale cachedRemoteMeta
 * and may misclassify pushed files as localOnly or conflicts.
 */
export async function updateCachedRemoteMetaFromSyncMeta(remoteMeta: SyncMeta): Promise<void> {
  const existing = await getCachedRemoteMeta();
  if (existing?.rootFolderId) {
    // Preserve local-only "new:" entries that haven't been migrated to Drive yet
    const mergedFiles = { ...remoteMeta.files };
    for (const [id, entry] of Object.entries(existing.files)) {
      if (id.startsWith("new:") && !(id in mergedFiles)) {
        mergedFiles[id] = entry;
      }
    }
    await setCachedRemoteMeta({
      id: "current",
      rootFolderId: existing.rootFolderId,
      lastUpdatedAt: remoteMeta.lastUpdatedAt,
      files: mergedFiles,
      cachedAt: Date.now(),
    });
  }
}
