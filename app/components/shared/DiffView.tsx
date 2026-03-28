import { useMemo } from "react";
import * as Diff from "diff";

export type DiffViewMode = "unified" | "split";

interface DiffViewProps {
  diff: string;
  viewMode?: DiffViewMode;
}

interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

interface LinePair {
  removedContent: string;
  addedContent: string;
}

// Parse unified diff string into structured DiffLine[]
function parseDiffLines(diff: string): DiffLine[] {
  // Remove trailing newline to avoid a phantom empty line at the end
  const lines = diff.replace(/\n$/, "").split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Skip file headers
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("Index:") || line.startsWith("===")) {
      continue;
    }
    // Parse hunk header for line numbers
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ type: "added", content: line.slice(1), oldLineNum: null, newLineNum: newLine });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({ type: "removed", content: line.slice(1), oldLineNum: oldLine, newLineNum: null });
      oldLine++;
    } else if (line.startsWith(" ")) {
      result.push({ type: "unchanged", content: line.slice(1), oldLineNum: oldLine, newLineNum: newLine });
      oldLine++;
      newLine++;
    }
    // Bare empty lines that don't start with ' ', '+', or '-' are ignored
    // (e.g. the "\ No newline at end of file" marker)
  }
  return result;
}

// Build pairs of removed/added lines for word-level diff
function buildLinePairs(diffLines: DiffLine[]): Map<number, LinePair> {
  const pairs = new Map<number, LinePair>();
  let i = 0;
  while (i < diffLines.length) {
    if (diffLines[i].type === "removed") {
      const removed: number[] = [];
      const added: number[] = [];
      while (i < diffLines.length && diffLines[i].type === "removed") {
        removed.push(i);
        i++;
      }
      while (i < diffLines.length && diffLines[i].type === "added") {
        added.push(i);
        i++;
      }
      const pairCount = Math.min(removed.length, added.length);
      for (let j = 0; j < pairCount; j++) {
        const pair: LinePair = {
          removedContent: diffLines[removed[j]].content,
          addedContent: diffLines[added[j]].content,
        };
        pairs.set(removed[j], pair);
        pairs.set(added[j], pair);
      }
    } else {
      i++;
    }
  }
  return pairs;
}

// Pair diff lines for split view
function pairLinesForSplitView(diffLines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < diffLines.length) {
    if (diffLines[i].type === "unchanged") {
      rows.push({ left: diffLines[i], right: diffLines[i] });
      i++;
    } else {
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type === "removed") {
        removed.push(diffLines[i]);
        i++;
      }
      while (i < diffLines.length && diffLines[i].type === "added") {
        added.push(diffLines[i]);
        i++;
      }
      const maxLen = Math.max(removed.length, added.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < removed.length ? removed[j] : null,
          right: j < added.length ? added[j] : null,
        });
      }
    }
  }
  return rows;
}

// Render word-level diff for a line
function WordDiffContent({
  oldContent,
  newContent,
  side,
}: {
  oldContent: string;
  newContent: string;
  side: "old" | "new";
}) {
  const changes = Diff.diffWords(oldContent, newContent);
  return (
    <>
      {changes.map((change, i) => {
        if (change.added) {
          return side === "new" ? (
            <span key={i} className="bg-green-300 dark:bg-green-700/60 rounded-sm font-semibold">{change.value}</span>
          ) : null;
        }
        if (change.removed) {
          return side === "old" ? (
            <span key={i} className="bg-red-300 dark:bg-red-700/60 rounded-sm font-semibold">{change.value}</span>
          ) : null;
        }
        return <span key={i}>{change.value}</span>;
      })}
    </>
  );
}

// Line content renderer with optional word-level diff
function LineContent({
  line,
  lineIndex,
  linePairs,
}: {
  line: DiffLine;
  lineIndex: number;
  linePairs: Map<number, LinePair>;
}) {
  const pair = linePairs.get(lineIndex);
  if (pair && line.type === "removed") {
    return <WordDiffContent oldContent={pair.removedContent} newContent={pair.addedContent} side="old" />;
  }
  if (pair && line.type === "added") {
    return <WordDiffContent oldContent={pair.removedContent} newContent={pair.addedContent} side="new" />;
  }
  return <>{line.content || " "}</>;
}

function UnifiedView({ diffLines, linePairs }: { diffLines: DiffLine[]; linePairs: Map<number, LinePair> }) {
  return (
    <pre className="text-xs font-mono leading-relaxed p-0">
      {diffLines.map((line, i) => {
        let rowClass = "text-gray-600 dark:text-gray-400";
        let gutter = " ";
        if (line.type === "added") {
          rowClass = "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300";
          gutter = "+";
        } else if (line.type === "removed") {
          rowClass = "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300";
          gutter = "-";
        }
        return (
          <div key={i} className={`flex ${rowClass}`}>
            <span className="select-none w-8 text-right pr-1 text-gray-400 dark:text-gray-600 shrink-0">
              {line.oldLineNum ?? ""}
            </span>
            <span className="select-none w-8 text-right pr-1 text-gray-400 dark:text-gray-600 shrink-0">
              {line.newLineNum ?? ""}
            </span>
            <span className="select-none w-4 text-center shrink-0">{gutter}</span>
            <span className="flex-1 whitespace-pre-wrap break-all">
              <LineContent line={line} lineIndex={i} linePairs={linePairs} />
            </span>
          </div>
        );
      })}
    </pre>
  );
}

function SplitView({ diffLines, linePairs }: { diffLines: DiffLine[]; linePairs: Map<number, LinePair> }) {
  const rows = useMemo(() => pairLinesForSplitView(diffLines), [diffLines]);

  // We need to find the actual index in diffLines for linePairs lookup.
  // Build a map from DiffLine object identity to its index.
  const lineIndexMap = useMemo(() => {
    const map = new Map<DiffLine, number>();
    diffLines.forEach((line, idx) => map.set(line, idx));
    return map;
  }, [diffLines]);

  return (
    <pre className="text-xs font-mono leading-relaxed p-0">
      {rows.map((row, i) => (
        <div key={i} className="flex">
          {/* Left (old) */}
          <div
            className={`flex flex-1 min-w-0 border-r border-gray-200 dark:border-gray-700 ${
              row.left
                ? row.left.type === "removed"
                  ? "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300"
                  : "text-gray-600 dark:text-gray-400"
                : "bg-gray-50 dark:bg-gray-900/50"
            }`}
          >
            {row.left ? (
              <>
                <span className="select-none w-8 text-right pr-1 text-gray-400 dark:text-gray-600 shrink-0">
                  {row.left.oldLineNum ?? ""}
                </span>
                <span className="select-none w-4 text-center shrink-0">
                  {row.left.type === "removed" ? "-" : " "}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all">
                  {row.left.type === "removed" ? (
                    <LineContent line={row.left} lineIndex={lineIndexMap.get(row.left) ?? -1} linePairs={linePairs} />
                  ) : (
                    row.left.content || " "
                  )}
                </span>
              </>
            ) : (
              <span className="flex-1">&nbsp;</span>
            )}
          </div>
          {/* Right (new) */}
          <div
            className={`flex flex-1 min-w-0 ${
              row.right
                ? row.right.type === "added"
                  ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                  : "text-gray-600 dark:text-gray-400"
                : "bg-gray-50 dark:bg-gray-900/50"
            }`}
          >
            {row.right ? (
              <>
                <span className="select-none w-8 text-right pr-1 text-gray-400 dark:text-gray-600 shrink-0">
                  {row.right.newLineNum ?? ""}
                </span>
                <span className="select-none w-4 text-center shrink-0">
                  {row.right.type === "added" ? "+" : " "}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all">
                  {row.right.type === "added" ? (
                    <LineContent line={row.right} lineIndex={lineIndexMap.get(row.right) ?? -1} linePairs={linePairs} />
                  ) : (
                    row.right.content || " "
                  )}
                </span>
              </>
            ) : (
              <span className="flex-1">&nbsp;</span>
            )}
          </div>
        </div>
      ))}
    </pre>
  );
}

export function DiffViewToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 text-[10px]">
      <button
        onClick={() => onViewModeChange("unified")}
        className={`px-1.5 py-0.5 rounded-l border ${
          viewMode === "unified"
            ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
            : "text-gray-500 border-gray-300 hover:bg-gray-100 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-800"
        }`}
      >
        Unified
      </button>
      <button
        onClick={() => onViewModeChange("split")}
        className={`px-1.5 py-0.5 rounded-r border border-l-0 ${
          viewMode === "split"
            ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
            : "text-gray-500 border-gray-300 hover:bg-gray-100 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-800"
        }`}
      >
        Split
      </button>
    </div>
  );
}

export function DiffView({ diff, viewMode = "unified" }: DiffViewProps) {
  const diffLines = useMemo(() => (diff ? parseDiffLines(diff) : []), [diff]);
  const linePairs = useMemo(() => buildLinePairs(diffLines), [diffLines]);

  if (!diff || diffLines.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400">No diff available</div>
    );
  }

  if (viewMode === "split") {
    return <SplitView diffLines={diffLines} linePairs={linePairs} />;
  }

  return <UnifiedView diffLines={diffLines} linePairs={linePairs} />;
}
