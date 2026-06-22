// Widget registry — maps widget type strings to WidgetDef implementations.
// Core widgets are registered here. Plugins can also register widgets
// via the registerWidget function (extensibility point for P1+).

import React from "react";
import { FileText, List, Table, Globe, Puzzle, LayoutGrid, Workflow } from "lucide-react";
import type { WidgetDef } from "../types";
import MarkdownWidget from "./MarkdownWidget";
import FileListWidget from "./FileListWidget";
import WebWidget from "./WebWidget";
import UnknownWidget from "./UnknownWidget";
import { MarkdownConfigEditor } from "./config-editors/MarkdownConfigEditor";
import { FileListConfigEditor } from "./config-editors/FileListConfigEditor";
import { WebConfigEditor } from "./config-editors/WebConfigEditor";
import FolderWidget from "../data-widget/FolderWidget";
import WorkflowWidget from "../data-widget/WorkflowWidget";
import { CardConfigEditor } from "../data-widget/CardConfigEditor";
import { TableConfigEditor } from "../data-widget/TableConfigEditor";
import { WorkflowConfigEditor } from "../data-widget/WorkflowConfigEditor";

const registry = new Map<string, WidgetDef>();

/**
 * Register a widget type. Plugins use this to add custom widgets.
 */
export function registerWidget(def: WidgetDef): void {
  registry.set(def.type, def);
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
  defaultConfig: { content: "" },
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
