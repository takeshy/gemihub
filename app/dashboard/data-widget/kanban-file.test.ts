import assert from "node:assert/strict";
import test from "node:test";
import {
  parseKanbanFile,
  serializeKanbanFile,
  boardDefinitionFromConfig,
  sanitizeKanbanFileName,
  kanbanFileBaseName,
  collectKanbanFileOptions,
  KANBAN_FILE_VERSION,
} from "./kanban-file.ts";
import type { KanbanWidgetConfig } from "./types.ts";

const fullDefinition = {
  title: "Sprint Board",
  folder: "projects/tasks",
  statusProperty: "state",
  titleProperty: "name",
  columns: [{ value: "todo", label: "To Do" }, "in-progress"],
  showUnspecified: false,
  displayFields: ["priority", "due"],
  filter: [{ field: "priority", op: "eq", value: "high" }],
  limit: 50,
};

test("parseKanbanFile parses a full document", () => {
  const def = parseKanbanFile(serializeKanbanFile(fullDefinition));
  assert.deepEqual(def, { version: KANBAN_FILE_VERSION, ...fullDefinition });
});

test("parseKanbanFile accepts partial documents (defaults applied downstream)", () => {
  assert.deepEqual(parseKanbanFile("folder: projects/tasks\n"), { folder: "projects/tasks" });
  assert.deepEqual(parseKanbanFile("{}"), {});
});

test("parseKanbanFile preserves unknown keys", () => {
  const def = parseKanbanFile("folder: a\nfutureKey: 42\n");
  assert.equal(def?.futureKey, 42);
});

test("parseKanbanFile returns null for broken or non-object documents", () => {
  assert.equal(parseKanbanFile("foo: [unclosed"), null);
  assert.equal(parseKanbanFile("- a\n- b\n"), null);
  assert.equal(parseKanbanFile("just a string"), null);
  assert.equal(parseKanbanFile(""), null);
});

test("serializeKanbanFile round-trips and stamps the current version", () => {
  const stale = { version: 99, ...fullDefinition };
  const def = parseKanbanFile(serializeKanbanFile(stale));
  assert.deepEqual(def, { version: KANBAN_FILE_VERSION, ...fullDefinition });
});

test("boardDefinitionFromConfig drops widget-only keys", () => {
  const config: KanbanWidgetConfig = {
    ...fullDefinition,
    kanban: "Dashboards/Kanbans/x.kanban",
    cardOrder: ["a", "b"],
  };
  assert.deepEqual(boardDefinitionFromConfig(config), fullDefinition);
});

test("sanitizeKanbanFileName strips forbidden characters and trims", () => {
  assert.equal(sanitizeKanbanFileName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n'), "abcdefghijklmn");
  assert.equal(sanitizeKanbanFileName("  spaced   out  "), "spaced out");
  assert.equal(sanitizeKanbanFileName("...dots"), "dots");
});

test("kanbanFileBaseName uses the title, falling back to the widget id", () => {
  assert.equal(kanbanFileBaseName({ title: "My Board" }, "widget-1234567890"), "My Board");
  assert.equal(kanbanFileBaseName({}, "widget-1234567890"), "kanban-widget-1");
  assert.equal(kanbanFileBaseName({ title: "???" }, "abcdefghij"), "kanban-abcdefgh");
});

test("collectKanbanFileOptions filters to .kanban files sorted by name", () => {
  const files = {
    id1: { name: "Dashboards/Kanbans/b.kanban" },
    id2: { name: "notes/readme.md" },
    id3: { name: "Dashboards/Kanbans/a.kanban" },
  } as never;
  assert.deepEqual(collectKanbanFileOptions(files), [
    { id: "id3", name: "Dashboards/Kanbans/a.kanban" },
    { id: "id1", name: "Dashboards/Kanbans/b.kanban" },
  ]);
});
