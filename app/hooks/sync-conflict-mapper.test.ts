import assert from "node:assert/strict";
import test from "node:test";
import {
  diffToLegacyConflicts,
  mapEditDeleteConflictsToLegacy,
  mapStorageConflictToLegacy,
} from "./sync-conflict-mapper.ts";
import type { StorageSyncDiff } from "~/services/sync-diff-storage.ts";

test("mapStorageConflictToLegacy: nested path → basename + md5", () => {
  const out = mapStorageConflictToLegacy({
    objectPath: "gemihub/notes/foo.md",
    localMd5: "h-local",
    remoteMd5: "h-remote",
    baseRevision: "100",
    remoteRevision: "200",
  });
  assert.equal(out.fileId, "gemihub/notes/foo.md");
  assert.equal(out.fileName, "foo.md");
  assert.equal(out.localChecksum, "h-local");
  assert.equal(out.remoteChecksum, "h-remote");
  assert.equal(out.localModifiedTime, "");
  assert.equal(out.remoteModifiedTime, "");
});

test("mapStorageConflictToLegacy: top-level path → basename equals path", () => {
  const out = mapStorageConflictToLegacy({
    objectPath: "settings.json",
    localMd5: "h",
    remoteMd5: "h",
    baseRevision: "1",
    remoteRevision: "2",
  });
  assert.equal(out.fileId, "settings.json");
  assert.equal(out.fileName, "settings.json");
});

test("mapEditDeleteConflictsToLegacy: marks isEditDelete and clears md5", () => {
  const diff: StorageSyncDiff = {
    toPush: [],
    toPull: [],
    conflicts: [],
    editDeleteConflicts: ["gemihub/abandoned.md"],
    localOnly: [],
    remoteOnly: [],
  };
  const out = mapEditDeleteConflictsToLegacy(diff);
  assert.equal(out.length, 1);
  assert.equal(out[0].fileId, "gemihub/abandoned.md");
  assert.equal(out[0].fileName, "abandoned.md");
  assert.equal(out[0].isEditDelete, true);
  assert.equal(out[0].localChecksum, "");
});

test("diffToLegacyConflicts: combines both types", () => {
  const diff: StorageSyncDiff = {
    toPush: [],
    toPull: [],
    conflicts: [
      {
        objectPath: "a.md",
        localMd5: "la",
        remoteMd5: "ra",
        baseRevision: "1",
        remoteRevision: "2",
      },
    ],
    editDeleteConflicts: ["b.md"],
    localOnly: [],
    remoteOnly: [],
  };
  const out = diffToLegacyConflicts(diff);
  assert.equal(out.length, 2);
  assert.equal(out[0].fileId, "a.md");
  assert.equal(out[0].isEditDelete, undefined);
  assert.equal(out[1].fileId, "b.md");
  assert.equal(out[1].isEditDelete, true);
});

test("diffToLegacyConflicts: empty diff → empty list", () => {
  const empty: StorageSyncDiff = {
    toPush: [],
    toPull: [],
    conflicts: [],
    editDeleteConflicts: [],
    localOnly: [],
    remoteOnly: [],
  };
  assert.deepEqual(diffToLegacyConflicts(empty), []);
});
