import type { BaseEntry, QueryResult, Value, ViewConfig } from "~/bases/types";
import { valueToString } from "~/bases/values";

export interface BaseEntryFileRef {
  fileId: string;
  fileName: string;
}

interface BaseViewRendererProps {
  view: ViewConfig;
  result: QueryResult;
  resolveFileRef?: (entry: BaseEntry) => BaseEntryFileRef | null;
  onOpenFile?: (file: BaseEntryFileRef) => void;
  /** Resolve a vault file name/path/wikilink target to a fetchable asset URL (e.g. card cover images). */
  resolveAssetUrl?: (target: string) => string | null;
}

export function BaseViewRenderer({ view, result, resolveFileRef, onOpenFile, resolveAssetUrl }: BaseViewRendererProps) {
  const interaction = { resolveFileRef, onOpenFile, resolveAssetUrl };
  if (view.type === "cards") return <CardsView view={view} result={result} interaction={interaction} />;
  if (view.type === "list") return <ListView view={view} result={result} interaction={interaction} />;
  return <TableView view={view} result={result} interaction={interaction} />;
}

interface EntryInteraction {
  resolveFileRef?: (entry: BaseEntry) => BaseEntryFileRef | null;
  onOpenFile?: (file: BaseEntryFileRef) => void;
  resolveAssetUrl?: (target: string) => string | null;
}

function TableView({ view, result, interaction }: { view: ViewConfig; result: QueryResult; interaction: EntryInteraction }) {
  const columns = getColumns(result);

  if (result.groupedData.length > 0) {
    return (
      <div className="space-y-3">
        {result.groupedData.map((group, gi) => (
          <section key={gi}>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              <span>{valueToString(group.key)}</span>
              <span className="text-gray-400">({group.entries.length})</span>
            </div>
            {group.summaries.size > 0 && (
              <SummaryStrip summaries={group.summaries} />
            )}
            <BaseTable
              view={view}
              entries={group.entries}
              columns={columns}
              summaries={view.summaries}
              getSummaryValue={result.getSummaryValue}
              interaction={interaction}
            />
          </section>
        ))}
      </div>
    );
  }

  return (
    <BaseTable
      view={view}
      entries={result.data}
      columns={columns}
      summaries={view.summaries}
      getSummaryValue={result.getSummaryValue}
      interaction={interaction}
    />
  );
}

function BaseTable({
  view,
  entries,
  columns,
  summaries,
  getSummaryValue,
  interaction,
}: {
  view: ViewConfig;
  entries: BaseEntry[];
  columns: string[];
  summaries?: Record<string, string>;
  getSummaryValue: QueryResult["getSummaryValue"];
  interaction: EntryInteraction;
}) {
  if (entries.length === 0) {
    return <div className="p-4 text-center text-sm text-gray-400">No results</div>;
  }

  const rowClass = tableRowClass(view.rowHeight);
  const summaryEntries = summaries ? Object.entries(summaries) : [];

  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
        <tr>
          {columns.map((col) => (
            <th
              key={col}
              className="truncate border-b border-gray-200 px-2 py-1 text-left text-xs font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400"
            >
              {formatPropertyLabel(col)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => {
          const fileRef = interaction.resolveFileRef?.(entry) ?? null;
          const clickable = !!fileRef && !!interaction.onOpenFile;
          return (
            <tr
              key={entry.file.path + i}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => interaction.onOpenFile?.(fileRef) : undefined}
              onKeyDown={clickable ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  interaction.onOpenFile?.(fileRef);
                }
              } : undefined}
              className={`border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 ${clickable ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500" : ""}`}
            >
              {columns.map((col) => (
                <td key={col} className={`max-w-64 truncate border-b border-gray-100 px-2 text-gray-700 dark:border-gray-800 dark:text-gray-300 ${rowClass}`}>
                  {renderCellValue(getEntryProperty(entry, col))}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      {summaryEntries.length > 0 && (
        <tfoot className="sticky bottom-0 bg-gray-50 dark:bg-gray-800">
          <tr>
            {columns.map((col) => {
              const summaryName = summaries?.[col];
              const summaryValue = summaryName ? getSummaryValue(entries, col, summaryName) : null;
              return (
                <td
                  key={col}
                  className="border-t border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300"
                >
                  {summaryName && summaryValue && (
                    <span className="truncate">
                      <span className="text-gray-400">{summaryName}: </span>
                      {renderCellValue(summaryValue)}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function SummaryStrip({ summaries }: { summaries: Map<string, Value> }) {
  return (
    <div className="mb-1 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
      {[...summaries.entries()].map(([prop, val]) => (
        <span key={prop} className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
          {formatPropertyLabel(prop)}: {renderCellValue(val)}
        </span>
      ))}
    </div>
  );
}

function tableRowClass(rowHeight: unknown): string {
  const value = typeof rowHeight === "string" ? rowHeight.toLowerCase() : "medium";
  if (["low", "small", "compact"].includes(value)) return "py-0.5";
  if (["high", "large", "tall"].includes(value)) return "py-2 align-top";
  if (["extra-high", "extrahigh", "extra-large", "xlarge", "xl"].includes(value)) return "py-3 align-top whitespace-normal";
  return "py-1";
}

function CardsView({ view, result, interaction }: { view: ViewConfig; result: QueryResult; interaction: EntryInteraction }) {
  const cardSize = typeof view.cardSize === "string" ? view.cardSize : "medium";
  const imageProp = getStringOption(view, "image", "imageProperty");
  const imageFit = getStringOption(view, "imageFit") ?? "cover";
  const aspectRatio = cardAspectRatio(view.imageAspectRatio);
  const cols = cardSize === "small"
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
    : cardSize === "large"
      ? "grid-cols-1 sm:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  const groups = result.groupedData.length > 0
    ? result.groupedData.map((g) => ({ key: g.key, entries: g.entries }))
    : [{ key: null, entries: result.data }];

  if (groups.every((g) => g.entries.length === 0)) {
    return <div className="p-4 text-center text-sm text-gray-400">No results</div>;
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => (
        <section key={gi}>
          {group.key && (
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              <span>{valueToString(group.key)}</span>
              <span className="text-gray-400">({group.entries.length})</span>
            </div>
          )}
          <div className={`grid gap-3 ${cols}`}>
            {group.entries.map((entry, i) => (
              <BaseCard
                key={entry.file.path + i}
                entry={entry}
                result={result}
                imageProp={imageProp}
                imageFit={imageFit}
                aspectRatio={aspectRatio}
                interaction={interaction}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BaseCard({
  entry,
  result,
  imageProp,
  imageFit,
  aspectRatio,
  interaction,
}: {
  entry: BaseEntry;
  result: QueryResult;
  imageProp?: string;
  imageFit: string;
  aspectRatio: string;
  interaction: EntryInteraction;
}) {
  const title = valueToString(getEntryProperty(entry, "file.name"));
  const cover = imageProp ? getEntryProperty(entry, imageProp) : null;
  const coverSrc = cover ? resolveCoverSrc(cover, interaction.resolveAssetUrl) : null;
  const props = result.properties.filter((p) => p !== "file.name").slice(0, 5);
  const fileRef = interaction.resolveFileRef?.(entry) ?? null;
  const clickable = !!fileRef && !!interaction.onOpenFile;

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? () => interaction.onOpenFile?.(fileRef) : undefined}
      className={`block w-full overflow-hidden rounded border border-gray-200 bg-white text-left shadow-sm dark:border-gray-700 dark:bg-gray-800 ${clickable ? "cursor-pointer hover:border-blue-300 hover:shadow dark:hover:border-blue-700" : "cursor-default"}`}
    >
      {coverSrc && (
        <div className="w-full overflow-hidden bg-gray-100 dark:bg-gray-700" style={{ aspectRatio }}>
          {coverSrc.type === "color" ? (
            <div className="h-full w-full" style={{ backgroundColor: coverSrc.value }} />
          ) : (
            <img
              src={coverSrc.value}
              alt={title}
              className={`h-full w-full ${imageFit === "contain" ? "object-contain" : "object-cover"}`}
              draggable={false}
            />
          )}
        </div>
      )}
      <div className="p-2">
        <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
        <dl className="mt-1 space-y-0.5">
          {props.map((prop) => {
            const val = getEntryProperty(entry, prop);
            if (val.type === "null") return null;
            return (
              <div key={prop} className="flex min-w-0 gap-1 text-xs">
                <dt className="shrink-0 text-gray-400">{formatPropertyLabel(prop)}:</dt>
                <dd className="truncate text-gray-700 dark:text-gray-300">{renderCellValue(val)}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </button>
  );
}

function cardAspectRatio(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(value);
  if (typeof value !== "string" || value.trim() === "") return "1 / 1";
  const trimmed = value.trim();
  const colon = trimmed.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (colon) return `${colon[1]} / ${colon[2]}`;
  if (/^\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/.test(trimmed)) return trimmed;
  return "1 / 1";
}

function ListView({ view, result, interaction }: { view: ViewConfig; result: QueryResult; interaction: EntryInteraction }) {
  const markers = (getStringOption(view, "markers", "marker") ?? "bullets").toLowerCase();
  const indentProps = view.indentProperties !== undefined ? Boolean(view.indentProperties) : false;
  const separator = getStringOption(view, "separator") ?? ", ";

  const renderGroup = (entries: BaseEntry[], key?: Value) => (
    <div>
      {key !== undefined && (
        <div className="mb-1 text-sm font-medium text-gray-600 dark:text-gray-300">
          {valueToString(key)} <span className="text-gray-400">({entries.length})</span>
        </div>
      )}
      <ul className="space-y-1">
        {entries.map((entry, i) => (
          <BaseListItem
            key={entry.file.path + i}
            entry={entry}
            index={i}
            properties={result.properties}
            markers={markers}
            indentProps={indentProps}
            separator={separator}
            interaction={interaction}
          />
        ))}
      </ul>
    </div>
  );

  if (result.groupedData.length > 0) {
    return <div className="space-y-3">{result.groupedData.map((g, gi) => <section key={gi}>{renderGroup(g.entries, g.key)}</section>)}</div>;
  }
  return renderGroup(result.data);
}

function BaseListItem({
  entry,
  index,
  properties,
  markers,
  indentProps,
  separator,
  interaction,
}: {
  entry: BaseEntry;
  index: number;
  properties: string[];
  markers: string;
  indentProps: boolean;
  separator: string;
  interaction: EntryInteraction;
}) {
  const title = valueToString(getEntryProperty(entry, "file.name"));
  const props = properties.filter((p) => p !== "file.name");
  const marker = renderMarker(markers, index);
  const fileRef = interaction.resolveFileRef?.(entry) ?? null;
  const clickable = !!fileRef && !!interaction.onOpenFile;
  const openFile = clickable ? () => interaction.onOpenFile?.(fileRef) : undefined;

  if (indentProps) {
    return (
      <li className="text-sm text-gray-700 dark:text-gray-300">
        <button
          type="button"
          disabled={!clickable}
          onClick={openFile}
          className={`rounded text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${clickable ? "cursor-pointer hover:text-blue-700 dark:hover:text-blue-300" : "cursor-default"}`}
        >
          <span className="inline-flex min-w-5 text-gray-400">{marker}</span>
          <span>{title}</span>
        </button>
        <ul className="ml-7 mt-1 space-y-0.5">
          {props.map((prop) => {
            const val = getEntryProperty(entry, prop);
            if (val.type === "null") return null;
            return (
              <li key={prop} className="text-xs text-gray-500 dark:text-gray-400">
                <span className="text-gray-400">-</span> {formatPropertyLabel(prop)}: {renderCellValue(val)}
              </li>
            );
          })}
        </ul>
      </li>
    );
  }

  const propParts = props
    .map((prop) => renderCellValue(getEntryProperty(entry, prop)))
    .filter((s) => s.length > 0)
    .join(separator);

  return (
    <li className="text-sm text-gray-700 dark:text-gray-300">
      <button
        type="button"
        disabled={!clickable}
        onClick={openFile}
        className={`rounded text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${clickable ? "cursor-pointer hover:text-blue-700 dark:hover:text-blue-300" : "cursor-default"}`}
      >
        {marker && <span className="inline-flex min-w-5 text-gray-400">{marker}</span>}
        <span>{title}</span>
        {propParts && <span className="text-gray-400"> {propParts}</span>}
      </button>
    </li>
  );
}

function renderMarker(markers: string, index: number): string {
  if (["numbers", "numbered", "ordered"].includes(markers)) return `${index + 1}.`;
  if (["none", "hidden"].includes(markers)) return "";
  return "-";
}

function getColumns(result: QueryResult): string[] {
  return result.properties.length > 0
    ? result.properties
    : result.data.length > 0
      ? [...result.data[0].rowScope.note.map.keys()].map((k) => `note.${k}`)
      : ["file.name"];
}

function getStringOption(view: ViewConfig, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = view[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function getEntryProperty(entry: BaseEntry, propertyId: string): Value {
  const dotIdx = propertyId.indexOf(".");
  if (dotIdx < 0) {
    return entry.rowScope.note.map.get(propertyId) ?? { type: "null" };
  }
  const prefix = propertyId.substring(0, dotIdx);
  const name = propertyId.substring(dotIdx + 1);

  if (prefix === "note") {
    return entry.rowScope.note.map.get(name) ?? { type: "null" };
  }
  if (prefix === "file") {
    return resolveFileField(name, entry);
  }
  if (prefix === "formula") {
    return entry.rowScope.formula.resolve(name) ?? { type: "null" };
  }
  return { type: "null" };
}

function resolveFileField(field: string, entry: BaseEntry): Value {
  const file = entry.rowScope.file;
  switch (field) {
    case "name": return { type: "string", value: file.name };
    case "basename": return { type: "string", value: file.basename };
    case "path": return { type: "string", value: file.path };
    case "folder": return { type: "string", value: file.folder };
    case "ext": return { type: "string", value: file.ext };
    case "size": return { type: "number", value: file.size };
    case "ctime": return { type: "date", epochMs: file.ctimeMs, dateOnly: false };
    case "mtime": return { type: "date", epochMs: file.mtimeMs, dateOnly: false };
    default: return { type: "null" };
  }
}

function formatPropertyLabel(propId: string): string {
  const dotIdx = propId.indexOf(".");
  if (dotIdx < 0) return propId;
  const prefix = propId.substring(0, dotIdx);
  const name = propId.substring(dotIdx + 1);
  if (prefix === "note" || prefix === "file" || prefix === "formula") {
    return name;
  }
  return propId;
}

function renderCellValue(value: Value): string {
  if (value.type === "null") return "";
  if (value.type === "error") return "";
  if (value.type === "list") return value.items.map(renderCellValue).join(", ");
  if (value.type === "object") return "";
  return valueToString(value);
}

function resolveCoverSrc(
  value: Value,
  resolveAssetUrl?: (target: string) => string | null,
): { type: "image" | "color"; value: string } | null {
  // Resolve a vault file name / path / wikilink target to a fetchable URL.
  const fromTarget = (raw: string): { type: "image"; value: string } | null => {
    const target = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
    if (!target) return null;
    if (/^https?:\/\//i.test(target) || target.startsWith("data:")) return { type: "image", value: target };
    const url = resolveAssetUrl?.(target);
    return url ? { type: "image", value: url } : null;
  };
  if (value.type === "string") {
    const v = value.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return { type: "color", value: v };
    if (/^https?:\/\//i.test(v) || v.startsWith("data:image/")) return { type: "image", value: v };
    return fromTarget(v);
  }
  if (value.type === "url") return { type: "image", value: value.url };
  if (value.type === "image") return fromTarget(value.resolvedPath ?? value.source);
  if (value.type === "link") return fromTarget(value.resolvedPath ?? value.target);
  if (value.type === "file") return fromTarget(value.path);
  return null;
}
