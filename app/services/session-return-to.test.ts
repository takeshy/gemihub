import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo } from "./session.server";

test("keeps same-origin absolute paths", () => {
  assert.equal(safeReturnTo("/settings?tab=general"), "/settings?tab=general");
  assert.equal(safeReturnTo("/"), "/");
});

test("rejects absolute URLs and protocol-relative paths", () => {
  assert.equal(safeReturnTo("https://evil.example/phish"), "/");
  assert.equal(safeReturnTo("//evil.example/phish"), "/");
  assert.equal(safeReturnTo("/\\evil.example/phish"), "/");
  assert.equal(safeReturnTo("javascript:alert(1)"), "/");
});

test("falls back for missing or non-string values", () => {
  assert.equal(safeReturnTo(undefined), "/");
  assert.equal(safeReturnTo(""), "/");
  assert.equal(safeReturnTo(42), "/");
  assert.equal(safeReturnTo(null, "/login"), "/login");
});
