import assert from "node:assert/strict";
import test from "node:test";
import { computeSyncDiff, type SyncMeta } from "./sync-diff.ts";

function makeMeta(id: string, md5Checksum: string): SyncMeta {
  return {
    lastUpdatedAt: "2024-01-01T00:00:00.000Z",
    files: {
      [id]: {
        name: `file-${id}.md`,
        mimeType: "text/plain",
        md5Checksum,
        modifiedTime: "2024-01-01T00:00:00.000Z",
      },
    },
  };
}

test("remote change produces toPull", () => {
  const localMeta = makeMeta("1", "aaa");
  const remoteMeta = makeMeta("1", "bbb"); // remote updated by another device
  const diff = computeSyncDiff(localMeta, remoteMeta, new Set());

  assert.deepEqual(diff.toPull, ["1"]);
  assert.equal(diff.conflicts.length, 0);
});

test("locally modified without local meta produces toPush", () => {
  const localMeta = null;
  const remoteMeta = makeMeta("1", "aaa");
  const diff = computeSyncDiff(localMeta, remoteMeta, new Set(["1"]));

  assert.deepEqual(diff.toPush, ["1"]);
  assert.equal(diff.conflicts.length, 0);
});

test("locally modified file missing on remote is localOnly", () => {
  const localMeta = null;
  const remoteMeta: SyncMeta = { lastUpdatedAt: "2024-01-01T00:00:00.000Z", files: {} };
  const diff = computeSyncDiff(localMeta, remoteMeta, new Set(["1"]));

  assert.deepEqual(diff.localOnly, ["1"]);
  assert.equal(diff.conflicts.length, 0);
});

test("locally modified with no remote change produces toPush", () => {
  const localMeta = makeMeta("1", "aaa");
  const remoteMeta = makeMeta("1", "aaa"); // same checksum
  const diff = computeSyncDiff(localMeta, remoteMeta, new Set(["1"]));

  assert.deepEqual(diff.toPush, ["1"]);
  assert.equal(diff.conflicts.length, 0);
});

test("locally modified with remote change produces conflict", () => {
  const localMeta = makeMeta("1", "aaa");
  const remoteMeta = makeMeta("1", "bbb"); // remote updated by another device
  const diff = computeSyncDiff(localMeta, remoteMeta, new Set(["1"]));

  assert.equal(diff.conflicts.length, 1);
  assert.equal(diff.conflicts[0]?.fileId, "1");
});

test("remoteOnly when no local meta and no local edits", () => {
  const localMeta = null;
  const remoteMeta = makeMeta("1", "aaa");
  const diff = computeSyncDiff(localMeta, remoteMeta, new Set());

  assert.deepEqual(diff.remoteOnly, ["1"]);
  assert.equal(diff.conflicts.length, 0);
});

test("unchanged file is skipped", () => {
  const localMeta = makeMeta("1", "aaa");
  const remoteMeta = makeMeta("1", "aaa");
  const diff = computeSyncDiff(localMeta, remoteMeta, new Set());

  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.toPull, []);
  assert.deepEqual(diff.conflicts, []);
  assert.deepEqual(diff.localOnly, []);
  assert.deepEqual(diff.remoteOnly, []);
});
