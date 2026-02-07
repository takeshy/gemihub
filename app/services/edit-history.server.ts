// Edit history manager - Drive-based persistence (called at Push time)

import crypto from "node:crypto";
import * as Diff from "diff";
import {
  readFile,
  createFile,
  updateFile,
  deleteFile,
  listFiles,
  getHistoryFolderId,
  ensureSubFolder,
} from "./google-drive.server";
import type { EditHistorySettings } from "~/types/settings";

const EDIT_HISTORY_FOLDER = "files";

export interface EditHistoryEntry {
  id: string;
  timestamp: string;
  source: "workflow" | "propose_edit" | "manual" | "auto";
  workflowName?: string;
  model?: string;
  diff: string;
  stats: {
    additions: number;
    deletions: number;
  };
}

export interface EditHistoryFile {
  version: number;
  path: string;
  entries: EditHistoryEntry[];
}

export interface EditHistoryStats {
  totalFiles: number;
  totalEntries: number;
}

/**
 * Ensure edit-history subfolder exists under history/
 */
async function ensureEditHistoryFolderId(
  accessToken: string,
  rootFolderId: string
): Promise<string> {
  const historyFolderId = await getHistoryFolderId(accessToken, rootFolderId);
  return ensureSubFolder(accessToken, historyFolderId, EDIT_HISTORY_FOLDER);
}

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").substring(0, 8);
}

function pathToHistoryFileName(filePath: string): string {
  return filePath.replace(/\//g, "-") + ".history.json";
}

/**
 * Find a file by name in the edit-history folder
 */
async function findFileByName(
  accessToken: string,
  folderId: string,
  fileName: string
): Promise<string | null> {
  const files = await listFiles(accessToken, folderId);
  const found = files.find((f) => f.name === fileName);
  return found?.id ?? null;
}

/**
 * Load history file
 */
async function loadHistoryFile(
  accessToken: string,
  historyFolderId: string,
  filePath: string
): Promise<{ history: EditHistoryFile; fileId: string | null }> {
  const fileName = pathToHistoryFileName(filePath);
  const fileId = await findFileByName(accessToken, historyFolderId, fileName);

  if (!fileId) {
    return {
      history: { version: 1, path: filePath, entries: [] },
      fileId: null,
    };
  }

  try {
    const content = await readFile(accessToken, fileId);
    return { history: JSON.parse(content) as EditHistoryFile, fileId };
  } catch {
    return {
      history: { version: 1, path: filePath, entries: [] },
      fileId,
    };
  }
}

/**
 * Save history file
 */
async function saveHistoryFile(
  accessToken: string,
  historyFolderId: string,
  filePath: string,
  history: EditHistoryFile,
  existingFileId: string | null
): Promise<void> {
  const content = JSON.stringify(history, null, 2);
  const fileName = pathToHistoryFileName(filePath);

  if (existingFileId) {
    await updateFile(accessToken, existingFileId, content, "application/json");
  } else {
    await createFile(accessToken, fileName, content, historyFolderId, "application/json");
  }
}

/**
 * Create a unified diff between two strings
 */
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
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      lines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
  }

  return { diff: lines.join("\n"), stats: { additions, deletions } };
}

// --- Public API ---

/**
 * Save an edit to Drive history (oldContent → newContent forward diff)
 */
export async function saveEdit(
  accessToken: string,
  rootFolderId: string,
  settings: EditHistorySettings,
  params: {
    path: string;
    oldContent: string;
    newContent: string;
    source: "workflow" | "propose_edit" | "manual" | "auto";
    workflowName?: string;
    model?: string;
  }
): Promise<EditHistoryEntry | null> {
  const historyFolderId = await ensureEditHistoryFolderId(accessToken, rootFolderId);

  const { diff, stats } = createDiffStr(params.oldContent, params.newContent, settings.diff.contextLines);

  if (stats.additions === 0 && stats.deletions === 0) return null;

  const entry: EditHistoryEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    source: params.source,
    workflowName: params.workflowName,
    model: params.model,
    diff,
    stats,
  };

  const { history, fileId: historyFileId } = await loadHistoryFile(
    accessToken,
    historyFolderId,
    params.path
  );

  history.entries.push(entry);

  if (settings.retention.maxEntriesPerFile > 0) {
    while (history.entries.length > settings.retention.maxEntriesPerFile) {
      history.entries.shift();
    }
  }

  await saveHistoryFile(accessToken, historyFolderId, params.path, history, historyFileId);

  return entry;
}

/**
 * Get history for a file
 */
export async function getHistory(
  accessToken: string,
  rootFolderId: string,
  filePath: string
): Promise<EditHistoryEntry[]> {
  const historyFolderId = await ensureEditHistoryFolderId(accessToken, rootFolderId);
  const { history } = await loadHistoryFile(accessToken, historyFolderId, filePath);
  return history.entries;
}

/**
 * Prune old history entries
 */
export async function prune(
  accessToken: string,
  rootFolderId: string,
  settings: EditHistorySettings
): Promise<{ deletedCount: number }> {
  const historyFolderId = await ensureEditHistoryFolderId(accessToken, rootFolderId);
  const files = await listFiles(accessToken, historyFolderId);
  const maxAgeMs =
    settings.retention.maxAgeInDays > 0
      ? settings.retention.maxAgeInDays * 24 * 60 * 60 * 1000
      : 0;
  const now = Date.now();
  let deletedCount = 0;

  for (const file of files) {
    if (!file.name.endsWith(".history.json")) continue;

    try {
      const content = await readFile(accessToken, file.id);
      const history = JSON.parse(content) as EditHistoryFile;
      const originalCount = history.entries.length;

      if (maxAgeMs > 0) {
        history.entries = history.entries.filter(
          (e) => now - new Date(e.timestamp).getTime() < maxAgeMs
        );
      }

      if (settings.retention.maxEntriesPerFile > 0 && history.entries.length > settings.retention.maxEntriesPerFile) {
        history.entries = history.entries.slice(-settings.retention.maxEntriesPerFile);
      }

      deletedCount += originalCount - history.entries.length;

      if (history.entries.length === 0) {
        await deleteFile(accessToken, file.id);
      } else if (history.entries.length !== originalCount) {
        await updateFile(accessToken, file.id, JSON.stringify(history, null, 2), "application/json");
      }
    } catch {
      // Skip
    }
  }

  return { deletedCount };
}

/**
 * Get statistics about edit history
 */
export async function getStats(
  accessToken: string,
  rootFolderId: string
): Promise<EditHistoryStats> {
  const historyFolderId = await ensureEditHistoryFolderId(accessToken, rootFolderId);
  const files = await listFiles(accessToken, historyFolderId);
  let totalFiles = 0;
  let totalEntries = 0;

  for (const file of files) {
    if (!file.name.endsWith(".history.json")) continue;

    try {
      totalFiles++;
      const content = await readFile(accessToken, file.id);
      const history = JSON.parse(content) as EditHistoryFile;
      totalEntries += history.entries.length;
    } catch {
      // Skip
    }
  }

  return { totalFiles, totalEntries };
}

/**
 * Clear all history for a specific file
 */
export async function clearHistory(
  accessToken: string,
  rootFolderId: string,
  filePath: string
): Promise<void> {
  const historyFolderId = await ensureEditHistoryFolderId(accessToken, rootFolderId);

  const historyFileName = pathToHistoryFileName(filePath);
  const historyFileId = await findFileByName(accessToken, historyFolderId, historyFileName);
  if (historyFileId) {
    await deleteFile(accessToken, historyFileId);
  }
}
