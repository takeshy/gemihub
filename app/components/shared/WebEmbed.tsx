import { useState, useEffect } from "react";
import { Link, ExternalLink, Globe, Loader2 } from "lucide-react";

function linkLabel(href: string): string {
  try {
    return new URL(href).hostname || href;
  } catch {
    return href;
  }
}

// Cache embeddability results per URL for the session so a dashboard with
// several web widgets (or re-renders) doesn't re-hit the server each time.
const embedCache = new Map<string, boolean>();

interface WebEmbedProps {
  url: string;
  /** When false, the iframe is pointer-events-none (used by Canvas previews). */
  interactive?: boolean;
}

/**
 * Shared web embed component: header bar (with "open in new tab") + iframe + URL footer.
 *
 * X-Frame-Options / CSP frame-ancestors blocks can't be detected from JS, so we
 * ask the server (/api/embed-check) whether the site allows framing. Embeddable
 * sites render in the iframe; blocked sites show a clean "open in new tab" card
 * instead of a broken blank frame.
 */
export default function WebEmbed({ url, interactive = true }: WebEmbedProps) {
  const [embeddable, setEmbeddable] = useState<boolean | null>(
    () => embedCache.get(url) ?? null,
  );

  useEffect(() => {
    const cached = embedCache.get(url);
    if (cached !== undefined) {
      setEmbeddable(cached);
      return;
    }
    let cancelled = false;
    setEmbeddable(null);
    (async () => {
      try {
        const res = await fetch("/api/embed-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = (await res.json()) as { embeddable?: boolean };
        // On any unexpected response, default to attempting the iframe.
        const result = data.embeddable !== false;
        embedCache.set(url, result);
        if (!cancelled) setEmbeddable(result);
      } catch {
        if (!cancelled) setEmbeddable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const header = (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-white/70 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-950/30">
      <Link size={12} className="shrink-0 text-purple-500" />
      <span className="truncate font-medium text-gray-700 dark:text-gray-200">
        {linkLabel(url)}
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
        title="Open in new tab"
      >
        <ExternalLink size={12} />
      </a>
    </div>
  );

  if (embeddable === null) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {header}
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={20} className="animate-spin text-gray-300 dark:text-gray-600" />
        </div>
      </div>
    );
  }

  if (!embeddable) {
    // Site forbids framing (X-Frame-Options / CSP). Nothing we can do client-side
    // — offer a clear link out instead of a broken blank iframe.
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <Globe size={28} className="text-gray-300 dark:text-gray-600" />
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {linkLabel(url)}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <ExternalLink size={13} />
            Open in new tab
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {header}
      <iframe
        title={url}
        src={url}
        className={`min-h-0 flex-1 border-0 bg-white ${interactive ? "" : "pointer-events-none"}`}
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        referrerPolicy="no-referrer"
      />
      <div className="truncate border-t border-gray-200 px-2 py-1 text-[10px] text-blue-700 dark:border-gray-700 dark:text-blue-300">
        {url}
      </div>
    </div>
  );
}
