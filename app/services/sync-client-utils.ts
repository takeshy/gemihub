export const SYNC_EXCLUDED_FILE_NAMES = new Set(["_sync-meta.json", "settings.json"]);
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
