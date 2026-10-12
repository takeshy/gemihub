import { executeDriveTool } from "./drive-tools.server";
import { isReadOnlyDriveTool } from "./drive-tool-definitions";
import { getFileMetadata } from "./google-drive.server";
import { getFileListFromMeta } from "./sync-meta.server";
import { getSettings } from "./user-settings.server";
import { SETTINGS_FILE_NAME, ENCRYPTED_AUTH_FILE_NAME, SYNC_META_FILE_NAME } from "./sync-diff";

export function canReadKakerattaFile(name: string, secretFolder: string): boolean {
  const reserved = [SETTINGS_FILE_NAME, ENCRYPTED_AUTH_FILE_NAME, SYNC_META_FILE_NAME];
  return !reserved.includes(name) && !(secretFolder && (name === secretFolder || name.startsWith(`${secretFolder}/`)));
}

/** Restrict even model-supplied file IDs to this root and exclude credentials. */
export async function executeKakerattaDriveTool(name: string, args: Record<string, unknown>, accessToken: string, rootFolderId: string, signal?: AbortSignal): Promise<unknown> {
  if (!isReadOnlyDriveTool(name)) return { error: "Only read tools are allowed" };
  const settings = await getSettings(accessToken, rootFolderId);
  const secretFolder = settings.secretManagerFolder;
  if (name === "read_drive_file") {
    if (typeof args.fileId !== "string") return { error: "Invalid file ID" };
    const file = await getFileMetadata(accessToken, args.fileId, { signal });
    if (!file.parents?.includes(rootFolderId) || !canReadKakerattaFile(file.name, secretFolder)) return { error: "File is outside the allowed reference scope" };
  }
  const result = await executeDriveTool(name, args, accessToken, rootFolderId, signal);
  if (name === "list_drive_files" || name === "search_drive_files") {
    const { files } = await getFileListFromMeta(accessToken, rootFolderId, { signal });
    const allowed = new Set(files.filter(f => canReadKakerattaFile(f.name, secretFolder)).map(f => f.id));
    const listing = result as { files?: { id: string }[]; folders?: { name: string }[] };
    return {
      ...listing,
      ...(listing.files ? { files: listing.files.filter(f => allowed.has(f.id)) } : {}),
      ...(listing.folders ? { folders: listing.folders.filter(f => canReadKakerattaFile([args.folder, f.name].filter(Boolean).join("/"), secretFolder)) } : {}),
    };
  }
  return result;
}
