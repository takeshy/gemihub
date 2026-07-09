// .kanban board definition files — YAML documents holding a kanban board
// definition (everything in KanbanWidgetConfig except widget-only keys).
// The kanban widget references one by path via `config.kanban`; inline
// configs remain supported when no file is referenced.

import yaml from "js-yaml";
import type { CachedRemoteMeta } from "~/services/indexeddb-cache";
import type { FilterCondition, KanbanColumnConfig, KanbanDisplayFieldConfig, KanbanWidgetConfig } from "./types";

/**
 * Board definition stored in a .kanban file — KanbanWidgetConfig minus the
 * widget-only keys (`kanban`, `cardOrder`). Declared explicitly instead of
 * Omit<> because the config's index signature would erase the named property
 * types under Omit.
 */
export interface KanbanBoardDefinition {
  version?: number;
  folder?: string;
  title?: string;
  statusProperty?: string;
  titleProperty?: string;
  columns?: Array<string | KanbanColumnConfig>;
  showUnspecified?: boolean;
  displayFields?: Array<string | KanbanDisplayFieldConfig>;
  filter?: FilterCondition[];
  limit?: number;
  /** Unknown keys are preserved for round-trip safety. */
  [key: string]: unknown;
}

export const KANBAN_FILE_VERSION = 1;
export const KANBAN_FILE_EXT = ".kanban";
/** Folder where "Save as .kanban file" places generated definitions. */
export const KANBAN_FOLDER = "Dashboards/Kanbans";

/**
 * Parse .kanban YAML. Tolerant: missing keys fall back to the same defaults
 * the widget already applies. Broken YAML or a non-object document → null.
 */
export function parseKanbanFile(content: string): KanbanBoardDefinition | null {
  let raw: unknown;
  try {
    raw = yaml.load(content);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as KanbanBoardDefinition;
}

export function serializeKanbanFile(def: KanbanBoardDefinition): string {
  const { version: _version, ...rest } = def;
  return yaml.dump({ version: KANBAN_FILE_VERSION, ...rest }, { lineWidth: -1, noRefs: true });
}

/** Board definition extracted from an inline widget config (widget-only keys dropped). */
export function boardDefinitionFromConfig(config: KanbanWidgetConfig): KanbanBoardDefinition {
  const { kanban: _kanban, cardOrder: _cardOrder, ...def } = config;
  return def;
}

/** Same character policy as kanban card file names. */
export function sanitizeKanbanFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
}

/** Base name (no folder, no extension) for a definition saved as a file. */
export function kanbanFileBaseName(def: KanbanBoardDefinition, widgetId: string): string {
  return sanitizeKanbanFileName(def.title ?? "") || `kanban-${widgetId.slice(0, 8)}`;
}

export interface KanbanFileOption {
  id: string;
  name: string;
}

export function collectKanbanFileOptions(files: CachedRemoteMeta["files"]): KanbanFileOption[] {
  return Object.entries(files)
    .filter(([, file]) => file.name.toLowerCase().endsWith(KANBAN_FILE_EXT))
    .map(([id, file]) => ({ id, name: file.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
