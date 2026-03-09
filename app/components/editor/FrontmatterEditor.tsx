import { useState, useCallback, useRef } from "react";
import yaml from "js-yaml";
import {
  Type,
  Hash,
  CheckSquare,
  Calendar,
  CalendarClock,
  List,
  GripVertical,
  Plus,
  X,
  ChevronRight,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { ContextMenu, type ContextMenuItem } from "~/components/ide/ContextMenu";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PropertyType = "text" | "number" | "checkbox" | "date" | "datetime" | "list";

const YAML_DUMP_OPTS: yaml.DumpOptions = { lineWidth: -1, quotingType: "'", forceQuotes: false };

function isComplexValue(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === "object");
}

interface FrontmatterProperty {
  id: string;
  key: string;
  value: unknown;
  type: PropertyType;
}

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
  hasFrontmatter: boolean;
}

interface FrontmatterEditorProps {
  parsed: ParsedFrontmatter;
  onFrontmatterChange: (properties: FrontmatterProperty[]) => void;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const m = content.match(FM_RE);
  if (!m) return { frontmatter: {}, body: content, raw: "", hasFrontmatter: false };
  const raw = m[1];
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // If YAML is invalid, treat as no frontmatter
    return { frontmatter: {}, body: content, raw, hasFrontmatter: false };
  }
  const body = content.slice(m[0].length);
  return { frontmatter, body, raw, hasFrontmatter: true };
}

export function serializeFrontmatter(
  properties: FrontmatterProperty[],
  body: string
): string {
  if (properties.length === 0) return body;
  const obj: Record<string, unknown> = {};
  for (const prop of properties) {
    obj[prop.key] = convertValue(prop.value, prop.type);
  }
  const yamlStr = yaml.dump(obj, YAML_DUMP_OPTS);
  return `---\n${yamlStr}---\n${body}`;
}

function convertValue(value: unknown, type: PropertyType): unknown {
  switch (type) {
    case "checkbox":
      if (typeof value === "boolean") return value;
      return String(value).toLowerCase() === "true";
    case "number": {
      const n = Number(value);
      return isNaN(n) ? 0 : n;
    }
    case "list":
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === "string" && value.trim()) return [value];
      return [];
    case "date":
    case "datetime":
    case "text":
    default:
      if (isComplexValue(value)) return value;
      if (typeof value === "boolean") return String(value);
      return value == null ? "" : value;
  }
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function inferPropertyType(value: unknown): PropertyType {
  if (typeof value === "boolean") return "checkbox";
  // Arrays of primitives → list; arrays containing objects → text (YAML)
  if (Array.isArray(value)) {
    const hasObject = value.some(v => v !== null && typeof v === "object");
    return hasObject ? "text" : "list";
  }
  if (typeof value === "number") return "number";
  if (value instanceof Date) return "date";
  if (typeof value === "string") {
    if (DATETIME_RE.test(value)) return "datetime";
    if (DATE_RE.test(value)) return "date";
  }
  return "text";
}

let nextId = 0;
function genId(): string {
  return `fp_${++nextId}`;
}

function propertiesFromFrontmatter(fm: Record<string, unknown>): FrontmatterProperty[] {
  return Object.entries(fm).map(([key, value]) => ({
    id: genId(),
    key,
    value,
    type: inferPropertyType(value),
  }));
}

// ---------------------------------------------------------------------------
// Constants (module-level)
// ---------------------------------------------------------------------------

const TYPE_LABEL_KEYS: Record<PropertyType, keyof TranslationStrings> = {
  text: "frontmatter.text",
  number: "frontmatter.number",
  checkbox: "frontmatter.checkbox",
  date: "frontmatter.date",
  datetime: "frontmatter.dateTime",
  list: "frontmatter.list",
};

const TYPE_ICONS: Record<PropertyType, React.ReactNode> = {
  text: <Type size={ICON.SM} />,
  number: <Hash size={ICON.SM} />,
  checkbox: <CheckSquare size={ICON.SM} />,
  date: <Calendar size={ICON.SM} />,
  datetime: <CalendarClock size={ICON.SM} />,
  list: <List size={ICON.SM} />,
};

const ALL_TYPES: { type: PropertyType; labelKey: keyof TranslationStrings }[] = [
  { type: "text", labelKey: "frontmatter.text" },
  { type: "number", labelKey: "frontmatter.number" },
  { type: "checkbox", labelKey: "frontmatter.checkbox" },
  { type: "date", labelKey: "frontmatter.date" },
  { type: "datetime", labelKey: "frontmatter.dateTime" },
  { type: "list", labelKey: "frontmatter.list" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FrontmatterEditor({ parsed, onFrontmatterChange, readOnly }: FrontmatterEditorProps) {
  const { t } = useI18n();
  const [properties, setProperties] = useState<FrontmatterProperty[]>(() =>
    propertiesFromFrontmatter(parsed.frontmatter)
  );
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("frontmatter-collapsed") === "true"; } catch { return true; }
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    index: number;
  } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Keep properties in sync when content changes externally (e.g. Raw mode, pull).
  // Compare parsed.raw (the YAML text between ---) to detect actual frontmatter changes.
  // Skip re-sync when the change was initiated by this component (selfInitiated flag).
  const selfInitiatedRef = useRef(false);
  const prevRawRef = useRef(parsed.raw);
  if (parsed.raw !== prevRawRef.current) {
    prevRawRef.current = parsed.raw;
    if (!selfInitiatedRef.current) {
      setProperties(propertiesFromFrontmatter(parsed.frontmatter));
    }
    selfInitiatedRef.current = false;
  }

  const commit = useCallback(
    (props: FrontmatterProperty[]) => {
      selfInitiatedRef.current = true;
      setProperties(props);
      onFrontmatterChange(props);
    },
    [onFrontmatterChange]
  );

  // --- Value editing ---

  const updateValue = (index: number, newValue: unknown) => {
    const next = [...properties];
    next[index] = { ...next[index], value: newValue };
    commit(next);
  };

  const updateKey = (index: number, newKey: string) => {
    const next = [...properties];
    next[index] = { ...next[index], key: newKey };
    commit(next);
  };

  const removeProperty = (index: number) => {
    const next = properties.filter((_, i) => i !== index);
    commit(next);
  };

  const addProperty = () => {
    const next = [...properties, { id: genId(), key: "", value: "", type: "text" as PropertyType }];
    commit(next);
  };

  const changeType = (index: number, newType: PropertyType) => {
    const next = [...properties];
    const current = next[index];
    next[index] = { ...current, type: newType, value: convertValue(current.value, newType) };
    commit(next);
  };

  // --- Clipboard ---

  const cutProperty = (index: number) => {
    const prop = properties[index];
    navigator.clipboard.writeText(`${prop.key}: ${JSON.stringify(prop.value)}`);
    removeProperty(index);
  };

  const copyProperty = (index: number) => {
    const prop = properties[index];
    navigator.clipboard.writeText(`${prop.key}: ${JSON.stringify(prop.value)}`);
  };

  const pasteProperty = async (index: number) => {
    try {
      const text = await navigator.clipboard.readText();
      const colonIdx = text.indexOf(":");
      if (colonIdx > 0) {
        const key = text.slice(0, colonIdx).trim();
        let value: unknown;
        try {
          value = JSON.parse(text.slice(colonIdx + 1).trim());
        } catch {
          value = text.slice(colonIdx + 1).trim();
        }
        const type = inferPropertyType(value);
        const next = [...properties];
        next.splice(index + 1, 0, { id: genId(), key, value, type });
        commit(next);
      }
    } catch {
      // clipboard access denied
    }
  };

  // --- Drag & Drop ---

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex == null || dragIndex === toIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const next = [...properties];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(toIndex, 0, moved);
    setDragIndex(null);
    setDragOverIndex(null);
    commit(next);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // --- Context menu ---

  const handleContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, index });
  };

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? [
        {
          label: t("frontmatter.propertyType"),
          children: ALL_TYPES.map(({ type, labelKey }) => ({
            label: t(labelKey),
            icon: TYPE_ICONS[type],
            onClick: () => changeType(contextMenu.index, type),
          })),
        },
        {
          label: t("frontmatter.cut"),
          onClick: () => cutProperty(contextMenu.index),
        },
        {
          label: t("frontmatter.copy"),
          onClick: () => copyProperty(contextMenu.index),
        },
        {
          label: t("frontmatter.paste"),
          onClick: () => pasteProperty(contextMenu.index),
        },
        {
          label: t("frontmatter.remove"),
          danger: true,
          onClick: () => removeProperty(contextMenu.index),
        },
      ]
    : [];

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setCollapsed((v) => { const next = !v; try { localStorage.setItem("frontmatter-collapsed", String(next)); } catch { /* ignore */ } return next; })}
        className="flex items-center gap-1 mb-1 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
      >
        <ChevronRight
          size={ICON.SM}
          className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        {t("frontmatter.properties")}
      </button>
      {!collapsed && (
        <>
          <div className="space-y-1">
            {properties.map((prop, index) => (
              <div
                key={prop.id}
                className={`group flex items-center gap-2 rounded px-1 py-0.5 ${
                  dragOverIndex === index && dragIndex !== index
                    ? "border-t-2 border-blue-400"
                    : ""
                } ${dragIndex === index ? "opacity-40" : ""}`}
                draggable={!readOnly}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onContextMenu={(e) => !readOnly && handleContextMenu(e, index)}
              >
                {/* Drag handle + type icon */}
                <span
                  className="flex shrink-0 cursor-grab items-center text-gray-400 dark:text-gray-500"
                  title={t(TYPE_LABEL_KEYS[prop.type])}
                >
                  {readOnly ? (
                    TYPE_ICONS[prop.type]
                  ) : (
                    <GripVertical size={ICON.SM} className="mr-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                  {!readOnly && TYPE_ICONS[prop.type]}
                </span>

                {/* Key */}
                {readOnly ? (
                  <span className="min-w-[80px] shrink-0 text-xs font-medium text-gray-600 dark:text-gray-300">
                    {prop.key}
                  </span>
                ) : (
                  <input
                    type="text"
                    value={prop.key}
                    onChange={(e) => updateKey(index, e.target.value)}
                    className="min-w-[80px] max-w-[140px] shrink-0 border-b border-transparent bg-transparent text-xs font-medium text-gray-600 outline-none focus:border-blue-400 dark:text-gray-300"
                    placeholder="key"
                  />
                )}

                {/* Value editor */}
                <div className="flex-1 min-w-0">
                  <PropertyValueEditor
                    prop={prop}
                    readOnly={readOnly}
                    onChange={(val) => updateValue(index, val)}
                  />
                </div>
              </div>
            ))}
          </div>

          {!readOnly && (
            <button
              onClick={addProperty}
              className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <Plus size={ICON.SM} />
              {t("frontmatter.addProperty")}
            </button>
          )}
        </>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value editors per type
// ---------------------------------------------------------------------------

function PropertyValueEditor({
  prop,
  readOnly,
  onChange,
}: {
  prop: FrontmatterProperty;
  readOnly?: boolean;
  onChange: (value: unknown) => void;
}) {
  switch (prop.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(prop.value)}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 dark:border-gray-600"
        />
      );

    case "number":
      return readOnly ? (
        <span className="text-xs text-gray-700 dark:text-gray-300">{String(prop.value)}</span>
      ) : (
        <input
          type="number"
          value={prop.value == null ? "" : String(prop.value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full border-b border-transparent bg-transparent text-xs text-gray-700 outline-none focus:border-blue-400 dark:text-gray-300"
        />
      );

    case "date":
      return readOnly ? (
        <span className="text-xs text-gray-700 dark:text-gray-300">{String(prop.value ?? "")}</span>
      ) : (
        <input
          type="date"
          value={String(prop.value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="border-b border-transparent bg-transparent text-xs text-gray-700 outline-none focus:border-blue-400 dark:text-gray-300 dark:[color-scheme:dark]"
        />
      );

    case "datetime": {
      // Convert ISO / space-separated datetime to datetime-local format
      const raw = String(prop.value ?? "");
      const localVal = raw.replace(" ", "T").slice(0, 16);
      return readOnly ? (
        <span className="text-xs text-gray-700 dark:text-gray-300">{raw}</span>
      ) : (
        <input
          type="datetime-local"
          value={localVal}
          onChange={(e) => onChange(e.target.value)}
          className="border-b border-transparent bg-transparent text-xs text-gray-700 outline-none focus:border-blue-400 dark:text-gray-300 dark:[color-scheme:dark]"
        />
      );
    }

    case "list":
      return <ListEditor values={Array.isArray(prop.value) ? prop.value.map(String) : []} readOnly={readOnly} onChange={onChange} />;

    case "text":
    default: {
      // Complex values (arrays of objects, nested objects) → show as YAML
      const isComplex = isComplexValue(prop.value);
      const displayValue = isComplex
        ? yaml.dump(prop.value, YAML_DUMP_OPTS).trimEnd()
        : String(prop.value ?? "");
      return readOnly || isComplex ? (
        <span className={`text-xs truncate whitespace-pre-wrap ${readOnly ? "text-gray-700 dark:text-gray-300" : "text-gray-500 dark:text-gray-400"}`}>{displayValue}</span>
      ) : (
        <input
          type="text"
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border-b border-transparent bg-transparent text-xs text-gray-700 outline-none focus:border-blue-400 dark:text-gray-300"
        />
      );
    }
  }
}

// ---------------------------------------------------------------------------
// List (tag) editor
// ---------------------------------------------------------------------------

function ListEditor({
  values,
  readOnly,
  onChange,
}: {
  values: string[];
  readOnly?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setInput("");
  };

  const removeTag = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {values.map((tag, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
        >
          {tag}
          {!readOnly && (
            <button
              onClick={() => removeTag(i)}
              className="ml-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
            if (e.key === "Backspace" && input === "" && values.length > 0) {
              removeTag(values.length - 1);
            }
          }}
          onBlur={addTag}
          placeholder="+"
          className="w-16 min-w-[2rem] border-b border-transparent bg-transparent text-xs text-gray-700 outline-none focus:border-blue-400 dark:text-gray-300"
        />
      )}
    </div>
  );
}
