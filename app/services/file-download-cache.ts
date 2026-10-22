import { shouldTreatAsBinaryFile } from "gemihub-sync-core/files";

/** A binary file's old text cache cannot reproduce its original bytes. */
export function canDownloadCachedFile(
  cached: { rawContentBase64?: string; encoding?: "base64" },
  fileName: string,
  mimeType?: string,
): boolean {
  return Boolean(cached.rawContentBase64)
    || cached.encoding === "base64"
    || !shouldTreatAsBinaryFile(fileName, mimeType);
}
