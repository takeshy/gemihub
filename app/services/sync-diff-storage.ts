/**
 * Pure sync diff for the gemihub GCS storage layer.
 *
 * Mirrors the algorithm in `sync-diff.ts` (which targets Drive) but works on
 * objectPath keys, md5Hash + revision, and avoids Drive-specific concepts
 * like a stored `_sync-meta.json` file (GCS list-objects is cheap enough that
 * the remote snapshot is built fresh on each pull).
 *
 * See docs/enterprise.md §5.
 */

export interface ObjectSnapshotEntry {
  md5Hash: string;
  /** GCS object revision — used for If-RevisionMatch on push. */
  revision: string;
  updatedAt: number;
}

/** Snapshot of object metadata, keyed by relativePath under the project prefix. */
export interface ObjectSnapshot {
  entries: Record<string, ObjectSnapshotEntry>;
}

export interface StorageSyncConflict {
  objectPath: string;
  localMd5: string;
  remoteMd5: string;
  /** From the localSync table — what we knew when we last synced. */
  baseRevision: string;
  /** Currently on the server. */
  remoteRevision: string;
}

export interface StorageSyncDiff {
  /** Locally edited, safely overwritable on the server. */
  toPush: string[];
  /** Server-changed; safe to overwrite the local copy. */
  toPull: string[];
  /** Both sides have changed since last sync — needs user resolution. */
  conflicts: StorageSyncConflict[];
  /** Locally edited but the server-side object was deleted. */
  editDeleteConflicts: string[];
  /** New locally; never been pushed. */
  localOnly: string[];
  /** New remotely; never been pulled. */
  remoteOnly: string[];
}

/**
 * Compute the sync diff.
 *
 * @param localBase   What the local cache last saw on the server
 *                    (the localSync table). null/empty = first sync.
 * @param remote      What the server currently has (fresh listObjectsForSync).
 *                    null = treat as empty.
 * @param locallyModified Set of objectPaths that the user has edited locally
 *                    since the last sync. The cache's `dirty` flag drives this.
 */
export function computeStorageSyncDiff(
  localBase: ObjectSnapshot | null,
  remote: ObjectSnapshot | null,
  locallyModified: Set<string> = new Set(),
): StorageSyncDiff {
  const baseEntries = localBase?.entries ?? {};
  const remoteEntries = remote?.entries ?? {};

  const toPush: string[] = [];
  const toPull: string[] = [];
  const conflicts: StorageSyncConflict[] = [];
  const editDeleteConflicts: string[] = [];
  const localOnly: string[] = [];
  const remoteOnly: string[] = [];

  const allPaths = new Set<string>();
  for (const k of Object.keys(baseEntries)) allPaths.add(k);
  for (const k of Object.keys(remoteEntries)) allPaths.add(k);
  for (const k of locallyModified) allPaths.add(k);

  for (const path of allPaths) {
    const base = baseEntries[path];
    const remoteEntry = remoteEntries[path];
    const isLocallyModified = locallyModified.has(path);
    const hasBase = !!base;
    const hasRemote = !!remoteEntry;

    const remoteChanged = hasBase && hasRemote && base.md5Hash !== remoteEntry.md5Hash;

    if (!hasBase && !hasRemote) {
      // Locally modified but never synced AND no remote = brand-new local file
      if (isLocallyModified) localOnly.push(path);
      continue;
    }
    if (!hasBase && hasRemote) {
      // Remote we've never pulled
      remoteOnly.push(path);
      continue;
    }
    if (hasBase && !hasRemote) {
      // Server lost it (deleted by another client)
      if (isLocallyModified) {
        editDeleteConflicts.push(path);
      }
      // else: silently drop from local — caller decides whether to delete cache.
      continue;
    }
    // hasBase && hasRemote
    if (isLocallyModified && remoteChanged) {
      conflicts.push({
        objectPath: path,
        localMd5: base.md5Hash, // The base md5; the local cache holds the new content
        remoteMd5: remoteEntry.md5Hash,
        baseRevision: base.revision,
        remoteRevision: remoteEntry.revision,
      });
    } else if (isLocallyModified) {
      toPush.push(path);
    } else if (remoteChanged) {
      toPull.push(path);
    }
    // else: clean and unchanged — no-op
  }

  return { toPush, toPull, conflicts, editDeleteConflicts, localOnly, remoteOnly };
}
