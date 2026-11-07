import React, { useRef } from "react";

/**
 * Keeps side-by-side `.comparison-preview` panes at the same position. Panes can differ in height:
 * only a position that really moved produces a scroll event to ignore, so a clamped pane never
 * pushes its shorter limit back onto the pane being scrolled.
 */
export function useComparisonScroll() {
  const mirrored = useRef(new WeakSet<Element>());
  return (event: React.UIEvent<HTMLElement>) => {
    const source = event.target as HTMLElement;
    if (!source.classList.contains("comparison-preview") || mirrored.current.delete(source)) return;
    for (const other of event.currentTarget.querySelectorAll<HTMLElement>(".comparison-preview")) {
      if (other === source) continue;
      const position = other.scrollTop;
      other.scrollTop = source.scrollTop;
      if (other.scrollTop !== position) mirrored.current.add(other);
    }
  };
}
