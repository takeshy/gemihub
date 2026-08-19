/** Infer a reasonable MIME type from the file name extension. */
export function mimeTypeFromFileName(fileName: string): string {
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx < 0) return "text/plain";
  const ext = fileName.slice(dotIdx + 1).toLowerCase();
  const map: Record<string, string> = {
    md: "text/markdown", txt: "text/plain",
    json: "application/json", canvas: "application/json",
    yaml: "text/yaml", yml: "text/yaml",
    js: "application/javascript", ts: "application/typescript",
    css: "text/css", html: "text/html", xml: "text/xml",
    csv: "text/csv",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    pdf: "application/pdf",
    mp3: "audio/mpeg", wav: "audio/wav",
    mp4: "video/mp4", webm: "video/webm",
  };
  return map[ext] || "text/plain";
}
