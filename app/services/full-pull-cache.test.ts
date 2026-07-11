import assert from "node:assert/strict";
import test from "node:test";
import { fullPullCacheRecord } from "./full-pull-cache";

test("Full Pull preserves the base64 marker for binary cache records", () => {
  assert.deepEqual(
    fullPullCacheRecord({
      fileId: "pdf-1",
      content: "JVBERi0=",
      md5Checksum: "abc",
      modifiedTime: "2026-07-11T00:00:00.000Z",
      fileName: "document.pdf",
      encoding: "base64",
    }, 123),
    {
      fileId: "pdf-1",
      content: "JVBERi0=",
      md5Checksum: "abc",
      modifiedTime: "2026-07-11T00:00:00.000Z",
      cachedAt: 123,
      fileName: "document.pdf",
      encoding: "base64",
    },
  );
});

test("Full Pull leaves text cache records unencoded", () => {
  const record = fullPullCacheRecord({
    fileId: "dashboard-1",
    content: "version: 1\n",
    md5Checksum: "def",
    modifiedTime: "2026-07-11T00:00:00.000Z",
    fileName: "home.dashboard",
  }, 123);

  assert.equal(record.encoding, undefined);
  assert.equal(record.content, "version: 1\n");
});
