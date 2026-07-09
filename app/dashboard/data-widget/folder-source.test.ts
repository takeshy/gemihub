import assert from "node:assert/strict";
import test from "node:test";

import { contentWithoutFrontmatter } from "./folder-source";

test("contentWithoutFrontmatter returns markdown body without properties", () => {
  const content = "---\ntitle: Test\nstatus: done\n---\n# Heading\nBody text";

  assert.equal(contentWithoutFrontmatter(content), "# Heading\nBody text");
});

test("contentWithoutFrontmatter keeps content without frontmatter as-is", () => {
  const content = "# Heading\nBody text";

  assert.equal(contentWithoutFrontmatter(content), content);
});
