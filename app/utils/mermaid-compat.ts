// wysimark-lite still imports Mermaid's initialize/render API. Vite routes
// that import here so WYSIWYG diagrams use the same Pele renderer as previews.
import { renderMermaid } from "./mermaid-render";

export default {
  initialize(_config: unknown): void {
    // Pele has no global initialization or mutable theme configuration.
    void _config;
  },
  async render(_id: string, chart: string): Promise<{ svg: string }> {
    return await renderMermaid({ chart }) ?? { svg: "" };
  },
};
