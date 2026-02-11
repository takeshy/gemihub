import type { WorkflowNode, ExecutionContext, ServiceContext, FileExplorerData, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
import * as driveService from "~/services/google-drive.server";
import { saveEdit } from "~/services/edit-history.server";
import { removeFileFromMeta } from "~/services/sync-meta.server";
import { isEncryptedFile, decryptFileContent } from "~/services/crypto-core";

const BINARY_MIME_PREFIXES = ["image/", "audio/", "video/"];
const BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/octet-stream",
]);

function isBinaryMimeType(mimeType: string): boolean {
  return BINARY_MIME_PREFIXES.some(p => mimeType.startsWith(p)) || BINARY_MIME_TYPES.has(mimeType);
}

async function readFileAsExplorerData(
  accessToken: string,
  fileId: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const res = await driveService.readFileRaw(accessToken, fileId);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
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

async function decryptIfEncrypted(
  content: string,
  path: string,
  promptCallbacks?: PromptCallbacks
): Promise<string> {
  if (!isEncryptedFile(content)) return content;
  if (!promptCallbacks?.promptForPassword) {
    throw new Error(`Cannot read encrypted file without password: ${path}`);
  }
  const password = await promptCallbacks.promptForPassword(
    `Enter password for: ${path}`
  );
  if (!password) {
    throw new Error(`Cannot read encrypted file without password: ${path}`);
  }
  try {
    return await decryptFileContent(content, password);
  } catch {
    throw new Error(`Failed to decrypt file (wrong password?): ${path}`);
  }
}

// Handle drive-file node (was: note) - write content to a Drive file
export async function handleDriveFileNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);
  const content = replaceVariables(node.properties["content"] || "", context);
  const mode = node.properties["mode"] || "overwrite";
  const confirm = node.properties["confirm"] ?? "true";
  const history = node.properties["history"];

  if (!path) throw new Error("drive-file node missing 'path' property");

  // Only append .md if path has no extension at all
  const baseName = path.includes("/") ? path.split("/").pop()! : path;
  const hasExtension = baseName.includes(".");
  const fileName = hasExtension ? path : `${path}.md`;
  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  // Check for companion _fileId variable from drive-file-picker
  let existingFile: driveService.DriveFile | undefined;
  const pathRaw = node.properties["path"] || "";
  const fileVarMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (fileVarMatch) {
    const pickerFileId = context.variables.get(`${fileVarMatch[1]}_fileId`);
    if (pickerFileId && typeof pickerFileId === "string") {
      existingFile = { id: pickerFileId, name: fileName, mimeType: "text/plain" };
    }
  }

  // Search for existing file
  if (!existingFile) {
    const existingFiles = await driveService.searchFiles(
      accessToken,
      folderId,
      fileName,
      false
    );
    existingFile = existingFiles.find(f => f.name === fileName);
  }

  // Fallback: exact name match within root folder (handles special chars)
  if (!existingFile) {
    existingFile = await driveService.findFileByExactName(accessToken, fileName, folderId) ?? undefined;
  }

  // Read existing content for history tracking, diff review, and append mode
  let oldContent = "";
  if (existingFile) {
    const needsOldContent =
      mode === "append" ||
      (history && history !== "false" && serviceContext.editHistorySettings) ||
      (confirm !== "false" && promptCallbacks?.promptForDiff);
    if (needsOldContent) {
      try {
        oldContent = await driveService.readFile(accessToken, existingFile.id);
      } catch { /* file may not be readable */ }
    }
  }

  // Diff review for existing files when confirm is enabled
  if (confirm !== "false" && existingFile && promptCallbacks?.promptForDiff) {
    const proposedContent = mode === "append"
      ? oldContent + "\n" + content
      : content;
    if (proposedContent !== oldContent) {
      const approved = await promptCallbacks.promptForDiff(
        "Confirm Write",
        fileName,
        oldContent,
        proposedContent
      );
      if (!approved) return; // User cancelled, skip write
    }
  }

  let finalContent = content;
  let resultFile: driveService.DriveFile | undefined;
  if (mode === "create") {
    if (existingFile) return; // File exists, skip
    resultFile = await driveService.createFile(accessToken, fileName, content, folderId, "text/markdown");
  } else if (mode === "append") {
    if (existingFile) {
      finalContent = oldContent + "\n" + content;
      await driveService.updateFile(accessToken, existingFile.id, finalContent, "text/markdown");
      resultFile = existingFile;
    } else {
      resultFile = await driveService.createFile(accessToken, fileName, content, folderId, "text/markdown");
    }
  } else {
    // overwrite
    if (existingFile) {
      await driveService.updateFile(accessToken, existingFile.id, content, "text/markdown");
      resultFile = existingFile;
    } else {
      resultFile = await driveService.createFile(accessToken, fileName, content, folderId, "text/markdown");
    }
  }

  // Set __openFile if open property is enabled
  const open = node.properties["open"];
  if (open === "true" && resultFile) {
    context.variables.set("__openFile", JSON.stringify({
      fileId: resultFile.id,
      fileName: resultFile.name,
      mimeType: resultFile.mimeType,
    }));
  }

  // Record edit history if enabled
  if (history && history !== "false" && serviceContext.editHistorySettings) {
    try {
      await saveEdit(accessToken, folderId, serviceContext.editHistorySettings, {
        path: fileName,
        oldContent,
        newContent: finalContent,
        source: "workflow",
      });
    } catch { /* history recording is non-fatal */ }
  }
}

// Handle drive-read node (was: note-read) - read file from Drive
export async function handleDriveReadNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const pathRaw = node.properties["path"] || "";
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("drive-read node missing 'saveTo' property");
  if (!pathRaw.trim()) throw new Error("drive-read node missing 'path' property");

  const path = replaceVariables(pathRaw, context);
  const accessToken = serviceContext.driveAccessToken;

  // Check if path is a Drive file ID (alphanumeric + hyphens/underscores, 20+ chars)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(path)) {
    const meta = await driveService.getFileMetadata(accessToken, path);
    if (isBinaryMimeType(meta.mimeType)) {
      context.variables.set(saveTo, await readFileAsExplorerData(accessToken, path, meta.name, meta.mimeType));
    } else {
      const content = await driveService.readFile(accessToken, path);
      context.variables.set(saveTo, await decryptIfEncrypted(content, meta.name, promptCallbacks));
    }
    return;
  }

  // Check for companion _fileId variable from drive-file-picker
  const varMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (varMatch) {
    const fileId = context.variables.get(`${varMatch[1]}_fileId`);
    if (fileId && typeof fileId === "string") {
      const meta = await driveService.getFileMetadata(accessToken, fileId);
      if (isBinaryMimeType(meta.mimeType)) {
        context.variables.set(saveTo, await readFileAsExplorerData(accessToken, fileId, meta.name, meta.mimeType));
      } else {
        const content = await driveService.readFile(accessToken, fileId);
        context.variables.set(saveTo, await decryptIfEncrypted(content, meta.name, promptCallbacks));
      }
      return;
    }
  }

  // Search by file name
  const folderId = serviceContext.driveRootFolderId;
  const files = await driveService.searchFiles(accessToken, folderId, path, false);
  let file = files.find(f => f.name === path || f.name === `${path}.md`);

  // Fallback: exact name match within root folder (handles special chars)
  if (!file) {
    file = await driveService.findFileByExactName(accessToken, path, folderId) ?? undefined;
    if (!file && !path.endsWith(".md")) {
      file = await driveService.findFileByExactName(accessToken, `${path}.md`, folderId) ?? undefined;
    }
  }

  if (!file) throw new Error(`File not found on Drive: ${path}`);

  if (isBinaryMimeType(file.mimeType)) {
    context.variables.set(saveTo, await readFileAsExplorerData(accessToken, file.id, file.name, file.mimeType));
  } else {
    const content = await driveService.readFile(accessToken, file.id);
    context.variables.set(saveTo, await decryptIfEncrypted(content, file.name, promptCallbacks));
  }
}

// Handle drive-delete node - soft delete (move file to trash/ subfolder)
export async function handleDriveDeleteNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  _promptCallbacks?: PromptCallbacks
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);
  if (!path) throw new Error("drive-delete node missing 'path' property");

  const baseName = path.includes("/") ? path.split("/").pop()! : path;
  const hasExtension = baseName.includes(".");
  const fileName = hasExtension ? path : `${path}.md`;
  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  // Check for companion _fileId variable from drive-file-picker
  let existingFile: driveService.DriveFile | undefined;
  const pathRaw = node.properties["path"] || "";
  const fileVarMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (fileVarMatch) {
    const pickerFileId = context.variables.get(`${fileVarMatch[1]}_fileId`);
    if (pickerFileId && typeof pickerFileId === "string") {
      existingFile = { id: pickerFileId, name: fileName, mimeType: "text/plain" };
    }
  }

  // Search for existing file
  if (!existingFile) {
    const existingFiles = await driveService.searchFiles(accessToken, folderId, fileName, false);
    existingFile = existingFiles.find(f => f.name === fileName);
  }

  // Fallback: exact name match within root folder (handles special chars)
  if (!existingFile) {
    existingFile = await driveService.findFileByExactName(accessToken, fileName, folderId) ?? undefined;
  }

  if (!existingFile) throw new Error(`File not found on Drive: ${path}`);

  // Soft delete: move to trash/ subfolder
  const trashFolderId = await driveService.ensureSubFolder(accessToken, folderId, "trash");
  const parentId = existingFile.parents?.[0] || folderId;
  await driveService.moveFile(accessToken, existingFile.id, trashFolderId, parentId);

  // Remove from sync metadata
  await removeFileFromMeta(accessToken, folderId, existingFile.id);
}
