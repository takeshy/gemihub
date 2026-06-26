// Widget registry — maps widget type strings to WidgetDef implementations.
// Core widgets are registered here. Plugins can also register widgets
// via the registerWidget function (extensibility point for P1+).

import React from "react";
import { FileText, List, Table, Globe, Puzzle, LayoutGrid, Workflow, Database } from "lucide-react";
import type { WidgetDef } from "../types";
import MarkdownWidget from "./MarkdownWidget";
import FileListWidget from "./FileListWidget";
import WebWidget from "./WebWidget";
import UnknownWidget from "./UnknownWidget";
import BaseWidget from "./BaseWidget";
import { MarkdownConfigEditor } from "./config-editors/MarkdownConfigEditor";
import { FileListConfigEditor } from "./config-editors/FileListConfigEditor";
import { WebConfigEditor } from "./config-editors/WebConfigEditor";
import { BaseConfigEditor } from "./config-editors/BaseConfigEditor";
import FolderWidget from "../data-widget/FolderWidget";
import WorkflowWidget from "../data-widget/WorkflowWidget";
import KanbanWidget from "../data-widget/KanbanWidget";
import { CardConfigEditor } from "../data-widget/CardConfigEditor";
import { TableConfigEditor } from "../data-widget/TableConfigEditor";
import { WorkflowConfigEditor } from "../data-widget/WorkflowConfigEditor";
import { KanbanConfigEditor } from "../data-widget/KanbanConfigEditor";

const registry = new Map<string, WidgetDef>();

/**
 * Register a widget type. Plugins use this to add custom widgets.
 *
 * Plugins load asynchronously, often after a dashboard has already rendered.
 * Emit a change signal so mounted DashboardCanvas instances re-render and swap
 * a previously-unknown widget type (rendered as UnknownWidget) for the real one.
 */
export function registerWidget(def: WidgetDef): void {
  registry.set(def.type, def);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dashboard-widgets-changed"));
  }
}

/**
 * Get a widget definition by type.
 * Falls back to UnknownWidget for unregistered types.
 * The fallback includes label/defaultConfig so it can be deleted
 * and its config is preserved on round-trip.
 */
export function getWidgetDef(type: string): WidgetDef {
  return registry.get(type) ?? {
    type: "__unknown__",
    label: `Unknown (${type})`,
    icon: React.createElement(Puzzle, { size: 16 }),
    defaultConfig: {},
    render: (config, ctx) => React.createElement(UnknownWidget, { type, config, ctx }),
  };
}

/**
 * Check if a widget type is registered.
 */
export function isKnownWidgetType(type: string): boolean {
  return registry.has(type);
}

/**
 * List all registered widget definitions (for the palette).
 */
export function listWidgetDefs(): WidgetDef[] {
  return Array.from(registry.values());
}

// --- Core widget registrations ---

registerWidget({
  type: "markdown",
  label: "Markdown",
  icon: React.createElement(FileText, { size: 16 }),
  defaultConfig: {},
  render: (config, ctx) => React.createElement(MarkdownWidget, { config, ctx }),
  defaultSize: { w: 6, h: 3 },
  ConfigEditor: MarkdownConfigEditor,
});

registerWidget({
  type: "card",
  label: "Card",
  icon: React.createElement(LayoutGrid, { size: 16 }),
  defaultConfig: {
    folder: "",
    sort: "-mtime",
    limit: 50,
    card: { title: "file.name" },
    cols: 3,
  },
  render: (config, ctx) =>
    React.createElement(FolderWidget, { config, ctx, view: "cards" }),
  defaultSize: { w: 6, h: 5 },
  ConfigEditor: CardConfigEditor,
});

registerWidget({
  type: "table",
  label: "Table",
  icon: React.createElement(Table, { size: 16 }),
  defaultConfig: {
    folder: "",
    sort: "-mtime",
    limit: 50,
    columns: ["file.name", "status"],
  },
  render: (config, ctx) =>
    React.createElement(FolderWidget, { config, ctx, view: "table" }),
  defaultSize: { w: 6, h: 5 },
  ConfigEditor: TableConfigEditor,
});

registerWidget({
  type: "kanban",
  label: "Kanban",
  icon: React.createElement(LayoutGrid, { size: 16 }),
  defaultConfig: {
    folder: "",
    title: "",
    statusProperty: "status",
    titleProperty: "title",
    columns: [
      { value: "todo", label: "To Do" },
      { value: "in-progress", label: "In Progress" },
      { value: "done", label: "Done" },
    ],
    showUnspecified: true,
    displayFields: [],
    limit: 100,
  },
  render: (config, ctx) => React.createElement(KanbanWidget, { config, ctx }),
  defaultSize: { w: 8, h: 5 },
  ConfigEditor: KanbanConfigEditor,
});

registerWidget({
  type: "workflow",
  label: "Workflow",
  icon: React.createElement(Workflow, { size: 16 }),
  defaultConfig: {
    workflow: "",
    outputVariable: "result",
    output: "table",
    limit: 50,
  },
  render: (config, ctx) => React.createElement(WorkflowWidget, { config, ctx }),
  defaultSize: { w: 6, h: 5 },
  ConfigEditor: WorkflowConfigEditor,
});

registerWidget({
  type: "file-list",
  label: "File List",
  icon: React.createElement(List, { size: 16 }),
  defaultConfig: { folder: "", sort: "-mtime", limit: 20 },
  render: (config, ctx) => React.createElement(FileListWidget, { config, ctx }),
  defaultSize: { w: 6, h: 4 },
  ConfigEditor: FileListConfigEditor,
});

registerWidget({
  type: "web",
  label: "Web Embed",
  icon: React.createElement(Globe, { size: 16 }),
  defaultConfig: { url: "" },
  render: (config, ctx) => React.createElement(WebWidget, { config, ctx }),
  defaultSize: { w: 6, h: 4 },
  ConfigEditor: WebConfigEditor,
});

registerWidget({
  type: "base",
  label: "Base",
  icon: React.createElement(Database, { size: 16 }),
  defaultConfig: { base: "", view: "" },
  render: (config, ctx) => React.createElement(BaseWidget, { config, ctx }),
  defaultSize: { w: 6, h: 5 },
  ConfigEditor: BaseConfigEditor,
});
