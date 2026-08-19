// Edit-history CRUD on tenant GCS.
//
// Each file's history is stored at `gemihub/history/edit/{encoded-path}.json`
// where {encoded-path} is the file path with "/" replaced by "-".
// This mirrors the legacy Drive-backed service's naming convention.

import crypto from "node:crypto";
import * as Diff from "diff";
import {
  GcsObjectNotFoundError,
  deleteObject,
  listObjects,
  readObject,
  writeObject,
} from "./gcs-storage.server";
import type { ProjectAccessContext } from "~/types/enterprise";
import type { EditHistorySettings } from "~/types/settings";

const EDIT_PREFIX = "gemihub/history/edit";

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

function pathToObjectKey(filePath: string): string {
  const encoded = filePath.replace(/\//g, "-");
  return `${EDIT_PREFIX}/${encoded}.history.json`;
}

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").substring(0, 8);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

async function loadHistoryFile(
  ctx: ProjectAccessContext,
  filePath: string
): Promise<EditHistoryFile> {
  const key = pathToObjectKey(filePath);
  try {
    const { bytes } = await readObject(ctx, key);
    return JSON.parse(decode(bytes)) as EditHistoryFile;
  } catch (err) {
    if (err instanceof GcsObjectNotFoundError) {
      return { version: 1, path: filePath, entries: [] };
    }
    throw err;
  }
}

async function saveHistoryFile(
  ctx: ProjectAccessContext,
  filePath: string,
  history: EditHistoryFile
): Promise<void> {
  const key = pathToObjectKey(filePath);
  await writeObject(ctx, key, JSON.stringify(history, null, 2), "application/json");
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
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      lines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
  }

  return { diff: lines.join("\n"), stats: { additions, deletions } };
}

export async function saveEditForTenant(
  ctx: ProjectAccessContext,
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

  const history = await loadHistoryFile(ctx, params.path);
  history.entries.push(entry);

  if (settings.retention.maxEntriesPerFile > 0) {
    while (history.entries.length > settings.retention.maxEntriesPerFile) {
      history.entries.shift();
    }
  }

  await saveHistoryFile(ctx, params.path, history);
  return entry;
}

export async function getHistoryForTenant(
  ctx: ProjectAccessContext,
  filePath: string
): Promise<EditHistoryEntry[]> {
  const history = await loadHistoryFile(ctx, filePath);
  return history.entries;
}

export async function clearHistoryForTenant(
  ctx: ProjectAccessContext,
  filePath: string
): Promise<void> {
  const key = pathToObjectKey(filePath);
  try {
    await deleteObject(ctx, key);
  } catch (err) {
    if (!(err instanceof GcsObjectNotFoundError)) throw err;
  }
}

export async function getStatsForTenant(
  ctx: ProjectAccessContext
): Promise<EditHistoryStats> {
  const result = await listObjects(ctx, { relativePrefix: EDIT_PREFIX });
  let totalFiles = 0;
  let totalEntries = 0;

  for (const obj of result.objects) {
    if (!obj.relativePath.endsWith(".history.json")) continue;
    try {
      const { bytes } = await readObject(ctx, obj.relativePath);
      const history = JSON.parse(decode(bytes)) as EditHistoryFile;
      totalFiles++;
      totalEntries += history.entries.length;
    } catch {
      // skip unreadable files
    }
  }

  return { totalFiles, totalEntries };
}

export async function pruneForTenant(
  ctx: ProjectAccessContext,
  settings: EditHistorySettings
): Promise<{ deletedCount: number; remainingEntries: number; totalFiles: number }> {
  const result = await listObjects(ctx, { relativePrefix: EDIT_PREFIX });
  const maxAgeMs =
    settings.retention.maxAgeInDays > 0
      ? settings.retention.maxAgeInDays * 24 * 60 * 60 * 1000
      : 0;
  const now = Date.now();
  let deletedCount = 0;
  let remainingEntries = 0;
  let totalFiles = 0;

  for (const obj of result.objects) {
    if (!obj.relativePath.endsWith(".history.json")) continue;
    try {
      const { bytes } = await readObject(ctx, obj.relativePath);
      const history = JSON.parse(decode(bytes)) as EditHistoryFile;
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
      remainingEntries += history.entries.length;

      if (history.entries.length === 0) {
        await deleteObject(ctx, obj.relativePath);
      } else {
        totalFiles++;
        if (history.entries.length !== originalCount) {
          await writeObject(ctx, obj.relativePath, JSON.stringify(history, null, 2), "application/json");
        }
      }
    } catch {
      // skip
    }
  }

  return { deletedCount, remainingEntries, totalFiles };
}
