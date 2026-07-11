import type { Widget } from "./types";

/**
 * Whether a widget has its primary selection set. A newly-added widget that
 * still lacks this selection is discarded when its settings panel closes.
 */
export function isWidgetConfigured(widget: Widget): boolean {
  const c = widget.config ?? {};
  const str = (key: string): string => {
    const value = c[key];
    return typeof value === "string" ? value.trim() : "";
  };

  switch (widget.type) {
    case "file":
    case "markdown":
      return str("path").length > 0;
    case "timeline":
      return str("name").length > 0 || str("path").length > 0;
    case "web":
      return str("url").length > 0;
    case "workflow":
      return str("workflow").length > 0;
    case "file-list":
    case "card":
    case "table":
      return true;
    case "kanban":
      // Current kanbans reference a .kanban definition file. Keep accepting
      // the old inline shape until all existing dashboards are converted.
      return str("kanban").length > 0
        || (str("folder").length > 0 && str("title").length > 0);
    default:
      return true;
  }
}
