/**
 * Browser-side cache for GCS-backed objects (gemihub).
 *
 * Enterprise-only. IndexedDB cache keyed by [mountKey, objectPath].
 * Tracks GCS object revision alongside md5 for If-RevisionMatch support.
 *
 * See docs/enterprise.md §5.3.
 */

const DB_NAME = "gemihub-storage";
const DB_VERSION = 3;

const STORE_OBJECTS = "objects";
const STORE_LOCAL_SYNC = "localSync";
const STORE_REMOTE_SYNC = "remoteSync";
const STORE_EDIT_HISTORY = "editHistory";
const STORE_CONFLICT_BACKUPS = "conflictBackups";

const INDEX_OBJECTS_TENANT = "by_tenant";
const INDEX_LOCAL_SYNC_TENANT = "by_tenant";
const INDEX_EDIT_HISTORY_TENANT = "by_tenant";
const INDEX_CONFLICT_BACKUPS_TENANT = "by_tenant";

export interface CachedObject {
  mountKey: string;
  objectPath: string;
  relativePath: string;
  content: string;
  /** Last text content known to match GCS, retained while local content is dirty. */
  syncedContent?: string;
  rawContentBase64?: string;
  encoding: "utf-8" | "base64";
  contentType: string;
  md5Hash: string;
  revision: string;
  cachedAt: number;
  /**
   * Set to true when the local copy has been edited but not yet pushed.
   * Sync layer reads this to build the push set.
   */
  dirty?: boolean;
}

export interface LocalSyncEntry {
  mountKey: string;
  objectPath: string;
  relativePath: string;
  md5Hash: string;
  revision: string;
  updatedAt: number;
}

export interface RemoteSyncSnapshot {
  mountKey: string;
  fetchedAt: number;
  entries: Array<{
    objectPath: string;
    relativePath: string;
    md5Hash: string;
    revision: string;
    updatedAt: number;
    /** Optional display/cache metadata retained for local-first viewers. */
    contentType?: string;
    size?: number;
  }>;
}

export interface ConflictBackup {
  id: string;
  mountKey: string;
  relativePath: string;
  content: string;
  encoding: "utf-8" | "base64";
  contentType: string;
  createdAt: number;
}

export function scopeFromMountKey(mountKey: string): string {
  const parts = mountKey.split("/");
  return parts[parts.length - 1] || mountKey;
}

export function objectPathForCachedFile(
  mountKey: string,
  relativePath: string,
): string {
  if (relativePath.startsWith("new:")) return relativePath;
  return `${scopeFromMountKey(mountKey)}/${relativePath.replace(/^\/+/, "")}`;
}

// ---------------------------------------------------------------------------
// Singleton DB connection
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
        const store = db.createObjectStore(STORE_OBJECTS, {
          keyPath: ["mountKey", "objectPath"],
        });
        store.createIndex(INDEX_OBJECTS_TENANT, "mountKey", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_LOCAL_SYNC)) {
        const store = db.createObjectStore(STORE_LOCAL_SYNC, {
          keyPath: ["mountKey", "objectPath"],
        });
        store.createIndex(INDEX_LOCAL_SYNC_TENANT, "mountKey", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_REMOTE_SYNC)) {
        // Keyed by mountKey — one snapshot per tenant.
        db.createObjectStore(STORE_REMOTE_SYNC, { keyPath: "mountKey" });
      }

      if (!db.objectStoreNames.contains(STORE_EDIT_HISTORY)) {
        const store = db.createObjectStore(STORE_EDIT_HISTORY, {
          keyPath: ["mountKey", "fileId"],
        });
        store.createIndex(INDEX_EDIT_HISTORY_TENANT, "mountKey", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_CONFLICT_BACKUPS)) {
        const store = db.createObjectStore(STORE_CONFLICT_BACKUPS, { keyPath: "id" });
        store.createIndex(INDEX_CONFLICT_BACKUPS_TENANT, "mountKey", { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Tests only: drop the cached connection so the next call re-opens against
 * whatever `indexedDB` is currently in scope. Production code never needs
 * this because the singleton is closed automatically on `versionchange`.
 */
export function _resetDBForTests(): void {
  dbPromise = null;
}

function txPromise<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (
    tx: IDBTransaction,
    stores: Record<string, IDBObjectStore>,
  ) => Promise<T> | T,
): Promise<T> {
  return getDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const stores: Record<string, IDBObjectStore> = {};
        for (const name of names) stores[name] = tx.objectStore(name);
        let result: T;
        Promise.resolve(fn(tx, stores))
          .then((r) => {
            result = r;
          })
          .catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
      }),
  );
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Cached objects
// ---------------------------------------------------------------------------

export async function getCachedObject(
  mountKey: string,
  objectPath: string,
): Promise<CachedObject | undefined> {
  return txPromise(STORE_OBJECTS, "readonly", async (_tx, stores) => {
    return reqPromise(stores[STORE_OBJECTS].get([mountKey, objectPath]) as IDBRequest<CachedObject | undefined>);
  });
}

export async function setCachedObject(obj: CachedObject): Promise<void> {
  await txPromise(STORE_OBJECTS, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_OBJECTS].put(obj));
  });
}

export async function deleteCachedObject(
  mountKey: string,
  objectPath: string,
): Promise<void> {
  await txPromise(STORE_OBJECTS, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_OBJECTS].delete([mountKey, objectPath]));
  });
}

export async function listCachedObjectsForMount(
  mountKey: string,
): Promise<CachedObject[]> {
  return txPromise(STORE_OBJECTS, "readonly", async (_tx, stores) => {
    const index = stores[STORE_OBJECTS].index(INDEX_OBJECTS_TENANT);
    return reqPromise(index.getAll(IDBKeyRange.only(mountKey)) as IDBRequest<CachedObject[]>);
  });
}

export async function listDirtyObjectsForMount(
  mountKey: string,
): Promise<CachedObject[]> {
  const all = await listCachedObjectsForMount(mountKey);
  return all.filter((o) => o.dirty);
}

function deleteAllByIndex(index: IDBIndex, key: IDBValidKey): Promise<void> {
  // cursor.continue() reuses the originating request — onsuccess fires for
  // each row, then once with cursor === null when iteration is exhausted.
  return new Promise((resolve, reject) => {
    const req = index.openCursor(IDBKeyRange.only(key));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearMountCache(mountKey: string): Promise<void> {
  await txPromise(
    [STORE_OBJECTS, STORE_LOCAL_SYNC, STORE_REMOTE_SYNC, STORE_CONFLICT_BACKUPS],
    "readwrite",
    async (_tx, stores) => {
      await deleteAllByIndex(
        stores[STORE_OBJECTS].index(INDEX_OBJECTS_TENANT),
        mountKey,
      );
      await deleteAllByIndex(
        stores[STORE_LOCAL_SYNC].index(INDEX_LOCAL_SYNC_TENANT),
        mountKey,
      );
      await reqPromise(stores[STORE_REMOTE_SYNC].delete(mountKey));
      await deleteAllByIndex(
        stores[STORE_CONFLICT_BACKUPS].index(INDEX_CONFLICT_BACKUPS_TENANT),
        mountKey,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Conflict backups (browser-local, tenant scoped)
// ---------------------------------------------------------------------------

export async function saveLocalConflictBackup(
  backup: Omit<ConflictBackup, "id" | "createdAt">,
): Promise<ConflictBackup> {
  const saved: ConflictBackup = {
    ...backup,
    id: `${Date.now()}-${crypto.randomUUID()}`,
    createdAt: Date.now(),
  };
  await txPromise(STORE_CONFLICT_BACKUPS, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_CONFLICT_BACKUPS].put(saved));
  });
  return saved;
}

export async function listLocalConflictBackups(
  mountKey: string,
): Promise<ConflictBackup[]> {
  return txPromise(STORE_CONFLICT_BACKUPS, "readonly", async (_tx, stores) => {
    const index = stores[STORE_CONFLICT_BACKUPS].index(INDEX_CONFLICT_BACKUPS_TENANT);
    return reqPromise(
      index.getAll(IDBKeyRange.only(mountKey)) as IDBRequest<ConflictBackup[]>,
    );
  });
}

// ---------------------------------------------------------------------------
// Local sync metadata (last-known md5 / revision per object)
// ---------------------------------------------------------------------------

export async function getLocalSyncEntry(
  mountKey: string,
  objectPath: string,
): Promise<LocalSyncEntry | undefined> {
  return txPromise(STORE_LOCAL_SYNC, "readonly", async (_tx, stores) => {
    return reqPromise(
      stores[STORE_LOCAL_SYNC].get([mountKey, objectPath]) as IDBRequest<LocalSyncEntry | undefined>,
    );
  });
}

export async function setLocalSyncEntry(entry: LocalSyncEntry): Promise<void> {
  await txPromise(STORE_LOCAL_SYNC, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_LOCAL_SYNC].put(entry));
  });
}

export async function deleteLocalSyncEntry(
  mountKey: string,
  objectPath: string,
): Promise<void> {
  await txPromise(STORE_LOCAL_SYNC, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_LOCAL_SYNC].delete([mountKey, objectPath]));
  });
}

export async function listLocalSyncEntriesForMount(
  mountKey: string,
): Promise<LocalSyncEntry[]> {
  return txPromise(STORE_LOCAL_SYNC, "readonly", async (_tx, stores) => {
    const index = stores[STORE_LOCAL_SYNC].index(INDEX_LOCAL_SYNC_TENANT);
    return reqPromise(
      index.getAll(IDBKeyRange.only(mountKey)) as IDBRequest<LocalSyncEntry[]>,
    );
  });
}

// ---------------------------------------------------------------------------
// Remote sync snapshots (last fetched listObjectsForSync per tenant)
// ---------------------------------------------------------------------------

export async function getRemoteSyncSnapshot(
  mountKey: string,
): Promise<RemoteSyncSnapshot | undefined> {
  return txPromise(STORE_REMOTE_SYNC, "readonly", async (_tx, stores) => {
    return reqPromise(
      stores[STORE_REMOTE_SYNC].get(mountKey) as IDBRequest<RemoteSyncSnapshot | undefined>,
    );
  });
}

export async function setRemoteSyncSnapshot(snapshot: RemoteSyncSnapshot): Promise<void> {
  await txPromise(STORE_REMOTE_SYNC, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_REMOTE_SYNC].put(snapshot));
  });
}

// ---------------------------------------------------------------------------
// Edit history (local diffs per file, keyed by [mountKey, fileId])
// ---------------------------------------------------------------------------

export interface EditHistoryDiff {
  timestamp: string;
  diff: string;
  stats: { additions: number; deletions: number };
}

export interface EditHistoryRecord {
  mountKey: string;
  fileId: string;
  filePath: string;
  diffs: EditHistoryDiff[];
}

export async function getEditHistory(
  mountKey: string,
  fileId: string,
): Promise<EditHistoryRecord | undefined> {
  return txPromise(STORE_EDIT_HISTORY, "readonly", async (_tx, stores) => {
    return reqPromise(
      stores[STORE_EDIT_HISTORY].get([mountKey, fileId]) as IDBRequest<EditHistoryRecord | undefined>,
    );
  });
}

export async function setEditHistory(record: EditHistoryRecord): Promise<void> {
  await txPromise(STORE_EDIT_HISTORY, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_EDIT_HISTORY].put(record));
  });
}

export async function deleteEditHistory(
  mountKey: string,
  fileId: string,
): Promise<void> {
  await txPromise(STORE_EDIT_HISTORY, "readwrite", async (_tx, stores) => {
    await reqPromise(stores[STORE_EDIT_HISTORY].delete([mountKey, fileId]));
  });
}

export async function listEditHistoryForMount(
  mountKey: string,
): Promise<EditHistoryRecord[]> {
  return txPromise(STORE_EDIT_HISTORY, "readonly", async (_tx, stores) => {
    const index = stores[STORE_EDIT_HISTORY].index(INDEX_EDIT_HISTORY_TENANT);
    return reqPromise(
      index.getAll(IDBKeyRange.only(mountKey)) as IDBRequest<EditHistoryRecord[]>,
    );
  });
}
