// Dashboard data model types
// The .dashboard YAML schema (version 1)

import type { ReactNode, FC } from "react";

export type Breakpoint = "lg" | "sm";

export interface LayoutPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridLayout {
  cols: number;
  rowHeight: number;
  gap: number;
}

export interface Widget {
  id: string;
  type: string;
  layout: Partial<Record<Breakpoint, LayoutPos>>;
  config: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DashboardData {
  version: number;
  grid: GridLayout;
  widgets: Widget[];
  [key: string]: unknown;
}

export const DEFAULT_GRID: GridLayout = {
  cols: 12,
  rowHeight: 80,
  gap: 8,
};

export const BREAKPOINT_THRESHOLD = 768;

/** Legacy single-dashboard filename (root level, backward compat). */
export const DASHBOARD_FILE_NAME = "home.dashboard";
/** Folder prefix for multi-dashboard storage. */
export const DASHBOARD_FOLDER = "dashboards";
export const DASHBOARD_MIME_TYPE = "text/yaml";
export const DASHBOARD_EXT = ".dashboard";

export interface WidgetContext {
  host: "dashboard" | "canvas";
  size: { w: number; h: number };
  /** True when the dashboard is in edit mode (enables cell editing in file-table). */
  editMode?: boolean;
  /** The widget's own ID (for sidecar caches, events, etc.). */
  widgetId?: string;
  /** The .dashboard file's ID (for sidecar caches scoped per dashboard). */
  dashboardFileId?: string;
  /**
   * Persist a change to this widget's config from the widget itself — works in
   * view mode too (not just the settings panel). Used e.g. by the markdown
   * widget to switch the referenced file via its header picker.
   */
  onConfigChange?: (config: unknown) => void;
}

export interface ConfigEditorProps {
  config: unknown;
  onChange: (next: unknown) => void;
  /** The widget's own ID (for sidecar caches, test-run, etc.). */
  widgetId?: string;
  /** The .dashboard file's ID (for sidecar caches scoped per dashboard). */
  dashboardFileId?: string;
}

export interface WidgetDef {
  type: string;
  /** Display name shown in the widget palette. */
  label: string;
  /** Optional icon for the palette. */
  icon?: ReactNode;
  /** Initial config inserted when a widget of this type is added. */
  defaultConfig: unknown;
  render: (config: unknown, ctx: WidgetContext) => ReactNode;
  defaultSize?: { w: number; h: number };
  /** Per-type settings form shown when editing a widget. Omit for "no settings". */
  ConfigEditor?: FC<ConfigEditorProps>;
}
