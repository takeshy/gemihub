import assert from "node:assert/strict";
import test from "node:test";
import { isCompletionColumn, parseKanbanTaskBody, serializeKanbanTaskBody } from "./kanban-task";

test("rich Kanban task bodies round-trip", () => {
  const source = serializeKanbanTaskBody({
    description: "**Important** details",
    checklist: [{ text: "Test", completed: true }],
    attachments: [{ path: "Tasks/Attachments/spec.pdf", label: "Spec" }],
  });
  assert.deepEqual(parseKanbanTaskBody(source), {
    description: "**Important** details",
    checklist: [{ text: "Test", completed: true }],
    attachments: [{ path: "Tasks/Attachments/spec.pdf", label: "Spec" }],
  });
});

test("completion columns support English and Japanese labels", () => {
  assert.equal(isCompletionColumn("done", "Done"), true);
  assert.equal(isCompletionColumn("closed", "完了"), true);
  assert.equal(isCompletionColumn("doing", "Doing"), false);
});
