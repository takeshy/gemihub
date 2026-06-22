import assert from "node:assert/strict";
import test from "node:test";
import { isSyncExcludedPath, getSyncCompletionStatus } from "./sync-client-utils.ts";

test("isSyncExcludedPath excludes system file names", () => {
  assert.equal(isSyncExcludedPath("_sync-meta.json"), true);
  assert.equal(isSyncExcludedPath("settings.json"), true);
});

test("isSyncExcludedPath excludes special folders", () => {
  assert.equal(isSyncExcludedPath("history/run.log"), true);
  assert.equal(isSyncExcludedPath("trash/note.md"), true);
  assert.equal(isSyncExcludedPath("sync_conflicts/backup.md"), true);
  assert.equal(isSyncExcludedPath("__TEMP__/draft.md"), true);
  assert.equal(isSyncExcludedPath("plugins/tool.js"), true);
  assert.equal(isSyncExcludedPath("dashboards/.cache/abc123.json"), true);
});

test("isSyncExcludedPath still syncs dashboard files themselves", () => {
  assert.equal(isSyncExcludedPath("dashboards/home.dashboard"), false);
  assert.equal(isSyncExcludedPath("home.dashboard"), false);
});

test("isSyncExcludedPath handles leading slash", () => {
  assert.equal(isSyncExcludedPath("/history/run.log"), true);
});

test("isSyncExcludedPath allows normal files", () => {
  assert.equal(isSyncExcludedPath("notes/daily.md"), false);
  assert.equal(isSyncExcludedPath("history_notes.md"), false);
});

test("getSyncCompletionStatus returns idle when nothing skipped", () => {
  const result = getSyncCompletionStatus(0, "Push");
  assert.equal(result.status, "idle");
  assert.equal(result.error, null);
});

test("getSyncCompletionStatus returns warning message for skipped files", () => {
  const result = getSyncCompletionStatus(2, "Full push");
  assert.equal(result.status, "warning");
  assert.equal(result.error, "Full push completed with warning: skipped 2 file(s).");
});
