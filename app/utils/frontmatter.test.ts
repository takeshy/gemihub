import assert from "node:assert/strict";
import test from "node:test";
import { parseFrontmatter, isMarkdownFile } from "./frontmatter.ts";

test("parseFrontmatter returns {} for empty content", () => {
  assert.deepEqual(parseFrontmatter(""), {});
});

test("parseFrontmatter returns {} for content without frontmatter", () => {
  assert.deepEqual(parseFrontmatter("Just some markdown\n# Heading"), {});
  assert.deepEqual(parseFrontmatter("Some text\n---\nmore text"), {});
});

test("parseFrontmatter parses valid YAML frontmatter", () => {
  const content = `---
title: My Note
status: done
priority: 3
tags:
  - work
  - urgent
---
Body text here`;
  const fm = parseFrontmatter(content);
  assert.equal(fm.title, "My Note");
  assert.equal(fm.status, "done");
  assert.equal(fm.priority, 3);
  assert.deepEqual(fm.tags, ["work", "urgent"]);
});

test("parseFrontmatter returns {} for invalid YAML", () => {
  const content = `---
title: [unclosed
---
Body`;
  assert.deepEqual(parseFrontmatter(content), {});
});

test("parseFrontmatter handles CRLF line endings", () => {
  const content = "---\r\ntitle: Test\r\n---\r\nBody";
  const fm = parseFrontmatter(content);
  assert.equal(fm.title, "Test");
});

test("parseFrontmatter returns {} for non-object YAML", () => {
  const content = `---
- item1
- item2
---
Body`;
  assert.deepEqual(parseFrontmatter(content), {});
});

test("parseFrontmatter returns {} for scalar YAML", () => {
  const content = `---
just a string
---
Body`;
  assert.deepEqual(parseFrontmatter(content), {});
});

test("isMarkdownFile detects .md and .markdown extensions", () => {
  assert.equal(isMarkdownFile("note.md"), true);
  assert.equal(isMarkdownFile("note.MD"), true);
  assert.equal(isMarkdownFile("note.markdown"), true);
  assert.equal(isMarkdownFile("note.MARKDOWN"), true);
  assert.equal(isMarkdownFile("note.txt"), false);
  assert.equal(isMarkdownFile("note.json"), false);
  assert.equal(isMarkdownFile(undefined), false);
  assert.equal(isMarkdownFile(""), false);
});
