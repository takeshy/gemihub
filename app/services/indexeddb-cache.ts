// IndexedDB cache service for browser-side file caching and sync metadata
// Uses a singleton DB connection for performance.

const DB_NAME = "gemini-hub-cache";
const DB_VERSION = 5;

// --- Store types ---

export interface CachedFile {
  fileId: string; // primary key
  content: string;
  md5Checksum: string;
  modifiedTime: string;
  cachedAt: number;
  fileName?: string;
}

export interface LocalSyncMeta {
  id: "current"; // primary key (fixed key, always 1 record)
  lastUpdatedAt: string;
  files: Record<string, { md5Checksum: string; modifiedTime: string }>;
}

export interface EditHistoryDiff {
  timestamp: string;
  diff: string;
  stats: { additions: number; deletions: number };
}

export interface CachedEditHistoryEntry {
  fileId: string; // primary key (one entry per file)
  filePath: string;
  diffs: EditHistoryDiff[];
}

export interface CachedEditHistorySnapshot {
  fileId: string; // primary key
  content: string;      // always latest content (updated by saveLocalEdit)
  baseContent: string;  // base for diff computation (set by initSnapshot)
  baseUpdatedAt: number; // when baseContent was set
  updatedAt: number;
}

export interface CachedTreeNode {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  children?: CachedTreeNode[];
}

export interface CachedFileTree {
  id: "current"; // primary key (fixed key, always 1 record)
  rootFolderId: string;
  items: CachedTreeNode[];
  cachedAt: number;
}

export interface CachedRemoteMeta {
  id: "current"; // primary key (fixed key, always 1 record)
  rootFolderId: string;
  lastUpdatedAt: string;
  files: Record<string, { name: string; mimeType: string; md5Checksum: string; modifiedTime: string; createdTime?: string; shared?: boolean; webViewLink?: string }>;
  cachedAt: number;
}

// --- Singleton DB connection ---

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

      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "fileId" });
      }

      if (!db.objectStoreNames.contains("syncMeta")) {
        db.createObjectStore("syncMeta", { keyPath: "id" });
      }

      // v5: recreate editHistory with fileId as primary key (was id + fileId index)
      if (db.objectStoreNames.contains("editHistory")) {
        db.deleteObjectStore("editHistory");
      }
      db.createObjectStore("editHistory", { keyPath: "fileId" });

      if (!db.objectStoreNames.contains("fileTree")) {
        db.createObjectStore("fileTree", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("remoteMeta")) {
        db.createObjectStore("remoteMeta", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("editHistorySnapshot")) {
        db.createObjectStore("editHistorySnapshot", { keyPath: "fileId" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If the connection is unexpectedly closed, reset the singleton
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

function txGet<T>(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txPut<T>(
  db: IDBDatabase,
  storeName: string,
  value: T
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txDelete(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function txGetAllByIndex<T>(
  db: IDBDatabase,
  storeName: string,
  indexName: string,
  key: IDBValidKey
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(key);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// --- files store ---

export async function getCachedFile(
  fileId: string
): Promise<CachedFile | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await getDB();
    return await txGet<CachedFile>(db, "files", fileId);
  } catch {
    return undefined;
  }
}

export async function setCachedFile(file: CachedFile): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txPut(db, "files", file);
  } catch {
    // ignore write errors
  }
}

export async function deleteCachedFile(fileId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txDelete(db, "files", fileId);
  } catch {
    // ignore
  }
}

export async function getAllCachedFiles(): Promise<CachedFile[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await getDB();
    return await txGetAll<CachedFile>(db, "files");
  } catch {
    return [];
  }
}

export async function getAllCachedFileIds(): Promise<Set<string>> {
  if (typeof indexedDB === "undefined") return new Set();
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const store = tx.objectStore("files");
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result.map(String)));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return new Set();
  }
}

// --- syncMeta store ---

export async function getLocalSyncMeta(): Promise<LocalSyncMeta | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await getDB();
    return await txGet<LocalSyncMeta>(db, "syncMeta", "current");
  } catch {
    return undefined;
  }
}

export async function setLocalSyncMeta(meta: LocalSyncMeta): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txPut(db, "syncMeta", meta);
  } catch {
    // ignore
  }
}

// --- editHistory store ---

export async function getEditHistoryForFile(
  fileId: string
): Promise<CachedEditHistoryEntry | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await getDB();
    return await txGet<CachedEditHistoryEntry>(db, "editHistory", fileId);
  } catch {
    return undefined;
  }
}

export async function setEditHistoryEntry(
  entry: CachedEditHistoryEntry
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txPut(db, "editHistory", entry);
  } catch {
    // ignore
  }
}

export async function deleteEditHistoryEntry(fileId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txDelete(db, "editHistory", fileId);
  } catch {
    // ignore
  }
}

export async function getLocallyModifiedFileIds(): Promise<Set<string>> {
  if (typeof indexedDB === "undefined") return new Set();
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("editHistory", "readonly");
      const store = tx.objectStore("editHistory");
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result.map(String)));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return new Set();
  }
}

export async function getAllEditHistory(): Promise<CachedEditHistoryEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await getDB();
    return await txGetAll<CachedEditHistoryEntry>(db, "editHistory");
  } catch {
    return [];
  }
}

export async function clearAllEditHistory(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    const tx = db.transaction(["editHistory", "editHistorySnapshot"], "readwrite");
    tx.objectStore("editHistory").clear();
    tx.objectStore("editHistorySnapshot").clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

// --- editHistorySnapshot store ---

export async function getEditHistorySnapshot(
  fileId: string
): Promise<CachedEditHistorySnapshot | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await getDB();
    return await txGet<CachedEditHistorySnapshot>(db, "editHistorySnapshot", fileId);
  } catch {
    return undefined;
  }
}

export async function setEditHistorySnapshot(
  snapshot: CachedEditHistorySnapshot
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txPut(db, "editHistorySnapshot", snapshot);
  } catch {
    // ignore
  }
}

// --- fileTree store ---

export async function getCachedFileTree(): Promise<CachedFileTree | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await getDB();
    return await txGet<CachedFileTree>(db, "fileTree", "current");
  } catch {
    return undefined;
  }
}

export async function setCachedFileTree(tree: CachedFileTree): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txPut(db, "fileTree", tree);
  } catch {
    // ignore
  }
}

// --- remoteMeta store ---

export async function getCachedRemoteMeta(): Promise<CachedRemoteMeta | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await getDB();
    return await txGet<CachedRemoteMeta>(db, "remoteMeta", "current");
  } catch {
    return undefined;
  }
}

export async function setCachedRemoteMeta(meta: CachedRemoteMeta): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    await txPut(db, "remoteMeta", meta);
  } catch {
    // ignore
  }
}

// --- clearAll ---

export async function clearAllCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    const tx = db.transaction(
      ["files", "syncMeta", "editHistory", "editHistorySnapshot", "fileTree", "remoteMeta"],
      "readwrite"
    );
    tx.objectStore("files").clear();
    tx.objectStore("syncMeta").clear();
    tx.objectStore("editHistory").clear();
    tx.objectStore("editHistorySnapshot").clear();
    tx.objectStore("fileTree").clear();
    tx.objectStore("remoteMeta").clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}
