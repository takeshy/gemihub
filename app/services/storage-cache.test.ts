/**
 * Tests for storage-cache.ts. Uses fake-indexeddb to provide an in-memory
 * IDBFactory so we can exercise the real cursor / composite-key paths
 * without a browser.
 *
 * Each test resets the polyfill so DBs don't leak across tests.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// Install the polyfill BEFORE the module-under-test imports `indexedDB`.
// The polyfill registers globals at require-time.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import {
  _resetDBForTests,
  clearMountCache,
  deleteCachedObject,
  deleteLocalSyncEntry,
  getCachedObject,
  getLocalSyncEntry,
  getRemoteSyncSnapshot,
  listLocalConflictBackups,
  listCachedObjectsForMount,
  listDirtyObjectsForMount,
  listLocalSyncEntriesForMount,
  objectPathForCachedFile,
  setCachedObject,
  setLocalSyncEntry,
  setRemoteSyncSnapshot,
  saveLocalConflictBackup,
  queueStorageDeletion,
  listPendingStorageDeletions,
  deletePendingStorageDeletion,
  type CachedObject,
  type LocalSyncEntry,
  type RemoteSyncSnapshot,
} from "./storage-cache.ts";

// Reset between tests — swap the global IDB factory for a fresh one AND
// drop storage-cache's cached connection so the next call reopens against
// the new factory. (Without the reset, the old singleton keeps writing to
// the previous test's DB and assertions over "tenant counts" go wrong.)
beforeEach(() => {
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
  _resetDBForTests();
});

function obj(
  mountKey: string,
  relativePath: string,
  overrides: Partial<CachedObject> = {},
): CachedObject {
  return {
    mountKey,
    objectPath: objectPathForCachedFile(mountKey, relativePath),
    relativePath,
    content: "hello",
    encoding: "utf-8",
    contentType: "text/markdown",
    md5Hash: "h",
    revision: "1",
    cachedAt: 1000,
    ...overrides,
  };
}

function localSync(
  mountKey: string,
  relativePath: string,
  overrides: Partial<LocalSyncEntry> = {},
): LocalSyncEntry {
  return {
    mountKey,
    objectPath: objectPathForCachedFile(mountKey, relativePath),
    relativePath,
    md5Hash: "h",
    revision: "1",
    updatedAt: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CachedObject CRUD
// ---------------------------------------------------------------------------

test("setCachedObject / getCachedObject round-trip", async () => {
  const o = obj("orgA/proj1", "notes/foo.md");
  await setCachedObject(o);
  const got = await getCachedObject("orgA/proj1", o.objectPath);
  assert.deepEqual(got, o);
});

test("getCachedObject returns undefined for missing key", async () => {
  const got = await getCachedObject("orgA/proj1", "orgA/proj1/nope.md");
  assert.equal(got, undefined);
});

test("composite key isolation: same relativePath in two tenants don't collide", async () => {
  const a = obj("orgA/proj1", "shared.md", { content: "a" });
  const b = obj("orgB/proj1", "shared.md", { content: "b" });
  await setCachedObject(a);
  await setCachedObject(b);
  const gotA = await getCachedObject("orgA/proj1", a.objectPath);
  const gotB = await getCachedObject("orgB/proj1", b.objectPath);
  assert.equal(gotA?.content, "a");
  assert.equal(gotB?.content, "b");
});

test("deleteCachedObject removes a single record", async () => {
  const o = obj("orgA/proj1", "to-delete.md");
  await setCachedObject(o);
  await deleteCachedObject("orgA/proj1", o.objectPath);
  assert.equal(await getCachedObject("orgA/proj1", o.objectPath), undefined);
});

test("pending deletions persist per mount until drained", async () => {
  await queueStorageDeletion({
    mountKey: "orgA/proj1",
    objectPath: "proj1/notes/a.md",
    relativePath: "notes/a.md",
    queuedAt: 123,
  });
  await queueStorageDeletion({
    mountKey: "orgB/proj1",
    objectPath: "proj1/notes/a.md",
    relativePath: "notes/a.md",
    queuedAt: 456,
  });
  assert.deepEqual(
    (await listPendingStorageDeletions("orgA/proj1")).map((entry) => entry.queuedAt),
    [123],
  );
  await deletePendingStorageDeletion("orgA/proj1", "proj1/notes/a.md");
  assert.equal((await listPendingStorageDeletions("orgA/proj1")).length, 0);
  assert.equal((await listPendingStorageDeletions("orgB/proj1")).length, 1);
});

// ---------------------------------------------------------------------------
// Per-tenant index
// ---------------------------------------------------------------------------

test("listCachedObjectsForMount returns only that tenant's objects", async () => {
  await setCachedObject(obj("orgA/proj1", "a.md"));
  await setCachedObject(obj("orgA/proj1", "b.md"));
  await setCachedObject(obj("orgB/proj1", "x.md"));
  const a = await listCachedObjectsForMount("orgA/proj1");
  const b = await listCachedObjectsForMount("orgB/proj1");
  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  assert.deepEqual(
    a.map((o) => o.relativePath).sort(),
    ["a.md", "b.md"],
  );
  assert.equal(b[0].relativePath, "x.md");
});

test("listDirtyObjectsForMount filters by dirty flag", async () => {
  await setCachedObject(obj("orgA/proj1", "clean.md", { dirty: false }));
  await setCachedObject(obj("orgA/proj1", "edited.md", { dirty: true }));
  await setCachedObject(obj("orgA/proj1", "also-clean.md"));
  const dirty = await listDirtyObjectsForMount("orgA/proj1");
  assert.equal(dirty.length, 1);
  assert.equal(dirty[0].relativePath, "edited.md");
});

// ---------------------------------------------------------------------------
// LocalSyncEntry
// ---------------------------------------------------------------------------

test("LocalSyncEntry CRUD + per-tenant list", async () => {
  await setLocalSyncEntry(localSync("orgA/proj1", "a.md", { md5Hash: "h-a" }));
  await setLocalSyncEntry(localSync("orgA/proj1", "b.md", { md5Hash: "h-b" }));
  await setLocalSyncEntry(localSync("orgB/proj1", "x.md", { md5Hash: "h-x" }));

  const got = await getLocalSyncEntry("orgA/proj1", objectPathForCachedFile("orgA/proj1", "a.md"));
  assert.equal(got?.md5Hash, "h-a");

  const all = await listLocalSyncEntriesForMount("orgA/proj1");
  assert.equal(all.length, 2);

  await deleteLocalSyncEntry("orgA/proj1", objectPathForCachedFile("orgA/proj1", "a.md"));
  const after = await listLocalSyncEntriesForMount("orgA/proj1");
  assert.equal(after.length, 1);
  assert.equal(after[0].relativePath, "b.md");
});

// ---------------------------------------------------------------------------
// RemoteSyncSnapshot (per-tenant)
// ---------------------------------------------------------------------------

test("RemoteSyncSnapshot CRUD per tenant", async () => {
  const snap: RemoteSyncSnapshot = {
    mountKey: "orgA/proj1",
    fetchedAt: 12345,
    entries: [
      {
        objectPath: objectPathForCachedFile("orgA/proj1", "a.md"),
        relativePath: "a.md",
        md5Hash: "h-a",
        revision: "10",
        updatedAt: 100,
      },
    ],
  };
  await setRemoteSyncSnapshot(snap);
  const got = await getRemoteSyncSnapshot("orgA/proj1");
  assert.deepEqual(got, snap);

  // Different tenant returns undefined
  assert.equal(await getRemoteSyncSnapshot("orgB/proj1"), undefined);
});

test("conflict backups are browser-local and tenant scoped", async () => {
  await saveLocalConflictBackup({
    mountKey: "orgA/proj1",
    relativePath: "notes/a.md",
    content: "losing local value",
    encoding: "utf-8",
    contentType: "text/markdown",
  });
  await saveLocalConflictBackup({
    mountKey: "orgB/proj1",
    relativePath: "image.png",
    content: "aGVsbG8=",
    encoding: "base64",
    contentType: "image/png",
  });

  const a = await listLocalConflictBackups("orgA/proj1");
  assert.equal(a.length, 1);
  assert.equal(a[0].relativePath, "notes/a.md");
  assert.equal(a[0].content, "losing local value");
  assert.equal(a[0].encoding, "utf-8");
  assert.equal((await listLocalConflictBackups("orgB/proj1")).length, 1);
});

// ---------------------------------------------------------------------------
// clearMountCache (cursor bulk delete)
// ---------------------------------------------------------------------------

test("clearMountCache wipes only that tenant's data across all stores", async () => {
  // Tenant A: 3 objects + 2 sync entries + 1 snapshot
  await setCachedObject(obj("orgA/proj1", "a1.md"));
  await setCachedObject(obj("orgA/proj1", "a2.md"));
  await setCachedObject(obj("orgA/proj1", "a3.md"));
  await setLocalSyncEntry(localSync("orgA/proj1", "a1.md"));
  await setLocalSyncEntry(localSync("orgA/proj1", "a2.md"));
  await setRemoteSyncSnapshot({
    mountKey: "orgA/proj1",
    fetchedAt: 1,
    entries: [],
  });
  await saveLocalConflictBackup({
    mountKey: "orgA/proj1",
    relativePath: "conflicted.md",
    content: "backup",
    encoding: "utf-8",
    contentType: "text/markdown",
  });

  // Tenant B: 1 of each
  await setCachedObject(obj("orgB/proj1", "x.md"));
  await setLocalSyncEntry(localSync("orgB/proj1", "x.md"));
  await setRemoteSyncSnapshot({
    mountKey: "orgB/proj1",
    fetchedAt: 2,
    entries: [],
  });

  await clearMountCache("orgA/proj1");

  assert.equal((await listCachedObjectsForMount("orgA/proj1")).length, 0);
  assert.equal((await listLocalSyncEntriesForMount("orgA/proj1")).length, 0);
  assert.equal(await getRemoteSyncSnapshot("orgA/proj1"), undefined);
  assert.equal((await listLocalConflictBackups("orgA/proj1")).length, 0);

  // B untouched
  assert.equal((await listCachedObjectsForMount("orgB/proj1")).length, 1);
  assert.equal((await listLocalSyncEntriesForMount("orgB/proj1")).length, 1);
  assert.notEqual(await getRemoteSyncSnapshot("orgB/proj1"), undefined);
});
