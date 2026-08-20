import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { MANUAL_CAPTURES } from "./manual-capture-manifest";

test("manual image references stay represented by the Storybook capture manifest", () => {
  const chapterDir = path.resolve("app/components/manual/chapters");
  const referenced = new Set<string>();

  for (const entry of readdirSync(chapterDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
    const source = readFileSync(path.join(chapterDir, entry.name), "utf8");
    for (const match of source.matchAll(/src="\/images\/([^"]+)"/g)) {
      referenced.add(match[1]);
    }
  }

  const manifested = new Set(MANUAL_CAPTURES.map((capture) => capture.fileName));
  assert.deepEqual([...manifested].sort(), [...referenced].sort());
  for (const fileName of referenced) {
    assert.equal(existsSync(path.resolve("public/images", fileName)), true, `${fileName} must exist in public/images`);
  }
});

test("README and landing-page image references exist", () => {
  const referenced = new Set<string>();
  for (const fileName of ["README.md", "README_ja.md", "app/routes/lp.tsx"]) {
    const source = readFileSync(path.resolve(fileName), "utf8");
    for (const match of source.matchAll(/(?:\.\/public)?\/images\/([\w.-]+)/g)) {
      referenced.add(match[1]);
    }
  }

  for (const fileName of referenced) {
    assert.equal(existsSync(path.resolve("public/images", fileName)), true, `${fileName} must exist in public/images`);
  }
});
