import assert from "node:assert/strict";
import test from "node:test";
import {
  objectPathOf,
  stripCommonPrefix,
  toStoredObject,
} from "./gcs-storage-utils.ts";
import type { ProjectAccessContext, TenantInfo } from "~/types/enterprise.ts";

const TENANT: TenantInfo = {
  gcsBucket: "gemihub-abc123",
  region: "global",
};

const CTX: ProjectAccessContext = {
  uid: "u_test",
  role: "editor",
  orgId: "abc123",
  projectId: "p_main",
  tenant: TENANT,
  gcsPrefix: "p_main",
};

// ---------------------------------------------------------------------------
// objectPathOf
// ---------------------------------------------------------------------------

test("objectPathOf: simple relative path", () => {
  assert.equal(objectPathOf(CTX, "gemihub/notes/foo.md"), "p_main/gemihub/notes/foo.md");
});

test("objectPathOf: strips leading slashes", () => {
  assert.equal(objectPathOf(CTX, "/gemihub/notes/foo.md"), "p_main/gemihub/notes/foo.md");
  assert.equal(objectPathOf(CTX, "///x.txt"), "p_main/x.txt");
});

test("objectPathOf: empty relative path leaves a trailing slash", () => {
  assert.equal(objectPathOf(CTX, ""), "p_main/");
});

// ---------------------------------------------------------------------------
// toStoredObject
// ---------------------------------------------------------------------------

test("toStoredObject: maps full GCS metadata", () => {
  const obj = toStoredObject(
    {
      name: "p_main/gemihub/notes/foo.md",
      contentType: "text/markdown",
      size: "1024",
      md5Hash: "deadbeefdeadbeefdeadbeefdeadbeef==",
      generation: "1700000000000001",
      updated: "2026-04-27T12:00:00.000Z",
      metadata: { createdBy: "u_a", updatedBy: "u_b", custom: "x" },
    },
    "p_main",
  );
  assert.equal(obj.objectPath, "p_main/gemihub/notes/foo.md");
  assert.equal(obj.relativePath, "gemihub/notes/foo.md");
  assert.equal(obj.contentType, "text/markdown");
  assert.equal(obj.size, 1024);
  assert.equal(obj.md5Hash, "deadbeefdeadbeefdeadbeefdeadbeef==");
  assert.equal(obj.generation, "1700000000000001");
  assert.equal(obj.updatedAt, new Date("2026-04-27T12:00:00.000Z").getTime());
  assert.equal(obj.createdBy, "u_a");
  assert.equal(obj.updatedBy, "u_b");
});

test("toStoredObject: defaults missing fields", () => {
  const obj = toStoredObject({ name: "p_main/x.bin" }, "p_main");
  assert.equal(obj.contentType, "application/octet-stream");
  assert.equal(obj.size, 0);
  assert.equal(obj.md5Hash, "");
  assert.equal(obj.generation, "0");
  assert.equal(obj.updatedAt, 0);
  assert.equal(obj.createdBy, undefined);
  assert.equal(obj.updatedBy, undefined);
});

test("toStoredObject: numeric size is preserved", () => {
  const obj = toStoredObject({ name: "p_main/x", size: 999 }, "p_main");
  assert.equal(obj.size, 999);
});

test("toStoredObject: relativePath unchanged if path is outside prefix", () => {
  // Should not happen in practice but test the fallback.
  const obj = toStoredObject({ name: "other/y.md" }, "p_main");
  assert.equal(obj.relativePath, "other/y.md");
});

test("toStoredObject: relativePath equal to prefix is empty after strip", () => {
  // Edge case: path exactly equals "{prefix}/" → relativePath becomes ""
  const obj = toStoredObject({ name: "p_main/" }, "p_main");
  assert.equal(obj.relativePath, "");
});

// ---------------------------------------------------------------------------
// stripCommonPrefix
// ---------------------------------------------------------------------------

test("stripCommonPrefix: strips matching prefix", () => {
  assert.equal(stripCommonPrefix("p_main/sub/", "p_main"), "sub/");
});

test("stripCommonPrefix: leaves non-matching prefix alone", () => {
  assert.equal(stripCommonPrefix("other/sub/", "p_main"), "other/sub/");
});
