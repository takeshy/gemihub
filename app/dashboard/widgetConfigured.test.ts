import assert from "node:assert/strict";
import test from "node:test";
import type { Widget } from "./types";
import { isWidgetConfigured } from "./widgetConfigured";

function widget(type: string, config: Record<string, unknown>): Widget {
  return { id: "widget-1", type, config, layout: {} };
}

test("a file-backed kanban is configured once its board file is selected", () => {
  assert.equal(
    isWidgetConfigured(widget("kanban", { kanban: "Dashboards/Kanbans/work.kanban" })),
    true,
  );
});

test("a blank new kanban is not configured", () => {
  assert.equal(isWidgetConfigured(widget("kanban", {})), false);
  assert.equal(isWidgetConfigured(widget("kanban", { kanban: "  " })), false);
});

test("legacy inline kanbans remain configured", () => {
  assert.equal(isWidgetConfigured(widget("kanban", { folder: "Work", title: "Tasks" })), true);
  assert.equal(isWidgetConfigured(widget("kanban", { folder: "Work", title: "" })), false);
});
