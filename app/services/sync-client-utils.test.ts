import assert from "node:assert/strict";
import test from "node:test";
import { getSyncCompletionStatus } from "./sync-client-utils.ts";

// Path / binary classification tests live in gemihub-sync-core.

test("getSyncCompletionStatus returns idle when nothing skipped", () => {
  const result = getSyncCompletionStatus(0, "Push");
  assert.equal(result.status, "idle");
  assert.equal(result.error, null);
});

test("getSyncCompletionStatus returns warning message for skipped files", () => {
  const result = getSyncCompletionStatus(2, "Full push");
  assert.equal(result.status, "warning");
  assert.equal(result.error, "Full push completed with warning: skipped 2 file(s).");
});
