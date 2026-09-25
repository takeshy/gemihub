// Pure diff helpers shared by local (IndexedDB) and remote (Drive / GCS)
// edit history. No I/O — safe to import from both client and server code.
//
// Diff format: bare unified-diff hunks ("@@ -a,b +c,d @@" + " "/"+"/"-"
// prefixed lines), without file headers.

import * as Diff from "diff";

export type DiffStats = { additions: number; deletions: number };

export interface EditHistoryDiffEntry {
  timestamp: string;
  diff: string;
  stats: DiffStats;
}

export type DiffWithOrigin = { diff: string; origin: "local" | "remote" };

export function createDiffStr(
  originalContent: string,
  modifiedContent: string,
  contextLines: number
): { diff: string; stats: DiffStats } {
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
    // Hunk lines never contain file headers, so every "+"/"-" line is a
    // change — including content that itself starts with "++" / "--"
    // (e.g. a deleted "---" frontmatter delimiter is the line "----").
    for (const line of hunk.lines) {
      lines.push(line);
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
  }

  return { diff: lines.join("\n"), stats: { additions, deletions } };
}

/**
 * Undo a diff. Returns null when the patch does not apply to `content`.
 *
 * Accepts bare hunks as well as full patches with file headers
 * (older project-mount entries were stored via createTwoFilesPatch):
 * anything before the first hunk header is ignored.
 */
export function reverseApplyDiff(content: string, diffStr: string): string | null {
  const lines = diffStr.split("\n");
  const reversed: string[] = [];
  let inHunks = false;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      inHunks = true;
      const [, oldStart, oldLines = "1", newStart, newLines = "1", rest] = hunkMatch;
      reversed.push(`@@ -${newStart},${newLines} +${oldStart},${oldLines} @@${rest}`);
    } else if (!inHunks) {
      // File headers ("===", "Index:", "--- a", "+++ b") — not part of the patch body.
      continue;
    } else if (line.startsWith("+")) {
      reversed.push("-" + line.slice(1));
    } else if (line.startsWith("-")) {
      reversed.push("+" + line.slice(1));
    } else {
      reversed.push(line);
    }
  }

  if (!inHunks) return null;

  const fullPatch = `--- original\n+++ modified\n${reversed.join("\n")}\n`;
  try {
    const result = Diff.applyPatch(content, fullPatch);
    return result === false ? null : result;
  } catch {
    // Malformed patch — treat like a mismatch rather than crashing the caller.
    return null;
  }
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

function boundary(timestamp: string): EditHistoryDiffEntry {
  return { timestamp, diff: "", stats: { additions: 0, deletions: 0 } };
}

/** diffs with a commit boundary appended if the current session has changes, or null if none is needed. */
export function withCommitBoundary(
  diffs: EditHistoryDiffEntry[],
  timestamp: string
): EditHistoryDiffEntry[] | null {
  const last = diffs[diffs.length - 1];
  if (!last || last.diff === "") return null;
  return [...diffs, boundary(timestamp)];
}

export type LocalEditStep =
  /** Nothing to record. */
  | { action: "none" }
  /** No meaningful diffs remain — delete the history entry (file reverted). */
  | { action: "delete" }
  /** Store `diffs`. `reverted` = the current session was undone but older sessions remain. */
  | { action: "save"; diffs: EditHistoryDiffEntry[]; reverted: boolean };

/**
 * Auto-save step: fold `oldContent → newContent` into the current diff session.
 * `oldContent` must be the cached content BEFORE the cache is updated.
 *
 * - Last diff empty (or none) → base = oldContent.
 * - Last diff non-empty → reverse-apply it to oldContent to reconstruct the
 *   session base, then overwrite it with the cumulative diff base → new.
 */
export function computeLocalEditStep(
  existingDiffs: EditHistoryDiffEntry[],
  oldContent: string,
  newContent: string,
  timestamp: string
): LocalEditStep {
  if (oldContent === newContent) return { action: "none" };

  const diffs = [...existingDiffs];
  let baseContent: string;
  const last = diffs[diffs.length - 1];

  if (!last || last.diff === "") {
    baseContent = oldContent;
  } else {
    const reconstructed = reverseApplyDiff(oldContent, last.diff);
    if (reconstructed === null) {
      // Reverse-apply failed — seal the session and start a new one.
      diffs.push(boundary(timestamp));
      baseContent = oldContent;
    } else {
      baseContent = reconstructed;
    }
  }

  const { diff, stats } = createDiffStr(baseContent, newContent, 3);
  if (stats.additions === 0 && stats.deletions === 0) {
    // Content matches session base — the current session was reverted.
    if (diffs.length > 0 && diffs[diffs.length - 1].diff !== "") {
      diffs.pop();
    }
    if (!diffs.some((d) => d.diff !== "")) return { action: "delete" };
    return { action: "save", diffs, reverted: true };
  }

  const entry: EditHistoryDiffEntry = { timestamp, diff, stats };
  if (diffs.length === 0) {
    diffs.push(entry);
  } else {
    // Replace last entry (commit marker or previous cumulative diff)
    diffs[diffs.length - 1] = entry;
  }
  return { action: "save", diffs, reverted: false };
}

/** Diffs recording a restore: [boundary] + diff(current → restored) + boundary. */
export function appendRestoreDiff(
  existingDiffs: EditHistoryDiffEntry[],
  currentContent: string,
  restoredContent: string,
  timestamp: string
): EditHistoryDiffEntry[] {
  const diffs = withCommitBoundary(existingDiffs, timestamp) ?? [...existingDiffs];
  const { diff, stats } = createDiffStr(currentContent, restoredContent, 3);
  if (diff) {
    diffs.push({ timestamp, diff, stats });
    diffs.push(boundary(timestamp));
  }
  return diffs;
}
