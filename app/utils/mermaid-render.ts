/** Render Mermaid syntax with Pele. Each call is independent of other diagrams. */
export interface MermaidRenderOptions {
  chart: string;
  /** Omit to follow the application theme through CSS (used by WYSIWYG). */
  isDark?: boolean;
  useMaxWidth?: boolean;
}

export interface MermaidRenderResult {
  svg: string;
}

let renderId = 0;

export async function renderMermaid(
  options: MermaidRenderOptions,
  isCancelled: () => boolean = () => false,
): Promise<MermaidRenderResult | null> {
  if (isCancelled() || !options.chart.trim()) return null;
  const { renderAsync } = await import("pele/lazy");
  if (isCancelled()) return null;
  const { svg } = await renderAsync(options.chart, {
    idPrefix: `pele-diagram-${++renderId}-`,
    responsive: options.useMaxWidth ?? true,
    autoDirection: false,
    links: false,
  });
  if (isCancelled()) return null;
  const theme = options.isDark === undefined ? "auto" : options.isDark ? "dark" : "light";
  return { svg: svg.replace("<svg ", `<svg data-pele-theme="${theme}" `) };
}
