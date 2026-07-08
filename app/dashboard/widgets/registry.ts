// Widget registry — maps widget type strings to WidgetDef implementations.
// Core widgets are registered here. Plugins can also register widgets
// via the registerWidget function (extensibility point for P1+).

import React from "react";
import { FileText, Globe, Puzzle, LayoutGrid, Workflow, Database, MessageCircle, NotebookPen } from "lucide-react";
import type { WidgetDef } from "../types";
import FileWidget from "./file-widget/FileWidget";
import MemoListWidget from "./MemoListWidget";
import WebWidget from "./WebWidget";
import UnknownWidget from "./UnknownWidget";
import BaseWidget from "./BaseWidget";
import TimelineWidget from "./TimelineWidget";
import { FileConfigEditor } from "./config-editors/FileConfigEditor";
import { WebConfigEditor } from "./config-editors/WebConfigEditor";
import { BaseConfigEditor } from "./config-editors/BaseConfigEditor";
import { TimelineConfigEditor } from "./config-editors/TimelineConfigEditor";
import WorkflowWidget from "../data-widget/WorkflowWidget";
import KanbanWidget from "../data-widget/KanbanWidget";
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

const fileWidgetDef: WidgetDef = {
  type: "file",
  label: "File",
  icon: React.createElement(FileText, { size: 16 }),
  defaultConfig: { path: "", showHeader: true, showProperties: true },
  render: (config, ctx) => React.createElement(FileWidget, { config, ctx }),
  defaultSize: { w: 6, h: 4 },
  ConfigEditor: FileConfigEditor,
  filePathOf: (config) => ((config as { path?: string })?.path ?? "").trim() || undefined,
};

registerWidget(fileWidgetDef);

// Released dashboards persist `type: markdown`; alias it to the File widget so
// they keep working without any YAML migration (config is forward-compatible).
registerWidget({ ...fileWidgetDef, type: "markdown", hiddenFromPalette: true });

registerWidget({
  type: "memo-list",
  label: "Memo List",
  icon: React.createElement(NotebookPen, { size: 16 }),
  defaultConfig: {},
  render: () => React.createElement(MemoListWidget),
  defaultSize: { w: 4, h: 5 },
});

registerWidget({
  type: "kanban",
  label: "Kanban",
  icon: React.createElement(LayoutGrid, { size: 16 }),
  // Boards are always defined by a .kanban file; the config editor creates or
  // picks one (legacy inline configs are converted there too).
  defaultConfig: {},
  render: (config, ctx) => React.createElement(KanbanWidget, { config, ctx }),
  defaultSize: { w: 8, h: 5 },
  ConfigEditor: KanbanConfigEditor,
  filePathOf: (config) => ((config as { kanban?: string })?.kanban ?? "").trim() || undefined,
});

registerWidget({
  type: "timeline",
  label: "Timeline",
  icon: React.createElement(MessageCircle, { size: 16 }),
  defaultConfig: {
    name: "",
    latestCount: 20,
    composerMode: "raw",
  },
  render: (config, ctx) => React.createElement(TimelineWidget, { config, ctx }),
  defaultSize: { w: 6, h: 6 },
  ConfigEditor: TimelineConfigEditor,
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
    showHeader: true,
  },
  render: (config, ctx) => React.createElement(WorkflowWidget, { config, ctx }),
  defaultSize: { w: 6, h: 5 },
  ConfigEditor: WorkflowConfigEditor,
  filePathOf: (config) => ((config as { workflow?: string })?.workflow ?? "").trim() || undefined,
});

registerWidget({
  type: "web",
  label: "Web Embed",
  icon: React.createElement(Globe, { size: 16 }),
  defaultConfig: { url: "", showHeader: true },
  render: (config, ctx) => React.createElement(WebWidget, { config, ctx }),
  defaultSize: { w: 6, h: 4 },
  ConfigEditor: WebConfigEditor,
  externalUrlOf: (config) => {
    const url = ((config as { url?: string })?.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return undefined;
    return url;
  },
});

registerWidget({
  type: "base",
  label: "Base",
  icon: React.createElement(Database, { size: 16 }),
  defaultConfig: { base: "", view: "" },
  render: (config, ctx) => React.createElement(BaseWidget, { config, ctx }),
  defaultSize: { w: 6, h: 5 },
  ConfigEditor: BaseConfigEditor,
  filePathOf: (config) => ((config as { base?: string })?.base ?? "").trim() || undefined,
});
