import { useEffect, useState } from "react";
import { getCachedFile } from "~/services/indexeddb-cache";
import { parseFrontmatter } from "~/components/editor/FrontmatterEditor";
import { extractMarkdownSubpath, splitSubpath } from "~/utils/wiki-subpath";
import type { FileListItem } from "~/contexts/EditorContext";
import type { TranslationStrings } from "~/i18n/translations";

const PREVIEW_MAX_CHARS = 280;

/** Resolve a wiki-link target (without its `|display`) to a file in the list. */
export function resolveWikiTarget(fileList: FileListItem[], target: string): FileListItem | undefined {
  const name = target.split("#")[0].trim();
  if (!name) return undefined;
  const lower = name.toLowerCase();
  const noExt = lower.replace(/\.md$/i, "");
  return fileList.find((f) => {
    const fn = f.name.toLowerCase();
    const fp = f.path.toLowerCase();
    return (
      fn === lower ||
      fn.replace(/\.md$/i, "") === noExt ||
      fp === lower ||
      fp.replace(/\.md$/i, "") === noExt
    );
  });
}

/**
 * Preview body shown inside wysimark-lite's internal-link dialog.
 * Resolves the link target to a cached file and renders a short text snippet.
 */
export function WikiLinkPreview({
  target,
  fileList,
  t,
}: {
  target: string;
  fileList: FileListItem[];
  t: (key: keyof TranslationStrings) => string;
}) {
  const file = resolveWikiTarget(fileList, target);
  const { subpath } = splitSubpath(target);
  const [snippet, setSnippet] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setSnippet(null);
      return;
    }
    (async () => {
      const cached = await getCachedFile(file.id);
      if (cancelled) return;
      const body = parseFrontmatter(cached?.content ?? "").body;
      // Show only the targeted heading section / block when a subpath is given
      const section = extractMarkdownSubpath(body, subpath).trim();
      setSnippet(section.slice(0, PREVIEW_MAX_CHARS));
    })();
    return () => {
      cancelled = true;
    };
  }, [file, subpath]);

  if (!file) {
    return <span style={{ fontStyle: "italic" }}>{t("wikiPreview.notFound")}</span>;
  }
  if (snippet === null) {
    return <span>…</span>;
  }
  if (snippet === "") {
    return <span style={{ fontStyle: "italic" }}>{t("wikiPreview.empty")}</span>;
  }
  return <span style={{ whiteSpace: "pre-wrap" }}>{snippet}</span>;
}
