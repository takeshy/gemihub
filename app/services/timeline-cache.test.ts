import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { applyTimelineSnapshotCAS, setCachedFile, getCachedFile, getEditHistoryForFile, setCachedRemoteMeta } from "./indexeddb-cache-drive.ts";

const file = { fileId: "timeline", fileName: "Dashboards/Timeline/Timeline/2026-10-12.md", content: "remote", md5Checksum: "remote-md5", modifiedTime: "2026-10-12T00:00:00.000Z", cachedAt: 1 };

test("a late sync response cannot replace newer local content", async () => {
  await setCachedRemoteMeta({ id: "current", rootFolderId: "root", lastUpdatedAt: "", files: {}, cachedAt: 1 });
  await setCachedFile({ ...file, content: "new local edit" });
  assert.equal(await applyTimelineSnapshotCAS({ file, rootFolderId: "root", expectedFileId: file.fileId, expectedContent: "old local edit", remoteContent: "remote" }), false);
  assert.equal((await getCachedFile(file.fileId))?.content, "new local edit");
});

test("a matching merged snapshot records pending edits against its actual remote base", async () => {
  const merged = { ...file, content: "remote\nnew local edit" };
  assert.equal(await applyTimelineSnapshotCAS({ file: merged, rootFolderId: "root", expectedFileId: file.fileId, expectedContent: "new local edit", remoteContent: "remote" }), true);
  assert.equal((await getCachedFile(file.fileId))?.content, merged.content);
  assert.ok((await getEditHistoryForFile(file.fileId))?.diffs[0].diff.includes("new local edit"));
});

test("switching accounts rejects an old account's response", async () => {
  await setCachedRemoteMeta({ id: "current", rootFolderId: "different-root", lastUpdatedAt: "", files: {}, cachedAt: 1 });
  assert.equal(await applyTimelineSnapshotCAS({ file, rootFolderId: "root", expectedFileId: file.fileId, expectedContent: "remote\nnew local edit", remoteContent: "remote" }), false);
  assert.equal((await getCachedFile(file.fileId))?.content, "remote\nnew local edit");
});

test("migration cannot overwrite a newer cache under its real Drive ID", async () => {
  await setCachedRemoteMeta({ id: "current", rootFolderId: "root", lastUpdatedAt: "", files: {}, cachedAt: 1 });
  const placeholder = `new:${file.fileName}`;
  await setCachedFile({ ...file, fileId: placeholder, content: "pending" });
  await setCachedFile({ ...file, content: "newer migrated edit" });
  assert.equal(await applyTimelineSnapshotCAS({ file, rootFolderId: "root", expectedFileId: placeholder, expectedContent: "pending", remoteContent: "remote" }), false);
  assert.equal((await getCachedFile(file.fileId))?.content, "newer migrated edit");
});
