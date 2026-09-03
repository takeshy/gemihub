import assert from "node:assert/strict";
import test from "node:test";
import { ThinkingLevel } from "@google/genai";
import { getThinkingConfig } from "./gemini-content-builders";
import { buildGenerationConfig } from "./gemini-interactions.server";

test("Gemini reasoning default leaves API defaults unchanged", () => {
  assert.equal(getThinkingConfig("gemini-3.8-flash", "default"), undefined);
  assert.equal(buildGenerationConfig("gemini-3.8-flash", "default"), undefined);
});

test("Gemini reasoning none maps to the lowest supported level", () => {
  assert.deepEqual(getThinkingConfig("gemini-3.8-flash", "none"), {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.LOW,
  });
  assert.deepEqual(getThinkingConfig("gemini-3.5-flash-lite", "none"), {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
});

test("Gemini Pro clamps unsupported minimal effort to low", () => {
  assert.deepEqual(getThinkingConfig("gemini-3.1-pro-preview", "minimal"), {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.LOW,
  });
  assert.deepEqual(buildGenerationConfig("gemini-3.1-pro-preview", "minimal"), {
    thinking_level: "low",
    thinking_summaries: "auto",
  });
});

test("explicit effort is forwarded to both Gemini API shapes", () => {
  assert.deepEqual(getThinkingConfig("gemini-3.8-flash", "medium"), {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.MEDIUM,
  });
  assert.deepEqual(buildGenerationConfig("gemini-3.8-flash", "medium"), {
    thinking_level: "medium",
    thinking_summaries: "auto",
  });
});

test("legacy enableThinking boolean maps to high / none", () => {
  assert.deepEqual(getThinkingConfig("gemini-3.8-flash", true), {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.HIGH,
  });
  assert.deepEqual(getThinkingConfig("gemini-3.8-flash", false), {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.LOW,
  });
  assert.deepEqual(getThinkingConfig("gemini-3.5-flash-lite", false), {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
});
