// Local edit history for project (GCS) mounts, keyed by an explicit mountKey.
//
// Same session model as the Drive-side edit-history-local.ts (one cumulative
// diff per session, commit boundaries between sessions, entry deleted when the
// file is reverted); both use the shared algorithm in ~/utils/edit-history-diff.
// saveLocalEdit must run BEFORE the cached object is updated.

import {
  getCachedObject,
  getEditHistory,
  objectPathForCachedFile,
  setEditHistory,
  deleteEditHistory,
} from "~/services/storage-cache";
import {
  appendRestoreDiff,
  computeLocalEditStep,
  reconstructContent,
  withCommitBoundary,
  type DiffWithOrigin,
  type EditHistoryDiffEntry,
} from "~/utils/edit-history-diff";

export { reconstructContent, reverseApplyDiff, type DiffWithOrigin } from "~/utils/edit-history-diff";

export interface CachedEditHistoryEntry {
  mountKey: string;
  fileId: string;
  filePath: string;
  diffs: EditHistoryDiff[];
}

export type EditHistoryDiff = EditHistoryDiffEntry;

export async function addCommitBoundary(
  mountKey: string,
  fileId: string,
): Promise<void> {
  const existing = await getEditHistory(mountKey, fileId);
  if (!existing) return;
  const diffs = withCommitBoundary(existing.diffs, new Date().toISOString());
  if (diffs) await setEditHistory({ ...existing, diffs });
}

export async function saveLocalEdit(
  mountKey: string,
  fileId: string,
  filePath: string,
  newContent: string,
): Promise<CachedEditHistoryEntry | null | "reverted"> {
  const cached = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, fileId));
  const oldContent = cached?.content ?? "";
  if (oldContent === newContent) return null;

  const existing = await getEditHistory(mountKey, fileId);
  const step = computeLocalEditStep(existing?.diffs ?? [], oldContent, newContent, new Date().toISOString());

  switch (step.action) {
    case "none":
      return null;
    case "delete":
      if (existing) await deleteEditHistory(mountKey, fileId);
      return "reverted";
    case "save": {
      const entry: CachedEditHistoryEntry = {
        mountKey,
        fileId,
        filePath: step.reverted ? existing?.filePath ?? filePath : filePath,
        diffs: step.diffs,
      };
      await setEditHistory(entry);
      return step.reverted ? null : entry;
    }
  }
}

export async function recordRestoreDiff(
  mountKey: string,
  fileId: string,
  currentContent: string,
  restoredContent: string,
): Promise<void> {
  const existing = await getEditHistory(mountKey, fileId);
  const diffs = appendRestoreDiff(existing?.diffs ?? [], currentContent, restoredContent, new Date().toISOString());
  await setEditHistory({ mountKey, fileId, filePath: existing?.filePath ?? fileId, diffs });
}

export async function restoreToHistoryEntry(
  mountKey: string,
  fileId: string,
  currentContent: string,
  diffsToApply: DiffWithOrigin[],
): Promise<string | null> {
  const restoredContent = reconstructContent(currentContent, diffsToApply);
  if (restoredContent === null) return null;
  await recordRestoreDiff(mountKey, fileId, currentContent, restoredContent);
  return restoredContent;
}

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
