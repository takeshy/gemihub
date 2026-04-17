import assert from "node:assert/strict";
import test from "node:test";
import { mergeSyncMetaSnapshots, pickSyncMetaToKeep } from "./sync-meta.server";
import type { DriveFile } from "./google-drive.server";
import type { SyncMeta } from "./sync-diff";

function file(id: string, modifiedTime: string): DriveFile {
  return {
    id,
    name: "_sync-meta.json",
    mimeType: "application/json",
    modifiedTime,
  };
}

test("pickSyncMetaToKeep returns nothing when list is empty", () => {
  const { keep, discard } = pickSyncMetaToKeep([]);
  assert.equal(keep, null);
  assert.deepEqual(discard, []);
});

test("pickSyncMetaToKeep keeps the sole file when only one exists", () => {
  const only = file("id-1", "2024-01-01T00:00:00.000Z");
  const { keep, discard } = pickSyncMetaToKeep([only]);
  assert.equal(keep?.id, "id-1");
  assert.deepEqual(discard, []);
});

test("pickSyncMetaToKeep picks the latest modifiedTime when duplicates exist", () => {
  const older = file("old", "2024-01-01T00:00:00.000Z");
  const middle = file("mid", "2024-06-01T00:00:00.000Z");
  const newer = file("new", "2025-01-01T00:00:00.000Z");

  const { keep, discard } = pickSyncMetaToKeep([older, newer, middle]);

  assert.equal(keep?.id, "new");
  assert.deepEqual(
    discard.map((f) => f.id).sort(),
    ["mid", "old"],
  );
});

test("pickSyncMetaToKeep treats missing modifiedTime as oldest", () => {
  const undated = { ...file("undated", ""), modifiedTime: undefined };
  const dated = file("dated", "2024-01-01T00:00:00.000Z");

  const { keep, discard } = pickSyncMetaToKeep([undated, dated]);

  assert.equal(keep?.id, "dated");
  assert.deepEqual(
    discard.map((f) => f.id),
    ["undated"],
  );
});

test("mergeSyncMetaSnapshots preserves file entries from divergent duplicates", () => {
  const older: SyncMeta = {
    lastUpdatedAt: "2024-01-01T00:00:00.000Z",
    files: {
      a: {
        name: "a.md",
        mimeType: "text/markdown",
        md5Checksum: "aaa",
        modifiedTime: "2024-01-01T00:00:00.000Z",
      },
    },
  };
  const newer: SyncMeta = {
    lastUpdatedAt: "2024-01-02T00:00:00.000Z",
    files: {
      b: {
        name: "b.md",
        mimeType: "text/markdown",
        md5Checksum: "bbb",
        modifiedTime: "2024-01-02T00:00:00.000Z",
      },
    },
  };

  const merged = mergeSyncMetaSnapshots([older, newer]);

  assert.equal(merged.lastUpdatedAt, "2024-01-02T00:00:00.000Z");
  assert.deepEqual(Object.keys(merged.files).sort(), ["a", "b"]);
});

test("mergeSyncMetaSnapshots keeps the newer file metadata while preserving optional fields", () => {
  const older: SyncMeta = {
    lastUpdatedAt: "2024-01-01T00:00:00.000Z",
    files: {
      same: {
        name: "report.md",
        mimeType: "text/markdown",
        md5Checksum: "old",
        modifiedTime: "2024-01-01T00:00:00.000Z",
        shared: true,
        webViewLink: "https://example.com/report",
      },
    },
  };
  const newer: SyncMeta = {
    lastUpdatedAt: "2024-01-03T00:00:00.000Z",
    files: {
      same: {
        name: "report-renamed.md",
        mimeType: "text/markdown",
        md5Checksum: "new",
        modifiedTime: "2024-01-03T00:00:00.000Z",
      },
    },
  };

  const merged = mergeSyncMetaSnapshots([older, newer]);

  assert.deepEqual(merged.files.same, {
    name: "report-renamed.md",
    mimeType: "text/markdown",
    md5Checksum: "new",
    modifiedTime: "2024-01-03T00:00:00.000Z",
    shared: true,
    webViewLink: "https://example.com/report",
  });
});
