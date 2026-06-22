import assert from "node:assert/strict";
import test from "node:test";
import { splitFrontmatter, updateFrontmatterKey } from "./frontmatter-writeback.ts";

test("splitFrontmatter returns null for unparseable YAML", () => {
  assert.equal(splitFrontmatter("---\n{ invalid: :yaml\n---\nbody"), null);
});

test("splitFrontmatter returns empty fm for no frontmatter block", () => {
  const r = splitFrontmatter("Just some markdown\n# Heading");
  assert.ok(r);
  assert.equal(r.hasFrontmatter, false);
  assert.equal(r.body, "Just some markdown\n# Heading");
});

test("splitFrontmatter parses valid frontmatter", () => {
  const r = splitFrontmatter("---\ntitle: Hello\ntags:\n  - a\n  - b\n---\n# Body\n");
  assert.ok(r);
  assert.equal(r.hasFrontmatter, true);
  assert.equal(r.frontmatter.title, "Hello");
  assert.deepEqual(r.frontmatter.tags, ["a", "b"]);
  assert.equal(r.body, "# Body\n");
});

test("updateFrontmatterKey preserves body verbatim", () => {
  const content = "---\ntitle: Hello\nstatus: draft\n---\n# My Body\n\nSome text here.\n";
  const result = updateFrontmatterKey(content, "status", "published");
  assert.ok(result);
  assert.ok(result.content.includes("# My Body\n\nSome text here.\n"));
  assert.equal(result.frontmatter.status, "published");
});

test("updateFrontmatterKey preserves other keys including unknown", () => {
  const content = "---\ntitle: Hello\nstatus: draft\ncustomUnknown: keep-me\n---\nbody\n";
  const result = updateFrontmatterKey(content, "status", "published");
  assert.ok(result);
  assert.equal(result.frontmatter.title, "Hello");
  assert.equal(result.frontmatter.status, "published");
  assert.equal(result.frontmatter.customUnknown, "keep-me");
});

test("updateFrontmatterKey preserves key insertion order on update", () => {
  const content = "---\nalpha: 1\nbeta: 2\ngamma: 3\n---\nbody\n";
  const result = updateFrontmatterKey(content, "beta", 99);
  assert.ok(result);
  const keys = Object.keys(result.frontmatter);
  assert.deepEqual(keys, ["alpha", "beta", "gamma"]);
  assert.equal(result.frontmatter.beta, 99);
});

test("updateFrontmatterKey appends new key at end", () => {
  const content = "---\nalpha: 1\nbeta: 2\n---\nbody\n";
  const result = updateFrontmatterKey(content, "gamma", 3);
  assert.ok(result);
  const keys = Object.keys(result.frontmatter);
  assert.deepEqual(keys, ["alpha", "beta", "gamma"]);
});

test("updateFrontmatterKey with null value removes key", () => {
  const content = "---\nalpha: 1\nbeta: 2\ngamma: 3\n---\nbody\n";
  const result = updateFrontmatterKey(content, "beta", null);
  assert.ok(result);
  const keys = Object.keys(result.frontmatter);
  assert.deepEqual(keys, ["alpha", "gamma"]);
});

test("updateFrontmatterKey removing the last key drops the frontmatter block (no {})", () => {
  const content = "---\nonly: 1\n---\n# Body\n";
  const result = updateFrontmatterKey(content, "only", null);
  assert.ok(result);
  assert.deepEqual(Object.keys(result.frontmatter), []);
  assert.ok(!result.content.includes("{}"));
  assert.equal(result.content, "# Body\n");
  // Re-parses as a no-frontmatter file with the body intact
  const reparsed = splitFrontmatter(result.content);
  assert.ok(reparsed);
  assert.equal(reparsed.hasFrontmatter, false);
  assert.equal(reparsed.body, "# Body\n");
});

test("updateFrontmatterKey returns null for unparseable frontmatter", () => {
  const content = "---\n{ bad: :yaml\n---\nbody\n";
  const result = updateFrontmatterKey(content, "key", "value");
  assert.equal(result, null);
});

test("updateFrontmatterKey round-trip: only target key changes", () => {
  const content = "---\ntitle: My Doc\nstatus: draft\npriority: 5\ntags:\n  - urgent\n---\n# Heading\n\nBody text.\n";
  const result = updateFrontmatterKey(content, "status", "done");
  assert.ok(result);

  // Re-parse and verify only "status" changed
  const reparsed = splitFrontmatter(result.content);
  assert.ok(reparsed);
  assert.equal(reparsed.frontmatter.title, "My Doc");
  assert.equal(reparsed.frontmatter.status, "done");
  assert.equal(reparsed.frontmatter.priority, 5);
  assert.deepEqual(reparsed.frontmatter.tags, ["urgent"]);
  // Body preserved
  assert.equal(reparsed.body, "# Heading\n\nBody text.\n");
});

test("updateFrontmatterKey handles boolean values", () => {
  const content = "---\ndone: false\ncount: 3\n---\nbody\n";
  const result = updateFrontmatterKey(content, "done", true);
  assert.ok(result);
  assert.equal(result.frontmatter.done, true);
  assert.equal(result.frontmatter.count, 3);
});

test("updateFrontmatterKey handles number values", () => {
  const content = "---\ncount: 3\n---\nbody\n";
  const result = updateFrontmatterKey(content, "count", 42);
  assert.ok(result);
  assert.equal(result.frontmatter.count, 42);
});

test("updateFrontmatterKey handles no existing frontmatter (adds new block)", () => {
  const content = "# Just a heading\n\nNo frontmatter here.\n";
  const result = updateFrontmatterKey(content, "status", "draft");
  assert.ok(result);
  assert.equal(result.frontmatter.status, "draft");
  assert.ok(result.content.startsWith("---\n"));
  assert.ok(result.content.includes("# Just a heading"));
});

test("updateFrontmatterKey preserves list/object values of other keys", () => {
  const content = "---\ntitle: Doc\ntags:\n  - a\n  - b\nconfig:\n  key: val\n---\nbody\n";
  const result = updateFrontmatterKey(content, "title", "Updated");
  assert.ok(result);
  assert.deepEqual(result.frontmatter.tags, ["a", "b"]);
  assert.deepEqual(result.frontmatter.config, { key: "val" });
  assert.equal(result.frontmatter.title, "Updated");
});
