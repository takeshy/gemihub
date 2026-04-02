/**
 * Local Drive node handlers (7 types).
 * All operations use IndexedDB cache via drive-local.ts.
 */
import type { WorkflowNode, ExecutionContext, FileExplorerData, PromptCallbacks } from "../types";
import type { DriveEvent } from "../local-executor";
import { replaceVariables } from "../handlers/utils";
import { isEncryptedFile, decryptFileContent } from "~/services/crypto-core";
import {
  resolveFileLocal,
  readFileLocal,
  readFileBinaryLocal,
  searchFilesLocal,
  listFilesLocal,
  listFoldersLocal,
  writeFileLocal,
  deleteFileLocal,
  saveBinaryFileLocal,
  findFileByNameLocal,
} from "~/services/drive-local";
import { isBinaryMimeType } from "~/services/sync-client-utils";

function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)\s*(d|h|m)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "d": return num * 24 * 60 * 60 * 1000;
    case "h": return num * 60 * 60 * 1000;
    case "m": return num * 60 * 1000;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// drive-read
// ---------------------------------------------------------------------------

export async function handleDriveReadNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
  promptCallbacks?: PromptCallbacks,
): Promise<void> {
  const pathRaw = node.properties["path"] || "";
  const saveTo = node.properties["saveTo"];
  if (!saveTo) throw new Error("drive-read node missing 'saveTo' property");
  if (!pathRaw.trim()) throw new Error("drive-read node missing 'path' property");

  const file = await resolveFileLocal(pathRaw, context, { tryMdExtension: true });

  if (isBinaryMimeType(file.mimeType)) {
    // Return as FileExplorerData JSON
    const base64 = await readFileBinaryLocal(file.id);
    const ext = file.name.includes(".") ? file.name.split(".").pop()! : "";
    const name = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
    const fileData: FileExplorerData = {
      id: file.id,
      path: file.name,
      basename: file.name,
      name,
      extension: ext,
      mimeType: file.mimeType,
      contentType: "binary",
      data: base64,
    };
    context.variables.set(saveTo, JSON.stringify(fileData));
  } else {
    let content = await readFileLocal(file.id);
    // Decrypt if the file is encrypted
    if (isEncryptedFile(content)) {
      if (!promptCallbacks?.promptForPassword) {
        throw new Error(`Cannot read encrypted file without password: ${file.name}`);
      }
      const password = await promptCallbacks.promptForPassword(`Enter password for: ${file.name}`);
      if (!password) {
        throw new Error(`Cannot read encrypted file without password: ${file.name}`);
      }
      try {
        content = await decryptFileContent(content, password);
      } catch {
        throw new Error(`Failed to decrypt file (wrong password?): ${file.name}`);
      }
    }
    context.variables.set(saveTo, content);
  }
}

// ---------------------------------------------------------------------------
// drive-file (write)
// ---------------------------------------------------------------------------

export async function handleDriveFileNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
  promptCallbacks?: PromptCallbacks,
): Promise<DriveEvent[]> {
  const path = replaceVariables(node.properties["path"] || "", context);
  const content = replaceVariables(node.properties["content"] || "", context);
  const mode = node.properties["mode"] || "overwrite";
  const confirm = node.properties["confirm"] ?? "true";

  if (!path) throw new Error("drive-file node missing 'path' property");

  const baseName = path.includes("/") ? path.split("/").pop()! : path;
  const hasExtension = baseName.includes(".");
  const fileName = hasExtension ? path : `${path}.md`;

  const driveEvents: DriveEvent[] = [];

  // Check for companion _fileId variable
  let existingFileId: string | undefined;
  const pathRaw = node.properties["path"] || "";
  const fileVarMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (fileVarMatch) {
    const pickerFileId = context.variables.get(`${fileVarMatch[1]}_fileId`);
    if (pickerFileId && typeof pickerFileId === "string") {
      existingFileId = pickerFileId;
    }
  }

  // Search for existing file in local cache
  if (!existingFileId) {
    const existing = await findFileByNameLocal(fileName);
    if (existing) existingFileId = existing.id;
  }

  // Read old content for diff/append
  let oldContent = "";
  if (existingFileId) {
    try {
      oldContent = await readFileLocal(existingFileId);
    } catch { /* file may not be readable */ }
  }

  // Diff review
  if (confirm !== "false" && existingFileId && promptCallbacks?.promptForDiff) {
    const proposedContent = mode === "append" ? oldContent + "\n" + content : content;
    if (proposedContent !== oldContent) {
      const approved = await promptCallbacks.promptForDiff("Confirm Write", fileName, oldContent, proposedContent);
      if (!approved) return driveEvents;
    }
  }

  if (mode === "create") {
    if (existingFileId) return driveEvents; // File exists, skip
    const result = await writeFileLocal(fileName, content);
    driveEvents.push({
      type: "created", fileId: result.fileId, fileName,
      content, md5Checksum: "", modifiedTime: new Date().toISOString(),
    });
  } else if (mode === "append") {
    if (existingFileId) {
      const finalContent = oldContent + "\n" + content;
      await writeFileLocal(fileName, finalContent, { existingFileId });
      driveEvents.push({ type: "updated", fileId: existingFileId, fileName, content: finalContent });
    } else {
      const result = await writeFileLocal(fileName, content);
      driveEvents.push({
        type: "created", fileId: result.fileId, fileName,
        content, md5Checksum: "", modifiedTime: new Date().toISOString(),
      });
    }
  } else {
    // overwrite
    if (existingFileId) {
      await writeFileLocal(fileName, content, { existingFileId });
      driveEvents.push({ type: "updated", fileId: existingFileId, fileName, content });
    } else {
      const result = await writeFileLocal(fileName, content);
      driveEvents.push({
        type: "created", fileId: result.fileId, fileName,
        content, md5Checksum: "", modifiedTime: new Date().toISOString(),
      });
    }
  }

  // Set __openFile if open property is enabled
  const open = node.properties["open"];
  const lastEvent = driveEvents[driveEvents.length - 1];
  if (open === "true" && lastEvent) {
    // Guess mimeType from file extension
    const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
    const mimeByExt: Record<string, string> = {
      md: "text/markdown", yaml: "text/yaml", yml: "text/yaml",
      json: "application/json", txt: "text/plain",
    };
    context.variables.set("__openFile", JSON.stringify({
      fileId: lastEvent.fileId,
      fileName: lastEvent.fileName,
      mimeType: mimeByExt[ext] || "text/plain",
    }));
  }

  return driveEvents;
}

// ---------------------------------------------------------------------------
// drive-search
// ---------------------------------------------------------------------------

export async function handleDriveSearchNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
): Promise<void> {
  const query = replaceVariables(node.properties["query"] || "", context);
  const searchContent = node.properties["searchContent"] === "true";
  const saveTo = node.properties["saveTo"];

  if (!query) throw new Error("drive-search node missing 'query' property");
  if (!saveTo) throw new Error("drive-search node missing 'saveTo' property");

  const limitStr = node.properties["limit"];
  const limit = limitStr ? (parseInt(replaceVariables(limitStr, context), 10) || 10) : 10;

  const files = await searchFilesLocal(query, searchContent);
  const results = files.slice(0, limit).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
  }));

  context.variables.set(saveTo, JSON.stringify(results));
}

// ---------------------------------------------------------------------------
// drive-list
// ---------------------------------------------------------------------------

export async function handleDriveListNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
): Promise<void> {
  const folder = replaceVariables(node.properties["folder"] || "", context);
  const limitStr = node.properties["limit"] || "50";
  const limit = parseInt(replaceVariables(limitStr, context), 10) || 50;
  const sortBy = replaceVariables(node.properties["sortBy"] || "modified", context);
  const sortOrder = replaceVariables(node.properties["sortOrder"] || "desc", context);
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("drive-list node missing 'saveTo' property");

  const modifiedWithin = node.properties["modifiedWithin"]
    ? replaceVariables(node.properties["modifiedWithin"], context) : undefined;
  const createdWithin = node.properties["createdWithin"]
    ? replaceVariables(node.properties["createdWithin"], context) : undefined;

  const { files, totalCount } = await listFilesLocal(folder || undefined, {
    limit,
    sortBy,
    sortOrder,
    modifiedWithinMs: modifiedWithin ? (parseDuration(modifiedWithin) ?? undefined) : undefined,
    createdWithinMs: createdWithin ? (parseDuration(createdWithin) ?? undefined) : undefined,
  });

  const results = files.map(f => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
  }));

  context.variables.set(saveTo, JSON.stringify({
    notes: results,
    count: results.length,
    totalCount,
    hasMore: totalCount > limit,
  }));
}

// ---------------------------------------------------------------------------
// drive-folder-list
// ---------------------------------------------------------------------------

export async function handleDriveFolderListNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
): Promise<void> {
  const parentFolder = replaceVariables(node.properties["folder"] || "", context);
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("drive-folder-list node missing 'saveTo' property");

  const sortedFolders = await listFoldersLocal(parentFolder || undefined);

  context.variables.set(saveTo, JSON.stringify({
    folders: sortedFolders.map(name => ({ name })),
    count: sortedFolders.length,
  }));
}

// ---------------------------------------------------------------------------
// drive-save
// ---------------------------------------------------------------------------

export async function handleDriveSaveNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
): Promise<DriveEvent[]> {
  const sourceRaw = node.properties["source"] || "";
  const path = replaceVariables(node.properties["path"] || "", context);
  const savePathTo = node.properties["savePathTo"];

  if (!sourceRaw) throw new Error("drive-save node missing 'source' property");
  if (!path) throw new Error("drive-save node missing 'path' property");

  const resolved = replaceVariables(sourceRaw, context);
  const sourceValue = context.variables.get(resolved) ?? resolved;

  let fileData: FileExplorerData;
  try {
    const parsed = JSON.parse(String(sourceValue));
    if (parsed && typeof parsed === "object" && "data" in parsed && "contentType" in parsed) {
      fileData = parsed;
    } else {
      throw new Error("not FileExplorerData");
    }
  } catch {
    // Fallback: treat source as plain text content
    const ext = path.includes(".") ? path.split(".").pop() || "" : "";
    fileData = {
      path,
      basename: path.split("/").pop() || path,
      name: path.split("/").pop()?.replace(/\.[^.]+$/, "") || path,
      extension: ext,
      mimeType: ext === "html" ? "text/html" : ext === "yaml" || ext === "yml" ? "text/yaml" : ext === "json" ? "application/json" : "text/plain",
      contentType: "text",
      data: String(sourceValue),
    };
  }

  let fileName = path;
  if (!fileName.includes(".") && fileData.extension) {
    fileName = `${fileName}.${fileData.extension}`;
  }

  // Check for companion _fileId variable (from drive-file-picker)
  const pathRaw = node.properties["path"] || "";
  let existingFileId: string | undefined;
  const fileVarMatch = pathRaw.trim().match(/^\{\{(\w+)\}\}$/);
  if (fileVarMatch) {
    const pickerFileId = context.variables.get(`${fileVarMatch[1]}_fileId`);
    if (pickerFileId && typeof pickerFileId === "string") {
      existingFileId = pickerFileId;
    }
  }

  const driveEvents: DriveEvent[] = [];
  const content = fileData.data;

  if (fileData.contentType === "binary") {
    const result = await saveBinaryFileLocal(fileName, content, fileData.mimeType, { existingFileId });
    driveEvents.push({
      type: result.isNew ? "created" : "updated", fileId: result.fileId, fileName,
      content: "", md5Checksum: "", modifiedTime: new Date().toISOString(),
    });
  } else {
    const result = await writeFileLocal(fileName, content, { existingFileId });
    driveEvents.push({
      type: result.isNew ? "created" : "updated", fileId: result.fileId, fileName,
      content, md5Checksum: "", modifiedTime: new Date().toISOString(),
    });
  }

  if (savePathTo) {
    context.variables.set(savePathTo, fileName);
  }

  return driveEvents;
}

// ---------------------------------------------------------------------------
// drive-delete
// ---------------------------------------------------------------------------

export async function handleDriveDeleteNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
): Promise<DriveEvent[]> {
  const pathRaw = node.properties["path"] || "";
  const file = await resolveFileLocal(pathRaw, context, { tryMdExtension: true });

  await deleteFileLocal(file.id);

  return [{
    type: "deleted",
    fileId: file.id,
    fileName: file.name,
  }];
}
