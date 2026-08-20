import assert from "node:assert/strict";
import test from "node:test";
import { ModelNotAllowedError, ModelNotPricedError, assertModelAllowed } from "./project-acl.server.ts";
import { VERTEX_MODELS } from "./ai/models.ts";
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

test("assertModelAllowed: every built-in default is priced", () => {
  const ctx = ctxWith([]);
  for (const model of Object.values(VERTEX_MODELS)) {
    assert.doesNotThrow(() => assertModelAllowed(ctx, model), model);
  }
});

test("assertModelAllowed: an allowlisted but unpriced model is refused", () => {
  // Spending an organization's budget at the Pro-tier fallback while Google
  // bills the real (up to 10x) rate is the loss this gate exists to prevent.
  const ctx = ctxWith(["gemini-9-unreleased"]);
  assert.throws(
    () => assertModelAllowed(ctx, "gemini-9-unreleased"),
    ModelNotPricedError,
  );
});

test("ModelNotPricedError: surfaces the model and a 403", () => {
  const ctx = ctxWith(["gemini-9-unreleased"]);
  try {
    assertModelAllowed(ctx, "gemini-9-unreleased");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof ModelNotPricedError);
    // Routes match on ModelNotAllowedError, so the subclass must satisfy it.
    assert.ok(err instanceof ModelNotAllowedError);
    assert.equal(err.model, "gemini-9-unreleased");
    assert.deepEqual(err.allowed, ["gemini-9-unreleased"]);
    assert.equal(err.status, 403);
  }
});
