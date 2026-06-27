import assert from "node:assert/strict";
import test from "node:test";
import { isSyncExcludedPath, getSyncCompletionStatus, shouldTreatAsBinaryFile } from "./sync-client-utils.ts";

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
});

test("isSyncExcludedPath still syncs dashboard files themselves", () => {
  assert.equal(isSyncExcludedPath("Dashboards/home.dashboard"), false);
  assert.equal(isSyncExcludedPath("home.dashboard"), false);
});

test("dashboard workflow cache is a normal synced file", () => {
  // Stored at Dashboards/Data/<id>.json — synced and visible like any file.
  assert.equal(isSyncExcludedPath("Dashboards/Data/abc123.json"), false);
});

test("timeline notes and attachments are normal synced files", () => {
  assert.equal(isSyncExcludedPath("Dashboards/Timeline/Daily/2026-06-27.md"), false);
  assert.equal(isSyncExcludedPath("Dashboards/Timeline/Daily/attachments/2026-06-27/post_01.png"), false);
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

test("shouldTreatAsBinaryFile keeps dashboard-like text files textual despite octet-stream mime", () => {
  assert.equal(shouldTreatAsBinaryFile("Dashboards/home.dashboard", "application/octet-stream"), false);
  assert.equal(shouldTreatAsBinaryFile("Dashboards/Bases/Tips.base", "application/octet-stream"), false);
  assert.equal(shouldTreatAsBinaryFile("workflows/example.yaml", "application/octet-stream"), false);
});

test("shouldTreatAsBinaryFile still treats real binary extensions as binary", () => {
  assert.equal(shouldTreatAsBinaryFile("archive.zip", "application/octet-stream"), true);
  assert.equal(shouldTreatAsBinaryFile("cover.png", ""), true);
});
