import { getFileMetadata, type DriveFile } from "./google-drive.server";
import { getSettings } from "./user-settings.server";
import { upsertFilesInMeta, type SyncMeta } from "./sync-meta.server";

export function filesFromMeta(meta: SyncMeta): DriveFile[] {
  return Object.entries(meta.files).map(([id, f]) => ({
    id,
    name: f.name,
    mimeType: f.mimeType,
    md5Checksum: f.md5Checksum,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
    size: f.size,
  }));
}

export async function ensureHubworkSpreadsheetsInMeta(
  accessToken: string,
  rootFolderId: string,
  meta: SyncMeta
): Promise<SyncMeta> {
  const settings = await getSettings(accessToken, rootFolderId).catch(() => null);
  const spreadsheetIds = Array.from(new Set(
    (settings?.hubwork?.spreadsheets ?? [])
      .map((spreadsheet) => spreadsheet.id?.trim())
      .filter((id): id is string => Boolean(id))
  ));
  const missingIds = spreadsheetIds.filter((id) => !meta.files[id]);
  if (missingIds.length === 0) return meta;

  const results = await Promise.allSettled(
    missingIds.map((id) => getFileMetadata(accessToken, id))
  );
  const files = results
    .filter((result): result is PromiseFulfilledResult<DriveFile> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((file) => file.mimeType === "application/vnd.google-apps.spreadsheet");
  if (files.length === 0) return meta;

  return upsertFilesInMeta(accessToken, rootFolderId, files);
}
