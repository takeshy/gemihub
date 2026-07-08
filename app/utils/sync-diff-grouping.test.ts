import assert from "node:assert/strict";
import test from "node:test";
import { dirnameOf, buildDialogRows, type FileListItem, type DialogRow } from "./sync-diff-grouping.ts";

function file(id: string, name: string, type: FileListItem["type"] = "modified"): FileListItem {
  return { id, name, type };
}

function fileRow(item: FileListItem): DialogRow {
  return { kind: "file", item };
}

test("dirnameOf returns null for root-level names", () => {
  assert.equal(dirnameOf("notes.md"), null);
});

test("dirnameOf returns the parent path for nested names", () => {
  assert.equal(dirnameOf("boards/kanban/card1.md"), "boards/kanban");
  assert.equal(dirnameOf("a/b.md"), "a");
});

test("buildDialogRows returns [] for empty input", () => {
  assert.deepEqual(buildDialogRows([]), []);
});

test("files in distinct folders or root all stay individual rows in order", () => {
  const files = [
    file("1", "a/one.md"),
    file("2", "b/two.md"),
    file("3", "three.md"),
  ];
  assert.deepEqual(buildDialogRows(files), files.map(fileRow));
});

test("mixed case: 3-file folder groups, 1-file folder and root file stay individual", () => {
  const a1 = file("a1", "A/one.md", "new");
  const b1 = file("b1", "B/solo.md");
  const a2 = file("a2", "A/two.md");
  const root = file("r", "root.md", "deleted");
  const a3 = file("a3", "A/three.md");
  const rows = buildDialogRows([a1, b1, a2, root, a3]);
  assert.deepEqual(rows, [
    { kind: "group", folderPath: "A", items: [a1, a2, a3], children: [a1, a2, a3].map(fileRow) },
    fileRow(b1),
    fileRow(root),
  ]);
});

test("exactly 2 files in a folder are grouped; exactly 1 is not", () => {
  const p1 = file("p1", "pair/one.md");
  const p2 = file("p2", "pair/two.md");
  const solo = file("s", "solo/only.md");
  const rows = buildDialogRows([p1, p2, solo]);
  assert.deepEqual(rows, [
    { kind: "group", folderPath: "pair", items: [p1, p2], children: [p1, p2].map(fileRow) },
    fileRow(solo),
  ]);
});

test("interleaved input: group emitted at first occurrence, other files keep position", () => {
  const a1 = file("a1", "A/1.md");
  const b1 = file("b1", "B/1.md");
  const a2 = file("a2", "A/2.md");
  const a3 = file("a3", "A/3.md");
  const rows = buildDialogRows([a1, b1, a2, a3]);
  assert.deepEqual(rows, [
    { kind: "group", folderPath: "A", items: [a1, a2, a3], children: [a1, a2, a3].map(fileRow) },
    fileRow(b1),
  ]);
});

test("root-level files are never grouped even when there are several", () => {
  const files = [file("1", "one.md"), file("2", "two.md"), file("3", "three.md")];
  assert.deepEqual(buildDialogRows(files), files.map(fileRow));
});

test("files at different depths group under their shared ancestor", () => {
  const x = file("x", "A/x.md");
  const y = file("y", "A/sub/y.md");
  const rows = buildDialogRows([x, y]);
  assert.deepEqual(rows, [
    { kind: "group", folderPath: "A", items: [x, y], children: [fileRow(x), fileRow(y)] },
  ]);
});

test("a subfolder with 2+ files nests as a subgroup inside its parent group", () => {
  const x1 = file("x1", "A/x1.md");
  const y1 = file("y1", "A/sub/y1.md");
  const x2 = file("x2", "A/x2.md");
  const y2 = file("y2", "A/sub/y2.md");
  const rows = buildDialogRows([x1, y1, x2, y2]);
  assert.deepEqual(rows, [
    {
      kind: "group",
      folderPath: "A",
      items: [x1, y1, x2, y2],
      children: [
        fileRow(x1),
        { kind: "group", folderPath: "A/sub", items: [y1, y2], children: [fileRow(y1), fileRow(y2)] },
        fileRow(x2),
      ],
    },
  ]);
});

test("deep folders label at the most specific shared folder, no wrapper chain", () => {
  const c1 = file("c1", "a/b/c/1.md");
  const c2 = file("c2", "a/b/c/2.md");
  const rows = buildDialogRows([c1, c2]);
  assert.deepEqual(rows, [
    { kind: "group", folderPath: "a/b/c", items: [c1, c2], children: [fileRow(c1), fileRow(c2)] },
  ]);
});

test("sibling folders stay separate top-level groups, no common-ancestor wrapper", () => {
  const b1x = file("b1x", "boards/b1/x.md");
  const b1y = file("b1y", "boards/b1/y.md");
  const b2z = file("b2z", "boards/b2/z.md");
  const b2w = file("b2w", "boards/b2/w.md");
  const rows = buildDialogRows([b1x, b1y, b2z, b2w]);
  assert.deepEqual(rows, [
    { kind: "group", folderPath: "boards/b1", items: [b1x, b1y], children: [fileRow(b1x), fileRow(b1y)] },
    { kind: "group", folderPath: "boards/b2", items: [b2z, b2w], children: [fileRow(b2z), fileRow(b2w)] },
  ]);
});
