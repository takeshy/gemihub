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

export function guessMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg", mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska",
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}

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
