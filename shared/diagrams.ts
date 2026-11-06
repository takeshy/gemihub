/** Quote arbitrary business labels as Mermaid strings without allowing syntax injection. */
export const diagramLabel = (text: string) => `"${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\r\n\u2028\u2029]/g, " ")}"`;
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Decode labels as plain text; React still escapes the resulting text when displaying a legend. */
export const diagramPlainText = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (match, code: string) => {
  if (!code.startsWith("#")) return entities[code.toLowerCase()] || match;
  const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
});
const seriesColors = ["#367d65", "#6398ca", "#d5a358", "#ac7ca4", "#74a5a8", "#ba7356", "#8d91bd", "#a2a15d"];
export const chartSeriesColor = (index: number) => seriesColors[index % seriesColors.length];
export function xyChart(title: string, labels: string[], series: number[][], kind: "bar" | "line" = "bar", axis = "", seriesNames: readonly string[] = []) {
  if (!labels.length) return "";
  const maximum = Math.max(1, ...series.flat());
  return [`xychart-beta`, `title ${diagramLabel(title)}`, `x-axis [${labels.map(diagramLabel).join(", ")}]`, `y-axis ${diagramLabel(axis)} 0 --> ${Math.ceil(maximum * 1.1)}`, ...series.map((values, index) => `${kind} ${seriesNames[index] ? `${diagramLabel(seriesNames[index])} ` : ""}[${values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0).join(", ")}]`)].join("\n");
}
