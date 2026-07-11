import assert from "node:assert/strict";
import test from "node:test";
import { remoteChangedSincePushSnapshot } from "./sync-push-guard";

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
