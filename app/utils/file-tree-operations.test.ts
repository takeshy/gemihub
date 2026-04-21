import assert from "node:assert/strict";
import test from "node:test";
import { buildTreeFromMeta } from "./file-tree-operations";
import type { CachedRemoteMeta, LocalSyncMeta } from "~/services/indexeddb-cache";

function makeMeta(files: CachedRemoteMeta["files"]): CachedRemoteMeta {
  return {
    id: "current",
    rootFolderId: "root",
    lastUpdatedAt: "2024-01-01T00:00:00.000Z",
    files,
    cachedAt: 0,
  };
}

function makeLocal(files: LocalSyncMeta["files"]): LocalSyncMeta["files"] {
  return files;
}

test("buildTreeFromMeta shows all remote files when localFiles is undefined", () => {
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

test("buildTreeFromMeta hides untracked remote files when localFiles is provided", () => {
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

  const tree = buildTreeFromMeta(meta, makeLocal({
    tracked: { md5Checksum: "aaa", modifiedTime: "2024-01-01T00:00:00.000Z", name: "tracked.md" },
  }));

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

  const tree = buildTreeFromMeta(meta, makeLocal({
    tracked: { md5Checksum: "aaa", modifiedTime: "2024-01-01T00:00:00.000Z", name: "tracked.md" },
  }));

  assert.deepEqual(
    tree.map((node) => node.id),
    ["new:draft.md", "tracked"],
  );
});

test("buildTreeFromMeta keeps locally-tracked files that were removed from remote", () => {
  // Simulates a remote directory deletion: the entries are gone from remote
  // meta, but localFiles still has them. They must remain in the tree until
  // the user explicitly pulls.
  const meta = makeMeta({});

  const tree = buildTreeFromMeta(meta, makeLocal({
    "file-1": { md5Checksum: "aaa", modifiedTime: "2024-01-01T00:00:00.000Z", name: "docs/guide.md" },
    "file-2": { md5Checksum: "bbb", modifiedTime: "2024-01-01T00:00:00.000Z", name: "notes.md" },
  }));

  assert.equal(tree.length, 2);
  assert.equal(tree[0]?.id, "vfolder:docs");
  assert.equal(tree[0]?.children?.[0]?.id, "file-1");
  assert.equal(tree[0]?.children?.[0]?.mimeType, "text/markdown");
  assert.equal(tree[1]?.id, "file-2");
});
