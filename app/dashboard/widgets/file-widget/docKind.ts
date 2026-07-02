// Document kind detection for the File widget (ported from mdwys).

export type DocKind = "markdown" | "text" | "html" | "epub" | "pdf" | "image";

const IMAGE_RE = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;

export function docKindFor(fileName: string): DocKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".pdf")) return "pdf";
  if (IMAGE_RE.test(lower)) return "image";
  return "text";
}

/** Files the File widget's picker offers (kinds it can meaningfully render). */
export function isFileWidgetFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".html") ||
    lower.endsWith(".htm") ||
    lower.endsWith(".epub") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".txt") ||
    IMAGE_RE.test(lower)
  );
}
