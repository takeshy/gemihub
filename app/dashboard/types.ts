// Dashboard data model types
// The .dashboard YAML schema (version 1)

import type { ReactNode, FC } from "react";
import type { EncryptionSettings } from "~/types/settings";

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

/** Folder prefix for multi-dashboard storage. */
export const DASHBOARD_FOLDER = "Dashboards";
export const DASHBOARD_MIME_TYPE = "text/yaml";
export const DASHBOARD_EXT = ".dashboard";

export interface WidgetContext {
  host: "dashboard" | "canvas";
  size: { w: number; h: number };
  /** The widget's own ID (for sidecar caches, events, etc.). */
  widgetId?: string;
  /** The .dashboard file's ID (fallback for sidecar caches scoped per dashboard). */
  dashboardFileId?: string;
  /** The .dashboard file path (stable sidecar cache scope, survives fileId changes). */
  dashboardFileName?: string;
  /** Current encryption settings supplied by the dashboard host. */
  encryptionSettings?: EncryptionSettings;
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
  /**
   * Optional per-editor action invoked when the settings panel's Done button is
   * pressed. Returning a config object applies it as the widget config before
   * the panel closes.
   */
  setDoneAction?: (action: (() => unknown | Promise<unknown>) | null) => void;
  /** Current widget type; used by config editors that can switch compatible types. */
  widgetType?: string;
  /** Switch this widget to another registered type without introducing a new schema type. */
  onTypeChange?: (nextType: string, nextConfig: Record<string, unknown>) => void;
  /** The widget's own ID (for sidecar caches, test-run, etc.). */
  widgetId?: string;
  /** The .dashboard file's ID (fallback for sidecar caches scoped per dashboard). */
  dashboardFileId?: string;
  /** The .dashboard file path (stable sidecar cache scope, survives fileId changes). */
  dashboardFileName?: string;
}

export interface WidgetDef {
  type: string;
  /** Display name shown in the widget palette. */
  label: string;
  /** Hide from the add-widget palette (e.g. legacy type aliases). */
  hiddenFromPalette?: boolean;
  /** Optional icon for the palette. */
  icon?: ReactNode;
  /** Initial config inserted when a widget of this type is added. */
  defaultConfig: unknown;
  render: (config: unknown, ctx: WidgetContext) => ReactNode;
  defaultSize?: { w: number; h: number };
  /** Per-type settings form shown when editing a widget. Omit for "no settings". */
  ConfigEditor?: FC<ConfigEditorProps>;
  /**
   * Drive file path the widget is backed by, if any. When this resolves to a
   * known file, the dashboard cell chrome shows an Open button that navigates
   * to that file's page in the main viewer.
   */
  filePathOf?: (config: unknown) => string | undefined;
  /**
   * External URL the widget is backed by, if any. When present, the dashboard
   * cell chrome shows an Open button that opens it in a new browser tab.
   */
  externalUrlOf?: (config: unknown) => string | undefined;
}
