import type { WorkflowNode, ExecutionContext, ServiceContext, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
import { isBinaryMimeType, resolveExistingFile, readBinaryFileAsExplorerData } from "./driveUtils";
import * as driveService from "~/services/google-drive.server";
import { saveEdit } from "~/services/edit-history.server";
import { removeFileFromMeta, upsertFileInMeta } from "~/services/sync-meta.server";
import { isEncryptedFile, decryptFileContent } from "~/services/crypto-core";

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
      false,
      { signal: serviceContext.abortSignal }
    );
    existingFile = existingFiles.find(f => f.name === fileName);
  }

  // Fallback: exact name match within root folder (handles special chars)
  if (!existingFile) {
    existingFile = await driveService.findFileByExactName(
      accessToken,
      fileName,
      folderId,
      { signal: serviceContext.abortSignal }
    ) ?? undefined;
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
        oldContent = await driveService.readFile(
          accessToken,
          existingFile.id,
          { signal: serviceContext.abortSignal }
        );
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
    resultFile = await driveService.createFile(
      accessToken,
      fileName,
      content,
      folderId,
      "text/markdown",
      { signal: serviceContext.abortSignal }
    );
    await upsertFileInMeta(accessToken, folderId, resultFile, { signal: serviceContext.abortSignal });
    serviceContext.onDriveFileCreated?.({
      fileId: resultFile.id,
      fileName: resultFile.name,
      content,
      md5Checksum: resultFile.md5Checksum || "",
      modifiedTime: resultFile.modifiedTime || "",
    });
  } else if (mode === "append") {
    if (existingFile) {
      finalContent = oldContent + "\n" + content;
      serviceContext.onDriveFileUpdated?.({
        fileId: existingFile.id,
        fileName: existingFile.name || fileName,
        content: finalContent,
      });
      resultFile = existingFile;
    } else {
      resultFile = await driveService.createFile(
        accessToken,
        fileName,
        content,
        folderId,
        "text/markdown",
        { signal: serviceContext.abortSignal }
      );
      await upsertFileInMeta(accessToken, folderId, resultFile, { signal: serviceContext.abortSignal });
      serviceContext.onDriveFileCreated?.({
        fileId: resultFile.id,
        fileName: resultFile.name,
        content,
        md5Checksum: resultFile.md5Checksum || "",
        modifiedTime: resultFile.modifiedTime || "",
      });
    }
  } else {
    // overwrite
    if (existingFile) {
      serviceContext.onDriveFileUpdated?.({
        fileId: existingFile.id,
        fileName: existingFile.name || fileName,
        content,
      });
      resultFile = existingFile;
    } else {
      resultFile = await driveService.createFile(
        accessToken,
        fileName,
        content,
        folderId,
        "text/markdown",
        { signal: serviceContext.abortSignal }
      );
      await upsertFileInMeta(accessToken, folderId, resultFile, { signal: serviceContext.abortSignal });
      serviceContext.onDriveFileCreated?.({
        fileId: resultFile.id,
        fileName: resultFile.name,
        content,
        md5Checksum: resultFile.md5Checksum || "",
        modifiedTime: resultFile.modifiedTime || "",
      });
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

  const accessToken = serviceContext.driveAccessToken;
  const file = await resolveExistingFile(pathRaw, context, serviceContext, { tryMdExtension: true });

  if (isBinaryMimeType(file.mimeType)) {
    context.variables.set(
      saveTo,
      await readBinaryFileAsExplorerData(
        accessToken,
        file.id,
        file.name,
        file.mimeType,
        serviceContext.abortSignal
      )
    );
  } else {
    const content = await driveService.readFile(accessToken, file.id, {
      signal: serviceContext.abortSignal,
    });
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
  const pathRaw = node.properties["path"] || "";
  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  const existingFile = await resolveExistingFile(pathRaw, context, serviceContext, { tryMdExtension: true });

  // Soft delete: move to trash/ subfolder
  const trashFolderId = await driveService.ensureSubFolder(accessToken, folderId, "trash", {
    signal: serviceContext.abortSignal,
  });
  const parentId = existingFile.parents?.[0] || folderId;
  await driveService.moveFile(accessToken, existingFile.id, trashFolderId, parentId, {
    signal: serviceContext.abortSignal,
  });

  // Remove from sync metadata
  await removeFileFromMeta(accessToken, folderId, existingFile.id, {
    signal: serviceContext.abortSignal,
  });

  // Notify client so file tree updates immediately
  serviceContext.onDriveFileDeleted?.({
    fileId: existingFile.id,
    fileName: existingFile.name,
  });
}
