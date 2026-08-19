import * as Diff from "diff";
import {
  getCachedObject,
  getEditHistory,
  objectPathForCachedFile,
  setEditHistory,
  deleteEditHistory,
} from "~/services/storage-cache";

export interface CachedEditHistoryEntry {
  mountKey: string;
  fileId: string;
  filePath: string;
  diffs: EditHistoryDiff[];
}

export interface EditHistoryDiff {
  timestamp: string;
  diff: string;
  stats: { additions: number; deletions: number };
}

export type DiffWithOrigin = { diff: string; origin: "local" | "remote" };

function computeDiff(oldContent: string, newContent: string): { diff: string; stats: { additions: number; deletions: number } } | null {
  if (oldContent === newContent) return null;
  const patch = Diff.createTwoFilesPatch("a", "b", oldContent, newContent, "", "", { context: 3 });
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { diff: patch, stats: { additions, deletions } };
}

export async function addCommitBoundary(
  mountKey: string,
  fileId: string,
): Promise<void> {
  const existing = await getEditHistory(mountKey, fileId);
  const entry: CachedEditHistoryEntry = existing ?? {
    mountKey,
    fileId,
    filePath: fileId,
    diffs: [],
  };
  entry.diffs.push({
    timestamp: new Date().toISOString(),
    diff: "",
    stats: { additions: 0, deletions: 0 },
  });
  await setEditHistory(entry);
}

export async function saveLocalEdit(
  mountKey: string,
  fileId: string,
  filePath: string,
  newContent: string,
): Promise<CachedEditHistoryEntry | null | "reverted"> {
  const objPath = objectPathForCachedFile(mountKey, fileId);
  const cached = await getCachedObject(mountKey, objPath);
  const oldContent = cached?.content ?? "";

  const diffResult = computeDiff(oldContent, newContent);
  if (!diffResult) {
    // No change — clear history if this is a revert to cached state.
    const existing = await getEditHistory(mountKey, fileId);
    if (existing) {
      await deleteEditHistory(mountKey, fileId);
    }
    return "reverted";
  }

  const existing = await getEditHistory(mountKey, fileId);
  const entry: CachedEditHistoryEntry = existing ?? {
    mountKey,
    fileId,
    filePath,
    diffs: [],
  };
  entry.diffs.push({
    timestamp: new Date().toISOString(),
    ...diffResult,
  });
  await setEditHistory(entry);
  return entry;
}

export async function recordRestoreDiff(
  mountKey: string,
  fileId: string,
  currentContent: string,
  restoredContent: string,
): Promise<void> {
  const diffResult = computeDiff(currentContent, restoredContent);
  if (!diffResult) return;
  const existing = await getEditHistory(mountKey, fileId);
  const entry: CachedEditHistoryEntry = existing ?? {
    mountKey,
    fileId,
    filePath: fileId,
    diffs: [],
  };
  entry.diffs.push({
    timestamp: new Date().toISOString(),
    ...diffResult,
  });
  await setEditHistory(entry);
}

export async function restoreToHistoryEntry(
  _mountKey: string,
  _fileId: string,
  currentContent: string,
  diffsToApply: DiffWithOrigin[],
): Promise<string | null> {
  return reconstructContent(currentContent, diffsToApply);
}

export function reconstructContent(
  currentContent: string,
  diffs: DiffWithOrigin[],
): string | null {
  let content = currentContent;
  for (const { diff, origin } of diffs) {
    if (origin === "remote") {
      const reversed = reverseApplyDiff(content, diff);
      if (reversed !== null) content = reversed;
      continue;
    }
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
        `@@ -${hunkMatch[3]},${hunkMatch[4]} +${hunkMatch[1]},${hunkMatch[2]} @@${hunkMatch[5]}`,
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
  if (result === false) return null;
  return result;
}

export async function hasNetContentChange(
  mountKey: string,
  fileId: string,
): Promise<boolean> {
  const existing = await getEditHistory(mountKey, fileId);
  if (!existing || existing.diffs.length === 0) return false;
  // A diff with empty string and zero stats is a boundary marker; ignore it.
  return existing.diffs.some((d) => d.diff !== "" || d.stats.additions > 0 || d.stats.deletions > 0);
}

// Backward-compatible re-exports for callers that already import these names.
export async function getEditHistoryForFile(
  mountKey: string,
  fileId: string,
): Promise<CachedEditHistoryEntry | undefined> {
  return getEditHistory(mountKey, fileId);
}

export async function setEditHistoryEntry(entry: CachedEditHistoryEntry): Promise<void> {
  return setEditHistory(entry);
}

export async function deleteEditHistoryEntry(
  mountKey: string,
  fileId: string,
): Promise<void> {
  return deleteEditHistory(mountKey, fileId);
}
