// Frontmatter index — extends existing CachedFile records with parsed frontmatter.
// No dedicated IndexedDB store; frontmatter is stored on the CachedFile record itself.
// Lazy parsing: file-table widget triggers parse on first access for unparse records.
// The write-time hook in setCachedFile (indexeddb-cache.ts) handles new/updated files.

import {
  getCachedFile,
  setCachedFile,
  type CachedFile,
} from "~/services/indexeddb-cache";
import { parseFrontmatter, isMarkdownFile } from "~/utils/frontmatter";

/**
 * Ensure frontmatter is parsed and cached for a CachedFile record.
 * Re-parses only if fmParsedMtime doesn't match the current modifiedTime.
 * Writes the updated record back to cache.
 * Returns the parsed frontmatter ({} if no frontmatter or not a .md file).
 */
export async function ensureFrontmatterCached(
  file: CachedFile,
): Promise<Record<string, unknown>> {
  if (!isMarkdownFile(file.fileName)) return {};

  const mtimeMs = file.modifiedTime
    ? new Date(file.modifiedTime).getTime()
    : file.cachedAt;

  if (file.frontmatter !== undefined && file.fmParsedMtime === mtimeMs) {
    return file.frontmatter;
  }

  const frontmatter = parseFrontmatter(file.content);

  // Write back to cache with parsed frontmatter
  await setCachedFile({
    ...file,
    frontmatter,
    fmParsedMtime: mtimeMs,
  });

  return frontmatter;
}

/**
 * Get frontmatter for a file by fileId.
 * If the file is cached but frontmatter hasn't been parsed yet,
 * parses it lazily and writes back to cache.
 * Returns {} for non-markdown files, uncached files, or files without frontmatter.
 */
export async function getFrontmatterForFile(
  fileId: string,
): Promise<Record<string, unknown>> {
  const cached = await getCachedFile(fileId);
  if (!cached) return {};
  return ensureFrontmatterCached(cached);
}
