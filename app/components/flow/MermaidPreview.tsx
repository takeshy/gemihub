"use client";

import { useEffect, useRef, useState } from "react";
import { useIsDark } from "~/hooks/useIsDark";
import { enqueueMermaidRender } from "~/utils/mermaid-render";

interface MermaidPreviewProps {
  chart: string;
}

export function MermaidPreview({ chart }: MermaidPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const isDark = useIsDark();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!containerRef.current || !chart) return;
      try {
        const result = await enqueueMermaidRender(
          { chart, isDark },
          () => cancelled,
        );
        if (result && !cancelled && containerRef.current) {
          containerRef.current.innerHTML = result.svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render diagram");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, isDark]);

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-auto rounded bg-white p-4 dark:bg-gray-900"
    />
  );
}
