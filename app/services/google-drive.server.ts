import type { SessionTokens } from "./session.server";
import {
  createDriveClient,
  DriveApiError,
  DRIVE_API,
  DRIVE_UPLOAD_API,
  escapeDriveQuery,
  fetchTransport,
  type DriveFile,
  type DriveOperationOptions,
} from "gemihub-sync-core/drive";

// The Drive REST client (requests, retries, pagination, multipart, errors) is
// shared with Obsidian and Desktop through gemihub-sync-core; this module keeps
// GemiHub's server-only operations (export, resumable upload, Docs import,
// publishing) and the existing function names.

export { DriveApiError, type DriveFile };

const ROOT_FOLDER_NAME = process.env.ROOT_FOLDER_NAME || "gemihub";
const HISTORY_FOLDER = "history";

// Google occasionally returns 502/504 from Drive uploads and metadata writes.
// Treat them like the other transient statuses handled by the shared client;
// otherwise a single failed request turns a partially completed Push into 500.
const drive = createDriveClient(fetchTransport({ timeoutMs: 30_000 }), {
  retryStatuses: [429, 500, 502, 503, 504],
});

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Authorized Drive request with the shared retry/error policy. */
function driveRequest(
  url: string,
  accessToken: string,
  options: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal } = {}
): Promise<Response> {
  return drive.request(url, accessToken, options);
}

// Find or create the root app folder
export function ensureRootFolder(accessToken: string, folderName?: string): Promise<string> {
  return drive.ensureRootFolder(accessToken, folderName || ROOT_FOLDER_NAME);
}

// Ensure a subfolder exists (concurrent calls for the same folder share one request)
export function ensureSubFolder(
  accessToken: string,
  parentId: string,
  folderName: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  return drive.ensureSubFolder(accessToken, parentId, folderName, options);
}

export async function getHistoryFolderId(
  accessToken: string,
  rootFolderId: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  return ensureSubFolder(accessToken, rootFolderId, HISTORY_FOLDER, options);
}

// List files in a folder (with pagination for 1000+ files)
export function listFiles(
  accessToken: string,
  folderId: string,
  mimeType?: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  return drive.listFiles(accessToken, folderId, mimeType, options);
}

// List user files in rootFolder (excludes folders, system files, and Google
// Workspace native files — Docs/Sheets/Slides have no downloadable binary
// content via alt=media, so tracking them in sync meta only produces
// unfulfillable pull requests later).
export function listUserFiles(
  accessToken: string,
  rootFolderId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  return drive.listUserFiles(accessToken, rootFolderId, options);
}

// Read file content
export function readFile(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  return drive.readFile(accessToken, fileId, options);
}

// Read file as raw Response (for binary files like PDF)
export function readFileRaw(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<Response> {
  return drive.readFileResponse(accessToken, fileId, options);
}

export async function exportFile(
  accessToken: string,
  fileId: string,
  mimeType: string,
  options: DriveOperationOptions = {}
): Promise<Buffer> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await driveRequest(
        `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
        accessToken,
        { signal: options.signal }
      );
      const buffer = await res.arrayBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      const retryable =
        error instanceof DriveApiError &&
        (error.status === 403 || error.status === 404 || error.status === 429 || error.status >= 500);
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }
      await sleep(750 * attempt, options.signal);
    }
  }
  throw new Error("Drive export failed");
}

// Read file as base64 string (for binary files in sync pipeline)
export async function readFileBase64(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  return Buffer.from(await readFileBytes(accessToken, fileId, options)).toString("base64");
}

// Read file as raw bytes (for binary files)
export function readFileBytes(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<Uint8Array> {
  return drive.readFileBytes(accessToken, fileId, options);
}

// Get file metadata
export function getFileMetadata(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.getFileMetadata(accessToken, fileId, options);
}

// Create a new file
export function createFile(
  accessToken: string,
  name: string,
  content: string,
  parentId: string,
  mimeType: string = "text/plain",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.createFile(accessToken, name, content, parentId, mimeType, options);
}

// Update file content
export function updateFile(
  accessToken: string,
  fileId: string,
  content: string,
  mimeType: string = "text/plain",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.updateFile(accessToken, fileId, content, mimeType, options);
}

// Rename a file
export function renameFile(
  accessToken: string,
  fileId: string,
  newName: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.renameFile(accessToken, fileId, newName, options);
}

// Move a file to a different parent folder
export function moveFile(
  accessToken: string,
  fileId: string,
  newParentId: string,
  oldParentId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.moveFile(accessToken, fileId, newParentId, oldParentId, options);
}

// Delete a file permanently (use for temp/system files only; user files should use soft delete via trash/ folder)
export function deleteFile(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<void> {
  return drive.deleteFile(accessToken, fileId, options);
}

// Search files by name or content (with pagination, capped at 1000 results)
export function searchFiles(
  accessToken: string,
  rootFolderId: string,
  query: string,
  searchContent: boolean = false,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  return drive.searchFiles(accessToken, rootFolderId, query, searchContent, options);
}

// Find a folder by name. Optionally restrict to a parent folder.
export function findFolderByName(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<DriveFile | null> {
  return drive.findFolderByName(accessToken, name, parentId);
}

// Find a file by exact name (not folder). Optionally restrict to a parent folder.
export function findFileByExactName(
  accessToken: string,
  name: string,
  parentId?: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile | null> {
  return drive.findFileByExactName(accessToken, name, parentId, options);
}

// Find ALL files with an exact name (not folder). Optionally restrict to a parent folder.
// Used by system-file callers that need to detect and consolidate duplicates.
export function findFilesByExactName(
  accessToken: string,
  name: string,
  parentId?: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  return drive.findFilesByExactName(accessToken, name, parentId, options);
}

// Find ALL files with an exact name AND specific mimeType. Used for singleton
// resources like the webpage_builder spreadsheet where concurrent provision
// calls can race create and we need createdTime for deterministic consolidation.
export async function findFilesByExactNameAndMimeType(
  accessToken: string,
  name: string,
  mimeType: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  const query = `name='${escapeDriveQuery(name)}' and mimeType='${mimeType}' and trashed=false`;
  const data = await drive.requestJson<{ files: DriveFile[] }>(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,createdTime,md5Checksum)&pageSize=100`,
    accessToken,
    { signal: options.signal }
  );
  return data.files;
}

// Find a folder by name, searching recursively through all subfolders
export async function findFolderByNameRecursive(
  accessToken: string,
  name: string,
  rootId: string
): Promise<DriveFile | null> {
  // First check direct children
  const direct = await findFolderByName(accessToken, name, rootId);
  if (direct) return direct;

  // Then search without parent constraint (within drive.file scope)
  return findFolderByName(accessToken, name);
}

// List folders under a parent
export function listFolders(
  accessToken: string,
  parentId: string
): Promise<DriveFile[]> {
  return drive.listFolders(accessToken, parentId);
}

// Create a folder
export function createFolder(
  accessToken: string,
  name: string,
  parentId: string
): Promise<DriveFile> {
  return drive.createFolder(accessToken, name, parentId);
}

export function copyFile(
  accessToken: string,
  fileId: string,
  name: string,
  parentId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.copyFile(accessToken, fileId, name, parentId, options);
}

// Create a file with binary content (for file uploads)
export function createFileBinary(
  accessToken: string,
  name: string,
  contentBuffer: Uint8Array,
  parentId: string,
  mimeType: string = "application/octet-stream",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.createFileBinary(accessToken, name, contentBuffer, parentId, mimeType, options);
}

export async function createResumableUploadSession(
  accessToken: string,
  name: string,
  parentId: string,
  mimeType: string = "application/octet-stream",
  contentLength?: number,
  options: DriveOperationOptions & { origin?: string } = {}
): Promise<string> {
  const res = await driveRequest(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum,size`,
    accessToken,
    {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        // Bind the session to the browser origin so the final PUT response is readable.
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(contentLength !== undefined ? { "X-Upload-Content-Length": String(contentLength) } : {}),
      },
      body: JSON.stringify({
        name,
        parents: [parentId],
        mimeType,
      }),
    }
  );
  const uploadUrl = res.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("Drive API did not return a resumable upload URL");
  }
  return uploadUrl;
}

export async function updateResumableUploadSession(
  accessToken: string,
  fileId: string,
  mimeType: string = "application/octet-stream",
  contentLength?: number,
  options: DriveOperationOptions & { origin?: string } = {}
): Promise<string> {
  const res = await driveRequest(
    `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=resumable&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum,size`,
    accessToken,
    {
      method: "PATCH",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        // Bind the session to the browser origin so the final PUT response is readable.
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(contentLength !== undefined ? { "X-Upload-Content-Length": String(contentLength) } : {}),
      },
      body: JSON.stringify({}),
    }
  );
  const uploadUrl = res.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("Drive API did not return a resumable upload URL");
  }
  return uploadUrl;
}

export async function uploadResumableFile(
  uploadUrl: string,
  contentBuffer: Buffer,
  mimeType: string = "application/octet-stream",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    signal: options.signal ?? AbortSignal.timeout(10 * 60_000),
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(contentBuffer.byteLength),
    },
    body: new Uint8Array(contentBuffer),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new DriveApiError(res.status, text);
  }
  return res.json();
}

export async function createGoogleDocFromHtml(
  accessToken: string,
  name: string,
  html: string,
  parentId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const metadata = JSON.stringify({
    name,
    parents: [parentId],
    mimeType: "application/vnd.google-apps.document",
  });

  const boundary = "-------boundary" + Date.now();
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: text/html; charset=UTF-8\r\n\r\n" +
    `${html}\r\n` +
    `--${boundary}--`;

  const res = await driveRequest(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum,size`,
    accessToken,
    {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  return res.json();
}

// Update file with binary content (for replacing uploaded files)
export function updateFileBinary(
  accessToken: string,
  fileId: string,
  contentBuffer: Uint8Array,
  mimeType: string = "application/octet-stream",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  return drive.updateFileBinary(accessToken, fileId, contentBuffer, mimeType, options);
}

// Publish a file (make it accessible to anyone with the link)
export async function publishFile(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  // Create "anyone" reader permission
  await driveRequest(
    `${DRIVE_API}/files/${fileId}/permissions`,
    accessToken,
    {
      method: "POST",
      signal: options.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }
  );
  // Fetch the webViewLink
  const res = await driveRequest(
    `${DRIVE_API}/files/${fileId}?fields=webViewLink`,
    accessToken,
    { signal: options.signal }
  );
  const data: { webViewLink: string } = await res.json();
  return data.webViewLink;
}

// Unpublish a file (remove "anyone" permission)
export async function unpublishFile(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<void> {
  try {
    await driveRequest(
      `${DRIVE_API}/files/${fileId}/permissions/anyoneWithLink`,
      accessToken,
      { method: "DELETE", signal: options.signal }
    );
  } catch (err) {
    // 404 means permission doesn't exist — that's fine
    if (err instanceof Error && err.message.includes("404")) return;
    throw err;
  }
}

// Helper to get Drive service context for workflow execution
export interface DriveServiceContext {
  accessToken: string;
  rootFolderId: string;
  historyFolderId: string;
}

export async function getDriveContext(
  tokens: SessionTokens
): Promise<DriveServiceContext> {
  const historyFolderId = await getHistoryFolderId(
    tokens.accessToken,
    tokens.rootFolderId
  );

  return {
    accessToken: tokens.accessToken,
    rootFolderId: tokens.rootFolderId,
    historyFolderId,
  };
}
