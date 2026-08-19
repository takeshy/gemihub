import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectMount } from "./resolve-mount.server";

test("parseProjectMount accepts an organization-scoped project", () => {
  assert.deepEqual(parseProjectMount("project:acme/default"), {
    orgId: "acme",
    projectId: "default",
  });
});

test("parseProjectMount keeps legacy session-scoped mounts compatible", () => {
  assert.deepEqual(parseProjectMount("project:default"), { projectId: "default" });
});

test("parseProjectMount rejects incomplete mounts", () => {
  assert.equal(parseProjectMount("drive"), null);
  assert.equal(parseProjectMount("project:"), null);
  assert.equal(parseProjectMount("project:acme/"), null);
});
