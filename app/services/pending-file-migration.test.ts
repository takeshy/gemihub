import assert from "node:assert/strict";
import test from "node:test";
import { pendingFileTargetName } from "./pending-file-migration";

test("pending migration follows a renamed cache filename", () => {
  assert.equal(
    pendingFileTargetName({ fileId: "new:old/path.md", fileName: "new/path.md" }),
    "new/path.md",
  );
});

test("pending migration falls back to the new: id path", () => {
  assert.equal(pendingFileTargetName({ fileId: "new:notes/a.md" }), "notes/a.md");
});
