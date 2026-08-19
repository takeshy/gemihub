/**
 * Path → Drive fileId index for the Drive storage provider.
 *
 * This repo's Drive layout is flat: a file's Drive NAME is its relative path
 * ("web/index.html" is a single file directly under the gemihub root folder;
 * folders are virtual). `_sync-meta.json` (sync-meta.server.ts) is the
 * canonical fileId → {name, md5Checksum, …} map maintained by the push flow,
 * so the path index is simply its inversion — no new index is built or
 * persisted.
 *
 * Staleness: entries reflect the last push/meta update. Callers that mutate
 * through the Drive provider keep the meta fresh via upsert/remove helpers;
 * files created outside the app (or before their first push) are invisible
 * here, exactly as they are to the existing sync flow.
 */

import type { DriveFile } from "../google-drive.server";
import { getFileListFromMeta, type SyncMeta } from "../sync-meta.server";

export interface DrivePathIndex {
  meta: SyncMeta;
  /** relative path → DriveFile (id, name=path, md5Checksum, …) */
  byPath: Map<string, DriveFile>;
}

export async function loadDrivePathIndex(
  accessToken: string,
  rootFolderId: string,
): Promise<DrivePathIndex> {
  const { meta, files } = await getFileListFromMeta(accessToken, rootFolderId);
  const byPath = new Map<string, DriveFile>();
  for (const file of files) {
    byPath.set(file.name, file);
  }
  return { meta, byPath };
}
