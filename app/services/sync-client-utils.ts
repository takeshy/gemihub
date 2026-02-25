import { setCachedFile, type LocalSyncMeta, type CachedRemoteMeta } from "~/services/indexeddb-cache";

export const SYNC_EXCLUDED_FILE_NAMES = new Set(["_sync-meta.json", "settings.json", "_encrypted-auth.json"]);
export const SYNC_EXCLUDED_PREFIXES = [
  "history/",
  "trash/",
  "sync_conflicts/",
  "__TEMP__/",
  "plugins/",
];

export function isSyncExcludedPath(fileName: string): boolean {
  const normalized = fileName.replace(/^\/+/, "");
  if (SYNC_EXCLUDED_FILE_NAMES.has(normalized)) return true;
  return SYNC_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

const BINARY_APPLICATION_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/x-gzip",
  "application/x-bzip2",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/octet-stream",
  "application/wasm",
]);

const BINARY_APPLICATION_PREFIXES = [
  "application/vnd.openxmlformats-",  // docx, xlsx, pptx
  "application/vnd.ms-",              // doc, xls, ppt
  "application/vnd.oasis.opendocument.", // odt, ods, odp
];

export function isBinaryMimeType(mimeType: string | undefined | null): boolean {
  if (!mimeType) return false;
  if (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("font/")
  ) return true;
  if (BINARY_APPLICATION_TYPES.has(mimeType)) return true;
  return BINARY_APPLICATION_PREFIXES.some((p) => mimeType.startsWith(p));
}

/**
 * Heuristic: check if content looks like binary data.
 * Inspects the first 512 characters for non-printable characters
 * (excluding \t, \n, \r). If >= 10% are control chars, treat as binary.
 */
export function looksLikeBinary(content: string): boolean {
  const sample = content.slice(0, 512);
  if (sample.length === 0) return false;
  let controlCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Allow tab (9), newline (10), carriage return (13)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlCount++;
    }
  }
  return controlCount / sample.length >= 0.1;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

/** Check if a file name has an image extension (for thumbnail display). */
export function isImageFileName(name: string): boolean {
  const ext = name.toLowerCase().split(".").pop() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Upload binary content directly to Google Drive, update IndexedDB cache,
 * and mutate localMeta/remoteMeta objects in-place (caller must persist them).
 * Returns true on success.
 */
export async function applyBinaryTempFile(
  fileId: string,
  content: string,
  fileName: string,
  localMeta?: LocalSyncMeta | null,
  remoteMeta?: CachedRemoteMeta | null,
): Promise<boolean> {
  const res = await fetch("/api/drive/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateBinary", fileId, content }),
  });
  if (!res.ok) return false;
  const data = await res.json();

  await setCachedFile({
    fileId,
    content,
    md5Checksum: data.md5Checksum || "",
    modifiedTime: data.file?.modifiedTime || "",
    cachedAt: Date.now(),
    fileName,
    encoding: "base64",
  });

  // Mutate localMeta in-place
  if (localMeta) {
    localMeta.files[fileId] = {
      md5Checksum: data.md5Checksum || "",
      modifiedTime: data.file?.modifiedTime || "",
    };
    localMeta.lastUpdatedAt = data.meta?.lastUpdatedAt || new Date().toISOString();
  }

  // Mutate remoteMeta in-place
  if (remoteMeta && data.meta?.files) {
    for (const [fid, fmeta] of Object.entries(data.meta.files as Record<string, Record<string, string>>)) {
      remoteMeta.files[fid] = { ...remoteMeta.files[fid], ...fmeta };
    }
    remoteMeta.lastUpdatedAt = data.meta.lastUpdatedAt;
    remoteMeta.cachedAt = Date.now();
  }

  window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId } }));
  return true;
}

export type SyncCompletionStatus = "idle" | "warning";

export function getSyncCompletionStatus(
  skippedCount: number,
  label: "Push" | "Full push"
): { status: SyncCompletionStatus; error: string | null } {
  if (skippedCount > 0) {
    return {
      status: "warning",
      error: `${label} completed with warning: skipped ${skippedCount} file(s).`,
    };
  }
  return { status: "idle", error: null };
}
