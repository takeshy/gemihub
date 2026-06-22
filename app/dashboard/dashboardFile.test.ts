import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDashboard,
  serializeDashboard,
  updateWidgetLayout,
  deriveSmLayout,
  createDefaultDashboard,
  createEmptyDashboard,
  dashboardPath,
  dashboardDisplayName,
} from "./dashboardFile.ts";
import type { DashboardData } from "./types.ts";

test("parseDashboard returns null for empty content", () => {
  assert.equal(parseDashboard(""), null);
  assert.equal(parseDashboard("   "), null);
});

test("parseDashboard returns null for invalid YAML", () => {
  assert.equal(parseDashboard("{ invalid yaml: :"), null);
});

test("parseDashboard returns null for non-object YAML", () => {
  assert.equal(parseDashboard("hello world"), null);
  assert.equal(parseDashboard("- item1\n- item2"), null);
});

test("parseDashboard parses valid dashboard YAML", () => {
  const yaml = `
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: w1
    type: markdown
    layout:
      lg:
        x: 0
        y: 0
        w: 6
        h: 3
    config:
      content: "Hello"
`;
  const data = parseDashboard(yaml);
  assert.ok(data);
  assert.equal(data.version, 1);
  assert.equal(data.widgets.length, 1);
  assert.equal(data.widgets[0].type, "markdown");
  assert.equal(data.widgets[0].layout.lg?.x, 0);
});

test("serializeDashboard round-trips unknown keys", () => {
  const yaml = `
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: w1
    type: custom-plugin-widget
    layout:
      lg:
        x: 0
        y: 0
        w: 4
        h: 2
    config:
      customKey: customValue
      nested:
        deep: true
unknownTopLevelKey: preserved
`;
  const data = parseDashboard(yaml);
  assert.ok(data);
  // The unknown top-level key should be preserved
  assert.equal((data as Record<string, unknown>).unknownTopLevelKey, "preserved");

  const serialized = serializeDashboard(data);
  const reparsed = parseDashboard(serialized);
  assert.ok(reparsed);
  assert.equal((reparsed as Record<string, unknown>).unknownTopLevelKey, "preserved");
  assert.equal(reparsed.widgets[0].type, "custom-plugin-widget");
  assert.equal(reparsed.widgets[0].config.customKey, "customValue");
});

test("serializeDashboard preserves unknown widget keys", () => {
  const data: DashboardData = {
    version: 1,
    grid: { cols: 12, rowHeight: 80, gap: 8 },
    widgets: [
      {
        id: "w1",
        type: "markdown",
        layout: { lg: { x: 0, y: 0, w: 6, h: 3 } },
        config: { content: "test" },
        customField: "should-be-preserved",
      } as Record<string, unknown>,
    ] as DashboardData["widgets"],
  };

  const serialized = serializeDashboard(data);
  const reparsed = parseDashboard(serialized);
  assert.ok(reparsed);
  assert.equal(
    (reparsed.widgets[0] as Record<string, unknown>).customField,
    "should-be-preserved",
  );
});

test("updateWidgetLayout updates only the target widget's position", () => {
  const data: DashboardData = {
    version: 1,
    grid: { cols: 12, rowHeight: 80, gap: 8 },
    widgets: [
      {
        id: "w1",
        type: "markdown",
        layout: { lg: { x: 0, y: 0, w: 6, h: 3 } },
        config: {},
      },
      {
        id: "w2",
        type: "markdown",
        layout: { lg: { x: 6, y: 0, w: 6, h: 3 } },
        config: {},
      },
    ],
  };

  const updated = updateWidgetLayout(data, "w1", "lg", { x: 2, y: 4, w: 6, h: 3 });
  assert.equal(updated.widgets[0].layout.lg?.x, 2);
  assert.equal(updated.widgets[0].layout.lg?.y, 4);
  // w2 unchanged
  assert.equal(updated.widgets[1].layout.lg?.x, 6);
  assert.equal(updated.widgets[1].layout.lg?.y, 0);
  // Original data unchanged (immutability)
  assert.equal(data.widgets[0].layout.lg?.x, 0);
});

test("updateWidgetLayout adds sm without removing lg", () => {
  const data: DashboardData = {
    version: 1,
    grid: { cols: 12, rowHeight: 80, gap: 8 },
    widgets: [
      {
        id: "w1",
        type: "markdown",
        layout: { lg: { x: 0, y: 0, w: 6, h: 3 } },
        config: {},
      },
    ],
  };

  const updated = updateWidgetLayout(data, "w1", "sm", { x: 0, y: 0, w: 12, h: 3 });
  assert.equal(updated.widgets[0].layout.lg?.x, 0);
  assert.equal(updated.widgets[0].layout.sm?.w, 12);
});

test("deriveSmLayout preserves existing sm and derives missing ones", () => {
  const data: DashboardData = {
    version: 1,
    grid: { cols: 12, rowHeight: 80, gap: 8 },
    widgets: [
      {
        id: "w1",
        type: "markdown",
        layout: {
          lg: { x: 0, y: 0, w: 6, h: 3 },
          sm: { x: 0, y: 0, w: 12, h: 5 }, // explicit sm
        },
        config: {},
      },
      {
        id: "w2",
        type: "markdown",
        layout: { lg: { x: 6, y: 0, w: 6, h: 4 } }, // no sm
        config: {},
      },
      {
        id: "w3",
        type: "markdown",
        layout: { lg: { x: 0, y: 4, w: 6, h: 2 } }, // no sm
        config: {},
      },
    ],
  };

  const result = deriveSmLayout(data);

  // w1 keeps its explicit sm
  assert.equal(result.widgets[0].layout.sm?.h, 5);
  assert.equal(result.widgets[0].layout.sm?.y, 0);

  // w2 derived: stacked after w1's sm (y=0 + h=5 = y=5)
  assert.equal(result.widgets[1].layout.sm?.y, 5);
  assert.equal(result.widgets[1].layout.sm?.w, 12);
  assert.equal(result.widgets[1].layout.sm?.h, 4);

  // w3 derived: stacked after w2 (y=5 + h=4 = y=9)
  assert.equal(result.widgets[2].layout.sm?.y, 9);
  assert.equal(result.widgets[2].layout.sm?.w, 12);
  assert.equal(result.widgets[2].layout.sm?.h, 2);
});

test("deriveSmLayout derives all when none have sm", () => {
  const data: DashboardData = {
    version: 1,
    grid: { cols: 12, rowHeight: 80, gap: 8 },
    widgets: [
      {
        id: "w1",
        type: "markdown",
        layout: { lg: { x: 0, y: 0, w: 6, h: 3 } },
        config: {},
      },
      {
        id: "w2",
        type: "markdown",
        layout: { lg: { x: 6, y: 0, w: 6, h: 4 } },
        config: {},
      },
    ],
  };

  const result = deriveSmLayout(data);
  assert.equal(result.widgets[0].layout.sm?.y, 0);
  assert.equal(result.widgets[0].layout.sm?.w, 12);
  assert.equal(result.widgets[0].layout.sm?.h, 3);
  assert.equal(result.widgets[1].layout.sm?.y, 3);
  assert.equal(result.widgets[1].layout.sm?.w, 12);
  assert.equal(result.widgets[1].layout.sm?.h, 4);
});

test("createDefaultDashboard creates 4 widgets with unique IDs", () => {
  const data = createDefaultDashboard();
  assert.equal(data.version, 1);
  assert.equal(data.widgets.length, 4);
  const types = data.widgets.map((w) => w.type);
  assert.ok(types.includes("markdown"));
  assert.ok(types.includes("file-list"));
  assert.ok(types.includes("table"));
  assert.ok(types.includes("web"));
  // Unique IDs
  const ids = data.widgets.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("createEmptyDashboard creates an empty dashboard with default grid", () => {
  const data = createEmptyDashboard();
  assert.equal(data.version, 1);
  assert.equal(data.widgets.length, 0);
  assert.equal(data.grid.cols, 12);
  assert.equal(data.grid.rowHeight, 80);
  assert.equal(data.grid.gap, 8);
});

test("dashboardPath builds correct path with folder prefix", () => {
  assert.equal(dashboardPath("my-board"), "dashboards/my-board.dashboard");
  assert.equal(dashboardPath("home"), "dashboards/home.dashboard");
});

test("dashboardDisplayName extracts name from path", () => {
  assert.equal(dashboardDisplayName("dashboards/my-board.dashboard"), "my-board");
  assert.equal(dashboardDisplayName("dashboards/home.dashboard"), "home");
  // Legacy root-level dashboard
  assert.equal(dashboardDisplayName("home.dashboard"), "home");
  // No extension
  assert.equal(dashboardDisplayName("dashboards/custom"), "custom");
});

test("serializeDashboard preserves unknown widget config keys (round-trip)", () => {
  const yaml = `
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: w1
    type: ai-query
    layout:
      lg:
        x: 0
        y: 0
        w: 4
        h: 2
    config:
      prompt: "What is the status?"
      refreshSchedule: "0 9 * * 1"
unknownTopLevel: metadata
`;
  const data = parseDashboard(yaml);
  assert.ok(data);
  assert.equal((data as Record<string, unknown>).unknownTopLevel, "metadata");
  assert.equal(data.widgets[0].type, "ai-query");
  assert.equal(data.widgets[0].config.prompt, "What is the status?");

  const serialized = serializeDashboard(data);
  const reparsed = parseDashboard(serialized);
  assert.ok(reparsed);
  assert.equal((reparsed as Record<string, unknown>).unknownTopLevel, "metadata");
  assert.equal(reparsed.widgets[0].type, "ai-query");
  assert.equal(reparsed.widgets[0].config.prompt, "What is the status?");
  assert.equal(reparsed.widgets[0].config.refreshSchedule, "0 9 * * 1");
});

test("parseDashboard does NOT migrate widget types (no compat shim)", () => {
  // The card/table/workflow split shipped without migration. parseDashboard
  // must leave every widget type — including the removed `data`/`file-table` —
  // exactly as written, preserving config and unknown keys for round-trip.
  const yaml = `
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: w1
    type: card
    layout:
      lg:
        x: 0
        y: 0
        w: 6
        h: 5
    config:
      folder: projects
      card:
        title: file.name
      cols: 3
      customKey: preserved
    widgetExtra: kept
  - id: w2
    type: workflow
    layout:
      lg:
        x: 6
        y: 0
        w: 6
        h: 5
    config:
      workflow: reports/weekly.yaml
      output: markdown
      refreshInterval: 60
`;
  const data = parseDashboard(yaml);
  assert.ok(data);
  assert.equal(data.widgets[0].type, "card");
  assert.equal(data.widgets[0].config.folder, "projects");
  assert.equal(data.widgets[0].config.card.title, "file.name");
  assert.equal(data.widgets[0].config.customKey, "preserved");
  assert.equal((data.widgets[0] as Record<string, unknown>).widgetExtra, "kept");
  assert.equal(data.widgets[1].type, "workflow");
  assert.equal(data.widgets[1].config.output, "markdown");
  assert.equal(data.widgets[1].config.refreshInterval, 60);
});

test("parseDashboard preserves unknown widget types", () => {
  const yaml = `
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: w1
    type: custom-plugin
    layout:
      lg:
        x: 0
        y: 0
        w: 4
        h: 3
    config:
      foo: bar
`;
  const data = parseDashboard(yaml);
  assert.ok(data);
  assert.equal(data.widgets[0].type, "custom-plugin");
  assert.equal(data.widgets[0].config.foo, "bar");
});
