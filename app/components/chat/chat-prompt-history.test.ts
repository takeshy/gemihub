import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPromptHistory,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  MAX_PROMPT_HISTORY,
  parsePromptHistory,
} from "./chat-prompt-history";

test("prompt history parsing filters invalid entries and caps the result", () => {
  const values = [...Array.from({ length: 105 }, (_, index) => `prompt ${index}`), "", 42];
  const history = parsePromptHistory(JSON.stringify(values));
  assert.equal(history.length, MAX_PROMPT_HISTORY);
  assert.equal(history[0], "prompt 5");
  assert.equal(history.at(-1), "prompt 104");
});

test("appendPromptHistory stores trimmed prompts and keeps repeated sends", () => {
  assert.deepEqual(appendPromptHistory(["first"], "  second  "), ["first", "second"]);
  assert.deepEqual(appendPromptHistory(["same"], "same"), ["same", "same"]);
});

test("caret helpers preserve normal multiline arrow navigation", () => {
  const value = "first\nsecond";
  assert.equal(isCaretOnFirstLine(value, 3), true);
  assert.equal(isCaretOnFirstLine(value, 8), false);
  assert.equal(isCaretOnLastLine(value, 3), false);
  assert.equal(isCaretOnLastLine(value, 8), true);
});
