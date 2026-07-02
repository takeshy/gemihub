// Equalize (整列) layout: tiles all widgets evenly into up to 3 columns
// (horizontal) or 3 rows (vertical), ported from mdwys buildEqualizedWidgets.
// GemiHub's grid has fixed-height auto rows and a scrolling canvas, so the
// caller passes targetRows (how many grid rows fit one screen) and the tiles
// divide that height instead of mdwys's viewport-fitted 1-unit rows.

import type { Widget, LayoutPos } from "./types";

export type EqualizeDirection = "horizontal" | "vertical";

const MIN_TILE_ROWS = 2;

export function buildEqualizedLayout(
  widgets: Widget[],
  direction: EqualizeDirection,
  cols: number,
  targetRows: number,
): Widget[] {
  const count = widgets.length;
  if (count === 0) return widgets;

  const primarySlots = Math.min(3, count);
  const groups = Array.from({ length: primarySlots }, () => [] as Widget[]);
  widgets.forEach((widget, index) => {
    groups[index % primarySlots].push(widget);
  });
  const maxGroupSize = Math.max(...groups.map((group) => group.length));

  const layouts = new Map<string, LayoutPos>();
  groups.forEach((group, primaryIndex) => {
    if (direction === "vertical") {
      // Groups are rows; widgets divide the row's width.
      const rowH = Math.max(MIN_TILE_ROWS, Math.floor(targetRows / primarySlots));
      const slotWidth = Math.max(1, Math.floor(cols / group.length));
      group.forEach((widget, groupIndex) => {
        const x = groupIndex * slotWidth;
        const w = groupIndex === group.length - 1 ? cols - x : slotWidth;
        layouts.set(widget.id, { x, y: primaryIndex * rowH, w, h: rowH });
      });
      return;
    }

    // Groups are columns; widgets stack within the column.
    const tileH = Math.max(MIN_TILE_ROWS, Math.floor(targetRows / maxGroupSize));
    const slotWidth = Math.max(1, Math.floor(cols / primarySlots));
    const x = primaryIndex * slotWidth;
    const w = primaryIndex === primarySlots - 1 ? cols - x : slotWidth;
    group.forEach((widget, groupIndex) => {
      layouts.set(widget.id, {
        x,
        y: groupIndex * tileH,
        w,
        // A column with a single widget stretches to the full column height.
        h: group.length === 1 ? maxGroupSize * tileH : tileH,
      });
    });
  });

  // Only lg is set; sm is dropped so deriveSmLayout re-derives the stacked layout.
  return widgets.map((widget) => {
    const pos = layouts.get(widget.id);
    return pos ? { ...widget, layout: { lg: pos } } : widget;
  });
}
