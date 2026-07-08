// Data-oriented widget types — shared by the card / table / workflow widgets.
// The earlier generalized "data" widget (source × view) was split into three
// explicit widget types; these types are the common vocabulary they share.

export type PropertyType = "string" | "number" | "boolean" | "list" | "date";

/** Output format of a workflow widget. */
export type WorkflowOutput = "card" | "table" | "markdown" | "html";

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "empty"
  | "notEmpty"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "isTrue"
  | "isFalse"
  | "before"
  | "after";

export interface FilterCondition {
  property: string;
  op: FilterOp;
  value?: unknown;
}

/** Card view field-to-property mapping. */
export interface CardMapping {
  title?: string;
  subtitle?: string;
  image?: string;
  badges?: string[];
  body?: string;
}

/** Config for the folder-backed `card` widget. */
export interface CardWidgetConfig {
  folder?: string;
  filter?: FilterCondition[];
  sort?: string;
  limit?: number;
  card?: CardMapping;
  cols?: number;
  /** Unknown keys are preserved for round-trip safety. */
  [key: string]: unknown;
}

/** Config for the folder-backed `table` widget. */
export interface TableWidgetConfig {
  folder?: string;
  filter?: FilterCondition[];
  sort?: string;
  limit?: number;
  columns?: string[];
  /** Unknown keys are preserved for round-trip safety. */
  [key: string]: unknown;
}

/** Config for the folder-backed `kanban` widget. */
export interface KanbanColumnConfig {
  value: string;
  label?: string;
}

export interface KanbanWidgetConfig {
  /**
   * Path of a .kanban board definition file. When set, the file is the single
   * source of truth for the board definition and the inline keys below
   * (except cardOrder) are ignored. See kanban-file.ts.
   */
  kanban?: string;
  folder?: string;
  title?: string;
  statusProperty?: string;
  titleProperty?: string;
  columns?: Array<string | KanbanColumnConfig>;
  showUnspecified?: boolean;
  /** Persisted visual card order by row id/file id. */
  cardOrder?: string[];
  displayFields?: string[];
  filter?: FilterCondition[];
  limit?: number;
  /** Unknown keys are preserved for round-trip safety. */
  [key: string]: unknown;
}

/** Config for the `workflow` widget (runs a workflow, renders its output). */
export interface WorkflowWidgetConfig {
  /** Workflow file path. */
  workflow?: string;
  /** Variable name to extract output from. Defaults to `result`. */
  outputVariable?: string;
  /** How to render the output. Defaults to `table`. */
  output?: WorkflowOutput;
  /** card output: field mapping + columns per row. */
  card?: CardMapping;
  cols?: number;
  /** table output: column keys. */
  columns?: string[];
  /** Post-processing for card/table outputs. */
  filter?: FilterCondition[];
  sort?: string;
  limit?: number;
  /** Auto-run interval in minutes. 0/undefined = manual only. */
  refreshInterval?: number;
  /** Whether to show the widget header controls. Defaults to true. */
  showHeader?: boolean;
  /** Unknown keys are preserved for round-trip safety. */
  [key: string]: unknown;
}

/** A single row of data, agnostic to whether it came from folder or workflow. */
export interface DataRow {
  /** Unique row identifier (fileId for folder, index for workflow). */
  id: string;
  /** File name for folder source; undefined for workflow. */
  fileName?: string;
  /** File ID for folder source; undefined for workflow. */
  fileId?: string;
  /** mtime in ms (folder source only). */
  mtime?: number;
  /** ctime in ms (folder source only). */
  ctime?: number;
  /** True if frontmatter parsed successfully (folder source only, for editability). */
  fmParseable?: boolean;
  /** Property values keyed by name. */
  cells: Record<string, unknown>;
}

/** Detected property metadata. */
export interface FieldInfo {
  name: string;
  type: PropertyType;
}

/** Sidecar cache record for workflow widget results. */
export interface WorkflowCacheRecord {
  widgetId: string;
  ranAt: number;
  status: "ok" | "error";
  /** card/table output: array of row objects. */
  rows?: Record<string, unknown>[];
  /** card/table output: detected field types. */
  fields?: Record<string, PropertyType>;
  /** markdown/html output: the rendered string. */
  text?: string;
  error?: string;
}

/** Result of a workflow execution producing rows (card/table output). */
export interface WorkflowRowsResult {
  rows: Record<string, unknown>[];
  fields: Record<string, PropertyType>;
}

/** Result of a workflow execution producing a string (markdown/html output). */
export interface WorkflowTextResult {
  text: string;
}

/** Built-in file attribute keys (not frontmatter — not editable). */
export const FILE_ATTR_KEYS = new Set([
  "file.name",
  "name",
  "file.mtime",
  "mtime",
  "file.ctime",
  "ctime",
  "file.size",
  "file.tags",
]);

export const BUILTIN_FILE_KEYS = ["file.name", "file.mtime", "file.ctime"];
