import assert from "node:assert/strict";
import test from "node:test";
import { KakerattaSettingsSchema, resolveKakerattaProfile, getKakerattaRagError } from "./kakeratta";

test("legacy settings opt out of connection and file access", () => {
  const config = KakerattaSettingsSchema.parse({});
  assert.equal(config.enabled, false);
  assert.equal(config.pollEnabled, true);
  assert.equal(config.defaultProfile.readFiles, false);
});

test("persona overrides never inherit broader default access", () => {
  const config = KakerattaSettingsSchema.parse({ defaultProfile: { readFiles: true, webSearch: true }, personas: { one: { model: "scoped" } } });
  assert.equal(resolveKakerattaProfile(config, { persona: { id: "one" } }).readFiles, false);
  assert.equal(resolveKakerattaProfile(config, { persona: { id: "one" } }).webSearch, false);
  assert.equal(resolveKakerattaProfile(config, { persona: { id: "missing" } }).readFiles, true);
  assert.equal(resolveKakerattaProfile(config, { persona: { id: "__proto__" } }).readFiles, true);
});

test("HTTP headers reject injection and invalid names", () => {
  assert.equal(KakerattaSettingsSchema.safeParse({ headers: { Authorization: "Bearer key\r\nX-Key: bad" } }).success, false);
  assert.equal(KakerattaSettingsSchema.safeParse({ headers: { "bad name": "value" } }).success, false);
});

test("personal Vertex rejects RAG in the default and in persona overrides", () => {
  for (const input of [{ defaultProfile: { ragSetting: "research" } }, { personas: { one: { ragSetting: "research" } } }, { direct: { ragSetting: "research" } }]) {
    const config = KakerattaSettingsSchema.parse(input);
    assert.match(getKakerattaRagError(config, { usePersonalVertex: true })!, /RAG is unavailable/);
    assert.equal(getKakerattaRagError(config, { usePersonalVertex: false }), null);
  }
  assert.equal(getKakerattaRagError(KakerattaSettingsSchema.parse({}), { usePersonalVertex: true }), null);
});
