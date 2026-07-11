import assert from "node:assert/strict";
import test from "node:test";
import { buildSecretTree, matchesSecretSearch, secretFilePath, type SecretTreeNode } from "./secret-manager";

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

function shape(nodes: SecretTreeNode<string>[]): unknown[] {
  return nodes.map((node) =>
    node.kind === "dir" ? { dir: node.path, children: shape(node.children) } : { file: node.entry }
  );
}

test("buildSecretTree sorts directories before files at every level", () => {
  const tree = buildSecretTree(
    ["b.encrypted", "Ops/token.encrypted", "a.encrypted", "Dev/key.encrypted"],
    (path) => path,
  );
  assert.deepEqual(shape(tree), [
    { dir: "Dev", children: [{ file: "Dev/key.encrypted" }] },
    { dir: "Ops", children: [{ file: "Ops/token.encrypted" }] },
    { file: "a.encrypted" },
    { file: "b.encrypted" },
  ]);
});

test("buildSecretTree nests up to two directory levels and flattens deeper paths", () => {
  const tree = buildSecretTree(
    ["Ops/API/token.encrypted", "Ops/API/Legacy/old.encrypted"],
    (path) => path,
  );
  assert.deepEqual(shape(tree), [
    {
      dir: "Ops",
      children: [
        {
          dir: "Ops/API",
          children: [
            { file: "Ops/API/Legacy/old.encrypted" },
            { file: "Ops/API/token.encrypted" },
          ],
        },
      ],
    },
  ]);
});
