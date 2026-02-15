import test from "node:test";
import assert from "node:assert/strict";
import { fromWysiwygMarkdown, toWysiwygMarkdown } from "./markdown-spacing";

const MARKER = "\u2060\u00A0\u2060";

test("single blank line remains unchanged", () => {
  const markdown = "alpha\n\nbeta";
  assert.equal(toWysiwygMarkdown(markdown), markdown);
});

test("converts extra blank lines to placeholder paragraphs and restores them", () => {
  const markdown = "alpha\n\n\nbeta";
  const converted = toWysiwygMarkdown(markdown);
  assert.equal(converted, `alpha\n\n${MARKER}\n\nbeta`);
  assert.equal(fromWysiwygMarkdown(converted), markdown);
});

test("restores long runs of blank lines", () => {
  const markdown = "alpha\n\n\n\nbeta";
  const converted = toWysiwygMarkdown(markdown);
  assert.equal(converted, `alpha\n\n${MARKER}\n\n${MARKER}\n\nbeta`);
  assert.equal(fromWysiwygMarkdown(converted), markdown);
});

test("does not transform blank lines inside fenced code blocks", () => {
  const markdown = "```\nline1\n\n\nline2\n```\n\n\nafter";
  const converted = toWysiwygMarkdown(markdown);
  assert.equal(converted, `\`\`\`\nline1\n\n\nline2\n\`\`\`\n\n${MARKER}\n\nafter`);
  assert.equal(fromWysiwygMarkdown(converted), markdown);
});

test("round-trip preserves mixed markdown", () => {
  const markdown = "# title\n\none\n\n\n\ntwo\n\n- a\n- b\n";
  assert.equal(fromWysiwygMarkdown(toWysiwygMarkdown(markdown)), markdown);
});

test("does not transform blank lines in indented code blocks", () => {
  const markdown = "    a\n\n\n    b";
  assert.equal(toWysiwygMarkdown(markdown), markdown);
  assert.equal(fromWysiwygMarkdown(markdown), markdown);
});

test("plain nbsp paragraph is not collapsed by reverse transform", () => {
  const markdown = "alpha\n\n\u00A0\n\nbeta";
  assert.equal(fromWysiwygMarkdown(markdown), markdown);
});
