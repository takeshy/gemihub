import assert from "node:assert/strict";
import test from "node:test";
import { parseStorageDragPayload } from "./storage-drag";

test("parseStorageDragPayload accepts a cross-project file move", () => {
  assert.deepEqual(
    parseStorageDragPayload(JSON.stringify({
      sourceMount: "drive",
      moves: [{ from: "notes/private.md", to: "private.md" }],
    })),
    {
      sourceMount: "drive",
      moves: [{ from: "notes/private.md", to: "private.md" }],
    },
  );
});

test("parseStorageDragPayload rejects malformed drag data", () => {
  assert.equal(parseStorageDragPayload("not-json"), null);
  assert.equal(parseStorageDragPayload(JSON.stringify({ sourceMount: "p", moves: [] })), null);
  assert.equal(parseStorageDragPayload(JSON.stringify({ sourceMount: "p", moves: [{ from: 1 }] })), null);
});
