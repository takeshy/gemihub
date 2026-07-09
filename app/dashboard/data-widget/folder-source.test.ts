import assert from "node:assert/strict";
import test from "node:test";

import { contentWithoutFrontmatter, extractFrontmatterTags } from "./folder-source";

test("contentWithoutFrontmatter returns markdown body without properties", () => {
  const content = "---\ntitle: Test\nstatus: done\n---\n# Heading\nBody text";

  assert.equal(contentWithoutFrontmatter(content), "# Heading\nBody text");
});

test("contentWithoutFrontmatter keeps content without frontmatter as-is", () => {
  const content = "# Heading\nBody text";

  assert.equal(contentWithoutFrontmatter(content), content);
});

test("extractFrontmatterTags canonicalizes list tags", () => {
  assert.deepEqual(extractFrontmatterTags({ tags: ["#work", "area//project/", "work"] }), [
    "work",
    "area/project",
  ]);
});

test("extractFrontmatterTags splits string tags", () => {
  assert.deepEqual(extractFrontmatterTags({ tags: "urgent, #next work" }), [
    "urgent",
    "next",
    "work",
  ]);
});
