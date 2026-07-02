// Local-first Drive IO for memo files (one markdown file per document under
// Dashboards/Memos/). All writes go through drive-local's IndexedDB cache +
// editHistory; Drive is only touched by the Push flow.

import { readFileLocal, writeFileLocal, findFileByNameLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { memoFilePathFor } from "./memoPath";
import { appendEntryBlock, buildEntryBlock, uniqueEntryId } from "./memoTimeline";

export const MEMO_DIR = "Dashboards/Memos";

/** Memo file path for a document's Drive path. */
export function memoPathForDocument(drivePath: string): string {
  return memoFilePathFor(MEMO_DIR, drivePath);
}

export interface MemoFileRead {
  exists: boolean;
  content: string;
  fileId: string | null;
}

export async function readMemoFileLocal(memoPath: string): Promise<MemoFileRead> {
  const file = await findFileByNameLocal(memoPath);
  if (!file) return { exists: false, content: "", fileId: null };
  const content = await readFileLocal(file.id);
  return { exists: true, content, fileId: file.id };
}

export interface MemoDraftFields {
  anchor: string;
  quote: string;
  quotePrefix: string;
  quoteSuffix: string;
}

/**
 * Append a memo entry for a document. Re-reads the memo file right before
 * writing so concurrent widgets on the same document cannot clobber each
 * other's posts.
 */
export async function postMemoEntry(
  drivePath: string,
  body: string,
  draft: MemoDraftFields | null,
): Promise<void> {
  const memoPath = memoPathForDocument(drivePath);
  const now = new Date();
  const current = await readMemoFileLocal(memoPath);
  const block = buildEntryBlock({
    createdAt: now.toISOString(),
    id: uniqueEntryId(current.content, now),
    anchor: draft?.anchor || null,
    quotePrefix: draft?.quotePrefix ?? "",
    quoteSuffix: draft?.quoteSuffix ?? "",
    quote: draft?.quote ?? "",
    body,
  });
  const next = appendEntryBlock(current.content, drivePath, block);
  await writeFileLocal(memoPath, next, current.fileId ? { existingFileId: current.fileId } : undefined);
}

/**
 * Rewrite a memo file (edit/delete/pin) with the same re-read-before-write
 * pattern. Throws when the file is missing or the mutation finds no entry.
 */
export async function rewriteMemoEntry(
  drivePath: string,
  mutate: (content: string) => string | null,
): Promise<void> {
  const memoPath = memoPathForDocument(drivePath);
  const current = await readMemoFileLocal(memoPath);
  if (!current.exists || !current.fileId) throw new Error("memo file is missing");
  const next = mutate(current.content);
  if (next === null) throw new Error("entry not found");
  await writeFileLocal(memoPath, next, { existingFileId: current.fileId });
}

export interface MemoListFile {
  fileId: string;
  memoPath: string;
  modifiedTime: string;
}

/**
 * All memo files under Dashboards/Memos/, newest first. Scans the cached
 * remote meta directly because listFilesLocal excludes the Dashboards/ prefix.
 */
export async function listMemoFilesLocal(): Promise<MemoListFile[]> {
  const meta = await getCachedRemoteMeta();
  if (!meta) return [];
  const prefix = `${MEMO_DIR}/`;
  const out: MemoListFile[] = [];
  for (const [fileId, entry] of Object.entries(meta.files)) {
    if (!entry.name.startsWith(prefix)) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    out.push({ fileId, memoPath: entry.name, modifiedTime: entry.modifiedTime });
  }
  return out.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
}
