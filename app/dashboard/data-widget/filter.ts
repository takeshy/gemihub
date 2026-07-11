// Filter evaluation — type inference, operator dispatch, and row filtering.
// Pure, deterministic, synchronous. No network or LLM calls (P2 spec §6).

import type {
  FilterCondition,
  FilterOp,
  PropertyType,
  DataRow,
  FieldInfo,
} from "./types";

// --- Operators per type (P2 spec §6.2) ---

export const OPERATORS_BY_TYPE: Record<PropertyType, FilterOp[]> = {
  string: ["eq", "neq", "contains", "notContains", "empty", "notEmpty"],
  number: ["eq", "neq", "gt", "lt", "gte", "lte"],
  boolean: ["isTrue", "isFalse"],
  list: ["contains", "notContains", "empty"],
  date: ["before", "after"],
};

// --- Type inference ---

/**
 * Infer a property type from a set of values.
 * Uses the first non-null/non-undefined value's type.
 * Arrays → list. Strings matching ISO date → date.
 * Falls back to "string".
 */
export function inferType(values: unknown[]): PropertyType {
  for (const v of values) {
    if (v == null) continue;
    if (Array.isArray(v)) return "list";
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "string") {
      if (isDateString(v)) return "date";
      return "string";
    }
    return "string";
  }
  return "string";
}

function isDateString(v: string): boolean {
  if (v.length < 10) return false;
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
  const t = Date.parse(v);
  return !isNaN(t);
}

/**
 * Detect field info (name + type) from a set of rows.
 * The key set is the union of all row keys.
 * Type is inferred from all non-null values across rows for each key.
 */
export function detectFields(rows: Record<string, unknown>[]): FieldInfo[] {
  const keySet = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const key of Object.keys(row)) {
        keySet.add(key);
      }
    }
  }
  return Array.from(keySet).map((name) => {
    const values = rows
      .map((r) => r?.[name])
      .filter((v) => v != null);
    return { name, type: inferType(values) };
  });
}

/**
 * Build a fields map from FieldInfo[].
 */
export function fieldsToMap(fields: FieldInfo[]): Record<string, PropertyType> {
  const map: Record<string, PropertyType> = {};
  for (const f of fields) map[f.name] = f.type;
  return map;
}

// --- Value coercion ---

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function toDate(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  return null;
}

// --- Cell value resolution ---

export function getCellValue(row: DataRow, property: string): unknown {
  if (property === "file.path") return row.fileName;
  if (property === "file.name") return row.fileName?.split("/").pop() ?? row.fileName;
  if (property === "file.content") return row.fileContent;
  if (property === "file.tags") return row.fileTags;
  if (property === "name") return row.fileName;
  if (property === "file.mtime" || property === "mtime") return row.mtime;
  if (property === "file.ctime" || property === "ctime") return row.ctime;
  return row.cells[property];
}

// --- Single condition evaluation (P2 spec §6.3) ---

export function evaluateCondition(
  row: DataRow,
  cond: FilterCondition,
): boolean {
  const value = getCellValue(row, cond.property);

  switch (cond.op) {
    case "empty":
      return value == null || value === "" ||
        (Array.isArray(value) && value.length === 0);
    case "notEmpty":
      return !(value == null || value === "" ||
        (Array.isArray(value) && value.length === 0));
    case "isTrue":
      return value === true;
    case "isFalse":
      return value === false;
    case "eq":
      return compareEq(value, cond.value);
    case "neq":
      // §6.3: "値が存在しないプロパティは empty 系のみ真"
      // — a missing property is not "not equal to X", it's just missing.
      if (value == null) return false;
      return !compareEq(value, cond.value);
    case "contains":
      return containsOp(value, cond.value);
    case "notContains":
      return !containsOp(value, cond.value);
    case "gt":
      return compareNum(value, cond.value) > 0;
    case "lt":
      return compareNum(value, cond.value) < 0;
    case "gte":
      return compareNum(value, cond.value) >= 0;
    case "lte":
      return compareNum(value, cond.value) <= 0;
    case "before":
      return compareDate(value, cond.value) < 0;
    case "after":
      return compareDate(value, cond.value) > 0;
    default:
      return true;
  }
}

function compareEq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    const an = toNumber(a);
    const bn = toNumber(b);
    if (an != null && bn != null) return an === bn;
  }
  return String(a) === String(b);
}

function containsOp(value: unknown, target: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((v) => compareEq(v, target));
  }
  if (typeof value === "string") {
    return typeof target === "string" && value.includes(target);
  }
  return false;
}

function compareNum(a: unknown, b: unknown): number {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an == null || bn == null) return NaN;
  return an - bn;
}

function compareDate(a: unknown, b: unknown): number {
  const at = toDate(a);
  const bt = toDate(b);
  if (at == null || bt == null) return NaN;
  return at - bt;
}

// --- Full filter application (implicit AND) ---

export function applyFilters(
  rows: DataRow[],
  filters: FilterCondition[] | undefined,
): DataRow[] {
  if (!filters || filters.length === 0) return rows;
  return rows.filter((row) =>
    filters.every((cond) => evaluateCondition(row, cond)),
  );
}

// --- Sort + limit (shared post-source transformation) ---

export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const aStr = String(a).toLowerCase();
  const bStr = String(b).toLowerCase();
  if (aStr < bStr) return -1;
  if (aStr > bStr) return 1;
  return 0;
}

export function applySort(
  rows: DataRow[],
  sort: string | undefined,
): DataRow[] {
  if (!sort) return rows;
  const sortKey = sort.startsWith("-") ? sort.slice(1) : sort;
  const sortDesc = sort.startsWith("-");
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const aVal = getCellValue(a, sortKey);
    const bVal = getCellValue(b, sortKey);
    const cmp = compareValues(aVal, bVal);
    if (isNaN(cmp)) return 0;
    return sortDesc ? -cmp : cmp;
  });
  return sorted;
}

export function applyLimit(
  rows: DataRow[],
  limit: number | undefined,
): DataRow[] {
  if (!limit || limit <= 0) return rows;
  return rows.slice(0, limit);
}

/** Full post-source pipeline: filter → sort → limit. */
export function applyPostSource(
  rows: DataRow[],
  config: { filter?: FilterCondition[]; sort?: string; limit?: number },
): DataRow[] {
  const filtered = applyFilters(rows, config.filter);
  const sorted = applySort(filtered, config.sort);
  return applyLimit(sorted, config.limit);
}

// --- Formatting ---

export function formatCell(
  value: unknown,
  type?: PropertyType,
  locale?: string,
): string {
  if (value == null) return "";
  if (type === "date") return formatDate(value, locale);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value: unknown, locale?: string): string {
  let ms: number | null = null;
  if (typeof value === "number") {
    // Treat 0 (missing modifiedTime/createdTime) as empty rather than 1970.
    if (value === 0) return "";
    ms = value;
  } else if (typeof value === "string") {
    const t = Date.parse(value);
    if (!isNaN(t)) ms = t;
  }
  if (ms == null) return String(value);
  return new Date(ms).toLocaleString(locale);
}
