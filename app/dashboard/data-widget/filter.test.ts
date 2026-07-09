import assert from "node:assert/strict";
import test from "node:test";
import {
  inferType,
  detectFields,
  fieldsToMap,
  applyFilters,
  applySort,
  applyLimit,
  applyPostSource,
  evaluateCondition,
  getCellValue,
  formatCell,
  OPERATORS_BY_TYPE,
} from "./filter.ts";
import type { DataRow } from "./types.ts";

const makeRow = (
  id: string,
  cells: Record<string, unknown>,
  extra?: Partial<DataRow>,
): DataRow => ({
  id,
  cells,
  ...extra,
});

test("inferType detects string", () => {
  assert.equal(inferType(["hello", "world"]), "string");
});

test("inferType detects number", () => {
  assert.equal(inferType([1, 2, 3]), "number");
  assert.equal(inferType([null, 42, null]), "number");
});

test("inferType detects boolean", () => {
  assert.equal(inferType([true, false]), "boolean");
});

test("inferType detects list from arrays", () => {
  assert.equal(inferType([["a", "b"]]), "list");
});

test("inferType detects date from ISO strings", () => {
  assert.equal(inferType(["2024-01-15", "2024-02-20"]), "date");
});

test("inferType falls back to string for unknown", () => {
  assert.equal(inferType([null, null]), "string");
  assert.equal(inferType([{ a: 1 }]), "string");
});

test("detectFields unions keys from all rows", () => {
  const rows = [
    { name: "A", status: "done" },
    { name: "B", owner: "takeshy" },
    { name: "C", status: "todo", amount: 100 },
  ];
  const fields = detectFields(rows);
  const names = fields.map((f) => f.name);
  assert.ok(names.includes("name"));
  assert.ok(names.includes("status"));
  assert.ok(names.includes("owner"));
  assert.ok(names.includes("amount"));
});

test("fieldsToMap builds a type map", () => {
  const fields = detectFields([{ name: "A", count: 5 }]);
  const map = fieldsToMap(fields);
  assert.equal(map.name, "string");
  assert.equal(map.count, "number");
});

// --- Filter evaluation ---

test("applyFilters with no filters returns all rows", () => {
  const rows = [makeRow("1", { a: 1 }), makeRow("2", { a: 2 })];
  assert.equal(applyFilters(rows, undefined).length, 2);
  assert.equal(applyFilters(rows, []).length, 2);
});

test("applyFilters with eq filter", () => {
  const rows = [
    makeRow("1", { status: "done" }),
    makeRow("2", { status: "todo" }),
    makeRow("3", { status: "done" }),
  ];
  const result = applyFilters(rows, [{ property: "status", op: "eq", value: "done" }]);
  assert.equal(result.length, 2);
});

test("applyFilters implicit AND with multiple conditions", () => {
  const rows = [
    makeRow("1", { status: "done", owner: "a" }),
    makeRow("2", { status: "todo", owner: "a" }),
    makeRow("3", { status: "done", owner: "b" }),
  ];
  const result = applyFilters(rows, [
    { property: "status", op: "eq", value: "done" },
    { property: "owner", op: "eq", value: "a" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "1");
});

test("evaluateCondition empty/notEmpty don't need value", () => {
  const row1 = makeRow("1", { tags: ["a", "b"] });
  const row2 = makeRow("2", { tags: [] });
  const row3 = makeRow("3", {});
  assert.ok(evaluateCondition(row1, { property: "tags", op: "notEmpty" }));
  assert.ok(!evaluateCondition(row2, { property: "tags", op: "notEmpty" }));
  assert.ok(evaluateCondition(row2, { property: "tags", op: "empty" }));
  assert.ok(evaluateCondition(row3, { property: "tags", op: "empty" }));
});

test("evaluateCondition isTrue/isFalse", () => {
  const row = makeRow("1", { active: true, archived: false });
  assert.ok(evaluateCondition(row, { property: "active", op: "isTrue" }));
  assert.ok(evaluateCondition(row, { property: "archived", op: "isFalse" }));
  assert.ok(!evaluateCondition(row, { property: "active", op: "isFalse" }));
});

test("evaluateCondition gt/lt with numbers", () => {
  const row = makeRow("1", { amount: 500 });
  assert.ok(evaluateCondition(row, { property: "amount", op: "gt", value: 100 }));
  assert.ok(!evaluateCondition(row, { property: "amount", op: "gt", value: 500 }));
  assert.ok(evaluateCondition(row, { property: "amount", op: "gte", value: 500 }));
  assert.ok(evaluateCondition(row, { property: "amount", op: "lt", value: 1000 }));
  assert.ok(!evaluateCondition(row, { property: "amount", op: "lt", value: 500 }));
  assert.ok(evaluateCondition(row, { property: "amount", op: "lte", value: 500 }));
});

test("evaluateCondition contains for list and string", () => {
  const row = makeRow("1", { tags: ["urgent", "bug"], title: "Fix the issue" });
  assert.ok(evaluateCondition(row, { property: "tags", op: "contains", value: "urgent" }));
  assert.ok(!evaluateCondition(row, { property: "tags", op: "contains", value: "feature" }));
  assert.ok(evaluateCondition(row, { property: "title", op: "contains", value: "Fix" }));
  assert.ok(!evaluateCondition(row, { property: "title", op: "contains", value: "Create" }));
});

test("evaluateCondition notContains for list", () => {
  const row = makeRow("1", { tags: ["urgent", "bug"] });
  assert.ok(evaluateCondition(row, { property: "tags", op: "notContains", value: "feature" }));
  assert.ok(!evaluateCondition(row, { property: "tags", op: "notContains", value: "bug" }));
});

test("evaluateCondition before/after for dates", () => {
  const row = makeRow("1", { date: "2024-06-15" });
  assert.ok(evaluateCondition(row, { property: "date", op: "before", value: "2024-07-01" }));
  assert.ok(!evaluateCondition(row, { property: "date", op: "before", value: "2024-06-01" }));
  assert.ok(evaluateCondition(row, { property: "date", op: "after", value: "2024-06-01" }));
  assert.ok(!evaluateCondition(row, { property: "date", op: "after", value: "2024-07-01" }));
});

test("evaluateCondition neq", () => {
  const row = makeRow("1", { status: "done" });
  assert.ok(evaluateCondition(row, { property: "status", op: "neq", value: "todo" }));
  assert.ok(!evaluateCondition(row, { property: "status", op: "neq", value: "done" }));
});

test("evaluateCondition neq on missing property is false (§6.3)", () => {
  const row = makeRow("1", { a: 1 });
  // Missing property: neq is false (only empty/notEmpty are true for missing props)
  assert.ok(!evaluateCondition(row, { property: "b", op: "neq", value: "x" }));
});

test("type mismatch: number op on string value coerces", () => {
  const row = makeRow("1", { amount: "500" });
  assert.ok(evaluateCondition(row, { property: "amount", op: "gt", value: 100 }));
});

test("type mismatch: NaN comparison excludes row (gt/lt)", () => {
  const row = makeRow("1", { amount: "not a number" });
  assert.ok(!evaluateCondition(row, { property: "amount", op: "gt", value: 100 }));
  assert.ok(!evaluateCondition(row, { property: "amount", op: "lt", value: 100 }));
});

test("missing property: empty/notEmpty only", () => {
  const row = makeRow("1", { a: 1 });
  assert.ok(evaluateCondition(row, { property: "b", op: "empty" }));
  assert.ok(!evaluateCondition(row, { property: "b", op: "notEmpty" }));
  // eq on missing property → false
  assert.ok(!evaluateCondition(row, { property: "b", op: "eq", value: "x" }));
  // neq on missing property → false (§6.3: only empty/notEmpty are true for missing)
  assert.ok(!evaluateCondition(row, { property: "b", op: "neq", value: "x" }));
});

// --- File attributes ---

test("getCellValue resolves file attributes", () => {
  const row = makeRow("1", { status: "done" }, {
    fileName: "folder/test.md",
    fileContent: "Body text",
    mtime: 1700000000,
    ctime: 1600000000,
  });
  assert.equal(getCellValue(row, "file.path"), "folder/test.md");
  assert.equal(getCellValue(row, "file.name"), "test.md");
  assert.equal(getCellValue(row, "file.content"), "Body text");
  assert.equal(getCellValue(row, "name"), "folder/test.md");
  assert.equal(getCellValue(row, "file.mtime"), 1700000000);
  assert.equal(getCellValue(row, "file.ctime"), 1600000000);
  assert.equal(getCellValue(row, "status"), "done");
});

// --- Sort ---

test("applySort ascending by name", () => {
  const rows = [
    makeRow("1", {}, { fileName: "c.md" }),
    makeRow("2", {}, { fileName: "a.md" }),
    makeRow("3", {}, { fileName: "b.md" }),
  ];
  const sorted = applySort(rows, "name");
  assert.equal(sorted[0].fileName, "a.md");
  assert.equal(sorted[1].fileName, "b.md");
  assert.equal(sorted[2].fileName, "c.md");
});

test("applySort descending with - prefix", () => {
  const rows = [
    makeRow("1", {}, { fileName: "a.md" }),
    makeRow("2", {}, { fileName: "c.md" }),
    makeRow("3", {}, { fileName: "b.md" }),
  ];
  const sorted = applySort(rows, "-name");
  assert.equal(sorted[0].fileName, "c.md");
  assert.equal(sorted[1].fileName, "b.md");
  assert.equal(sorted[2].fileName, "a.md");
});

test("applySort by frontmatter key", () => {
  const rows = [
    makeRow("1", { priority: 3 }),
    makeRow("2", { priority: 1 }),
    makeRow("3", { priority: 2 }),
  ];
  const sorted = applySort(rows, "priority");
  assert.equal(sorted[0].cells.priority, 1);
  assert.equal(sorted[1].cells.priority, 2);
  assert.equal(sorted[2].cells.priority, 3);
});

// --- Limit ---

test("applyLimit truncates", () => {
  const rows = Array.from({ length: 10 }, (_, i) => makeRow(String(i), { a: i }));
  assert.equal(applyLimit(rows, 5).length, 5);
  assert.equal(applyLimit(rows, undefined).length, 10);
  assert.equal(applyLimit(rows, 0).length, 10);
});

// --- Full pipeline ---

test("applyPostSource: filter → sort → limit", () => {
  const rows = [
    makeRow("1", { status: "done", priority: 3 }),
    makeRow("2", { status: "todo", priority: 1 }),
    makeRow("3", { status: "done", priority: 1 }),
    makeRow("4", { status: "done", priority: 2 }),
  ];
  const result = applyPostSource(rows, {
    filter: [{ property: "status", op: "eq", value: "done" }],
    sort: "priority",
    limit: 2,
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].cells.priority, 1);
  assert.equal(result[1].cells.priority, 2);
});

// --- Same filter/sort/limit for folder and workflow rows ---

test("filter/sort/limit work identically for workflow-style rows", () => {
  const rows = [
    makeRow("0", { name: "ACME", status: "進行中", amount: 500000 }),
    makeRow("1", { name: "Beta", status: "保留", amount: 200000 }),
    makeRow("2", { name: "Gamma", status: "進行中", amount: 300000 }),
  ];
  const result = applyPostSource(rows, {
    filter: [{ property: "status", op: "eq", value: "進行中" }],
    sort: "-amount",
    limit: 10,
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].cells.name, "ACME");
  assert.equal(result[1].cells.name, "Gamma");
});

// --- Operators by type ---

test("OPERATORS_BY_TYPE has correct operators per type", () => {
  assert.ok(OPERATORS_BY_TYPE.string.includes("eq"));
  assert.ok(OPERATORS_BY_TYPE.string.includes("contains"));
  assert.ok(!OPERATORS_BY_TYPE.string.includes("gt"));
  assert.ok(OPERATORS_BY_TYPE.number.includes("gt"));
  assert.ok(OPERATORS_BY_TYPE.number.includes("lte"));
  assert.ok(OPERATORS_BY_TYPE.boolean.includes("isTrue"));
  assert.ok(OPERATORS_BY_TYPE.list.includes("contains"));
  assert.ok(OPERATORS_BY_TYPE.date.includes("before"));
  assert.ok(OPERATORS_BY_TYPE.date.includes("after"));
});

// --- Formatting ---

test("formatCell formats various types", () => {
  assert.equal(formatCell(null), "");
  assert.equal(formatCell(undefined), "");
  assert.equal(formatCell(true), "Yes");
  assert.equal(formatCell(false), "No");
  assert.equal(formatCell([1, 2, 3]), "1, 2, 3");
  assert.equal(formatCell({ a: 1 }), '{"a":1}');
  assert.equal(formatCell("hello"), "hello");
  assert.equal(formatCell(42), "42");
});

test("formatCell formats dates with locale", () => {
  const ms = new Date("2024-01-15T10:30:00Z").getTime();
  // Without type, a number is rendered as-is
  assert.equal(formatCell(ms), String(ms));
  // With type "date", it is rendered as a locale-formatted string
  const en = formatCell(ms, "date", "en");
  const ja = formatCell(ms, "date", "ja");
  assert.ok(en.includes("2024"));
  assert.ok(ja.includes("2024"));
  // Locale difference: English uses AM/PM, Japanese does not
  assert.notEqual(en, ja);
  // ISO date strings are also handled
  const isoEn = formatCell("2024-01-15T10:30:00Z", "date", "en");
  assert.ok(isoEn.includes("2024"));
  // Null/undefined dates return empty
  assert.equal(formatCell(null, "date", "en"), "");
  assert.equal(formatCell(undefined, "date", "en"), "");
  // 0 (missing timestamp) returns empty rather than the 1970 epoch
  assert.equal(formatCell(0, "date", "en"), "");
});
