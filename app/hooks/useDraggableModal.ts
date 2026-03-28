import { useState, useRef, useCallback, useLayoutEffect } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

const MIN_VISIBLE_MARGIN = 24;

function clampPosition(x: number, y: number, width: number, height: number) {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - Math.min(width, MIN_VISIBLE_MARGIN))),
    y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - Math.min(height, MIN_VISIBLE_MARGIN))),
  };
}

/**
 * Hook that makes a modal draggable (via header) and freely resizable.
 * Returns a ref for the modal panel, a style object for absolute positioning,
 * and an onMouseDown handler for the drag-handle (header).
 */
export function useDraggableModal() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Center the modal on first render, after the browser has laid it out
  useLayoutEffect(() => {
    if (modalRef.current && pos === null) {
      const rect = modalRef.current.getBoundingClientRect();
      setPos(
        clampPosition(
          (window.innerWidth - rect.width) / 2,
          (window.innerHeight - rect.height) / 2,
          rect.width,
          rect.height,
        ),
      );
    }
  }, [pos]);

  const onDragStart = useCallback(
    (e: ReactMouseEvent) => {
      // Only left-click
      if (e.button !== 0) return;
      // Don't drag when clicking buttons / inputs inside the header
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, input, a")) return;

      if (!pos) return;
      e.preventDefault();
      dragging.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };

      const onMove = (ev: globalThis.MouseEvent) => {
        if (!dragging.current || !modalRef.current) return;
        const rect = modalRef.current.getBoundingClientRect();
        setPos(
          clampPosition(
            dragging.current.origX + (ev.clientX - dragging.current.startX),
            dragging.current.origY + (ev.clientY - dragging.current.startY),
            rect.width,
            rect.height,
          ),
        );
      };
      const onUp = () => {
        dragging.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [pos],
  );

  const modalStyle: CSSProperties = pos
    ? { position: "absolute", left: pos.x, top: pos.y }
    : { visibility: "hidden" as const };

  return { modalRef, modalStyle, onDragStart };
}
