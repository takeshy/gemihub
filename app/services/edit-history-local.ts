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

import * as Diff from "diff";
import {
  getEditHistoryForFile,
  setEditHistoryEntry,
  getCachedFile,
  type CachedEditHistoryEntry,
  type EditHistoryDiff,
} from "./indexeddb-cache";

/**
 * If current session has changes, adds a commit boundary so the next
 * auto-save starts a new diff session.
 *
 * Called on: file open/reload, pull, temp diff accept, resolve conflict (remote).
 */
export async function addCommitBoundary(fileId: string): Promise<void> {
  const existing = await getEditHistoryForFile(fileId);
  if (existing && existing.diffs.length > 0) {
    const lastDiff = existing.diffs[existing.diffs.length - 1];
    if (lastDiff.diff !== "") {
      existing.diffs.push({
        timestamp: new Date().toISOString(),
        diff: "",
        stats: { additions: 0, deletions: 0 },
      });
      await setEditHistoryEntry(existing);
    }
  }
}

/**
 * Called every 3s auto-save, BEFORE cache is updated.
 * Reads old content from IndexedDB cache, computes cumulative diff from base.
 */
export async function saveLocalEdit(
  fileId: string,
  filePath: string,
  newContent: string
): Promise<CachedEditHistoryEntry | null> {
  const cached = await getCachedFile(fileId);
  const oldContent = cached?.content ?? "";

  if (oldContent === newContent) return null;

  let entry = await getEditHistoryForFile(fileId);
  if (!entry) {
    entry = { fileId, filePath, diffs: [] };
  }

  let baseContent: string;

  if (entry.diffs.length === 0 || entry.diffs[entry.diffs.length - 1].diff === "") {
    // No diffs yet or last is commit marker → base = old cache content
    baseContent = oldContent;
  } else {
    // Reverse-apply last diff to old cache content to reconstruct base
    const reconstructed = reverseApplyDiff(oldContent, entry.diffs[entry.diffs.length - 1].diff);
    if (reconstructed === null) {
      // Reverse-apply failed — insert commit boundary and start new session
      entry.diffs.push({
        timestamp: new Date().toISOString(),
        diff: "",
        stats: { additions: 0, deletions: 0 },
      });
      baseContent = oldContent;
    } else {
      baseContent = reconstructed;
    }
  }

  const { diff, stats } = createDiffStr(baseContent, newContent, 3);
  if (stats.additions === 0 && stats.deletions === 0) return null;

  const diffEntry: EditHistoryDiff = {
    timestamp: new Date().toISOString(),
    diff,
    stats,
  };

  if (entry.diffs.length === 0) {
    // First diff → append
    entry.diffs.push(diffEntry);
  } else {
    // Replace last entry (commit marker or previous cumulative diff)
    entry.diffs[entry.diffs.length - 1] = diffEntry;
  }

  entry.filePath = filePath;
  await setEditHistoryEntry(entry);
  return entry;
}

/**
 * Record a restore operation as a diff entry in local history.
 * Adds commit boundary + restore diff + commit boundary.
 */
export async function recordRestoreDiff(
  fileId: string,
  currentContent: string,
  restoredContent: string
): Promise<void> {
  let entry = await getEditHistoryForFile(fileId);
  if (!entry) {
    entry = { fileId, filePath: "", diffs: [] };
  }

  const now = new Date().toISOString();
  const lastDiff = entry.diffs[entry.diffs.length - 1];

  // Add commit boundary if current session has changes
  if (lastDiff && lastDiff.diff !== "") {
    entry.diffs.push({ timestamp: now, diff: "", stats: { additions: 0, deletions: 0 } });
  }

  // Add restore diff (from current content to restored content)
  const { diff, stats } = createDiffStr(currentContent, restoredContent, 3);
  if (diff) {
    entry.diffs.push({ timestamp: now, diff, stats });
    // Add commit boundary after restore
    entry.diffs.push({ timestamp: now, diff: "", stats: { additions: 0, deletions: 0 } });
  }

  await setEditHistoryEntry(entry);
}

export type DiffWithOrigin = { diff: string; origin: "local" | "remote" };

/**
 * Reconstruct content and record the restore as a new history entry.
 */
export async function restoreToHistoryEntry(
  fileId: string,
  currentContent: string,
  diffsToApply: DiffWithOrigin[]
): Promise<string | null> {
  const restoredContent = reconstructContent(currentContent, diffsToApply);
  if (restoredContent === null) return null;

  await recordRestoreDiff(fileId, currentContent, restoredContent);
  return restoredContent;
}

/**
 * Reconstruct file content at a specific point in history by reverse-applying diffs.
 * diffs should be ordered from newest to oldest.
 *
 * Local diffs are always reverse-applied (cache is the newest content).
 * Remote diffs: try reverse-apply first (content is at NEW side after pull).
 * If reverse-apply fails, the content is at the OLD side (not yet pulled) — skip.
 */
export function reconstructContent(
  currentContent: string,
  diffs: DiffWithOrigin[]
): string | null {
  let content = currentContent;
  for (const { diff, origin } of diffs) {
    if (origin === "remote") {
      const reversed = reverseApplyDiff(content, diff);
      if (reversed !== null) {
        content = reversed;
      }
      // else: content is at the OLD side (not pulled) — skip
      continue;
    }
    // Local: always reverse-apply
    const reversed = reverseApplyDiff(content, diff);
    if (reversed === null) return null;
    content = reversed;
  }
  return content;
}

export function reverseApplyDiff(content: string, diffStr: string): string | null {
  const lines = diffStr.split("\n");
  const reversed: string[] = [];

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@(.*)$/);
    if (hunkMatch) {
      reversed.push(
        `@@ -${hunkMatch[3]},${hunkMatch[4]} +${hunkMatch[1]},${hunkMatch[2]} @@${hunkMatch[5]}`
      );
    } else if (line.startsWith("+")) {
      reversed.push("-" + line.slice(1));
    } else if (line.startsWith("-")) {
      reversed.push("+" + line.slice(1));
    } else {
      reversed.push(line);
    }
  }

  const fullPatch = `--- original\n+++ modified\n${reversed.join("\n")}\n`;
  const result = Diff.applyPatch(content, fullPatch);
  if (result === false) {
    return null;
  }
  return result;
}

function createDiffStr(
  originalContent: string,
  modifiedContent: string,
  contextLines: number
): { diff: string; stats: { additions: number; deletions: number } } {
  const patch = Diff.structuredPatch(
    "original",
    "modified",
    originalContent,
    modifiedContent,
    undefined,
    undefined,
    { context: contextLines }
  );

  const lines: string[] = [];
  let additions = 0;
  let deletions = 0;

  for (const hunk of patch.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    );
    for (const line of hunk.lines) {
      lines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
  }

  return { diff: lines.join("\n"), stats: { additions, deletions } };
}
