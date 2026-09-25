// Client-side edit history using IndexedDB
//
// Design: CachedFile.content (cache) always holds the latest file content.
// Each file has one CachedEditHistoryEntry with diffs[]: array of diff entries.
//
// Auto-save (saveLocalEdit):
//   Called BEFORE cache is updated. Reads old content from cache.
//   - If diffs is empty or last diff is empty (commit marker):
//     base = oldContent, compute diff(base, newContent), append or replace last.
//   - If last diff is non-empty:
//     reverse-apply last diff to oldContent → base, diff(base, newContent), overwrite last.
//
// addCommitBoundary:
//   Adds empty diff entry as commit boundary. Next saveLocalEdit starts new session.
//   Called on file open/reload/pull, temp diff accept, resolve conflict (remote).
//
// The diff algorithm itself lives in ~/utils/edit-history-diff (shared with
// the project-mount store in edit-history-storage.ts).

import {
  getEditHistoryForFile,
  setEditHistoryEntry,
  deleteEditHistoryEntry,
  getCachedFile,
  type CachedEditHistoryEntry,
} from "./indexeddb-cache";
import {
  appendRestoreDiff,
  computeLocalEditStep,
  createDiffStr,
  reconstructContent,
  withCommitBoundary,
  type DiffWithOrigin,
} from "~/utils/edit-history-diff";

export { reconstructContent, reverseApplyDiff, type DiffWithOrigin } from "~/utils/edit-history-diff";

/**
 * If current session has changes, adds a commit boundary so the next
 * auto-save starts a new diff session.
 *
 * Called on: file open/reload, pull, temp diff accept, resolve conflict (remote).
 */
export async function addCommitBoundary(fileId: string): Promise<void> {
  const existing = await getEditHistoryForFile(fileId);
  if (!existing) return;
  const diffs = withCommitBoundary(existing.diffs, new Date().toISOString());
  if (diffs) await setEditHistoryEntry({ ...existing, diffs });
}

/**
 * Called every 1s auto-save (debounced), BEFORE cache is updated.
 * Reads old content from IndexedDB cache, computes cumulative diff from base.
 */
export async function saveLocalEdit(
  fileId: string,
  filePath: string,
  newContent: string
): Promise<CachedEditHistoryEntry | null | "reverted"> {
  const cached = await getCachedFile(fileId);
  const oldContent = cached?.content ?? "";
  if (oldContent === newContent) return null;

  const existing = await getEditHistoryForFile(fileId);
  const step = computeLocalEditStep(existing?.diffs ?? [], oldContent, newContent, new Date().toISOString());

  switch (step.action) {
    case "none":
      return null;
    case "delete":
      if (existing) await deleteEditHistoryEntry(fileId);
      return "reverted";
    case "save": {
      const entry: CachedEditHistoryEntry = {
        fileId,
        filePath: step.reverted ? existing?.filePath ?? filePath : filePath,
        diffs: step.diffs,
      };
      await setEditHistoryEntry(entry);
      return step.reverted ? null : entry;
    }
  }
}

/**
 * Record a restore operation as a diff entry in local history.
 * Adds commit boundary + restore diff + commit boundary.
 */
export async function recordRestoreDiff(
  fileId: string,
  currentContent: string,
  restoredContent: string,
  filePath?: string
): Promise<void> {
  const existing = await getEditHistoryForFile(fileId);
  const diffs = appendRestoreDiff(existing?.diffs ?? [], currentContent, restoredContent, new Date().toISOString());
  await setEditHistoryEntry({
    fileId,
    filePath: existing?.filePath || filePath || "",
    diffs,
  });
}

/**
 * Reconstruct content and record the restore as a new history entry.
 */
export async function restoreToHistoryEntry(
  fileId: string,
  currentContent: string,
  diffsToApply: DiffWithOrigin[],
  filePath?: string
): Promise<string | null> {
  const restoredContent = reconstructContent(currentContent, diffsToApply);
  if (restoredContent === null) return null;

  await recordRestoreDiff(fileId, currentContent, restoredContent, filePath);
  return restoredContent;
}

/**
 * Check if a file has actual content changes compared to its original synced state.
 * Reconstructs the original content by reverse-applying all editHistory diffs.
 * Returns false if content has been reverted to original (no net change).
 */
export async function hasNetContentChange(fileId: string): Promise<boolean> {
  const original = await getOriginalContentForPush(fileId);
  const cached = await getCachedFile(fileId);
  if (!cached) return false;
  if (original === null) return true; // Can't reconstruct → assume changed
  return original !== cached.content;
}

/** Reconstruct the last synced text for server-side history generation. */
export async function getOriginalContentForPush(fileId: string): Promise<string | null> {
  const cached = await getCachedFile(fileId);
  if (!cached || cached.encoding === "base64") return null;
  const editHistory = await getEditHistoryForFile(fileId);
  if (!editHistory) return null;
  const meaningfulDiffs = editHistory.diffs.filter((entry) => entry.diff !== "");
  if (meaningfulDiffs.length === 0) return cached.content;
  const diffs: DiffWithOrigin[] = [...meaningfulDiffs]
    .reverse()
    .map((entry) => ({ diff: entry.diff, origin: "local" as const }));
  return reconstructContent(cached.content, diffs);
}

export async function getPushHistoryDiff(fileId: string): Promise<{
  diff: string;
  stats: { additions: number; deletions: number };
} | null> {
  const cached = await getCachedFile(fileId);
  if (!cached || cached.encoding === "base64") return null;
  const original = await getOriginalContentForPush(fileId);
  if (original === null) return null;
  const result = createDiffStr(original, cached.content, 3);
  return result.diff ? result : null;
}
