import type { WorkflowNode, ExecutionContext, ServiceContext, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
import * as driveService from "~/services/google-drive.server";
import { saveEdit } from "~/services/edit-history.server";

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
  const confirm = node.properties["confirm"];
  const history = node.properties["history"];

  if (!path) throw new Error("drive-file node missing 'path' property");

  // Confirm before writing if confirm is set and not "false"
  if (confirm && confirm !== "false" && promptCallbacks?.promptForDialog) {
    const confirmResult = await promptCallbacks.promptForDialog(
      "Confirm Write",
      `Write to "${path}"?`,
      [],
      false,
      "OK",
      "Cancel"
    );
    if (confirmResult === null || confirmResult.button === "Cancel") {
      return; // User cancelled, skip write
    }
  }

  // Only append .md if path has no extension at all
  const baseName = path.includes("/") ? path.split("/").pop()! : path;
  const hasExtension = baseName.includes(".");
  const fileName = hasExtension ? path : `${path}.md`;
  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  // Check for companion _fileId variable from drive-file-picker
  let existingFile: driveService.DriveFile | undefined;
  const pathRaw = node.properties["path"] || "";
  const fileVarMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}/);
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

  // Fallback: exact name match (handles special chars and files in subfolders)
  if (!existingFile) {
    existingFile = await driveService.findFileByExactName(accessToken, fileName) ?? undefined;
  }

  // Read old content for history tracking
  let oldContent = "";
  if (history && history !== "false" && existingFile && serviceContext.editHistorySettings) {
    try {
      oldContent = await driveService.readFile(accessToken, existingFile.id);
    } catch { /* file may not be readable */ }
  }

  let finalContent = content;
  if (mode === "create") {
    if (existingFile) return; // File exists, skip
    await driveService.createFile(accessToken, fileName, content, folderId, "text/markdown");
  } else if (mode === "append") {
    if (existingFile) {
      const currentContent = await driveService.readFile(accessToken, existingFile.id);
      finalContent = currentContent + "\n" + content;
      await driveService.updateFile(accessToken, existingFile.id, finalContent, "text/markdown");
    } else {
      await driveService.createFile(accessToken, fileName, content, folderId, "text/markdown");
    }
  } else {
    // overwrite
    if (existingFile) {
      await driveService.updateFile(accessToken, existingFile.id, content, "text/markdown");
    } else {
      await driveService.createFile(accessToken, fileName, content, folderId, "text/markdown");
    }
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
  serviceContext: ServiceContext
): Promise<void> {
  const pathRaw = node.properties["path"] || "";
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("drive-read node missing 'saveTo' property");
  if (!pathRaw.trim()) throw new Error("drive-read node missing 'path' property");

  const path = replaceVariables(pathRaw, context);
  const accessToken = serviceContext.driveAccessToken;

  // Check if path is a Drive file ID (alphanumeric + hyphens/underscores, 20+ chars)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(path)) {
    const content = await driveService.readFile(accessToken, path);
    context.variables.set(saveTo, content);
    return;
  }

  // Check for companion _fileId variable from drive-file-picker
  const varMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (varMatch) {
    const fileId = context.variables.get(`${varMatch[1]}_fileId`);
    if (fileId && typeof fileId === "string") {
      const content = await driveService.readFile(accessToken, fileId);
      context.variables.set(saveTo, content);
      return;
    }
  }

  // Search by file name
  const folderId = serviceContext.driveRootFolderId;
  const files = await driveService.searchFiles(accessToken, folderId, path, false);
  let file = files.find(f => f.name === path || f.name === `${path}.md`);

  // Fallback: exact name match (handles special chars and files in subfolders)
  if (!file) {
    file = await driveService.findFileByExactName(accessToken, path) ?? undefined;
    if (!file && !path.endsWith(".md")) {
      file = await driveService.findFileByExactName(accessToken, `${path}.md`) ?? undefined;
    }
  }

  if (!file) throw new Error(`File not found on Drive: ${path}`);

  const content = await driveService.readFile(accessToken, file.id);
  context.variables.set(saveTo, content);
}
