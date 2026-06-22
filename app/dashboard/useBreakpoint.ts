import { useState, useEffect, useRef } from "react";
import { BREAKPOINT_THRESHOLD, type Breakpoint } from "./types";

/**
 * Returns the current breakpoint based on container width.
 * Uses ResizeObserver to track the container element's width.
 * Returns null until the container width is measured (avoids
 * the "container width 0" problem on first render).
 */
export function useBreakpoint(
  containerRef: React.RefObject<HTMLElement | null>,
): { breakpoint: Breakpoint | null; width: number } {
  const [breakpoint, setBreakpoint] = useState<Breakpoint | null>(null);
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = (w: number) => {
      setWidth(w);
      setBreakpoint(w < BREAKPOINT_THRESHOLD ? "sm" : "lg");
    };

    // Initial measurement
    measure(el.clientWidth);

    // Observe future changes
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) measure(w);
      }
    });
    observer.observe(el);
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [containerRef]);

  return { breakpoint, width };
}
