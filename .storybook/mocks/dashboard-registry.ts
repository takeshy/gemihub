import type { WidgetDef } from "../../app/dashboard/types";

const registry = new Map<string, WidgetDef>();

export function registerWidget(definition: WidgetDef): void {
  registry.set(definition.type, definition);
}

export function getWidgetDef(type: string): WidgetDef {
  return registry.get(type) ?? {
    type,
    label: type,
    defaultConfig: {},
    render: () => null,
  };
}

export function listWidgetDefs(): WidgetDef[] {
  return [...registry.values()];
}

export function isKnownWidgetType(type: string): boolean {
  return registry.has(type);
}
