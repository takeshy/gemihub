import assert from "node:assert/strict";
import test from "node:test";
import {
  compareOkfVersions,
  isGemihubOkfBundleName,
  parseGemihubOkfManifest,
} from "./gemihub-okf-manifest";

const validManifest = {
  name: "GemiHub",
  version: "1.2.0",
  publishedAt: "2026-07-11T12:00:00+09:00",
  bundleUrl: "releases/1.2.0/gemihub-okf.zip",
  sha256: "a".repeat(64),
  files: {
    "index.md": "b".repeat(64),
    "features/dashboard.md": "c".repeat(64),
  },
};

test("parseGemihubOkfManifest accepts a valid distribution manifest", () => {
  assert.deepEqual(parseGemihubOkfManifest(validManifest), validManifest);
});

test("parseGemihubOkfManifest rejects paths outside the bundle", () => {
  assert.throws(
    () => parseGemihubOkfManifest({
      ...validManifest,
      files: { "../settings.json": "d".repeat(64) },
    }),
    /file path/,
  );
});

test("isGemihubOkfBundleName matches the exact name and legacy folder-name fallbacks", () => {
  assert.equal(isGemihubOkfBundleName("GemiHub"), true);
  assert.equal(isGemihubOkfBundleName(" gemihub "), true);
  assert.equal(isGemihubOkfBundleName("gemihub-okf"), true);
  assert.equal(isGemihubOkfBundleName("My GemiHub Notes"), true);
  assert.equal(isGemihubOkfBundleName("Knowledge"), false);
});

test("compareOkfVersions compares semantic versions and prereleases", () => {
  assert.equal(compareOkfVersions("1.2.0", "1.1.9") > 0, true);
  assert.equal(compareOkfVersions("1.2.0-beta.1", "1.2.0") < 0, true);
  assert.equal(compareOkfVersions("1.2.0-beta.10", "1.2.0-beta.2") > 0, true);
  assert.equal(compareOkfVersions("2.0.0", "2.0.0"), 0);
});
