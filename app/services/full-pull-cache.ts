import type { CachedFile } from "./indexeddb-cache";

export interface FullPullFilePayload {
  fileId: string;
  content: string;
  md5Checksum: string;
  modifiedTime: string;
  fileName: string;
  encoding?: "base64";
}

/** Build the authoritative cache record returned by Full Pull. */
export function fullPullCacheRecord(
  file: FullPullFilePayload,
  cachedAt = Date.now(),
): CachedFile {
  return {
    fileId: file.fileId,
    content: file.content,
    md5Checksum: file.md5Checksum,
    modifiedTime: file.modifiedTime,
    cachedAt,
    fileName: file.fileName,
    ...(file.encoding ? { encoding: file.encoding } : {}),
  };
}
