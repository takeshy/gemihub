import { useState, useEffect, useCallback } from "react";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { getCachedFile } from "~/services/indexeddb-cache";
import { splitFrontmatter } from "../frontmatter-writeback";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";

interface MarkdownConfig {
  /** Inline markdown content (used when no fileId is set). */
  content?: string;
  /** When set, render the body of this Drive markdown file instead of inline content. */
  fileId?: string;
  fileName?: string;
}

export default function MarkdownWidget({
  config,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as MarkdownConfig;
  const inline = typeof cfg.content === "string" ? cfg.content : "";
  const [fileText, setFileText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const loadFile = useCallback(async () => {
    if (!cfg.fileId) {
      setFileText(null);
      setMissing(false);
      return;
    }
    const cached = await getCachedFile(cfg.fileId);
    if (!cached) {
      setMissing(true);
      setFileText(null);
      return;
    }
    setMissing(false);
    // Render only the markdown body — drop the frontmatter block.
    const split = splitFrontmatter(cached.content);
    setFileText(split ? split.body : cached.content);
  }, [cfg.fileId]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  // Refresh when the referenced file changes (push/pull, cell edits, etc.).
  useEffect(() => {
    if (!cfg.fileId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { fileId?: string } | undefined;
      if (!detail || !detail.fileId || detail.fileId === cfg.fileId) {
        loadFile();
      }
    };
    window.addEventListener("file-modified", handler);
    window.addEventListener("dashboard-data-changed", handler);
    return () => {
      window.removeEventListener("file-modified", handler);
      window.removeEventListener("dashboard-data-changed", handler);
    };
  }, [cfg.fileId, loadFile]);

  if (cfg.fileId && missing) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.fileNotFound")}
      </div>
    );
  }

  const text = cfg.fileId ? (fileText ?? "") : inline;

  return (
    <div className="prose prose-sm h-full max-w-none overflow-auto dark:prose-invert">
      <GfmMarkdownPreview content={text} />
    </div>
  );
}
