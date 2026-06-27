// Cards view — renders rows as cards with structured field mapping (P2 spec §8).
// No free-form template strings; only field-to-property assignment.

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "~/i18n/context";
import { findFileByNameLocal } from "~/services/drive-local";
import type { DataRow, CardMapping, PropertyType } from "./types";
import { getCellValue, formatCell } from "./filter";

interface CardsViewProps {
  rows: DataRow[];
  card: CardMapping;
  cols?: number;
  /** Enables card click to open the underlying file. Folder cards carry a
   *  runtime fileId; workflow cards can carry a path / file.path cell. */
  clickable: boolean;
  /** Field type map for locale-aware formatting (e.g. dates). */
  fieldTypes?: Record<string, PropertyType>;
  /** Hide scrollbars while keeping the card grid scrollable. */
  hideScrollbar?: boolean;
}

/**
 * Extract the target path from an Obsidian internal embed/link
 * (`![[path]]` or `[[path]]`), dropping any `|alias` or `#subpath`.
 * Returns null when the value isn't a wiki embed/link.
 */
function extractWikiEmbed(value: string): string | null {
  const m = value.trim().match(/^!?\[\[([^\]]+)\]\]$/);
  if (!m) return null;
  return m[1].split("|")[0].split("#")[0].trim() || null;
}

/**
 * Resolve a single image value to a displayable URL.
 * - Data URI (data:image/...;base64,...) → use directly (IndexedDB image format)
 * - Full URL (http/https) → use directly
 * - Drive file ID (alphanumeric with dashes, 20+ chars) → /api/drive/files?action=raw
 * - Drive path (contains / or has a file extension) → resolve via findFileByNameLocal
 * - Obsidian embed `![[path]]` / `[[path]]` → resolve the inner path
 * - Otherwise → null (no image)
 *
 * Returns "pending" while a path is being resolved to a fileId.
 */
function resolveStaticUrl(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Inline base64 image (how images are stored in the IndexedDB cache).
  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Drive file ID (alphanumeric with dashes/underscores, typically 25-40 chars)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return `/api/drive/files?action=raw&fileId=${encodeURIComponent(trimmed)}`;
  }

  // Drive path — needs async resolution via findFileByNameLocal
  return null;
}

/**
 * Check if a value looks like a Drive path that needs async resolution.
 * A path contains a slash or has a file extension (e.g. "projects/cover.png", "cover.png").
 */
function looksLikeDrivePath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("data:image/")) return false; // inline base64 image
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return false;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return false; // file ID
  return trimmed.includes("/") || /\.\w{2,5}$/.test(trimmed);
}

/**
 * Hook that resolves Drive paths to fileIds for all card images in one pass.
 * Returns a map from row.id → resolved URL (or null).
 * URLs that can be resolved synchronously (http/https, file IDs) are available immediately.
 */
function useResolvedImageUrls(
  rows: DataRow[],
  imageKey: string | undefined,
): Record<string, string | null> {
  const [resolvedPaths, setResolvedPaths] = useState<Record<string, string | null>>({});

  // Identify rows whose image value is a Drive path needing async resolution
  const pathJobs = useMemo(() => {
    if (!imageKey) return [] as Array<{ rowId: string; path: string }>;
    return rows
      .map((row) => {
        const value = getCellValue(row, imageKey);
        // Obsidian embed/link → resolve its inner path; else a plain Drive path.
        const embed = typeof value === "string" ? extractWikiEmbed(value) : null;
        const path = embed ?? (looksLikeDrivePath(value) ? String(value).trim() : null);
        if (!path) return null;
        return { rowId: row.id, path };
      })
      .filter((j): j is { rowId: string; path: string } => j !== null);
  }, [rows, imageKey]);

  useEffect(() => {
    if (pathJobs.length === 0) {
      setResolvedPaths({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries: Array<[string, string | null]> = [];
      for (const { rowId, path } of pathJobs) {
        const found = await findFileByNameLocal(path);
        entries.push([
          rowId,
          found ? `/api/drive/files?action=raw&fileId=${encodeURIComponent(found.id)}` : null,
        ]);
      }
      if (!cancelled) {
        setResolvedPaths(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathJobs]);

  return resolvedPaths;
}

export function CardsView({ rows, card, cols, clickable, fieldTypes, hideScrollbar = false }: CardsViewProps) {
  const { t, language } = useI18n();

  const resolvedPaths = useResolvedImageUrls(rows, card.image);

  // Track container width so narrow viewports collapse to a single column (§8).
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.noFiles")}
      </div>
    );
  }

  const configuredCols = cols && cols > 0 ? cols : 3;
  // Mobile / very narrow widgets: 1 column. Otherwise honor the configured count.
  const gridCols =
    containerWidth != null && containerWidth < 360 ? 1 : configuredCols;

  const resolveRowFileRef = (row: DataRow): { fileId?: string; fileName?: string; path?: string } => {
    // Folder source: row.fileId is set directly.
    // Workflow source: look for common file-reference keys in the row.
    const fileId =
      row.fileId ??
      (typeof row.cells.fileId === "string" ? row.cells.fileId : undefined) ??
      (typeof row.cells["file.fileId"] === "string"
        ? row.cells["file.fileId"]
        : undefined);
    const fileName =
      row.fileName ??
      (typeof row.cells.fileName === "string" ? row.cells.fileName : undefined) ??
      (typeof row.cells["file.name"] === "string"
        ? row.cells["file.name"]
        : undefined);
    const path =
      row.fileName ??
      (typeof row.cells.path === "string" ? row.cells.path : undefined) ??
      (typeof row.cells["file.path"] === "string" ? row.cells["file.path"] : undefined) ??
      fileName;
    return { fileId, fileName, path };
  };

  const handleCardClick = async (row: DataRow) => {
    if (!clickable) return;
    const ref = resolveRowFileRef(row);
    let { fileId, fileName } = ref;
    const { path } = ref;
    if (!fileId && path) {
      const found = await findFileByNameLocal(path);
      fileId = found?.id;
      fileName = found?.name ?? fileName ?? path;
    }
    if (!fileId) return;
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId, fileName },
      }),
    );
  };

  return (
    <div
      ref={containerRef}
      className={`h-full overflow-auto p-2 ${hideScrollbar ? "scrollbar-hide" : ""}`}
      style={{ display: "grid", gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gap: "8px", alignContent: "start" }}
    >
      {rows.map((row) => {
        // Fall back to the file name when no title is mapped (or the mapped
        // value is empty) so a freshly added card is never fully blank.
        const mappedTitle = card.title ? getCellValue(row, card.title) : undefined;
        const title =
          mappedTitle != null && mappedTitle !== "" ? mappedTitle : row.fileName;
        const subtitle = card.subtitle
          ? getCellValue(row, card.subtitle)
          : undefined;
        const image = card.image ? getCellValue(row, card.image) : undefined;
        const body = card.body ? getCellValue(row, card.body) : undefined;
        const badges = card.badges ?? [];

        const hasImage = image != null && image !== "";
        const imageUrl = hasImage
          ? (resolveStaticUrl(image) ?? resolvedPaths[row.id] ?? null)
          : null;
        const { fileId: rowFileId, path: rowPath } = resolveRowFileRef(row);
        const isClickable = clickable && (rowFileId != null || rowPath != null);

        return (
          <div
            key={row.id}
            onClick={() => handleCardClick(row)}
            className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden flex flex-col ${
              isClickable
                ? "cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all"
                : ""
            }`}
          >
            {hasImage && imageUrl && (
              <div className="w-full h-24 bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0">
                <img
                  src={imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
            {hasImage && !imageUrl && (
              <div className="w-full h-24 bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                <span className="text-xs text-gray-400">{t("dashboard.noImage")}</span>
              </div>
            )}
            <div className="p-2 flex-1 min-h-0 overflow-hidden">
              {title != null && (
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                  {formatCell(title, fieldTypes?.[card.title ?? ""], language)}
                </div>
              )}
              {subtitle != null && (
                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {formatCell(subtitle, fieldTypes?.[card.subtitle ?? ""], language)}
                </div>
              )}
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {badges.map((badge) => {
                    const val = getCellValue(row, badge);
                    if (val == null || val === "") return null;
                    return (
                      <span
                        key={badge}
                        className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300 truncate max-w-full"
                      >
                        {formatCell(val, fieldTypes?.[badge], language)}
                      </span>
                    );
                  })}
                </div>
              )}
              {body != null && (
                <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-1 line-clamp-3 overflow-hidden">
                  {formatCell(body, fieldTypes?.[card.body ?? ""], language)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
