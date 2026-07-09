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

test("collectBaseFileOptions includes .base files under Dashboards", () => {
  const files: CachedRemoteMeta["files"] = {
    a: file("Dashboards/project.base"),
    b: file("notes/readme.md"),
    c: file("other/Tasks.BASE"),
  };

  assert.deepEqual(collectBaseFileOptions(files), [
    { id: "a", name: "Dashboards/project.base" },
    { id: "c", name: "other/Tasks.BASE" },
  ]);
});

test("findBaseFileOption resolves selected .base by full path", () => {
  const files: CachedRemoteMeta["files"] = {
    a: file("Dashboards/project.base"),
  };

  assert.deepEqual(findBaseFileOption(files, "Dashboards/project.base"), {
    id: "a",
    name: "Dashboards/project.base",
  });
  assert.equal(findBaseFileOption(files, "project.base"), null);
});

test("findBaseFileOption resolves an unambiguous case-only mismatch", () => {
  const files: CachedRemoteMeta["files"] = {
    a: file("Dashboards/tasks.base"),
  };

  assert.deepEqual(findBaseFileOption(files, "Dashboards/Tasks.base"), {
    id: "a",
    name: "Dashboards/tasks.base",
  });
});

test("findBaseFileOption rejects ambiguous case-insensitive matches", () => {
  const files: CachedRemoteMeta["files"] = {
    a: file("Dashboards/tasks.base"),
    b: file("Dashboards/Tasks.base"),
  };

  assert.equal(findBaseFileOption(files, "Dashboards/TASKS.base"), null);
});
