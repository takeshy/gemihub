/**
 * Client-side adapter that maps the Drive-shaped tree mutations
 * (create / delete / rename) onto the GCS storage routes added in
 * Phase 5d-step2/4d.
 *
 * Lives next to storage-sync — same layer, no React. Invoked from
 * useTreeFileOperations with the current enterprise selection.
 */

import type { StoredObject } from "~/services/gcs-storage-utils";

export interface CreateStorageFileResult {
  object: StoredObject;
}

export interface BulkDeleteResult {
  succeeded: string[];
  failed: Array<{ relativePath: string; error: string }>;
}

export async function createStorageFile(
  projectId: string,
  relativePath: string,
  content: string,
  contentType?: string,
): Promise<CreateStorageFileResult> {
  const res = await fetch("/api/storage/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      path: relativePath,
      content,
      encoding: "utf-8",
      contentType: contentType ?? "text/plain",
      // Refuse to silently overwrite — duplicate-name flows should bump the
      // name in the UI before calling here.
      ifRevisionMatch: 0,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`create file failed: HTTP ${res.status} ${body}`);
  }
  return (await res.json()) as CreateStorageFileResult;
}

export async function deleteStorageFile(
  projectId: string,
  relativePath: string,
): Promise<void> {
  const res = await fetch("/api/storage/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, path: relativePath }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`delete file failed: HTTP ${res.status} ${body}`);
  }
}

/**
 * Bulk-delete returns per-path success/failure rather than throwing on the
 * first failure — matches the behaviour of the Drive-era bulkDelete.
 */
export async function bulkDeleteStorageFiles(
  projectId: string,
  relativePaths: string[],
): Promise<BulkDeleteResult> {
  const succeeded: string[] = [];
  const failed: BulkDeleteResult["failed"] = [];
  // Sequential so a flaky network can't fan out concurrent failures —
  // the volume is "user just selected N files in the tree", not a
  // background sweep.
  for (const path of relativePaths) {
    try {
      await deleteStorageFile(projectId, path);
      succeeded.push(path);
    } catch (err) {
      failed.push({
        relativePath: path,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return { succeeded, failed };
}

export async function renameStorageFile(
  projectId: string,
  fromRelativePath: string,
  toRelativePath: string,
): Promise<{ object: StoredObject }> {
  const res = await fetch("/api/storage/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      from: fromRelativePath,
      to: toRelativePath,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`rename failed: HTTP ${res.status} ${body}`);
  }
  return (await res.json()) as { object: StoredObject };
}
