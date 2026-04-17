import assert from "node:assert/strict";
import test from "node:test";
import { buildTreeFromMeta } from "./file-tree-operations";
import type { CachedRemoteMeta } from "~/services/indexeddb-cache";

function makeMeta(files: CachedRemoteMeta["files"]): CachedRemoteMeta {
  return {
    id: "current",
    rootFolderId: "root",
    lastUpdatedAt: "2024-01-01T00:00:00.000Z",
    files,
    cachedAt: 0,
  };
}

test("buildTreeFromMeta shows all remote files when trackedIds is undefined", () => {
  const meta = makeMeta({
    "file-1": {
      name: "docs/guide.md",
      mimeType: "text/markdown",
      md5Checksum: "aaa",
      modifiedTime: "2024-01-01T00:00:00.000Z",
    },
    "file-2": {
      name: "notes.md",
      mimeType: "text/markdown",
      md5Checksum: "bbb",
      modifiedTime: "2024-01-01T00:00:00.000Z",
    },
  });

  const tree = buildTreeFromMeta(meta);

  assert.equal(tree.length, 2);
  assert.equal(tree[0]?.id, "vfolder:docs");
  assert.equal(tree[0]?.children?.[0]?.id, "file-1");
  assert.equal(tree[1]?.id, "file-2");
});

test("buildTreeFromMeta hides untracked remote files when trackedIds is provided", () => {
  const meta = makeMeta({
    tracked: {
      name: "tracked.md",
      mimeType: "text/markdown",
      md5Checksum: "aaa",
      modifiedTime: "2024-01-01T00:00:00.000Z",
    },
    hidden: {
      name: "hidden.md",
      mimeType: "text/markdown",
      md5Checksum: "bbb",
      modifiedTime: "2024-01-01T00:00:00.000Z",
    },
  });

  const tree = buildTreeFromMeta(meta, new Set(["tracked"]));

  assert.deepEqual(
    tree.map((node) => node.id),
    ["tracked"],
  );
});

test("buildTreeFromMeta keeps local new: files even when they are not tracked", () => {
  const meta = makeMeta({
    tracked: {
      name: "tracked.md",
      mimeType: "text/markdown",
      md5Checksum: "aaa",
      modifiedTime: "2024-01-01T00:00:00.000Z",
    },
    "new:draft.md": {
      name: "draft.md",
      mimeType: "text/markdown",
      md5Checksum: "",
      modifiedTime: "2024-01-01T00:00:00.000Z",
    },
  });

  const tree = buildTreeFromMeta(meta, new Set(["tracked"]));

  assert.deepEqual(
    tree.map((node) => node.id),
    ["new:draft.md", "tracked"],
  );
});
