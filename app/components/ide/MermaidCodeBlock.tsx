"use client";

import { useEffect, useRef, useState } from "react";
import { useIsDark } from "~/hooks/useIsDark";
import { enqueueMermaidRender } from "~/utils/mermaid-render";

export function MermaidCodeBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const isDark = useIsDark();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!containerRef.current || !code) return;
      try {
        const result = await enqueueMermaidRender(
          { chart: code, isDark, useMaxWidth: true },
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
  }, [code, isDark]);

  if (error) {
    return (
      <pre className="rounded bg-gray-100 p-4 text-sm text-red-600 dark:bg-gray-800 dark:text-red-400">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center overflow-auto rounded bg-white p-4 dark:bg-gray-900 [&>svg]:max-w-full"
    />
  );
}
