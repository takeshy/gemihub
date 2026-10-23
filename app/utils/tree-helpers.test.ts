import assert from "node:assert/strict";
import test from "node:test";
import type { CachedTreeNode } from "~/services/indexeddb-cache";
import { findNodeById, getMoveTargetIssue, moveNodeInTree } from "./tree-helpers";

const file = (id: string, name: string): CachedTreeNode => ({ id, name, mimeType: "text/plain", isFolder: false });
const folder = (path: string, children?: CachedTreeNode[]): CachedTreeNode => ({
  id: `vfolder:${path}`, name: path.split("/").pop()!, mimeType: "application/vnd.google-apps.folder", isFolder: true, children,
});
const tree = [
  folder("docs", [file("draft", "draft.md"), folder("docs/nested", [])]),
  folder("archive", [file("other-draft", "draft.md")]),
  folder("empty"),
  folder("docs-other", []),
  file("new:note.md", "note.md"),
];

test("move targets reject the current parent, self, and descendants, but allow root and similarly named siblings", () => {
  assert.equal(getMoveTargetIssue(tree, "draft", "vfolder:docs", "root"), "sameFolder");
  assert.equal(getMoveTargetIssue(tree, "new:note.md", "root", "root"), "sameFolder");
  assert.equal(getMoveTargetIssue(tree, "vfolder:docs", "vfolder:docs", "root"), "descendant");
  assert.equal(getMoveTargetIssue(tree, "vfolder:docs", "vfolder:docs/nested", "root"), "descendant");
  assert.equal(getMoveTargetIssue(tree, "vfolder:docs", "vfolder:docs-other", "root"), null);
  assert.equal(getMoveTargetIssue(tree, "draft", "root", "root"), null);
});

test("move targets reject name collisions and missing or non-folder destinations", () => {
  assert.equal(getMoveTargetIssue(tree, "draft", "vfolder:archive", "root"), "nameConflict");
  const conflicting = [...tree, folder("destination", [folder("destination/docs", [])])];
  assert.equal(getMoveTargetIssue(conflicting, "vfolder:docs", "vfolder:destination", "root"), "nameConflict");
  assert.equal(getMoveTargetIssue(tree, "draft", "gone", "root"), "missing");
  assert.equal(getMoveTargetIssue(tree, "draft", "new:note.md", "root"), "missing");
  assert.equal(getMoveTargetIssue(tree, "gone", "root", "root"), "missing");
  assert.equal(getMoveTargetIssue(tree, "draft", "vfolder:empty", "root"), null);
});

test("moving a local file reparents it with its migrated id and preserves empty folders", () => {
  const movedFile = file("new:empty/note.md", "note.md");
  const result = moveNodeInTree(tree, "new:note.md", "vfolder:empty", "root", movedFile);
  assert.equal(findNodeById("new:note.md", result), null);
  assert.deepEqual(findNodeById("vfolder:empty", result)?.children, [movedFile]);
  assert.deepEqual(findNodeById("vfolder:docs/nested", result), folder("docs/nested", []));
  assert.ok(findNodeById("new:note.md", tree), "the original tree is immutable");
});

test("moving an empty folder to root preserves it and sorts it before files", () => {
  const movedFolder = folder("nested", []);
  const result = moveNodeInTree(tree, "vfolder:docs/nested", "root", "root", movedFolder);
  assert.equal(findNodeById("vfolder:docs/nested", result), null);
  assert.deepEqual(findNodeById("vfolder:nested", result), movedFolder);
  assert.ok(result.findIndex((node) => node.id === movedFolder.id) < result.findIndex((node) => !node.isFolder));
});

test("invalid local moves leave the source tree intact", () => {
  assert.equal(moveNodeInTree(tree, "draft", "vfolder:archive", "root", file("draft", "draft.md")), tree);
  assert.equal(moveNodeInTree(tree, "vfolder:docs", "vfolder:docs/nested", "root", folder("docs/nested/docs", [])), tree);
});
