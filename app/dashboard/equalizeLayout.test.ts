import assert from "node:assert/strict";
import test from "node:test";
import { buildEqualizedLayout } from "./equalizeLayout.ts";
import type { Widget } from "./types.ts";

function makeWidgets(count: number): Widget[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i + 1}`,
    type: "file",
    layout: { lg: { x: 0, y: i, w: 6, h: 3 }, sm: { x: 0, y: i, w: 12, h: 3 } },
    config: {},
  }));
}

function lg(widgets: Widget[], id: string) {
  const pos = widgets.find((w) => w.id === id)?.layout.lg;
  if (!pos) throw new Error(`no lg layout for ${id}`);
  return pos;
}

test("empty input returns as-is", () => {
  assert.deepEqual(buildEqualizedLayout([], "horizontal", 12, 12), []);
});

test("horizontal: 3 widgets become 3 full-height columns, last absorbs remainder", () => {
  const result = buildEqualizedLayout(makeWidgets(3), "horizontal", 12, 12);
  assert.deepEqual(lg(result, "w1"), { x: 0, y: 0, w: 4, h: 12 });
  assert.deepEqual(lg(result, "w2"), { x: 4, y: 0, w: 4, h: 12 });
  assert.deepEqual(lg(result, "w3"), { x: 8, y: 0, w: 4, h: 12 });
});

test("horizontal: 2 widgets split into 2 columns with remainder on the last", () => {
  const result = buildEqualizedLayout(makeWidgets(2), "horizontal", 12, 10);
  assert.deepEqual(lg(result, "w1"), { x: 0, y: 0, w: 6, h: 10 });
  assert.deepEqual(lg(result, "w2"), { x: 6, y: 0, w: 6, h: 10 });
});

test("horizontal: round-robin stacks the 4th widget under the 1st; single-member columns stretch", () => {
  const result = buildEqualizedLayout(makeWidgets(4), "horizontal", 12, 12);
  // groups: [w1,w4], [w2], [w3]; maxGroupSize=2, tileH=6
  assert.deepEqual(lg(result, "w1"), { x: 0, y: 0, w: 4, h: 6 });
  assert.deepEqual(lg(result, "w4"), { x: 0, y: 6, w: 4, h: 6 });
  assert.deepEqual(lg(result, "w2"), { x: 4, y: 0, w: 4, h: 12 });
  assert.deepEqual(lg(result, "w3"), { x: 8, y: 0, w: 4, h: 12 });
});

test("vertical: 3 widgets become 3 full-width rows", () => {
  const result = buildEqualizedLayout(makeWidgets(3), "vertical", 12, 12);
  assert.deepEqual(lg(result, "w1"), { x: 0, y: 0, w: 12, h: 4 });
  assert.deepEqual(lg(result, "w2"), { x: 0, y: 4, w: 12, h: 4 });
  assert.deepEqual(lg(result, "w3"), { x: 0, y: 8, w: 12, h: 4 });
});

test("vertical: 5 widgets round-robin into 3 rows; widths divide within a row", () => {
  const result = buildEqualizedLayout(makeWidgets(5), "vertical", 12, 12);
  // groups: [w1,w4], [w2,w5], [w3]; rowH=4
  assert.deepEqual(lg(result, "w1"), { x: 0, y: 0, w: 6, h: 4 });
  assert.deepEqual(lg(result, "w4"), { x: 6, y: 0, w: 6, h: 4 });
  assert.deepEqual(lg(result, "w2"), { x: 0, y: 4, w: 6, h: 4 });
  assert.deepEqual(lg(result, "w5"), { x: 6, y: 4, w: 6, h: 4 });
  assert.deepEqual(lg(result, "w3"), { x: 0, y: 8, w: 12, h: 4 });
});

test("tile height never drops below 2 rows", () => {
  const result = buildEqualizedLayout(makeWidgets(9), "horizontal", 12, 3);
  // maxGroupSize=3, floor(3/3)=1 → clamped to 2
  assert.equal(lg(result, "w1").h, 2);
  assert.deepEqual(lg(result, "w4"), { x: 0, y: 2, w: 4, h: 2 });
});

test("sm layout is dropped so deriveSmLayout re-derives it", () => {
  const result = buildEqualizedLayout(makeWidgets(2), "horizontal", 12, 12);
  for (const widget of result) {
    assert.equal(widget.layout.sm, undefined);
    assert.notEqual(widget.layout.lg, undefined);
  }
});

test("widget identity and config are preserved", () => {
  const widgets = makeWidgets(2);
  widgets[0].config = { path: "a.md" };
  const result = buildEqualizedLayout(widgets, "vertical", 12, 12);
  assert.equal(result[0].id, "w1");
  assert.deepEqual(result[0].config, { path: "a.md" });
  assert.equal(result[0].type, "file");
});
