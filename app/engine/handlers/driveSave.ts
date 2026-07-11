import type { WorkflowNode, ExecutionContext, FileExplorerData, ServiceContext } from "../types";
import { replaceVariables } from "./utils";
import * as driveService from "~/services/google-drive.server";
import { upsertFileInMeta } from "~/services/sync-meta.server";

// Handle drive-save node (was: file-save) - save FileExplorerData to Drive
export async function handleDriveSaveNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const sourceRaw = node.properties["source"] || "";
  const path = replaceVariables(node.properties["path"] || "", context);
  const savePathTo = node.properties["savePathTo"];

  if (!sourceRaw) throw new Error("drive-save node missing 'source' property");
  if (!path) throw new Error("drive-save node missing 'path' property");

  // Resolve {{variable}} templates, then try variable lookup
  const resolved = replaceVariables(sourceRaw, context);
  const sourceValue = context.variables.get(resolved) ?? resolved;
  if (sourceValue === undefined) {
    throw new Error(`Variable '${sourceRaw}' not found`);
  }

  let fileData: FileExplorerData;
  try {
    fileData = JSON.parse(String(sourceValue));
  } catch {
    throw new Error(`Variable '${sourceRaw}' does not contain valid FileExplorerData JSON`);
  }

  // Determine filename
  let fileName = path;
  if (!fileName.includes(".") && fileData.extension) {
    fileName = `${fileName}.${fileData.extension}`;
  }

  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  // Create or update the file. Drive permits duplicate names, so an
  // unconditional create would make paid/scheduled workflows behave
  // differently from local workflows and accumulate duplicate paths.
  const content = fileData.contentType === "binary"
    ? fileData.data  // Base64 encoded
    : fileData.data;

  const existing = await driveService.findFileByExactName(
    accessToken,
    fileName,
    folderId,
    { signal: serviceContext.abortSignal },
  );
  const driveFile = fileData.contentType === "binary"
    ? existing
      ? await driveService.updateFileBinary(
        accessToken,
        existing.id,
        Buffer.from(content, "base64"),
        fileData.mimeType,
        { signal: serviceContext.abortSignal },
      )
      : await driveService.createFileBinary(
        accessToken,
        fileName,
        Buffer.from(content, "base64"),
        folderId,
        fileData.mimeType,
        { signal: serviceContext.abortSignal },
      )
    : existing
      ? await driveService.updateFile(
        accessToken,
        existing.id,
        content,
        fileData.mimeType,
        { signal: serviceContext.abortSignal },
      )
      : await driveService.createFile(
        accessToken,
        fileName,
        content,
        folderId,
        fileData.mimeType,
        { signal: serviceContext.abortSignal },
      );

  await upsertFileInMeta(accessToken, folderId, driveFile, { signal: serviceContext.abortSignal });
  const driveEvent = {
    fileId: driveFile.id,
    fileName: driveFile.name,
    content: fileData.contentType === "binary" ? "" : content,
    md5Checksum: driveFile.md5Checksum || "",
    modifiedTime: driveFile.modifiedTime || "",
  };
  if (existing) serviceContext.onDriveFileUpdated?.(driveEvent);
  else serviceContext.onDriveFileCreated?.(driveEvent);

  if (savePathTo) {
    context.variables.set(savePathTo, driveFile.name);
  }
}
