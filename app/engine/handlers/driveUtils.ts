import type { ExecutionContext, ServiceContext, FileExplorerData } from "../types";
import { replaceVariables } from "./utils";
import * as driveService from "~/services/google-drive.server";

const BINARY_MIME_PREFIXES = ["image/", "audio/", "video/"];
const BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/octet-stream",
]);

export function isBinaryMimeType(mimeType: string): boolean {
  return BINARY_MIME_PREFIXES.some(p => mimeType.startsWith(p)) || BINARY_MIME_TYPES.has(mimeType);
}

export interface ResolvedFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
}

/**
 * Resolve a file path (or variable reference) to a Drive file.
 * Shared resolution logic used by drive-read, drive-delete, and gemihub-command handlers.
 *
 * Resolution order:
 *   1. Direct file ID (20+ alphanumeric chars)
 *   2. Companion `_fileId` variable from drive-file-picker
 *   3. searchFiles by name (optionally tries `.md` extension)
 *   4. findFileByExactName fallback (optionally tries `.md` extension)
 *
 * @param tryMdExtension - also try appending `.md` in search/fallback steps (for drive-read / drive-delete)
 */
export async function resolveExistingFile(
  pathRaw: string,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  options?: { tryMdExtension?: boolean },
): Promise<ResolvedFile> {
  const path = replaceVariables(pathRaw, context);
  if (!path) throw new Error("Missing 'path' property");

  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;
  const tryMd = options?.tryMdExtension ?? false;

  // 1. Direct file ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(path)) {
    const meta = await driveService.getFileMetadata(accessToken, path, {
      signal: serviceContext.abortSignal,
    });
    return { id: meta.id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents };
  }

  // 2. Companion _fileId variable from drive-file-picker
  const varMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (varMatch) {
    const fileId = context.variables.get(`${varMatch[1]}_fileId`);
    if (fileId && typeof fileId === "string") {
      const meta = await driveService.getFileMetadata(accessToken, fileId, {
        signal: serviceContext.abortSignal,
      });
      return { id: meta.id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents };
    }
  }

  // 3. Search by file name
  const files = await driveService.searchFiles(accessToken, folderId, path, false, {
    signal: serviceContext.abortSignal,
  });
  let file: driveService.DriveFile | undefined;
  if (tryMd) {
    file = files.find(f => f.name === path || f.name === `${path}.md`);
  } else {
    file = files.find(f => f.name === path);
  }

  // 4. Fallback: exact name match within root folder
  if (!file) {
    file = await driveService.findFileByExactName(accessToken, path, folderId, {
      signal: serviceContext.abortSignal,
    }) ?? undefined;
    if (!file && tryMd && !path.endsWith(".md")) {
      file = await driveService.findFileByExactName(accessToken, `${path}.md`, folderId, {
        signal: serviceContext.abortSignal,
      }) ?? undefined;
    }
  }

  if (!file) throw new Error(`File not found on Drive: ${path}`);
  return { id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents };
}

/**
 * Read a binary file from Drive and return it as a FileExplorerData JSON string
 * with base64-encoded data. Used by drive-read and drive-file-picker handlers.
 */
export async function readBinaryFileAsExplorerData(
  accessToken: string,
  fileId: string,
  fileName: string,
  mimeType: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const res = await driveService.readFileRaw(accessToken, fileId, { signal: abortSignal });
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const ext = fileName.includes(".") ? fileName.split(".").pop()! : "";
  const name = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
  const fileData: FileExplorerData = {
    id: fileId,
    path: fileName,
    basename: fileName,
    name,
    extension: ext,
    mimeType,
    contentType: "binary",
    data: base64,
  };
  return JSON.stringify(fileData);
}
