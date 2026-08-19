// Project file storage tools for Gemini Function Calling in enterprise chat.
// File IDs are GCS relative paths within the selected project.

import {
  GcsObjectNotFoundError,
  deleteObject,
  listObjects,
  readObjectMetadata,
  readObject,
  renameObject,
  writeObject,
} from "./gcs-storage.server";
import type { ProjectAccessContext } from "~/types/enterprise";
import { DRIVE_TOOL_DEFINITIONS, DRIVE_SEARCH_TOOL_NAMES } from "./drive-tool-definitions";
import type { DriveToolMediaResult } from "./gemini-content-builders";
import { hasMinRole } from "./project-acl.server";

export { DRIVE_TOOL_DEFINITIONS, DRIVE_SEARCH_TOOL_NAMES };
export type { DriveToolMediaResult };

const GEMINI_MEDIA_PREFIXES = ["image/", "audio/", "video/"];
const GEMINI_MEDIA_EXACT = new Set(["application/pdf"]);
const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/x-sh",
  "application/sql",
  "application/graphql",
  "application/ld+json",
  "application/xhtml+xml",
]);
const MAX_INLINE_DATA_BYTES = 20 * 1024 * 1024;

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function isSystemPath(path: string): boolean {
  return path === "gemihub" || path.startsWith("gemihub/");
}

function pathArg(value: unknown, toolName: string, argName: string): string | { error: string } {
  if (typeof value !== "string" || !value) {
    return { error: `${toolName}: '${argName}' must be a non-empty string` };
  }
  const path = normalizePath(value);
  if (!path || isSystemPath(path)) {
    return { error: `${toolName}: '${argName}' must point to a user file` };
  }
  return path;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function isGeminiSupportedMedia(mimeType: string): boolean {
  return (
    GEMINI_MEDIA_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    GEMINI_MEDIA_EXACT.has(mimeType)
  );
}

function isTextualMimeType(mimeType: string): boolean {
  return (
    TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    TEXT_MIME_EXACT.has(mimeType)
  );
}

function inferTextContentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  switch (ext) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "yaml":
    case "yml":
      return "text/yaml";
    case "json":
      return "application/json";
    case "html":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
      return "application/javascript";
    case "ts":
      return "application/typescript";
    case "csv":
      return "text/csv";
    default:
      return "text/plain";
  }
}

async function listAllObjects(
  ctx: ProjectAccessContext,
  relativePrefix?: string,
) {
  const objects = [];
  let pageToken: string | undefined;
  do {
    const result = await listObjects(ctx, {
      relativePrefix,
      pageToken,
      pageSize: 1000,
    });
    objects.push(...result.objects);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return objects.filter((obj) => !isSystemPath(obj.relativePath));
}

function requireEditor(ctx: ProjectAccessContext, toolName: string): { error: string } | null {
  if (hasMinRole(ctx.role, "editor")) return null;
  return { error: `${toolName}: project editor role is required to modify files` };
}

export async function executeStorageTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ProjectAccessContext,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  if (abortSignal?.aborted) {
    throw new Error("Execution cancelled");
  }

  switch (toolName) {
    case "read_drive_file": {
      const fileId = pathArg(args.fileId, "read_drive_file", "fileId");
      if (typeof fileId !== "string") return fileId;
      try {
        const { object, bytes } = await readObject(ctx, fileId);
        if (isGeminiSupportedMedia(object.contentType)) {
          if (object.size > MAX_INLINE_DATA_BYTES) {
            return {
              error: `File is too large (${Math.round(object.size / 1024 / 1024)}MB). Maximum supported size is 20MB.`,
            };
          }
          return {
            __mediaData: {
              mimeType: object.contentType,
              base64: Buffer.from(bytes).toString("base64"),
              fileName: fileId,
            },
          } satisfies DriveToolMediaResult;
        }
        if (!isTextualMimeType(object.contentType)) {
          return {
            error: `Cannot read file of type '${object.contentType}'. Supported formats: text files, images, audio, video, and PDF.`,
          };
        }
        return { content: decode(bytes) };
      } catch (err) {
        if (err instanceof GcsObjectNotFoundError) {
          return { error: `File not found: ${fileId}` };
        }
        throw err;
      }
    }

    case "search_drive_files": {
      const query = args.query;
      if (typeof query !== "string" || !query) {
        return { error: "search_drive_files: 'query' must be a non-empty string" };
      }
      const searchContent = (args.searchContent as boolean) ?? false;
      const rawFolder = args.folder;
      const folder =
        typeof rawFolder === "string" && rawFolder ? normalizePath(rawFolder) : undefined;
      if (folder && isSystemPath(folder)) {
        return { error: "search_drive_files: 'folder' must point to a user folder" };
      }
      const objects = await listAllObjects(ctx, folder ? `${folder}/` : undefined);
      const lowerQuery = query.toLowerCase();
      const matched: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }> = [];

      for (const obj of objects) {
        const path = obj.relativePath;
        if (path.toLowerCase().includes(lowerQuery)) {
          matched.push({
            id: path,
            name: path,
            mimeType: obj.contentType,
            modifiedTime: obj.updatedAt ? new Date(obj.updatedAt).toISOString() : undefined,
          });
          continue;
        }
        if (!searchContent || !isTextualMimeType(obj.contentType)) continue;
        try {
          const { bytes } = await readObject(ctx, obj.relativePath);
          const content = decode(bytes);
          if (content.toLowerCase().includes(lowerQuery)) {
            matched.push({
              id: path,
              name: path,
              mimeType: obj.contentType,
              modifiedTime: obj.updatedAt ? new Date(obj.updatedAt).toISOString() : undefined,
            });
          }
        } catch {
          // Skip files that changed or became unreadable while scanning.
        }
      }

      return { files: matched };
    }

    case "list_drive_files": {
      const rawFolder = args.folder;
      const folder =
        typeof rawFolder === "string" && rawFolder ? normalizePath(rawFolder) : undefined;
      if (folder && isSystemPath(folder)) {
        return { error: "list_drive_files: 'folder' must point to a user folder" };
      }

      const objects = await listAllObjects(ctx, folder ? `${folder}/` : undefined);
      const files: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }> = [];
      const virtualFolders = new Set<string>();

      for (const obj of objects) {
        const path = obj.relativePath;
        const relativeName = folder ? path.slice(folder.length + 1) : path;
        const slashIndex = relativeName.indexOf("/");
        if (slashIndex === -1) {
          files.push({
            id: path,
            name: relativeName,
            mimeType: obj.contentType,
            modifiedTime: obj.updatedAt ? new Date(obj.updatedAt).toISOString() : undefined,
          });
        } else {
          virtualFolders.add(relativeName.slice(0, slashIndex));
        }
      }

      return {
        files,
        folders: Array.from(virtualFolders).sort().map((name) => ({ name })),
      };
    }

    case "create_drive_file": {
      const rawName = pathArg(args.name, "create_drive_file", "name");
      const content = args.content;
      if (typeof rawName !== "string") return rawName;
      if (typeof content !== "string") {
        return { error: "create_drive_file: 'content' must be a string" };
      }
      const roleError = requireEditor(ctx, "create_drive_file");
      if (roleError) return roleError;
      const existing = await readObjectMetadata(ctx, rawName);
      if (existing) {
        return {
          error: `create_drive_file: a file already exists at '${rawName}'. Use update_drive_file instead.`,
          existingFileId: rawName,
        };
      }
      const object = await writeObject(ctx, rawName, content, inferTextContentType(rawName), {
        ifGenerationMatch: 0,
        updatedBy: ctx.uid,
      });
      return {
        id: rawName,
        name: rawName,
        content,
        md5Checksum: object.md5Hash,
        modifiedTime: object.updatedAt ? new Date(object.updatedAt).toISOString() : undefined,
      };
    }

    case "update_drive_file": {
      const fileId = pathArg(args.fileId, "update_drive_file", "fileId");
      const content = args.content;
      if (typeof fileId !== "string") return fileId;
      if (typeof content !== "string") {
        return { error: "update_drive_file: 'content' must be a string" };
      }
      const roleError = requireEditor(ctx, "update_drive_file");
      if (roleError) return roleError;
      const existing = await readObjectMetadata(ctx, fileId);
      if (!existing) return { error: `File not found: ${fileId}` };
      const object = await writeObject(
        ctx,
        fileId,
        content,
        existing.contentType || inferTextContentType(fileId),
        { updatedBy: ctx.uid },
      );
      return {
        id: fileId,
        name: fileId,
        content,
        md5Checksum: object.md5Hash,
        modifiedTime: object.updatedAt ? new Date(object.updatedAt).toISOString() : undefined,
      };
    }

    case "rename_drive_file": {
      const fileId = pathArg(args.fileId, "rename_drive_file", "fileId");
      const newName = pathArg(args.newName, "rename_drive_file", "newName");
      if (typeof fileId !== "string") return fileId;
      if (typeof newName !== "string") return newName;
      const roleError = requireEditor(ctx, "rename_drive_file");
      if (roleError) return roleError;
      try {
        const destination = await readObjectMetadata(ctx, newName);
        if (destination && fileId !== newName) {
          return { error: `rename_drive_file: a file already exists at '${newName}'` };
        }
        await renameObject(ctx, fileId, newName);
      } catch (err) {
        if (err instanceof GcsObjectNotFoundError) {
          return { error: `File not found: ${fileId}` };
        }
        throw err;
      }
      return { id: newName, name: newName };
    }

    case "bulk_rename_drive_files": {
      const files = args.files;
      if (!Array.isArray(files) || files.length === 0) {
        return { error: "bulk_rename_drive_files: 'files' must be a non-empty array" };
      }
      const roleError = requireEditor(ctx, "bulk_rename_drive_files");
      if (roleError) return roleError;
      const results: Array<{ id: string; name: string } | { error: string }> = [];
      for (const entry of files) {
        const raw = entry as { fileId?: unknown; newName?: unknown };
        const fileId = pathArg(raw.fileId, "bulk_rename_drive_files", "fileId");
        const newName = pathArg(raw.newName, "bulk_rename_drive_files", "newName");
        if (typeof fileId !== "string") {
          results.push(fileId);
          continue;
        }
        if (typeof newName !== "string") {
          results.push(newName);
          continue;
        }
        try {
          const destination = await readObjectMetadata(ctx, newName);
          if (destination && fileId !== newName) {
            results.push({ error: `Failed to rename ${fileId}: destination exists at ${newName}` });
            continue;
          }
          await renameObject(ctx, fileId, newName);
          results.push({ id: newName, name: newName });
        } catch (err) {
          results.push({
            error: `Failed to rename ${fileId}: ${err instanceof Error ? err.message : "unknown error"}`,
          });
        }
      }
      return { results };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

export async function deleteStorageFile(
  ctx: ProjectAccessContext,
  filePath: string,
): Promise<void> {
  const path = normalizePath(filePath);
  if (isSystemPath(path)) return;
  try {
    await deleteObject(ctx, path);
  } catch (err) {
    if (!(err instanceof GcsObjectNotFoundError)) throw err;
  }
}
