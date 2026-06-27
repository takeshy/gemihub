import { writeFileLocal } from "~/services/drive-local";
import type { FilterCondition } from "./data-widget/types";
import type { Widget } from "./types";

type LegacyFolderWidgetType = "card" | "table" | "file-list";

interface LegacyFolderConfig {
  folder?: string;
  filter?: FilterCondition[];
  sort?: string;
  limit?: number;
  columns?: string[];
  card?: {
    subtitle?: string;
    image?: string;
    body?: string;
    badges?: string[];
  };
}

export function isLegacyFolderWidget(type: string): type is LegacyFolderWidgetType {
  return type === "card" || type === "table" || type === "file-list";
}

export async function convertLegacyFolderWidgetToBase(
  widget: Widget,
): Promise<{ type: "base"; config: Record<string, unknown> } | null> {
  if (!isLegacyFolderWidget(widget.type)) return null;
  const basePath = `Dashboards/Bases/${widget.type}-${widget.id.slice(0, 8)}.base`;
  const content = buildBaseYaml(widget.type, widget.config as LegacyFolderConfig);
  await writeFileLocal(basePath, content);
  return { type: "base", config: { base: basePath, view: "" } };
}

function buildBaseYaml(type: LegacyFolderWidgetType, cfg: LegacyFolderConfig): string {
  const viewType = type === "card" ? "cards" : type === "file-list" ? "list" : "table";
  const viewName = type === "card" ? "Cards" : type === "file-list" ? "List" : "Table";
  const filters = [
    cfg.folder ? `file.inFolder(${JSON.stringify(cfg.folder)})` : null,
    ...(cfg.filter ?? []).map(filterToExpression),
  ].filter((filter): filter is string => !!filter);
  const sort = sortToBase(cfg.sort);
  const order = orderFor(type, cfg);

  const lines = ["views:", `  - type: ${viewType}`, `    name: ${viewName}`];
  if (filters.length === 1) {
    lines.push(`    filters: ${filters[0]}`);
  } else if (filters.length > 1) {
    lines.push("    filters:", "      and:", ...filters.map((filter) => `        - ${filter}`));
  }
  if (order.length > 0) {
    lines.push("    order:", ...order.map((property) => `      - ${property}`));
  }
  if (sort) {
    lines.push("    sort:", `      - property: ${sort.property}`, `        direction: ${sort.direction}`);
  }
  if (cfg.limit && cfg.limit > 0) {
    lines.push(`    limit: ${cfg.limit}`);
  }
  if (type === "card" && cfg.card?.image) {
    lines.push(`    image: ${toBaseProperty(cfg.card.image)}`);
  }
  return `${lines.join("\n")}\n`;
}

function orderFor(type: LegacyFolderWidgetType, cfg: LegacyFolderConfig): string[] {
  if (type === "table") {
    return (cfg.columns ?? ["file.name", "status"]).map(toBaseProperty);
  }
  if (type === "file-list") {
    return ["file.name", "file.mtime"];
  }
  const card = cfg.card ?? {};
  return [
    "file.name",
    card.subtitle,
    card.body,
    ...(card.badges ?? []),
  ].filter((property): property is string => !!property).map(toBaseProperty);
}

function toBaseProperty(property: string): string {
  if (property === "name") return "file.name";
  if (property === "mtime") return "file.mtime";
  if (property === "ctime") return "file.ctime";
  return property;
}

function sortToBase(sort: string | undefined): { property: string; direction: "ASC" | "DESC" } | null {
  if (!sort) return null;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  return { property: toBaseProperty(key), direction: desc ? "DESC" : "ASC" };
}

function filterToExpression(filter: FilterCondition): string | null {
  const property = toBaseProperty(filter.property);
  switch (filter.op) {
    case "empty":
      return `${property} == null`;
    case "notEmpty":
      return `${property} != null`;
    case "isTrue":
      return `${property} == true`;
    case "isFalse":
      return `${property} == false`;
    case "eq":
      return `${property} == ${valueExpression(filter.value)}`;
    case "neq":
      return `${property} != ${valueExpression(filter.value)}`;
    case "contains":
      return `${property}.contains(${valueExpression(filter.value)})`;
    case "notContains":
      return `!${property}.contains(${valueExpression(filter.value)})`;
    case "gt":
      return `${property} > ${valueExpression(filter.value)}`;
    case "lt":
      return `${property} < ${valueExpression(filter.value)}`;
    case "gte":
      return `${property} >= ${valueExpression(filter.value)}`;
    case "lte":
      return `${property} <= ${valueExpression(filter.value)}`;
    case "before":
      return `${property} < date(${valueExpression(filter.value)})`;
    case "after":
      return `${property} > date(${valueExpression(filter.value)})`;
    default:
      return null;
  }
}

function valueExpression(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value == null) return "null";
  return JSON.stringify(String(value));
}
