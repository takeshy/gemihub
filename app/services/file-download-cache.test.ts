import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { shouldTreatAsBinaryFile } from "gemihub-sync-core/files";
import { canDownloadCachedFile } from "./file-download-cache";

test("tgz with an unrecognized browser MIME type must not use a text cache", () => {
  const original = gzipSync(Buffer.from("archive contents"));
  const corrupted = Buffer.from(original.toString("utf8"));
  assert.notDeepEqual(corrupted, original);
  for (const mimeType of [undefined, "", "application/x-compressed", "application/x-gtar", "application/gzip"]) {
    assert.equal(shouldTreatAsBinaryFile("uploads/ARCHIVE.TGZ", mimeType), true);
    assert.equal(canDownloadCachedFile({}, "uploads/ARCHIVE.TGZ", mimeType), false);
  }
});

test("binary caches preserve gzip bytes", () => {
  const original = gzipSync(Buffer.from("archive contents"));
  const base64 = original.toString("base64");
  assert.equal(canDownloadCachedFile({ rawContentBase64: base64 }, "archive.tgz"), true);
  assert.equal(canDownloadCachedFile({ encoding: "base64" }, "archive.tgz"), true);
  assert.deepEqual(Buffer.from(base64, "base64"), original);
  assert.equal(gunzipSync(Buffer.from(base64, "base64")).toString(), "archive contents");
});

test("text files can still download local edits even with a binary MIME type", () => {
  assert.equal(canDownloadCachedFile({}, "notes.md", "application/octet-stream"), true);
  assert.equal(canDownloadCachedFile({}, "archive.zip", "text/plain"), false);
  assert.equal(canDownloadCachedFile({}, "unknown.custom", "application/octet-stream"), false);
});
