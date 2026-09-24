const VIDEO_EXTS = [".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv"];
const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".aac", ".m4a", ".opus"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];

export function getMediaType(name: string | null, mimeType: string | null): "pdf" | "video" | "audio" | "image" | null {
  const lower = name?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (VIDEO_EXTS.some((ext) => lower.endsWith(ext)) || mimeType?.startsWith("video/")) return "video";
  if (AUDIO_EXTS.some((ext) => lower.endsWith(ext)) || mimeType?.startsWith("audio/")) return "audio";
  if (IMAGE_EXTS.some((ext) => lower.endsWith(ext)) || mimeType?.startsWith("image/")) return "image";
  return null;
}

// One MIME table shared with sync and the other GemiHub clients.
export { guessMimeType } from "gemihub-sync-core/files";

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return bytes;
}

/** PDF headers may be preceded by a small binary comment or whitespace. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}
