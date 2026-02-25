/**
 * Shared MIME type utilities for local handlers.
 */

const BINARY_MIME_PREFIXES = ["image/", "audio/", "video/"];
const BINARY_MIME_TYPES = new Set(["application/pdf", "application/zip", "application/octet-stream"]);

export function isBinaryMimeType(mimeType: string): boolean {
  return BINARY_MIME_PREFIXES.some(p => mimeType.startsWith(p)) || BINARY_MIME_TYPES.has(mimeType);
}
