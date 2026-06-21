// Shared helpers for Obsidian-style wiki link / embed subpaths
// (`#heading` and `#^blockId`) used by preview, embed, and editor navigation.

/** Slugify a heading's text to a DOM id (matches GfmMarkdownPreview heading ids). */
export function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/** Split a wiki target `Page#heading` into `{ target, subpath }` (subpath has no leading `#`). */
export function splitSubpath(value: string): { target: string; subpath?: string } {
  const hash = value.indexOf("#");
  if (hash < 0) return { target: value.trim() };
  return {
    target: value.slice(0, hash).trim(),
    subpath: value.slice(hash + 1).trim() || undefined,
  };
}

/**
 * Extract a heading section (`#Heading`) or block (`#^blockId`) from markdown.
 * Returns the whole content when there is no subpath, or "" when not found.
 */
export function extractMarkdownSubpath(content: string, subpath?: string): string {
  if (!subpath) return content;
  const lines = content.split("\n");

  if (subpath.startsWith("^")) {
    const blockId = subpath.slice(1);
    const markerIndex = lines.findIndex((line) => line.trimEnd().endsWith(`^${blockId}`));
    if (markerIndex < 0) return "";
    let start = markerIndex;
    while (start > 0 && lines[start - 1].trim() !== "") start--;
    return lines
      .slice(start, markerIndex + 1)
      .join("\n")
      .replace(/\s*\^\S+\s*$/, "")
      .trim();
  }

  const wantedSlug = slugifyHeading(subpath);
  const headingIndex = lines.findIndex((line) => {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return m ? slugifyHeading(m[2]) === wantedSlug : false;
  });
  if (headingIndex < 0) return "";
  const level = lines[headingIndex].match(/^(#{1,6})/)?.[1].length ?? 1;
  let end = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(headingIndex, end).join("\n").trim();
}
