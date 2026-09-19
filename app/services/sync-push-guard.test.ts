import assert from "node:assert/strict";
import test from "node:test";
import {
  findAmbiguousPushPaths,
  findPendingDeletionsChangedOnRemote,
  indexUniqueRemotePaths,
  remoteChangedSincePushSnapshot,
} from "./sync-push-guard";

test("normal Push addresses files by ID even when Drive has duplicate paths", () => {
  assert.deepEqual(findAmbiguousPushPaths(
    [{ fileId: "a", fileName: "same.md" }], new Set(["a", "b"]), ["same.md"], false,
  ), []);
});

test("Full Push permits valid IDs and unrelated duplicate paths", () => {
  assert.deepEqual(findAmbiguousPushPaths(
    [{ fileId: "a", fileName: "same.md" }, { fileId: "stale", fileName: "unique.md" }],
    new Set(["a", "b"]), ["same.md", "other.md"], true,
  ), []);
});

test("Full Push rejects an ambiguous replacement for a stale ID", () => {
  assert.deepEqual(findAmbiguousPushPaths(
    [{ fileId: "stale", fileName: "same.md" }], new Set(["a", "b"]), ["same.md"], true,
  ), ["same.md"]);
});

test("deletion-only Push is not blocked by duplicate paths", () => {
  assert.deepEqual(findAmbiguousPushPaths([], new Set(["a", "b"]), ["same.md"], false), []);
});

test("indexes unique Drive paths and reports duplicates", () => {
  const indexed = indexUniqueRemotePaths([
    { id: "a", name: "same.md" },
    { id: "b", name: "same.md" },
    { id: "c", name: "unique.md" },
  ]);
  assert.deepEqual(indexed.duplicates, ["same.md"]);
  assert.equal(indexed.byPath.get("unique.md")?.id, "c");
});

test("push guard detects content changed after preflight", () => {
  assert.equal(
    remoteChangedSincePushSnapshot(
      { name: "note.md", md5Checksum: "old", modifiedTime: "1" },
      { name: "note.md", md5Checksum: "new", modifiedTime: "2" },
    ),
    true,
  );
});

test("push guard accepts an unchanged file and case-only rename", () => {
  assert.equal(
    remoteChangedSincePushSnapshot(
      { name: "Note.md", md5Checksum: "same", modifiedTime: "1" },
      { name: "note.md", md5Checksum: "same", modifiedTime: "1" },
    ),
    false,
  );
});

test("push guard falls back to modified time when checksums are absent", () => {
  assert.equal(
    remoteChangedSincePushSnapshot(
      { name: "note.md", modifiedTime: "1" },
      { name: "note.md", modifiedTime: "2" },
    ),
    true,
  );
});

test("push guard allows files missing from a snapshot", () => {
  assert.equal(
    remoteChangedSincePushSnapshot(undefined, { name: "note.md", md5Checksum: "new" }),
    false,
  );
});

test("pending deletions are cancelled only when the remote file changed after queuing", () => {
  const local = {
    unchanged: { name: "a.md", md5Checksum: "1", modifiedTime: "t1" },
    edited: { name: "b.md", md5Checksum: "1", modifiedTime: "t1" },
    renamed: { name: "c.md", md5Checksum: "1", modifiedTime: "t1" },
    gone: { name: "d.md", md5Checksum: "1", modifiedTime: "t1" },
  };
  const remote = {
    unchanged: { name: "a.md", md5Checksum: "1", modifiedTime: "t1" },
    edited: { name: "b.md", md5Checksum: "2", modifiedTime: "t2" },
    renamed: { name: "moved/c.md", md5Checksum: "1", modifiedTime: "t2" },
    neverSynced: { name: "e.md", md5Checksum: "9", modifiedTime: "t9" },
  };
  assert.deepEqual(
    findPendingDeletionsChangedOnRemote(
      ["unchanged", "edited", "renamed", "gone", "neverSynced"],
      local,
      remote,
    ),
    ["edited", "renamed"],
  );
});
