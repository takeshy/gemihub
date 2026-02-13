import {
  listFiles,
  readFile,
  createFile,
  updateFile,
  deleteFile,
  getFileMetadata,
  ensureSubFolder,
  type DriveFile,
} from "./google-drive.server";
import { saveEdit } from "./edit-history.server";
import type { EditHistorySettings } from "~/types/settings";

const TEMP_FOLDER_NAME = "__TEMP__";

export interface TempFilePayload {
  fileId: string;
  content: string;
  savedAt: string;
}

export interface TempFileInfo {
  tempFileId: string;
  fileName: string;
  displayName: string;
  payload: TempFilePayload;
}

export interface ApplyResult {
  fileId: string;
  md5Checksum: string;
  modifiedTime: string;
  editHistoryEntry?: unknown;
}

async function ensureTempFolder(
  accessToken: string,
  rootFolderId: string
): Promise<string> {
  return ensureSubFolder(accessToken, rootFolderId, TEMP_FOLDER_NAME);
}

export async function listTempFiles(
  accessToken: string,
  rootFolderId: string
): Promise<TempFileInfo[]> {
  const tempFolderId = await ensureTempFolder(accessToken, rootFolderId);
  const files = await listFiles(accessToken, tempFolderId);

  const results: TempFileInfo[] = [];
  for (const file of files) {
    // Skip internal meta files (e.g. _temp-edit-meta.json)
    if (file.name.startsWith("_")) continue;
    try {
      const raw = await readFile(accessToken, file.id);
      const payload: TempFilePayload = JSON.parse(raw);
      results.push({
        tempFileId: file.id,
        fileName: file.name,
        displayName: file.name,
        payload,
      });
    } catch {
      // skip malformed temp files
    }
  }
  return results;
}

export async function findTempFile(
  accessToken: string,
  rootFolderId: string,
  fileName: string
): Promise<TempFileInfo | null> {
  const tempFolderId = await ensureTempFolder(accessToken, rootFolderId);
  const files = await listFiles(accessToken, tempFolderId);
  const match = files.find((f) => f.name === fileName);
  if (!match) return null;

  try {
    const raw = await readFile(accessToken, match.id);
    const payload: TempFilePayload = JSON.parse(raw);
    return {
      tempFileId: match.id,
      fileName: match.name,
      displayName: match.name,
      payload,
    };
  } catch {
    return null;
  }
}

export async function saveTempFile(
  accessToken: string,
  rootFolderId: string,
  fileName: string,
  payload: TempFilePayload
): Promise<DriveFile> {
  const tempFolderId = await ensureTempFolder(accessToken, rootFolderId);
  const content = JSON.stringify(payload);

  // Check if temp file already exists for this fileName
  const files = await listFiles(accessToken, tempFolderId);
  const existing = files.find((f) => f.name === fileName);

  if (existing) {
    return updateFile(accessToken, existing.id, content, "application/json");
  }

  return createFile(accessToken, fileName, content, tempFolderId, "application/json");
}

export async function readTempFile(
  accessToken: string,
  tempFileId: string
): Promise<TempFilePayload> {
  const raw = await readFile(accessToken, tempFileId);
  return JSON.parse(raw);
}

export async function applyTempFile(
  accessToken: string,
  rootFolderId: string,
  tempFile: TempFileInfo,
  editHistorySettings?: EditHistorySettings
): Promise<ApplyResult | null> {
  const { payload, tempFileId } = tempFile;

  try {
    // Read old content before updating (for edit history diff)
    let oldContent = "";
    try {
      oldContent = await readFile(accessToken, payload.fileId);
    } catch {
      // file may not exist yet
    }

    // Update the actual file
    const updated = await updateFile(
      accessToken,
      payload.fileId,
      payload.content
    );

    // Save edit history if settings provided (oldContent → newContent)
    let editHistoryEntry = null;
    if (editHistorySettings) {
      try {
        const meta = await getFileMetadata(accessToken, payload.fileId);
        editHistoryEntry = await saveEdit(
          accessToken,
          rootFolderId,
          editHistorySettings,
          {
            path: meta.name,
            oldContent,
            newContent: payload.content,
            source: "manual",
          }
        );
      } catch {
        // edit history failure is non-critical
      }
    }

    // Delete the temp file
    await deleteFile(accessToken, tempFileId);

    return {
      fileId: payload.fileId,
      md5Checksum: updated.md5Checksum || "",
      modifiedTime: updated.modifiedTime || "",
      editHistoryEntry,
    };
  } catch (err) {
    // If the target file was deleted (404), just clean up the temp file
    if (err instanceof Error && err.message.includes("404")) {
      try {
        await deleteFile(accessToken, tempFileId);
      } catch {
        // ignore cleanup failure
      }
      return null;
    }
    throw err;
  }
}

export async function applyAllTempFiles(
  accessToken: string,
  rootFolderId: string,
  editHistorySettings?: EditHistorySettings
): Promise<ApplyResult[]> {
  const tempFiles = await listTempFiles(accessToken, rootFolderId);
  const results: ApplyResult[] = [];

  for (const tempFile of tempFiles) {
    const result = await applyTempFile(
      accessToken,
      rootFolderId,
      tempFile,
      editHistorySettings
    );
    if (result) {
      results.push(result);
    }
  }

  return results;
}

export async function deleteTempFiles(
  accessToken: string,
  tempFileIds: string[]
): Promise<void> {
  for (const id of tempFileIds) {
    try {
      await deleteFile(accessToken, id);
    } catch {
      // ignore individual delete failures
    }
  }
}

// ---------------------------------------------------------------------------
// Temp Edit Meta — stored as _temp-edit-meta.json inside __TEMP__ folder
// ---------------------------------------------------------------------------

const TEMP_EDIT_META_NAME = "_temp-edit-meta.json";

export interface TempEditMetaEntry {
  uuid: string;
  fileId: string;
  fileName: string;
  createdAt: string;
}

interface TempEditMeta {
  entries: TempEditMetaEntry[];
}

export async function readTempEditMeta(
  accessToken: string,
  rootFolderId: string
): Promise<TempEditMeta> {
  const tempFolderId = await ensureTempFolder(accessToken, rootFolderId);
  const files = await listFiles(accessToken, tempFolderId);
  const match = files.find((f) => f.name === TEMP_EDIT_META_NAME);
  if (!match) return { entries: [] };
  try {
    const raw = await readFile(accessToken, match.id);
    return JSON.parse(raw) as TempEditMeta;
  } catch {
    return { entries: [] };
  }
}

async function writeTempEditMeta(
  accessToken: string,
  rootFolderId: string,
  meta: TempEditMeta
): Promise<void> {
  const tempFolderId = await ensureTempFolder(accessToken, rootFolderId);
  const content = JSON.stringify(meta);
  const files = await listFiles(accessToken, tempFolderId);
  const existing = files.find((f) => f.name === TEMP_EDIT_META_NAME);
  if (existing) {
    await updateFile(accessToken, existing.id, content, "application/json");
  } else {
    await createFile(accessToken, TEMP_EDIT_META_NAME, content, tempFolderId, "application/json");
  }
}

export async function addTempEditEntry(
  accessToken: string,
  rootFolderId: string,
  entry: TempEditMetaEntry
): Promise<void> {
  const meta = await readTempEditMeta(accessToken, rootFolderId);
  // Prune expired entries (older than 1 day) to prevent unbounded growth
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  meta.entries = meta.entries.filter(
    (e) => new Date(e.createdAt).getTime() > cutoff
  );
  meta.entries.push(entry);
  await writeTempEditMeta(accessToken, rootFolderId, meta);
}

export async function removeTempEditEntry(
  accessToken: string,
  rootFolderId: string,
  uuid: string
): Promise<void> {
  const meta = await readTempEditMeta(accessToken, rootFolderId);
  meta.entries = meta.entries.filter((e) => e.uuid !== uuid);
  await writeTempEditMeta(accessToken, rootFolderId, meta);
}
