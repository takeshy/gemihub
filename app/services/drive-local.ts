/**
 * IndexedDB-based Drive operation service for local workflow execution.
 * All operations work against the browser's cached data (CachedRemoteMeta, CachedFile).
 * Follows the same local-first pattern as chat file operations.
 */

import {
  getCachedFile,
  setCachedFile,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  renameCachedFile,
  deleteCachedFile,
  deleteEditHistoryEntry,
  removeLocalSyncMetaEntry,
  setEditHistoryEntry,
  getEditHistoryForFile,
  type CachedRemoteMeta,
} from "./indexeddb-cache";
import { saveLocalEdit, addCommitBoundary } from "./edit-history-local";
import { base64Encode } from "~/utils/base64";
import type { ExecutionContext } from "~/engine/types";
import { replaceVariables } from "~/engine/handlers/utils";

/** Prefixes for files that should be excluded from search/list results. */
const EXCLUDED_PREFIXES = ["trash/", "history/", "plugins/", "Dashboards/"];

function dispatchFileModified(fileId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId } }));
}

/** Infer a reasonable MIME type from the file name extension. */
export function mimeTypeFromFileName(fileName: string): string {
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx < 0) return "text/plain";
  const ext = fileName.slice(dotIdx + 1).toLowerCase();
  const map: Record<string, string> = {
    md: "text/markdown", txt: "text/plain",
    json: "application/json", canvas: "application/json",
    yaml: "text/yaml", yml: "text/yaml",
    dashboard: "text/yaml", base: "text/yaml",
    js: "application/javascript", ts: "application/typescript",
    css: "text/css", html: "text/html", xml: "text/xml",
    csv: "text/csv",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    pdf: "application/pdf", epub: "application/epub+zip",
    mp3: "audio/mpeg", wav: "audio/wav",
    mp4: "video/mp4", webm: "video/webm",
  };
  return map[ext] || "text/plain";
}

// ---------------------------------------------------------------------------
// File resolution (local equivalent of driveUtils.resolveExistingFile)
// ---------------------------------------------------------------------------

export interface ResolvedLocalFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Resolve a file path to a cached Drive file using CachedRemoteMeta.
 * Resolution order:
 *   1. Companion `_fileId` variable from drive-file-picker
 *   2. Name match in CachedRemoteMeta
 *   3. Name match with .md extension appended
 */
export async function resolveFileLocal(
  pathRaw: string,
  context: ExecutionContext,
  options?: { tryMdExtension?: boolean },
): Promise<ResolvedLocalFile> {
  const path = replaceVariables(pathRaw, context);
  if (!path) throw new Error("Missing 'path' property");

  const tryMd = options?.tryMdExtension ?? false;
  const meta = await getCachedRemoteMeta();

  // 1. Companion _fileId variable
  const varMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (varMatch) {
    const fileId = context.variables.get(`${varMatch[1]}_fileId`);
    if (fileId && typeof fileId === "string") {
      const entry = meta?.files[fileId];
      if (entry) {
        return { id: fileId, name: entry.name, mimeType: entry.mimeType };
      }
      // fallback: return with basic info
      return { id: fileId, name: path, mimeType: "text/plain" };
    }
  }

  // 2. Direct file ID (matches server-side resolveExistingFile pattern)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(path)) {
    const entry = meta?.files[path];
    if (entry) {
      return { id: path, name: entry.name, mimeType: entry.mimeType };
    }
  }

  // 3-4. Search by name in CachedRemoteMeta
  if (meta) {
    const candidates = tryMd && !path.endsWith(".md")
      ? [path, `${path}.md`]
      : [path];

    for (const candidate of candidates) {
      for (const [fileId, entry] of Object.entries(meta.files)) {
        if (entry.name === candidate) {
          return { id: fileId, name: entry.name, mimeType: entry.mimeType };
        }
      }
    }
  }

  throw new Error(`File not found in local cache: ${path}`);
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

/** Read file content as text from IndexedDB cache, with server fallback */
export async function readFileLocal(fileId: string): Promise<string> {
  const cached = await getCachedFile(fileId);
  if (cached) return cached.content;

  // Cache miss — fetch from server and cache for future reads
  const res = await fetch(`/api/drive/files?action=read&fileId=${encodeURIComponent(fileId)}`);
  if (!res.ok) throw new Error(`File not found: ${fileId}`);
  const data = await res.json() as { content: string; md5Checksum?: string; modifiedTime?: string };

  const meta = await getCachedRemoteMeta();
  const fileMeta = meta?.files[fileId];
  await setCachedFile({
    fileId,
    content: data.content,
    md5Checksum: data.md5Checksum ?? "",
    modifiedTime: data.modifiedTime ?? "",
    cachedAt: Date.now(),
    fileName: fileMeta?.name,
  });
  return data.content;
}

/** Read file as base64 from IndexedDB cache, with server fallback */
export async function readFileBinaryLocal(fileId: string): Promise<string> {
  const cached = await getCachedFile(fileId);
  if (cached) {
    if (cached.encoding === "base64") return cached.content;
    const encoder = new TextEncoder();
    return base64Encode(encoder.encode(cached.content));
  }

  // Cache miss — fetch raw content from server and cache as base64
  const res = await fetch(`/api/drive/files?action=raw&fileId=${encodeURIComponent(fileId)}`);
  if (!res.ok) throw new Error(`File not found: ${fileId}`);
  const arrayBuffer = await res.arrayBuffer();
  const b64 = base64Encode(new Uint8Array(arrayBuffer));

  const meta = await getCachedRemoteMeta();
  const fileMeta = meta?.files[fileId];
  await setCachedFile({
    fileId,
    content: b64,
    md5Checksum: fileMeta?.md5Checksum ?? "",
    modifiedTime: fileMeta?.modifiedTime ?? "",
    cachedAt: Date.now(),
    fileName: fileMeta?.name,
    encoding: "base64",
  });
  return b64;
}

// ---------------------------------------------------------------------------
// File searching and listing
// ---------------------------------------------------------------------------

/** Search files by name (and optionally content) in CachedRemoteMeta + cache */
export async function searchFilesLocal(
  query: string,
  searchContent?: boolean,
  folder?: string,
): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }>> {
  const meta = await getCachedRemoteMeta();
  if (!meta) return [];

  const lowerQuery = query.toLowerCase();
  const results: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }> = [];

  for (const [fileId, entry] of Object.entries(meta.files)) {
    // Skip excluded paths (trash, history, plugins)
    if (EXCLUDED_PREFIXES.some(p => entry.name.startsWith(p))) continue;

    // Folder filter
    if (folder && !entry.name.startsWith(folder + "/") && entry.name !== folder) continue;

    // Name match
    if (entry.name.toLowerCase().includes(lowerQuery)) {
      results.push({ id: fileId, name: entry.name, mimeType: entry.mimeType, modifiedTime: entry.modifiedTime });
      continue;
    }

    // Content match
    if (searchContent) {
      const cached = await getCachedFile(fileId);
      if (cached?.content && cached.content.toLowerCase().includes(lowerQuery)) {
        results.push({ id: fileId, name: entry.name, mimeType: entry.mimeType, modifiedTime: entry.modifiedTime });
      }
    }
  }

  return results;
}

/** List files from CachedRemoteMeta with folder filtering, sorting, and time filters */
export async function listFilesLocal(
  folder?: string,
  options?: {
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    modifiedWithinMs?: number;
    createdWithinMs?: number;
  },
): Promise<{
  files: Array<{ id: string; name: string; modifiedTime?: string; createdTime?: string }>;
  totalCount: number;
}> {
  const meta = await getCachedRemoteMeta();
  if (!meta) return { files: [], totalCount: 0 };

  const prefix = folder ? folder + "/" : "";
  let filtered: Array<{ id: string; name: string; modifiedTime?: string; createdTime?: string }> = [];

  for (const [fileId, entry] of Object.entries(meta.files)) {
    if (EXCLUDED_PREFIXES.some(p => entry.name.startsWith(p))) continue;
    if (folder && !entry.name.startsWith(prefix)) continue;
    filtered.push({
      id: fileId,
      name: entry.name,
      modifiedTime: entry.modifiedTime,
      createdTime: entry.createdTime,
    });
  }

  // Time-based filters
  const now = Date.now();
  if (options?.modifiedWithinMs) {
    const cutoff = now - options.modifiedWithinMs;
    filtered = filtered.filter(f =>
      f.modifiedTime && new Date(f.modifiedTime).getTime() >= cutoff
    );
  }
  if (options?.createdWithinMs) {
    const cutoff = now - options.createdWithinMs;
    filtered = filtered.filter(f =>
      f.createdTime && new Date(f.createdTime).getTime() >= cutoff
    );
  }

  // Sort
  const sortBy = options?.sortBy || "modified";
  const sortOrder = options?.sortOrder || "desc";
  filtered.sort((a, b) => {
    let aVal: string | number = 0;
    let bVal: string | number = 0;
    if (sortBy === "name") {
      aVal = a.name.toLowerCase();
      bVal = b.name.toLowerCase();
    } else if (sortBy === "created") {
      aVal = a.createdTime ? new Date(a.createdTime).getTime() : 0;
      bVal = b.createdTime ? new Date(b.createdTime).getTime() : 0;
    } else {
      aVal = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      bVal = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
    }
    if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
    if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const totalCount = filtered.length;
  const limit = options?.limit || 50;

  return { files: filtered.slice(0, limit), totalCount };
}

/** List virtual folders from CachedRemoteMeta */
export async function listFoldersLocal(
  parentFolder?: string,
): Promise<string[]> {
  const meta = await getCachedRemoteMeta();
  if (!meta) return [];

  const prefix = parentFolder ? parentFolder + "/" : "";
  const folderNames = new Set<string>();

  for (const [, entry] of Object.entries(meta.files)) {
    if (EXCLUDED_PREFIXES.some(p => entry.name.startsWith(p))) continue;
    const name = parentFolder
      ? (entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : null)
      : entry.name;
    if (name === null) continue;
    const slashIndex = name.indexOf("/");
    if (slashIndex !== -1) {
      folderNames.add(name.slice(0, slashIndex));
    }
  }

  return Array.from(folderNames).sort();
}

/** Find a file by exact name in CachedRemoteMeta */
export async function findFileByNameLocal(
  name: string,
): Promise<ResolvedLocalFile | null> {
  const meta = await getCachedRemoteMeta();
  if (!meta) return null;

  for (const [fileId, entry] of Object.entries(meta.files)) {
    if (entry.name === name) {
      return { id: fileId, name: entry.name, mimeType: entry.mimeType };
    }
  }
  return null;
}

/**
 * Find a file by name, accepting a case-only mismatch when it is unambiguous.
 * Google Drive permits case-distinct siblings, so exact match must win and
 * multiple case-insensitive matches are treated as unresolved.
 */
export async function findFileByNameLocalLoose(
  name: string,
): Promise<ResolvedLocalFile | null> {
  const exact = await findFileByNameLocal(name);
  if (exact) return exact;

  const meta = await getCachedRemoteMeta();
  if (!meta) return null;
  const lowerName = name.toLowerCase();
  const matches: ResolvedLocalFile[] = [];
  for (const [fileId, entry] of Object.entries(meta.files)) {
    if (entry.name.toLowerCase() === lowerName) {
      matches.push({ id: fileId, name: entry.name, mimeType: entry.mimeType });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

// ---------------------------------------------------------------------------
// File writing (local-first pattern: update IndexedDB only, no Drive)
// ---------------------------------------------------------------------------

/**
 * Write file to IndexedDB cache and record edit history.
 * For existing files: updates cache + editHistory.
 * For new files: creates a cache entry with a `new:` prefixed ID.
 * Returns the file ID and a flag indicating if it was newly created.
 */
export async function writeFileLocal(
  fileName: string,
  content: string,
  options?: { existingFileId?: string },
): Promise<{ fileId: string; isNew: boolean }> {
  let existingId = options?.existingFileId;

  if (existingId) {
    let cached = await getCachedFile(existingId);
    if (!cached && existingId.startsWith("new:")) {
      // The `new:` placeholder was already migrated to a real Drive id in the
      // background (pending-file-migration.ts deletes its cache entry as part
      // of the id swap). Resolve the current id by name instead of blindly
      // resurrecting a cache entry under the stale `new:` id — an orphan like
      // that has no CachedRemoteMeta entry, but getPendingNewFiles() scans the
      // raw cache directly, so it would get picked up by the next migration
      // pass and re-uploaded as a genuine duplicate file.
      const resolved = await findFileByNameLocal(fileName);
      if (resolved) {
        existingId = resolved.id;
        cached = await getCachedFile(existingId);
      }
    }
    // Update existing file
    await addCommitBoundary(existingId);
    await saveLocalEdit(existingId, fileName, content);
    await setCachedFile({
      fileId: existingId,
      content,
      md5Checksum: cached?.md5Checksum ?? "",
      modifiedTime: new Date().toISOString(),
      cachedAt: Date.now(),
      fileName,
    });
    await addCommitBoundary(existingId);
    dispatchFileModified(existingId);
    return { fileId: existingId, isNew: false };
  }

  // Check if file already exists by name
  const existing = await findFileByNameLocal(fileName);
  if (existing) {
    await addCommitBoundary(existing.id);
    await saveLocalEdit(existing.id, fileName, content);
    const cached = await getCachedFile(existing.id);
    await setCachedFile({
      fileId: existing.id,
      content,
      md5Checksum: cached?.md5Checksum ?? "",
      modifiedTime: new Date().toISOString(),
      cachedAt: Date.now(),
      fileName,
    });
    await addCommitBoundary(existing.id);
    dispatchFileModified(existing.id);
    return { fileId: existing.id, isNew: false };
  }

  // Create new file with temporary ID
  // Convention: "new:<filePath>" — usePendingFileMigration extracts the path from the ID
  const now = new Date().toISOString();
  const newId = `new:${fileName}`;

  // Record edit history BEFORE writing to cache (saveLocalEdit reads old content from cache;
  // for new files old content is "" which correctly produces a diff against the new content)
  await addCommitBoundary(newId);
  await saveLocalEdit(newId, fileName, content);

  await setCachedFile({
    fileId: newId,
    content,
    md5Checksum: "",
    modifiedTime: now,
    cachedAt: Date.now(),
    fileName,
  });
  await addCommitBoundary(newId);

  // Add to CachedRemoteMeta so it's visible in searches/listings
  const meta = await getCachedRemoteMeta() ?? {
    id: "current", rootFolderId: "", lastUpdatedAt: now, files: {}, cachedAt: Date.now(),
  };
  meta.files[newId] = {
    name: fileName,
    mimeType: mimeTypeFromFileName(fileName),
    md5Checksum: "",
    modifiedTime: now,
    createdTime: now,
  };
  await setCachedRemoteMeta(meta);

  // Notify usePendingFileMigration that a new file needs Drive migration
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pending-files-created"));
  }
  dispatchFileModified(newId);

  return { fileId: newId, isNew: true };
}

// ---------------------------------------------------------------------------
// File deletion (local only)
// ---------------------------------------------------------------------------

export async function deleteFileLocal(fileId: string): Promise<void> {
  const meta = await getCachedRemoteMeta();
  const entry = meta?.files[fileId];

  if (!entry) return; // File not in cache — nothing to delete

  if (fileId.startsWith("new:")) {
    // Cancel a not-yet-migrated creation completely. If migration already
    // created its remote placeholder, its in-flight cache re-check sees the
    // missing record and removes that placeholder as well.
    const cached = await getCachedFile(fileId);
    if (cached?.pendingRemoteFileId) {
      const deletePendingRes = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          fileId: cached.pendingRemoteFileId,
          permanent: true,
        }),
      });
      if (!deletePendingRes.ok) {
        throw new Error(`Failed to cancel pending file creation: ${entry.name}`);
      }
    }
    delete meta.files[fileId];
    await setCachedRemoteMeta(meta);
  } else {
    const res = await fetch("/api/drive/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", fileId }),
    });
    if (!res.ok) throw new Error(`Failed to delete file: ${entry.name}`);
    const data = await res.json() as {
      meta?: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] };
    };
    if (data.meta) {
      const pendingEntries = Object.fromEntries(
        Object.entries(meta.files).filter(([id]) => id.startsWith("new:")),
      );
      await setCachedRemoteMeta({
        ...meta,
        lastUpdatedAt: data.meta.lastUpdatedAt,
        files: { ...data.meta.files, ...pendingEntries },
        cachedAt: Date.now(),
      });
    } else {
      delete meta.files[fileId];
      await setCachedRemoteMeta(meta);
    }
  }

  await deleteCachedFile(fileId);
  await deleteEditHistoryEntry(fileId);
  await removeLocalSyncMetaEntry(fileId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("tree-meta-updated"));
    window.dispatchEvent(new Event("sync-complete"));
  }
}

// ---------------------------------------------------------------------------
// File renaming (local only)
// ---------------------------------------------------------------------------

export async function renameFileLocal(fileId: string, newName: string): Promise<void> {
  await renameCachedFile(fileId, newName);

  // Update CachedRemoteMeta
  const meta = await getCachedRemoteMeta();
  if (meta && meta.files[fileId]) {
    meta.files[fileId].name = newName;
    await setCachedRemoteMeta(meta);
  }
}

// ---------------------------------------------------------------------------
// Binary file writing (for drive-save node)
// ---------------------------------------------------------------------------

/**
 * Save a binary file (base64 content) to IndexedDB.
 * Unlike writeFileLocal, this stores raw base64 data with encoding marker.
 */
export async function saveBinaryFileLocal(
  fileName: string,
  base64Data: string,
  mimeType: string,
  options?: { existingFileId?: string },
): Promise<{ fileId: string; isNew: boolean }> {
  // Use explicit existingFileId if provided (e.g. from drive-file-picker _fileId)
  if (options?.existingFileId) {
    // Mark as modified (minimal entry — skip diff computation for binary data)
    await markBinaryFileModified(options.existingFileId, fileName);
    await setCachedFile({
      fileId: options.existingFileId,
      content: base64Data,
      md5Checksum: "",
      modifiedTime: new Date().toISOString(),
      cachedAt: Date.now(),
      fileName,
      encoding: "base64",
    });
    dispatchFileModified(options.existingFileId);
    return { fileId: options.existingFileId, isNew: false };
  }

  // Check if file already exists by name
  const existing = await findFileByNameLocal(fileName);
  if (existing) {
    await markBinaryFileModified(existing.id, fileName);
    await setCachedFile({
      fileId: existing.id,
      content: base64Data,
      md5Checksum: "",
      modifiedTime: new Date().toISOString(),
      cachedAt: Date.now(),
      fileName,
      encoding: "base64",
    });
    dispatchFileModified(existing.id);
    return { fileId: existing.id, isNew: false };
  }

  // Convention: "new:<filePath>" — usePendingFileMigration extracts the path from the ID
  const now = new Date().toISOString();
  const newId = `new:${fileName}`;

  // Mark as modified (minimal entry — skip diff computation for binary data)
  await markBinaryFileModified(newId, fileName);

  await setCachedFile({
    fileId: newId,
    content: base64Data,
    md5Checksum: "",
    modifiedTime: now,
    cachedAt: Date.now(),
    fileName,
    encoding: "base64",
  });

  const meta = await getCachedRemoteMeta() ?? {
    id: "current", rootFolderId: "", lastUpdatedAt: now, files: {}, cachedAt: Date.now(),
  };
  meta.files[newId] = {
    name: fileName,
    mimeType,
    md5Checksum: "",
    modifiedTime: now,
    createdTime: now,
  };
  await setCachedRemoteMeta(meta);

  // Notify usePendingFileMigration that a new file needs Drive migration
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pending-files-created"));
  }
  dispatchFileModified(newId);

  return { fileId: newId, isNew: true };
}

// ---------------------------------------------------------------------------
// Helper: mark binary file as modified without computing diffs
// ---------------------------------------------------------------------------

export async function markBinaryFileModified(fileId: string, filePath: string): Promise<void> {
  const existing = await getEditHistoryForFile(fileId);
  if (existing) return; // already marked
  await setEditHistoryEntry({
    fileId,
    filePath,
    diffs: [{ timestamp: new Date().toISOString(), diff: "[binary]", stats: { additions: 0, deletions: 0 } }],
  });
}

// ---------------------------------------------------------------------------
// Helper: get all remote meta entries (for list_drive_files tool)
// ---------------------------------------------------------------------------

export async function getRemoteMetaFiles(): Promise<CachedRemoteMeta["files"]> {
  const meta = await getCachedRemoteMeta();
  if (!meta) return {};
  const filtered: CachedRemoteMeta["files"] = {};
  for (const [id, entry] of Object.entries(meta.files)) {
    if (!EXCLUDED_PREFIXES.some(p => entry.name.startsWith(p))) {
      filtered[id] = entry;
    }
  }
  return filtered;
}
