import assert from "node:assert/strict";
import test from "node:test";
import { getDriveToolModeConstraint } from "./settings.ts";

test("RAG keeps Drive function tools available for regular Gemini models", () => {
  assert.deepEqual(getDriveToolModeConstraint("gemini-3.7-flash", "gemihub"), {
    forcedMode: null,
    defaultMode: "noSearch",
    locked: false,
  });
});

test("RAG keeps Drive function tools available for Flash Lite", () => {
  assert.deepEqual(getDriveToolModeConstraint("gemini-3.5-flash-lite", "gemihub"), {
    forcedMode: null,
    defaultMode: "noSearch",
    locked: false,
  });
});
