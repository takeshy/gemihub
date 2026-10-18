import { useEffect, useRef, useState } from "react";
import { useIsDark } from "~/hooks/useIsDark";
import { renderMermaid } from "~/utils/mermaid-render";

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
      if (!containerRef.current) return;
      containerRef.current.innerHTML = "";
      setError(null);
      if (!chart) return;
      try {
        const result = await renderMermaid(
          { chart, isDark, useMaxWidth: false },
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

  return (
    <>
      {error && (
        <div className="flex items-center justify-center p-8 text-sm text-red-500">
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        style={{ display: error ? "none" : undefined }}
        className="overflow-auto rounded bg-white p-4 dark:bg-gray-900"
      />
    </>
  );
}
