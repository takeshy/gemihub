"use client";

import { useEffect, useRef, useState } from "react";
import { useIsDark } from "~/hooks/useIsDark";

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

      const id = `mermaid-${Date.now()}`;
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: "basis",
          },
          securityLevel: "strict",
          suppressErrorRendering: true,
        });

        const { svg } = await mermaid.render(id, chart);

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        // Clean up orphaned Mermaid error element created by failed render
        document.getElementById(id)?.remove();
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
