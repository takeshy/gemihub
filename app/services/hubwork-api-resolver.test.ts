import assert from "node:assert/strict";
import test from "node:test";
import { buildApiIndexFromPaths, resolveApiWorkflow } from "./hubwork-api-resolver.server.ts";

test("GCS Hubwork API index includes only YAML workflows under web/api", () => {
  const index = buildApiIndexFromPaths([
    "web/api/users/list.yaml",
    "web/api/users/[id].yaml",
    "web/api/readme.txt",
    "workflows/other.yaml",
  ]);
  assert.deepEqual([...index.keys()], ["users/list.yaml", "users/[id].yaml"]);
  assert.deepEqual(resolveApiWorkflow(index, "users/list"), {
    fileId: "web/api/users/list.yaml",
    params: {},
  });
  assert.deepEqual(resolveApiWorkflow(index, "users/42"), {
    fileId: "web/api/users/[id].yaml",
    params: { id: "42" },
  });
});
