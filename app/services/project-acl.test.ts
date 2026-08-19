import assert from "node:assert/strict";
import test from "node:test";
import { ModelNotAllowedError, assertModelAllowed } from "./project-acl.server.ts";
import type { ProjectAccessContext, TenantInfo } from "~/types/enterprise.ts";

const TENANT: TenantInfo = {
  gcsBucket: "gemihub-abc123",
  region: "global",
};

function ctxWith(allowedModels: string[]): ProjectAccessContext {
  return {
    uid: "u",
    role: "editor",
    orgId: "abc123",
    projectId: "p",
    tenant: TENANT,
    gcsPrefix: "p",
    allowedModels,
  };
}

test("assertModelAllowed: empty list permits the built-in defaults", () => {
  const ctx = ctxWith([]);
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemini-3.1-pro-preview"));
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemini-3.7-flash"));
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemini-3.5-flash-lite"));
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemma-4-31b-it"));
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemma-4-26b-a4b-it"));
});

test("assertModelAllowed: deprecated Flash models resolve to the default", () => {
  const ctx = ctxWith([]);
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemini-3.6-flash"));
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemini-3.5-flash"));
});

test("assertModelAllowed: empty list rejects models outside the defaults", () => {
  const ctx = ctxWith([]);
  assert.throws(
    () => assertModelAllowed(ctx, "gemini-9-unknown"),
    ModelNotAllowedError,
  );
  assert.throws(
    () => assertModelAllowed(ctx, "claude-opus-4-7"),
    ModelNotAllowedError,
  );
});

test("assertModelAllowed: explicit allowlist permits only listed models", () => {
  const ctx = ctxWith(["gemini-3.5-flash"]);
  assert.doesNotThrow(() => assertModelAllowed(ctx, "gemini-3.5-flash"));
  assert.throws(
    () => assertModelAllowed(ctx, "gemini-3.1-pro-preview"),
    ModelNotAllowedError,
  );
});

test("ModelNotAllowedError: surfaces model and allowed list", () => {
  const ctx = ctxWith(["gemini-3.5-flash"]);
  try {
    assertModelAllowed(ctx, "gemini-3.1-pro-preview");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof ModelNotAllowedError);
    assert.equal(err.model, "gemini-3.1-pro-preview");
    assert.deepEqual(err.allowed, ["gemini-3.5-flash"]);
    assert.equal(err.status, 403);
  }
});
