/**
 * Browser-side sync engine for the gemihub GCS storage layer.
 *
 * Composes:
 *   - storage-cache.ts (IndexedDB)
 *   - sync-diff-storage.ts (pure diff)
 *   - api.storage.* routes (server proxy to GCS)
 *
 * Replaces useSync.ts once the IDE shell is migrated; for now both layers
 * coexist. Phase 4/5 will wire this into a new useSync hook + UI.
 *
 * See docs/enterprise.md §5.
 */

import {
  deleteCachedObject,
  deleteLocalSyncEntry,
  getCachedObject,
  getRemoteSyncSnapshot,
  listCachedObjectsForMount,
  listLocalSyncEntriesForMount,
  objectPathForCachedFile,
  setCachedObject,
  setLocalSyncEntry,
  setRemoteSyncSnapshot,
  type CachedObject,
  type LocalSyncEntry,
  type RemoteSyncSnapshot,
} from "./storage-cache";
import {
  computeStorageSyncDiff,
  type ObjectSnapshot,
  type StorageSyncDiff,
} from "./sync-diff-storage";
import { isSyncExcludedPath } from "./sync-client-utils";

// ---------------------------------------------------------------------------
// Server response shapes (must match api.storage.*.tsx)
// ---------------------------------------------------------------------------

interface StoredObjectResponse {
  relativePath: string;
  contentType: string;
  size: number;
  md5Hash: string;
  revision: string;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

interface ListResponse {
  objects: StoredObjectResponse[];
  commonPrefixes: string[];
  nextPageToken?: string;
}

interface ReadResponse {
  object: StoredObjectResponse;
  content: string;
  encoding?: "utf-8" | "base64";
}

interface WriteResponse {
  object: StoredObjectResponse;
}

export class StorageSyncError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly objectPath?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageSyncError";
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body && !(init.headers as Record<string, string> | undefined)?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    const objectPath =
      typeof body === "object" && body !== null && "path" in body
        ? String((body as { path: unknown }).path)
        : undefined;
    throw new StorageSyncError(message, res.status, objectPath, body);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Snapshot construction
// ---------------------------------------------------------------------------

/**
 * Walk every page of /api/storage/list and return an ObjectSnapshot suitable
 * for sync-diff. Also persists the snapshot to remoteSync for offline replay.
 */
export async function fetchRemoteSnapshot(
  mount: string,
  mountKey: string,
): Promise<ObjectSnapshot> {
  const entries: ObjectSnapshot["entries"] = {};
  const remoteEntries: RemoteSyncSnapshot["entries"] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ mount, pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const list = await fetchJson<ListResponse>(`/api/storage/list?${params.toString()}`);
    for (const obj of list.objects) {
      if (isSyncExcludedPath(obj.relativePath)) continue;
      entries[obj.relativePath] = {
        md5Hash: obj.md5Hash,
        revision: obj.revision,
        updatedAt: obj.updatedAt,
      };
      remoteEntries.push({
        objectPath: objectPathForCachedFile(mountKey, obj.relativePath),
        relativePath: obj.relativePath,
        md5Hash: obj.md5Hash,
        revision: obj.revision,
        updatedAt: obj.updatedAt,
        contentType: obj.contentType,
        size: obj.size,
      });
    }
    pageToken = list.nextPageToken;
  } while (pageToken);

  await setRemoteSyncSnapshot({
    mountKey,
    fetchedAt: Date.now(),
    entries: remoteEntries,
  });
  return { entries };
}

/** Build a snapshot from the local IndexedDB sync table. */
export async function buildLocalBaseSnapshot(
  mountKey: string,
): Promise<ObjectSnapshot> {
  const rows = await listLocalSyncEntriesForMount(mountKey);
  const entries: ObjectSnapshot["entries"] = {};
  for (const r of rows) {
    if (isSyncExcludedPath(r.relativePath)) continue;
    entries[r.relativePath] = {
      md5Hash: r.md5Hash,
      revision: r.revision,
      updatedAt: r.updatedAt,
    };
  }
  return { entries };
}

export async function getLocallyModifiedPaths(
  mountKey: string,
): Promise<Set<string>> {
  const all = await listCachedObjectsForMount(mountKey);
  return new Set(
    all
      .filter((o) => o.dirty && !isSyncExcludedPath(o.relativePath))
      .map((o) => o.relativePath),
  );
}

export interface DetectChangesResult {
  diff: StorageSyncDiff;
  localBase: ObjectSnapshot;
  remote: ObjectSnapshot;
}

export interface FullPullResult {
  pulledCount: number;
  trashedLocalOnlyCount: number;
  droppedLocalOnlyCount: number;
}

export async function detectChanges(
  mount: string,
  mountKey: string,
  options?: { useCachedRemote?: boolean },
): Promise<DetectChangesResult> {
  const localBase = await buildLocalBaseSnapshot(mountKey);
  const modified = await getLocallyModifiedPaths(mountKey);

  let remote: ObjectSnapshot;
  if (options?.useCachedRemote) {
    const cached = await getRemoteSyncSnapshot(mountKey);
    remote = cached
      ? {
          entries: Object.fromEntries(
            cached.entries.map((e) => [
              e.relativePath,
              { md5Hash: e.md5Hash, revision: e.revision, updatedAt: e.updatedAt },
            ]),
          ),
        }
      : await fetchRemoteSnapshot(mount, mountKey);
  } else {
    remote = await fetchRemoteSnapshot(mount, mountKey);
  }

  await reconcileCleanCacheWithRemote(mountKey, localBase, remote, modified);
  const diff = computeStorageSyncDiff(localBase, remote, modified);
  return { diff, localBase, remote };
}

async function reconcileCleanCacheWithRemote(
  mountKey: string,
  localBase: ObjectSnapshot,
  remote: ObjectSnapshot,
  locallyModified: Set<string>,
): Promise<void> {
  const cachedObjects = await listCachedObjectsForMount(mountKey);
  for (const cached of cachedObjects) {
    if (isSyncExcludedPath(cached.relativePath)) continue;
    if (cached.dirty || locallyModified.has(cached.relativePath)) continue;
    const remoteEntry = remote.entries[cached.relativePath];
    if (!remoteEntry || remoteEntry.md5Hash !== cached.md5Hash) continue;

    localBase.entries[cached.relativePath] = {
      md5Hash: remoteEntry.md5Hash,
      revision: remoteEntry.revision,
      updatedAt: remoteEntry.updatedAt,
    };

    const reconciled =
      cached.revision === remoteEntry.revision
        ? cached
        : {
            ...cached,
            revision: remoteEntry.revision,
            cachedAt: Date.now(),
          };
    if (reconciled !== cached) {
      await setCachedObject(reconciled);
    }
    await setLocalSyncEntry(toLocalSyncEntry(reconciled));
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

export async function fullPullFromRemote(
  mount: string,
  mountKey: string,
): Promise<FullPullResult> {
  const remote = await fetchRemoteSnapshot(mount, mountKey);
  const remotePaths = new Set(Object.keys(remote.entries));
  const now = Date.now();
  let trashedLocalOnlyCount = 0;
  let droppedLocalOnlyCount = 0;

  const cachedObjects = await listCachedObjectsForMount(mountKey);
  for (const cached of cachedObjects) {
    if (isSyncExcludedPath(cached.relativePath)) continue;
    if (cached.relativePath.startsWith("trash/")) continue;
    if (remotePaths.has(cached.relativePath)) continue;

    await deleteCachedObject(mountKey, cached.objectPath).catch(() => {});
    await deleteLocalSyncEntry(mountKey, cached.objectPath).catch(() => {});

    if (cached.dirty || cached.objectPath.startsWith("new:")) {
      const originalPath = cached.objectPath.startsWith("new:")
        ? cached.objectPath.slice("new:".length)
        : cached.relativePath;
      const trashPath = `trash/full-pull-${now}/${originalPath.replace(/^\/+/, "")}`;
      await setCachedObject({
        ...cached,
        objectPath: `new:${trashPath}`,
        relativePath: trashPath,
        cachedAt: now,
        dirty: false,
      });
      trashedLocalOnlyCount += 1;
    } else {
      droppedLocalOnlyCount += 1;
    }
  }

  const localSyncEntries = await listLocalSyncEntriesForMount(mountKey);
  for (const entry of localSyncEntries) {
    if (isSyncExcludedPath(entry.relativePath) || !remotePaths.has(entry.relativePath)) {
      await deleteLocalSyncEntry(mountKey, entry.objectPath).catch(() => {});
    }
  }

  const paths = Object.keys(remote.entries).filter((path) => !isSyncExcludedPath(path));
  for (const path of paths) {
    await pullObject(mount, mountKey, path);
  }

  return {
    pulledCount: paths.length,
    trashedLocalOnlyCount,
    droppedLocalOnlyCount,
  };
}

/** Pull a single object, write it to cache, and update the localSync entry. */
export async function pullObject(
  mount: string,
  mountKey: string,
  relativePath: string,
): Promise<CachedObject> {
  if (isSyncExcludedPath(relativePath)) {
    throw new StorageSyncError("object is excluded from sync", 400, relativePath);
  }
  const params = new URLSearchParams({ mount, path: relativePath, format: "json" });
  const result = await fetchJson<ReadResponse>(`/api/storage/read?${params.toString()}`);
  const cached: CachedObject = {
    mountKey,
    objectPath: objectPathForCachedFile(mountKey, result.object.relativePath),
    relativePath: result.object.relativePath,
    content: result.content,
    encoding: result.encoding ?? "utf-8",
    contentType: result.object.contentType,
    md5Hash: result.object.md5Hash,
    revision: result.object.revision,
    cachedAt: Date.now(),
    dirty: false,
  };
  await setCachedObject(cached);
  await setLocalSyncEntry(toLocalSyncEntry(cached));
  return cached;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Push a single object. The cached `dirty` flag must be set; otherwise the
 * object is skipped.
 *
 * Uses ifRevisionMatch with the cached `revision` to refuse silent
 * overwrites — if the server has a newer copy, throws StorageSyncError(412).
 */
export async function pushObject(
  mount: string,
  mountKey: string,
  relativePath: string,
  options?: { ifRevisionMatch?: string },
): Promise<CachedObject> {
  if (isSyncExcludedPath(relativePath)) {
    throw new StorageSyncError("object is excluded from sync", 400, relativePath);
  }
  const cached = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, relativePath));
  if (!cached) {
    throw new StorageSyncError(
      "object not in local cache",
      404,
      relativePath,
    );
  }
  if (!cached.dirty) {
    // No-op: nothing to push.
    return cached;
  }

  const result = await fetchJson<WriteResponse>("/api/storage/write", {
    method: "POST",
    body: JSON.stringify({
      mount,
      path: relativePath,
      content: cached.content,
      encoding: cached.encoding,
      contentType: cached.contentType,
      // A fresh remote snapshot may prove that this is a new object even when
      // IndexedDB still carries a generation from an older/removed backend.
      // Let that caller explicitly require non-existence instead of reusing
      // the stale cached generation. Ordinary updates retain the cached
      // generation and therefore remain protected against lost updates.
      ifRevisionMatch: (options?.ifRevisionMatch ?? cached.revision) || "0",
    }),
  });

  const updated: CachedObject = {
    ...cached,
    syncedContent: cached.content,
    md5Hash: result.object.md5Hash,
    revision: result.object.revision,
    dirty: false,
    cachedAt: Date.now(),
  };
  await setCachedObject(updated);
  await setLocalSyncEntry(toLocalSyncEntry(updated));
  return updated;
}

// ---------------------------------------------------------------------------
// Local-side mutators
// ---------------------------------------------------------------------------

/** Mark a cached object dirty after the user edits it. */
export async function markDirty(
  mountKey: string,
  relativePath: string,
  newContent: string,
  encoding: "utf-8" | "base64" = "utf-8",
): Promise<CachedObject> {
  const existing = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, relativePath));
  if (!existing) {
    throw new StorageSyncError("object not in local cache; pull first", 404, relativePath);
  }
  const updated: CachedObject = {
    ...existing,
    content: newContent,
    encoding,
    cachedAt: Date.now(),
    dirty: true,
  };
  await setCachedObject(updated);
  return updated;
}

/** Remove the local cache and sync entry for an object, e.g. after a pull-side delete. */
export async function dropLocal(
  mountKey: string,
  relativePath: string,
): Promise<void> {
  const cached = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, relativePath));
  if (cached) await deleteCachedObject(mountKey, cached.objectPath);
  // The local-sync key is the same as the cache key.
  if (cached) await deleteLocalSyncEntry(mountKey, cached.objectPath);
}

function toLocalSyncEntry(obj: CachedObject): LocalSyncEntry {
  return {
    mountKey: obj.mountKey,
    objectPath: obj.objectPath,
    relativePath: obj.relativePath,
    md5Hash: obj.md5Hash,
    revision: obj.revision,
    updatedAt: obj.cachedAt,
  };
}
