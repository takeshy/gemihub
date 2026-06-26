import assert from "node:assert/strict";
import test from "node:test";

import { collectBaseFileOptions, findBaseFileOption } from "./base-file-options";
import type { CachedRemoteMeta } from "~/services/indexeddb-cache";

function file(name: string): CachedRemoteMeta["files"][string] {
  return {
    name,
    mimeType: "text/plain",
    md5Checksum: "",
    modifiedTime: "2026-01-01T00:00:00.000Z",
  };
}

test("collectBaseFileOptions includes .base files under dashboards", () => {
  const files: CachedRemoteMeta["files"] = {
    a: file("dashboards/project.base"),
    b: file("notes/readme.md"),
    c: file("other/Tasks.BASE"),
  };

  assert.deepEqual(collectBaseFileOptions(files), [
    { id: "a", name: "dashboards/project.base" },
    { id: "c", name: "other/Tasks.BASE" },
  ]);
});

test("findBaseFileOption resolves selected .base by full path", () => {
  const files: CachedRemoteMeta["files"] = {
    a: file("dashboards/project.base"),
  };

  assert.deepEqual(findBaseFileOption(files, "dashboards/project.base"), {
    id: "a",
    name: "dashboards/project.base",
  });
  assert.equal(findBaseFileOption(files, "project.base"), null);
});
