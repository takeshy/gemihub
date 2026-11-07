import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../server/domain.ts";
import { scopedConfig, scopedSource, rebaseDraft, themeValue } from "../server/pages.ts";
import { validateVisualChange } from "../server/visual.ts";
import { standardTheme } from "../shared/theme-editing.ts";
import { designOf, designFingerprints, restoreDesign, parseTargetKey, indexedDesignVersions } from "../server/design-versions.ts";
import { editorIndex } from "../server/editor-sync.ts";
import { syncStatus } from "../src/editor-sync.ts";
import { sampleFixtures } from "../src/local-preview.ts";

test("the whole-page frame publishes header/footer/style together while preserving facts, features and page content", async () => {
  const current = { ...structuredClone(sample), pages: [{ id: "faq", slug: "faq", title: "FAQ", navigationLabel: "FAQ", body: "<p>Published</p>", layout: "standard" as const, imageUrl: "" }] };
  const local = structuredClone(current);
  local.header.title = "New heading";local.footer.text = "New footer";
  local.appearance = { accent: "rose", layout: "standard", imageUrl: "", theme: { ...standardTheme, css: "main{padding:24px}" }, articles: { blogs: false, announcements: false } };
  local.pages[0].body = "<p>Unpublished page edit</p>";local.description = "Unpublished description";local.rules.interval = 60;
  const next = scopedConfig(current, local, { kind: "theme" });
  assert.equal(next.header.title, "New heading");assert.equal(next.footer.text, "New footer");
  assert.equal(next.description, current.description);assert.deepEqual(next.rules, current.rules);assert.deepEqual(next.pages, current.pages);
  assert.deepEqual(next.appearance?.articles, current.appearance?.articles);
  const rebased = rebaseDraft(current, local, next, { kind: "theme" });
  assert.equal(rebased.config.pages[0].body, local.pages[0].body);assert.equal(rebased.source.pages[0].body, current.pages[0].body);
  assert.equal(rebased.config.description, local.description);assert.equal(rebased.source.description, current.description);
  assert.deepEqual(themeValue(rebased.config), themeValue(next));assert.deepEqual(themeValue(rebased.source), themeValue(next));
  const draft = { config: local, source: current, base: 1, fixtures: sampleFixtures(current) };
  assert.equal(await syncStatus(draft, editorIndex(current, 1), { kind: "theme" }), "local");
  assert.notDeepEqual(scopedSource(current, { kind: "theme" }), scopedSource(next, { kind: "theme" }));
});

test("whole-page visual changes include both ends of the page and reject business or functional changes", () => {
  const current = structuredClone(sample), next = structuredClone(current);
  next.header.title = "New heading";next.footer.text = "New footer";
  assert.equal(validateVisualChange(current, next, "theme").header.title, "New heading");
  for (const change of [
    (config: typeof next) => { config.name = "A different shop"; },
    (config: typeof next) => { config.rules.interval = 60; },
    (config: typeof next) => { config.menus[0].price++; },
    (config: typeof next) => { config.screens = { reserve: { html: '<section><slot name="booking"></slot></section>', css: "" } }; },
    (config: typeof next) => { config.appearance = { ...config.appearance!, articles: { blogs: false, announcements: false } }; },
    (config: typeof next) => { config.appearance = { ...config.appearance!, copy: { ...config.appearance?.copy, recentPosts: "Hidden content change" } }; },
  ]) { const invalid = structuredClone(next);change(invalid);assert.throws(() => validateVisualChange(current, invalid, "theme")); }
});

test("publishing a screen's content keeps an unfinished whole-page draft separate", async () => {
  const current = structuredClone(sample), local = structuredClone(sample);
  local.header.title = "Unpublished heading";local.footer.text = "Unpublished footer";
  local.appearance = { ...local.appearance!, accent: "rose", theme: { ...standardTheme, css: "main{padding:40px}" }, copy: { navReserve: "Unpublished menu", recentPosts: "New news heading" } };
  const next = scopedConfig(current, local, { kind: "content" });
  assert.deepEqual(themeValue(next), themeValue(current));assert.equal(next.appearance?.copy?.recentPosts, "New news heading");
  const rebased = rebaseDraft(current, local, next, { kind: "content" });
  assert.equal(rebased.config.header.title, "Unpublished heading");assert.equal(rebased.config.footer.text, "Unpublished footer");
  assert.equal(rebased.config.appearance?.theme?.css, "main{padding:40px}");assert.equal(rebased.source.appearance?.theme?.css, current.appearance?.theme?.css);
  assert.equal(rebased.source.appearance?.copy?.recentPosts, "New news heading");
  const draft = { config: { ...local, appearance: { ...local.appearance!, copy: { navReserve: "Unpublished menu" } } }, source: current, base: 1, fixtures: sampleFixtures(current) };
  assert.equal(await syncStatus(draft, editorIndex(current, 1), { kind: "content" }), "synced", "a frame-only edit does not mark each content screen as changed");
});

test("whole-page history restores only its complete frame and indexes versions created before the unified editor", async () => {
  const previous = structuredClone(sample), current = structuredClone(sample);
  current.header.title = "Current heading";current.footer.text = "Current footer";current.rules.interval = 60;
  current.appearance = { ...current.appearance!, articles: { blogs: false, announcements: true } };
  const target = parseTargetKey("theme");
  const restored = restoreDesign(current, designOf(previous), target);
  assert.equal(restored.header.title, previous.header.title);assert.equal(restored.footer.text, previous.footer.text);
  assert.equal(restored.rules.interval, 60);assert.deepEqual(restored.appearance?.articles, current.appearance.articles);
  const fingerprints = designFingerprints(previous);delete fingerprints.theme;
  let reads = 0;
  const indexed = await indexedDesignVersions([{ number: 1, at: "2026-11-07T00:00:00Z", summary: "Old frame", folderId: "old", manifestId: "whole-page-legacy", fingerprints }], { readDesign: async () => { reads++;return designOf(previous); } });
  assert.equal(reads, 1);assert.equal(indexed[0].fingerprints?.theme, designFingerprints(previous).theme);
});
