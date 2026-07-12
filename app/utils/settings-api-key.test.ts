import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubmittedGeminiApiKey } from "./settings-api-key";

test("ignores an autofilled API key for an existing setup", () => {
  assert.equal(resolveSubmittedGeminiApiKey("autofilled-password", true, false), "");
});

test("accepts an explicitly edited API key for an existing setup", () => {
  assert.equal(resolveSubmittedGeminiApiKey("  new-api-key  ", true, true), "new-api-key");
});

test("accepts the API key during initial setup without an edit marker", () => {
  assert.equal(resolveSubmittedGeminiApiKey("initial-api-key", false, false), "initial-api-key");
});
