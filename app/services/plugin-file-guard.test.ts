import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isPluginDeniedPath, assertPluginPathAllowed, PluginAccessDeniedError } from "./plugin-file-guard.ts";

test("credential-bearing files are denied to plugins", () => {
  assert.equal(isPluginDeniedPath("settings.json"), true);
  assert.equal(isPluginDeniedPath("_encrypted-auth.json"), true);
  assert.equal(isPluginDeniedPath("_sync-meta.json"), true);
  assert.equal(isPluginDeniedPath("./settings.json"), true);
  assert.equal(isPluginDeniedPath("/settings.json"), true);
});

test("other plugins' code is denied to plugins", () => {
  assert.equal(isPluginDeniedPath("plugins/other/main.js"), true);
  assert.equal(isPluginDeniedPath("plugins/other/manifest.json"), true);
});

test("ordinary user files stay allowed", () => {
  assert.equal(isPluginDeniedPath("notes/daily.md"), false);
  assert.equal(isPluginDeniedPath("my-settings.json"), false);
  assert.equal(isPluginDeniedPath("docs/plugins/guide.md"), false);
  assert.equal(isPluginDeniedPath(undefined), false);
});

test("assertPluginPathAllowed throws only for denied paths", () => {
  assert.throws(() => assertPluginPathAllowed("settings.json"), PluginAccessDeniedError);
  assert.doesNotThrow(() => assertPluginPathAllowed("notes/daily.md"));
});

/**
 * The decrypted Gemini API key (`api-key-cache.ts`) and the decrypted RSA
 * private key / encryption password (`crypto-cache.ts`) are host-only. Plugins
 * run in the same realm, so this cannot stop a hostile plugin that patches
 * globals — but it does guarantee the PluginAPI never hands the material over,
 * and it fails loudly if someone wires it in later.
 */
test("PluginAPI never touches the API key or private key caches", () => {
  const source = readFileSync(new URL("./plugin-api.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "api-key-cache",
    "crypto-cache",
    "getCachedApiKey",
    "cryptoCache",
    "getPrivateKey",
    "getPassword",
    "encryptedPrivateKey",
    "encryptedApiKey",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `plugin-api.ts must not reference ${forbidden} — key material stays out of the plugin surface`
    );
  }
});

test("PluginAPI surface stays an explicit allowlist", () => {
  const source = readFileSync(new URL("../types/plugin.ts", import.meta.url), "utf8");
  const surface = source.match(/^export interface PluginAPI \{[\s\S]*?^\}/m);
  assert.ok(surface, "PluginAPI interface not found in app/types/plugin.ts");
  // Top-level members a plugin can reach. Adding one is a deliberate decision:
  // update this list only after checking it exposes no credential material.
  const expected = [
    "language",
    "registerView",
    "registerSettingsTab",
    "registerWidget",
    "onActiveFileChanged",
    "selectFile",
    "assets",
    "React",
    "ReactDOM",
    "gemini",
    "drive",
    "storage",
    "calendar",
    "gmail",
    "sheets",
  ];
  const declared = [...surface[0].matchAll(/^ {2}(\w+)[?:(]/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(declared)].sort(),
    [...expected].sort(),
    "PluginAPI surface changed — review the new member for credential exposure"
  );
});
