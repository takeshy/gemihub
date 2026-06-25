// .dashboard YAML file load/save with unknown key preservation.
// The loaded object is never reconstructed — updates are merged in-place
// so that unknown keys (plugin widgets, future extensions) survive round-trips.

import yaml from "js-yaml";
import {
  getAllCachedFiles,
  getCachedRemoteMeta,
} from "~/services/indexeddb-cache";
import { readFileLocal, writeFileLocal, renameFileLocal, deleteFileLocal } from "~/services/drive-local";
import {
  type DashboardData,
  type LayoutPos,
  type Breakpoint,
  DEFAULT_GRID,
  DASHBOARD_FILE_NAME,
  DASHBOARD_FOLDER,
  DASHBOARD_EXT,
} from "./types";

const YAML_DUMP_OPTS = { lineWidth: -1, noRefs: true };

export interface DashboardFileEntry {
  fileId: string;
  fileName: string;
  /** Display name (without folder prefix and .dashboard extension). */
  name: string;
}

/**
 * Build the storage path for a dashboard name.
 * New dashboards are stored as `dashboards/{name}.dashboard`.
 */
export function dashboardPath(name: string): string {
  return `${DASHBOARD_FOLDER}/${name}${DASHBOARD_EXT}`;
}

/**
 * Extract a display name from a dashboard file path.
 * Strips the folder prefix and .dashboard extension.
 */
export function dashboardDisplayName(fileName: string): string {
  const base = fileName.includes("/")
    ? fileName.slice(fileName.lastIndexOf("/") + 1)
    : fileName;
  return base.endsWith(DASHBOARD_EXT)
    ? base.slice(0, -DASHBOARD_EXT.length)
    : base;
}

/**
 * Parse .dashboard YAML content into DashboardData.
 * Returns null for empty/invalid content.
 * Unknown keys (and unknown widget types) are preserved on the parsed object
 * for round-trip safety; no widget-type migration is performed.
 */
export function parseDashboard(content: string): DashboardData | null {
  if (!content || !content.trim()) return null;
  try {
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as DashboardData;
  } catch {
    return null;
  }
}

/**
 * Serialize DashboardData back to YAML.
 * Unknown keys are naturally preserved since we dump the full object.
 */
export function serializeDashboard(data: DashboardData): string {
  return yaml.dump(data, YAML_DUMP_OPTS);
}

/**
 * Update a single widget's layout position for a specific breakpoint.
 * Returns a new DashboardData object with the updated layout,
 * preserving all other widgets and unknown keys.
 */
export function updateWidgetLayout(
  data: DashboardData,
  widgetId: string,
  bp: Breakpoint,
  pos: LayoutPos,
): DashboardData {
  return {
    ...data,
    widgets: data.widgets.map((w) =>
      w.id === widgetId
        ? { ...w, layout: { ...w.layout, [bp]: pos } }
        : w,
    ),
  };
}

/**
 * Ensure every widget has an `sm` layout.
 * Widgets with an explicit `sm` keep it; missing ones are auto-derived from
 * `lg` (w=12, x=0) and stacked vertically in `lg.y` order, skipping over the
 * vertical span already occupied by explicit `sm` positions.
 */
export function deriveSmLayout(data: DashboardData): DashboardData {
  const sorted = [...data.widgets].sort((a, b) => {
    const ay = a.layout.lg?.y ?? 0;
    const by = b.layout.lg?.y ?? 0;
    return ay - by;
  });

  let currentY = 0;
  const smPositions = new Map<string, LayoutPos>();
  for (const w of sorted) {
    if (w.layout.sm) {
      currentY = Math.max(currentY, w.layout.sm.y + w.layout.sm.h);
      continue;
    }
    const h = w.layout.lg?.h ?? 3;
    smPositions.set(w.id, { x: 0, y: currentY, w: 12, h });
    currentY += h;
  }

  return {
    ...data,
    widgets: data.widgets.map((w) => {
      const sm = smPositions.get(w.id);
      if (!sm) return w;
      return { ...w, layout: { ...w.layout, sm } };
    }),
  };
}

/**
 * Create an empty dashboard (version 1, default grid, no widgets).
 * Used for new dashboard creation — the empty state guides the user to add widgets.
 */
export function createEmptyDashboard(): DashboardData {
  return {
    version: 1,
    grid: { ...DEFAULT_GRID },
    widgets: [],
  };
}

/**
 * Create a default dashboard with one widget of each type.
 * Used when home.dashboard doesn't exist yet and the user clicks "Create dashboard"
 * from the empty state (legacy convenience — new dashboards via the lifecycle
 * UI use createEmptyDashboard instead).
 */
export function createDefaultDashboard(): DashboardData {
  return {
    version: 1,
    grid: { ...DEFAULT_GRID },
    widgets: [
      {
        id: crypto.randomUUID(),
        type: "markdown",
        layout: {
          lg: { x: 0, y: 0, w: 6, h: 3 },
        },
        config: {},
      },
      {
        id: crypto.randomUUID(),
        type: "file-list",
        layout: {
          lg: { x: 6, y: 0, w: 6, h: 4 },
        },
        config: {
          folder: "",
          sort: "-mtime",
          limit: 20,
        },
      },
      {
        id: crypto.randomUUID(),
        type: "table",
        layout: {
          lg: { x: 0, y: 3, w: 6, h: 5 },
        },
        config: {
          folder: "",
          sort: "-mtime",
          limit: 50,
          columns: ["title", "status", "tags"],
        },
      },
      {
        id: crypto.randomUUID(),
        type: "web",
        layout: {
          lg: { x: 6, y: 4, w: 6, h: 4 },
        },
        config: {
          url: "https://example.com",
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// File I/O — local-first (reuses existing writeFileLocal from drive-local.ts)
// ---------------------------------------------------------------------------

/**
 * True for dashboard files that should never appear in the listing —
 * soft-deleted (trash/) and history snapshots keep the .dashboard extension
 * after deleteFileLocal renames them, so the extension check alone is not enough.
 */
function isHiddenDashboardPath(name: string): boolean {
  return name.startsWith("trash/") || name.startsWith("history/");
}

/**
 * Enumerate all .dashboard files from CachedRemoteMeta (and cached files fallback).
 * Returns entries sorted by display name.
 * Includes both legacy `home.dashboard` (root) and `dashboards/*.dashboard`,
 * but excludes trashed/history copies.
 */
export async function listDashboardFiles(): Promise<DashboardFileEntry[]> {
  const meta = await getCachedRemoteMeta();
  const entries: DashboardFileEntry[] = [];

  if (meta) {
    for (const [id, entry] of Object.entries(meta.files)) {
      if (entry.name.endsWith(DASHBOARD_EXT) && !isHiddenDashboardPath(entry.name)) {
        entries.push({
          fileId: id,
          fileName: entry.name,
          name: dashboardDisplayName(entry.name),
        });
      }
    }
  }

  // Fallback: scan cached files if meta is missing or incomplete
  if (entries.length === 0) {
    const allFiles = await getAllCachedFiles();
    for (const f of allFiles) {
      if (f.fileName?.endsWith(DASHBOARD_EXT) && !isHiddenDashboardPath(f.fileName)) {
        entries.push({
          fileId: f.fileId,
          fileName: f.fileName,
          name: dashboardDisplayName(f.fileName),
        });
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/**
 * Load a dashboard by its file path/name.
 * Returns the parsed data and fileId, or null if not found.
 */
export async function loadDashboardByPath(
  path: string,
): Promise<{ data: DashboardData; fileId: string } | null> {
  const meta = await getCachedRemoteMeta();
  let fileId: string | null = null;

  if (meta) {
    for (const [id, entry] of Object.entries(meta.files)) {
      if (entry.name === path) {
        fileId = id;
        break;
      }
    }
  }

  if (!fileId) {
    const allFiles = await getAllCachedFiles();
    for (const f of allFiles) {
      if (f.fileName === path) {
        fileId = f.fileId;
        break;
      }
    }
  }

  if (!fileId) return null;

  // Read content with a server fallback: the file may be listed in remote meta
  // (so it shows up in the dashboard listing) while its content has not been
  // cached locally yet. Reading cache-only here is what made a fresh device
  // spin forever on the dashboard home even though opening files worked.
  let content: string;
  try {
    content = await readFileLocal(fileId);
  } catch {
    return null;
  }

  const data = parseDashboard(content);
  if (!data) return null;

  return { data, fileId };
}

/**
 * Find home.dashboard in the cache (legacy backward compat).
 * Checks CachedRemoteMeta first (fast), then falls back to scanning all cached files.
 * Returns the fileId and cached content, or null if not found.
 */
export async function loadDashboardFile(): Promise<{
  data: DashboardData;
  fileId: string;
} | null> {
  // 1. Try CachedRemoteMeta (fast path)
  const meta = await getCachedRemoteMeta();
  let fileId: string | null = null;

  if (meta) {
    for (const [id, entry] of Object.entries(meta.files)) {
      if (entry.name === DASHBOARD_FILE_NAME) {
        fileId = id;
        break;
      }
    }
  }

  // 2. Fallback: scan all cached files for fileName match
  if (!fileId) {
    const allFiles = await getAllCachedFiles();
    for (const f of allFiles) {
      if (f.fileName === DASHBOARD_FILE_NAME) {
        fileId = f.fileId;
        break;
      }
    }
  }

  if (!fileId) return null;

  let content: string;
  try {
    content = await readFileLocal(fileId);
  } catch {
    return null;
  }

  const data = parseDashboard(content);
  if (!data) return null;

  return { data, fileId };
}

/**
 * Resolve which dashboard to open on app launch.
 * Resolution order:
 *   1. settings.homeDashboard (if set and the file exists)
 *   2. Legacy home.dashboard (if it exists)
 *   3. First dashboard in the listing
 *   4. null (no dashboards — show "create" empty state)
 */
export async function resolveHomeDashboard(
  homeDashboard?: string | null,
): Promise<{ data: DashboardData; fileId: string; fileName: string } | null> {
  // 1. Explicit setting
  if (homeDashboard) {
    const result = await loadDashboardByPath(homeDashboard);
    if (result) {
      return { ...result, fileName: homeDashboard };
    }
  }

  // 2. Legacy home.dashboard
  const legacy = await loadDashboardFile();
  if (legacy) {
    return { ...legacy, fileName: DASHBOARD_FILE_NAME };
  }

  // 3. First in listing
  const list = await listDashboardFiles();
  if (list.length > 0) {
    const result = await loadDashboardByPath(list[0].fileName);
    if (result) {
      return { ...result, fileName: list[0].fileName };
    }
  }

  // 4. None
  return null;
}

/**
 * Save dashboard to IndexedDB cache (local-first).
 * Delegates to the existing writeFileLocal which handles:
 *   addCommitBoundary + saveLocalEdit + setCachedFile + CachedRemoteMeta update.
 * Marks the file as dirty for Push sync via file-modified event.
 * Returns the fileId.
 */
export async function saveDashboardFile(
  data: DashboardData,
  existingFileId: string | null,
  fileName?: string,
): Promise<string> {
  const content = serializeDashboard(data);
  const result = await writeFileLocal(
    fileName ?? DASHBOARD_FILE_NAME,
    content,
    { existingFileId: existingFileId ?? undefined },
  );

  // Notify sync system that a file was modified
  window.dispatchEvent(
    new CustomEvent("file-modified", { detail: { fileId: result.fileId } }),
  );

  return result.fileId;
}

/**
 * Create a new dashboard file with the given name.
 * Stores it as `dashboards/{name}.dashboard`.
 * Returns the fileId.
 */
export async function createNewDashboard(name: string): Promise<string> {
  const data = createEmptyDashboard();
  const path = dashboardPath(name);
  const result = await writeFileLocal(path, serializeDashboard(data));
  window.dispatchEvent(
    new CustomEvent("file-modified", { detail: { fileId: result.fileId } }),
  );
  return result.fileId;
}

/**
 * Rename a dashboard file (via existing renameFileLocal).
 * The new name is applied as `dashboards/{newName}.dashboard`.
 */
export async function renameDashboard(
  fileId: string,
  currentFileName: string,
  newName: string,
): Promise<string> {
  const newPath = dashboardPath(newName);
  await renameFileLocal(fileId, newPath);
  window.dispatchEvent(
    new CustomEvent("file-modified", { detail: { fileId } }),
  );
  return newPath;
}

/**
 * Delete a dashboard file (via existing deleteFileLocal which trashes it).
 */
export async function deleteDashboard(fileId: string): Promise<void> {
  await deleteFileLocal(fileId);
}
