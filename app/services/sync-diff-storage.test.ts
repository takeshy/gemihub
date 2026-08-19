import assert from "node:assert/strict";
import test from "node:test";
import {
  computeStorageSyncDiff,
  type ObjectSnapshot,
} from "./sync-diff-storage.ts";

function snap(entries: Record<string, { md5: string; gen?: string; updatedAt?: number }>): ObjectSnapshot {
  return {
    entries: Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [
        k,
        {
          md5Hash: v.md5,
          revision: v.gen ?? "1",
          updatedAt: v.updatedAt ?? 0,
        },
      ]),
    ),
  };
}

test("first sync: everything remote becomes remoteOnly", () => {
  const remote = snap({ "a.md": { md5: "h1" }, "b.md": { md5: "h2" } });
  const diff = computeStorageSyncDiff(null, remote);
  assert.deepEqual(diff.remoteOnly.sort(), ["a.md", "b.md"]);
  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.toPull, []);
});

test("clean state: no changes", () => {
  const base = snap({ "a.md": { md5: "h1" } });
  const remote = snap({ "a.md": { md5: "h1" } });
  const diff = computeStorageSyncDiff(base, remote);
  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.toPull, []);
  assert.deepEqual(diff.conflicts, []);
});

test("remote-only change: pulls into toPull", () => {
  const base = snap({ "a.md": { md5: "h1" } });
  const remote = snap({ "a.md": { md5: "h2" } });
  const diff = computeStorageSyncDiff(base, remote);
  assert.deepEqual(diff.toPull, ["a.md"]);
  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.conflicts, []);
});

test("local-only change: pushes into toPush", () => {
  const base = snap({ "a.md": { md5: "h1" } });
  const remote = snap({ "a.md": { md5: "h1" } });
  const diff = computeStorageSyncDiff(base, remote, new Set(["a.md"]));
  assert.deepEqual(diff.toPush, ["a.md"]);
  assert.deepEqual(diff.toPull, []);
  assert.deepEqual(diff.conflicts, []);
});

test("simultaneous local + remote change: conflict", () => {
  const base = snap({ "a.md": { md5: "h1", gen: "100" } });
  const remote = snap({ "a.md": { md5: "h2", gen: "200" } });
  const diff = computeStorageSyncDiff(base, remote, new Set(["a.md"]));
  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.toPull, []);
  assert.equal(diff.conflicts.length, 1);
  assert.equal(diff.conflicts[0].objectPath, "a.md");
  assert.equal(diff.conflicts[0].baseRevision, "100");
  assert.equal(diff.conflicts[0].remoteRevision, "200");
});

test("edit-delete conflict: local modified, remote deleted", () => {
  const base = snap({ "a.md": { md5: "h1" } });
  const remote = snap({});
  const diff = computeStorageSyncDiff(base, remote, new Set(["a.md"]));
  assert.deepEqual(diff.editDeleteConflicts, ["a.md"]);
  assert.deepEqual(diff.toPush, []);
});

test("clean local + remote deleted: no conflict (will be cleaned by caller)", () => {
  const base = snap({ "a.md": { md5: "h1" } });
  const remote = snap({});
  const diff = computeStorageSyncDiff(base, remote);
  assert.deepEqual(diff.editDeleteConflicts, []);
  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.toPull, []);
});

test("brand-new local file: localOnly", () => {
  const diff = computeStorageSyncDiff(null, null, new Set(["new.md"]));
  assert.deepEqual(diff.localOnly, ["new.md"]);
  assert.deepEqual(diff.toPush, []);
});

test("mixed scenario", () => {
  const base = snap({
    clean: { md5: "h1" },
    edited: { md5: "h2" },
    conflict: { md5: "h3", gen: "10" },
    remoteDeleted: { md5: "h4" },
  });
  const remote = snap({
    clean: { md5: "h1" },
    edited: { md5: "h2" }, // unchanged on server
    conflict: { md5: "h3-remote", gen: "20" },
    pulled: { md5: "h5" },
  });
  const diff = computeStorageSyncDiff(base, remote, new Set(["edited", "conflict"]));
  assert.deepEqual(diff.toPush, ["edited"]);
  assert.deepEqual(diff.toPull, []);
  assert.deepEqual(diff.remoteOnly, ["pulled"]);
  assert.equal(diff.conflicts.length, 1);
  assert.equal(diff.conflicts[0].objectPath, "conflict");
});
