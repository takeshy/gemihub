import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { watchPreviewDependencies } from "./html-preview-events";
import { buildMockGemihubScript, loadPreviewMockData } from "./html-preview-mock";

test("saving a JSON dependency rebuilds the mock API with the new cached content", async () => {
  const events = new EventTarget();
  const path = "web/__gemihub/api/items.json";
  let cachedContent = '{"value":"before"}';
  const rebuild = async () => buildMockGemihubScript(await loadPreviewMockData(
    { fixture: { name: path } }, async () => cachedContent, () => false,
  ));
  let script = await rebuild();
  let refreshed: Promise<string> | undefined;
  const stop = watchPreviewDependencies(events, () => new Set(["fixture"]), () => {
    refreshed = rebuild();
  });
  try {
    cachedContent = '{"value":"after"}';
    events.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId: "fixture" } }));
    await delay(80);
    assert.ok(refreshed);
    script = await refreshed;
    const context = { window: {} as { gemihub?: { get: (path: string) => Promise<{ value: string }> } } };
    runInNewContext(script.replace(/^<script>|<\/script>$/g, ""), context);
    assert.equal((await context.window.gemihub!.get("items")).value, "after");
  } finally {
    stop();
  }
});

test("bulk cache and pull notifications refresh once and unrelated edits are ignored", async () => {
  const events = new EventTarget();
  let refreshes = 0;
  const stop = watchPreviewDependencies(events, () => new Set(["fixture"]), () => { refreshes++; });
  try {
    events.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId: "other" } }));
    events.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: ["other"] } }));
    await delay(80);
    assert.equal(refreshes, 0);
    events.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: "fixture" } }));
    events.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: ["other", "fixture"] } }));
    events.dispatchEvent(new Event("sync-complete"));
    await delay(80);
    assert.equal(refreshes, 1);
    events.dispatchEvent(new Event("tree-meta-updated"));
    await delay(80);
    assert.equal(refreshes, 2);
  } finally {
    stop();
  }
});

test("unmount cancels pending rebuilds and removes listeners", async () => {
  const events = new EventTarget();
  let refreshes = 0;
  const stop = watchPreviewDependencies(events, () => new Set(["fixture"]), () => { refreshes++; });
  events.dispatchEvent(new Event("sync-complete"));
  stop();
  events.dispatchEvent(new Event("pending-files-created"));
  await delay(80);
  assert.equal(refreshes, 0);
});
