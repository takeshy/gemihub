import assert from "node:assert/strict";
import test from "node:test";

import { parseBaseConfig } from "./config";

test("Base config accepts the legacy top-level version marker", () => {
  const result = parseBaseConfig(`
version: 1
views:
  - type: table
    name: Notes
`);

  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.config);
  assert.equal(result.config.views[0]?.name, "Notes");
});
