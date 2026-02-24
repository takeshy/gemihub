import type { SessionTokens } from "./session.server";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const ROOT_FOLDER_NAME = process.env.ROOT_FOLDER_NAME || "gemihub";
const HISTORY_FOLDER = "history";

/** Escape a value for use in Drive API query strings (single-quote contexts). */
function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const SYSTEM_FILES = new Set(["settings.json", "_sync-meta.json"]);

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  parents?: string[];
  webViewLink?: string;
  md5Checksum?: string;
  size?: string;
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

interface DriveOperationOptions {
  signal?: AbortSignal;
}

async function driveRequest(
  url: string,
  accessToken: string,
  options: RequestInit = {},
  retries = 2
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  // Retry on 429 (rate limit) or 503 (service unavailable)
  if ((response.status === 429 || response.status === 503) && retries > 0) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return driveRequest(url, accessToken, options, retries - 1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive API error ${response.status}: ${text}`);
  }

  return response;
}

// Find or create the root app folder
export async function ensureRootFolder(accessToken: string, folderName?: string): Promise<string> {
  const name = folderName || ROOT_FOLDER_NAME;
  // Search for existing folder
  const query = `name='${escapeDriveQuery(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    accessToken
  );
  const data: DriveListResponse = await res.json();

  if (data.files.length > 0) {
    return data.files[0].id;
  }

  // Create root folder
  const createRes = await driveRequest(`${DRIVE_API}/files`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const folder: DriveFile = await createRes.json();
  return folder.id;
}

// In-flight deduplication for ensureSubFolder to prevent race-condition duplicates
const subFolderInflight = new Map<string, Promise<string>>();

// Ensure a subfolder exists
export async function ensureSubFolder(
  accessToken: string,
  parentId: string,
  folderName: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  const cacheKey = `${parentId}:${folderName}`;
  const inflight = subFolderInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = ensureSubFolderImpl(accessToken, parentId, folderName, options).finally(() => {
    subFolderInflight.delete(cacheKey);
  });
  subFolderInflight.set(cacheKey, promise);
  return promise;
}

async function ensureSubFolderImpl(
  accessToken: string,
  parentId: string,
  folderName: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  const query = `name='${escapeDriveQuery(folderName)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    accessToken,
    { signal: options.signal }
  );
  const data: DriveListResponse = await res.json();

  if (data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await driveRequest(`${DRIVE_API}/files`, accessToken, {
    method: "POST",
    signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const folder: DriveFile = await createRes.json();
  return folder.id;
}

export async function getHistoryFolderId(
  accessToken: string,
  rootFolderId: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  return ensureSubFolder(accessToken, rootFolderId, HISTORY_FOLDER, options);
}

// List files in a folder (with pagination for 1000+ files)
export async function listFiles(
  accessToken: string,
  folderId: string,
  mimeType?: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  let query = `'${folderId}' in parents and trashed=false`;
  if (mimeType) {
    query += ` and mimeType='${mimeType}'`;
  }

  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum)");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await driveRequest(url.toString(), accessToken, { signal: options.signal });
    const data: DriveListResponse = await res.json();
    allFiles.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

// List user files in rootFolder (excludes folders and system files)
export async function listUserFiles(
  accessToken: string,
  rootFolderId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  const allFiles = await listFiles(accessToken, rootFolderId, undefined, options);
  return allFiles.filter(
    (f) =>
      f.mimeType !== "application/vnd.google-apps.folder" &&
      !SYSTEM_FILES.has(f.name)
  );
}

// Read file content
export async function readFile(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  const res = await driveRequest(
    `${DRIVE_API}/files/${fileId}?alt=media`,
    accessToken,
    { signal: options.signal }
  );
  return res.text();
}

// Read file as raw Response (for binary files like PDF)
export async function readFileRaw(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<Response> {
  return driveRequest(
    `${DRIVE_API}/files/${fileId}?alt=media`,
    accessToken,
    { signal: options.signal }
  );
}

export async function exportFile(
  accessToken: string,
  fileId: string,
  mimeType: string,
  options: DriveOperationOptions = {}
): Promise<Buffer> {
  const res = await driveRequest(
    `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    accessToken,
    { signal: options.signal }
  );
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}

// Read file as base64 string (for binary files in sync pipeline)
export async function readFileBase64(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<string> {
  const bytes = await readFileBytes(accessToken, fileId, options);
  return Buffer.from(bytes).toString("base64");
}

// Read file as raw bytes (for binary files)
export async function readFileBytes(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<Uint8Array> {
  const res = await readFileRaw(accessToken, fileId, options);
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

// Get file metadata
export async function getFileMetadata(
  accessToken: string,
  fileId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const res = await driveRequest(
    `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,modifiedTime,createdTime,parents,webViewLink,md5Checksum,size`,
    accessToken,
    { signal: options.signal }
  );
  return res.json();
}

// Create a new file
export async function createFile(
  accessToken: string,
  name: string,
  content: string,
  parentId: string,
  mimeType: string = "text/plain",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const metadata = {
    name,
    parents: [parentId],
    mimeType,
  };

  const boundary = "-------boundary" + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await driveRequest(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum`,
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

// Update file content
export async function updateFile(
  accessToken: string,
  fileId: string,
  content: string,
  mimeType: string = "text/plain",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const res = await driveRequest(
    `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum`,
    accessToken,
    {
      method: "PATCH",
      signal: options.signal,
      headers: { "Content-Type": mimeType },
      body: content,
    }
  );
  return res.json();
}

// Rename a file
export async function renameFile(
  accessToken: string,
  fileId: string,
  newName: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const res = await driveRequest(
    `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum`,
    accessToken,
    {
      method: "PATCH",
      signal: options.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    }
  );
  return res.json();
}

// Move a file to a different parent folder
export async function moveFile(
  accessToken: string,
  fileId: string,
  newParentId: string,
  oldParentId: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const url = `${DRIVE_API}/files/${fileId}?addParents=${encodeURIComponent(newParentId)}&removeParents=${encodeURIComponent(oldParentId)}&fields=id,name,mimeType,parents`;
  const res = await driveRequest(url, accessToken, { method: "PATCH", signal: options.signal });
  return res.json();
}

// Delete a file permanently (use for temp/system files only; user files should use soft delete via trash/ folder)
export async function deleteFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  await driveRequest(`${DRIVE_API}/files/${fileId}`, accessToken, {
    method: "DELETE",
  });
}

// Search files by name or content (with pagination, capped at 1000 results)
export async function searchFiles(
  accessToken: string,
  rootFolderId: string,
  query: string,
  searchContent: boolean = false,
  options: DriveOperationOptions = {}
): Promise<DriveFile[]> {
  let driveQuery: string;
  if (searchContent) {
    driveQuery = `fullText contains '${escapeDriveQuery(query)}' and '${rootFolderId}' in parents and trashed=false`;
  } else {
    driveQuery = `name contains '${escapeDriveQuery(query)}' and '${rootFolderId}' in parents and trashed=false`;
  }

  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set("q", driveQuery);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum)");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await driveRequest(url.toString(), accessToken, { signal: options.signal });
    const data: DriveListResponse = await res.json();
    allFiles.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken && allFiles.length < 1000);

  return allFiles;
}

// Find a folder by name (searches recursively under a parent)
export async function findFolderByName(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<DriveFile | null> {
  let query = `name='${escapeDriveQuery(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)&pageSize=1`,
    accessToken
  );
  const data: DriveListResponse = await res.json();
  return data.files.length > 0 ? data.files[0] : null;
}

// Find a file by exact name (not folder). Optionally restrict to a parent folder.
export async function findFileByExactName(
  accessToken: string,
  name: string,
  parentId?: string,
  options: DriveOperationOptions = {}
): Promise<DriveFile | null> {
  let query = `name='${escapeDriveQuery(name)}' and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,md5Checksum)&pageSize=1`,
    accessToken,
    { signal: options.signal }
  );
  const data: DriveListResponse = await res.json();
  return data.files.length > 0 ? data.files[0] : null;
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
export async function listFolders(
  accessToken: string,
  parentId: string
): Promise<DriveFile[]> {
  const query = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)&orderBy=name`,
    accessToken
  );
  const data: DriveListResponse = await res.json();
  return data.files;
}

// Create a folder
export async function createFolder(
  accessToken: string,
  name: string,
  parentId: string
): Promise<DriveFile> {
  const res = await driveRequest(`${DRIVE_API}/files`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  return res.json();
}

// Create a file with binary content (for file uploads)
export async function createFileBinary(
  accessToken: string,
  name: string,
  contentBuffer: Buffer,
  parentId: string,
  mimeType: string = "application/octet-stream",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const metadata = JSON.stringify({
    name,
    parents: [parentId],
    mimeType,
  });

  const boundary = "-------boundary" + Date.now();
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf-8"
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--`, "utf-8");
  const body = Buffer.concat([preamble, contentBuffer, epilogue]);

  const res = await driveRequest(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum`,
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
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum`,
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
export async function updateFileBinary(
  accessToken: string,
  fileId: string,
  contentBuffer: Buffer,
  mimeType: string = "application/octet-stream",
  options: DriveOperationOptions = {}
): Promise<DriveFile> {
  const res = await driveRequest(
    `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,md5Checksum`,
    accessToken,
    {
      method: "PATCH",
      signal: options.signal,
      headers: { "Content-Type": mimeType },
      body: new Uint8Array(contentBuffer),
    }
  );
  return res.json();
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
