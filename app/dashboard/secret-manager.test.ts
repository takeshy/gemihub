import assert from "node:assert/strict";
import test from "node:test";
import { matchesSecretSearch, secretFilePath } from "./secret-manager";

test("secretFilePath creates a safe encrypted path in the configured folder", () => {
  assert.equal(secretFilePath(" Secrets/API ", "Production token"), "Secrets/API/Production token.encrypted");
  assert.equal(secretFilePath("Secrets", "Production token", " Services/API "), "Secrets/Services/API/Production token.encrypted");
  assert.equal(secretFilePath("Secrets", "Production token", "../Services/./API"), "Secrets/Services/API/Production token.encrypted");
  assert.equal(secretFilePath("", "deploy.encrypted"), "deploy.encrypted");
  assert.equal(secretFilePath("Secrets", "../bad/name"), "Secrets/bad-name.encrypted");
});

test("secret manager search matches file names and descriptions", () => {
  assert.equal(matchesSecretSearch("Secrets/github.encrypted", "CI deploy token", "github"), true);
  assert.equal(matchesSecretSearch("Secrets/github.encrypted", "CI deploy token", "DEPLOY"), true);
  assert.equal(matchesSecretSearch("Secrets/github.encrypted", "CI deploy token", "ops@example.com", {
    email: "ops@example.com",
  }), true);
  assert.equal(matchesSecretSearch("Secrets/github.encrypted", "CI deploy token", "database"), false);
});
