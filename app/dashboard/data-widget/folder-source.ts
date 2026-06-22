// Folder source — loads rows from frontmatter cache (P2 spec §4).
// Deterministic, synchronous, local, offline OK, zero LLM.
// Reuses the existing frontmatter cache piggyback (no new store).

import { listFilesLocal } from "~/services/drive-local";
import { getCachedFile } from "~/services/indexeddb-cache";
import { ensureFrontmatterCached } from "../frontmatter-cache";
import { splitFrontmatter } from "../frontmatter-writeback";
import type { DataRow, FieldInfo } from "./types";
import { BUILTIN_FILE_KEYS } from "./types";
import { inferType } from "./filter";

/**
 * Load rows from a folder's frontmatter cache.
 * Each file becomes a DataRow with:
 *   - file.name, file.mtime, file.ctime as file attributes
 *   - frontmatter keys as cell properties (empty for non-markdown files)
 */
export async function loadFolderRows(folder: string): Promise<DataRow[]> {
  const result = await listFilesLocal(folder || undefined, {
    limit: 100000,
    sortBy: "modified",
    sortOrder: "desc",
  });

  const rows: DataRow[] = await Promise.all(
    result.files.map(async (file) => {
      const cached = await getCachedFile(file.id);
      let frontmatter: Record<string, unknown> = {};
      let fmParseable = false;

      if (cached) {
        const split = splitFrontmatter(cached.content);
        if (split !== null) {
          fmParseable = true;
          frontmatter = await ensureFrontmatterCached(cached);
        }
      }

      return {
        id: file.id,
        fileId: file.id,
        fileName: file.name,
        mtime: file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0,
        ctime: file.createdTime ? new Date(file.createdTime).getTime() : 0,
        fmParseable,
        cells: frontmatter,
      };
    }),
  );

  return rows;
}

/**
 * Detect available properties from folder rows.
 * Includes built-in file.* attributes plus all frontmatter keys.
 */
export function detectFolderFields(rows: DataRow[]): FieldInfo[] {
  const fieldMap = new Map<string, FieldInfo>();

  for (const key of BUILTIN_FILE_KEYS) {
    const values = rows
      .map((r) => {
        if (key === "file.name" || key === "name") return r.fileName;
        if (key === "file.mtime" || key === "mtime") return r.mtime;
        if (key === "file.ctime" || key === "ctime") return r.ctime;
        return undefined;
      })
      .filter((v) => v != null);
    fieldMap.set(key, { name: key, type: inferType(values) });
  }

  for (const row of rows) {
    for (const key of Object.keys(row.cells)) {
      if (fieldMap.has(key)) continue;
      const values = rows
        .map((r) => r.cells[key])
        .filter((v) => v != null);
      fieldMap.set(key, { name: key, type: inferType(values) });
    }
  }

  return Array.from(fieldMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Scan a folder's cached frontmatter for config editor suggestions.
 * Returns typed fields (name + inferred type) so the editor can offer
 * type-appropriate filter operators (§6.2).
 */
export async function scanFolderFields(folder: string): Promise<FieldInfo[]> {
  const rows = await loadFolderRows(folder);
  return detectFolderFields(rows);
}
