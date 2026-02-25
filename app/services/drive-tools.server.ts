// Drive tools for Gemini Function Calling in chat

import {
  readFile,
  readFileRaw,
  getFileMetadata,
  searchFiles,
  createFile,
  renameFile,
} from "./google-drive.server";
import { getFileListFromMeta, upsertFileInMeta } from "./sync-meta.server";

// Re-export shared definitions and types from browser-safe modules
export { DRIVE_TOOL_DEFINITIONS, DRIVE_SEARCH_TOOL_NAMES } from "./drive-tool-definitions";
export type { DriveToolMediaResult } from "./gemini-chat-core";
import type { DriveToolMediaResult } from "./gemini-chat-core";

const GEMINI_MEDIA_PREFIXES = ["image/", "audio/", "video/"];
const GEMINI_MEDIA_EXACT = new Set(["application/pdf"]);

function isGeminiSupportedMedia(mimeType: string): boolean {
  return (
    GEMINI_MEDIA_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    GEMINI_MEDIA_EXACT.has(mimeType)
  );
}

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/x-sh",
  "application/sql",
  "application/graphql",
  "application/ld+json",
  "application/xhtml+xml",
  "application/x-httpd-php",
]);

function isTextualMimeType(mimeType: string): boolean {
  return (
    TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    TEXT_MIME_EXACT.has(mimeType)
  );
}

const MAX_INLINE_DATA_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * Execute a Drive tool call
 */
export async function executeDriveTool(
  toolName: string,
  args: Record<string, unknown>,
  accessToken: string,
  rootFolderId: string,
  abortSignal?: AbortSignal
): Promise<unknown> {
  if (abortSignal?.aborted) {
    throw new Error("Execution cancelled");
  }
  switch (toolName) {
    case "read_drive_file": {
      const fileId = args.fileId;
      if (typeof fileId !== "string" || !fileId) {
        return { error: "read_drive_file: 'fileId' must be a non-empty string" };
      }
      const metadata = await getFileMetadata(accessToken, fileId, { signal: abortSignal });
      if (isGeminiSupportedMedia(metadata.mimeType)) {
        const fileSize = metadata.size ? parseInt(metadata.size, 10) : 0;
        if (fileSize > MAX_INLINE_DATA_BYTES) {
          return { error: `File is too large (${Math.round(fileSize / 1024 / 1024)}MB). Maximum supported size is 20MB.` };
        }
        const rawRes = await readFileRaw(accessToken, fileId, { signal: abortSignal });
        const buf = await rawRes.arrayBuffer();
        const base64 = Buffer.from(buf).toString("base64");
        return {
          __mediaData: {
            mimeType: metadata.mimeType,
            base64,
            fileName: metadata.name,
          },
        } satisfies DriveToolMediaResult;
      }
      if (!isTextualMimeType(metadata.mimeType)) {
        return { error: `Cannot read file of type '${metadata.mimeType}'. Supported formats: text files, images, audio, video, and PDF.` };
      }
      const content = await readFile(accessToken, fileId, { signal: abortSignal });
      return { content };
    }

    case "search_drive_files": {
      const query = args.query;
      if (typeof query !== "string" || !query) {
        return { error: "search_drive_files: 'query' must be a non-empty string" };
      }
      const searchContent = (args.searchContent as boolean) ?? false;
      const folder = args.folder as string | undefined;
      let files = await searchFiles(accessToken, rootFolderId, query, searchContent, { signal: abortSignal });
      // Filter by virtual folder prefix
      if (folder) {
        files = files.filter(
          (f) => f.name === folder || f.name.startsWith(folder + "/")
        );
      }
      return {
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
        })),
      };
    }

    case "list_drive_files": {
      const folder = args.folder as string | undefined;
      const { files: allFiles } = await getFileListFromMeta(accessToken, rootFolderId, { signal: abortSignal });

      // Filter and extract virtual structure
      const prefix = folder ? folder + "/" : "";
      const filteredFiles: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }> = [];
      const virtualFolders = new Set<string>();

      for (const f of allFiles) {
        if (folder && !f.name.startsWith(prefix)) continue;

        const relativeName = folder ? f.name.slice(prefix.length) : f.name;
        const slashIndex = relativeName.indexOf("/");

        if (slashIndex === -1) {
          // Direct child file
          filteredFiles.push({
            id: f.id,
            name: relativeName,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
          });
        } else {
          // File in a subfolder — extract immediate subfolder name
          virtualFolders.add(relativeName.slice(0, slashIndex));
        }
      }

      return {
        files: filteredFiles,
        folders: Array.from(virtualFolders)
          .sort()
          .map((name) => ({ name })),
      };
    }

    case "create_drive_file": {
      const rawName = args.name;
      const content = args.content;
      if (typeof rawName !== "string" || !rawName) {
        return { error: "create_drive_file: 'name' must be a non-empty string" };
      }
      if (typeof content !== "string") {
        return { error: "create_drive_file: 'content' must be a string" };
      }
      const name = rawName.startsWith("temporaries/") ? rawName : `temporaries/${rawName}`;
      const file = await createFile(accessToken, name, content, rootFolderId, "text/plain", { signal: abortSignal });
      await upsertFileInMeta(accessToken, rootFolderId, file, { signal: abortSignal });
      return {
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink,
        content,
        md5Checksum: file.md5Checksum,
        modifiedTime: file.modifiedTime,
      };
    }

    case "update_drive_file": {
      const fileId = args.fileId;
      const content = args.content;
      if (typeof fileId !== "string" || !fileId) {
        return { error: "update_drive_file: 'fileId' must be a non-empty string" };
      }
      if (typeof content !== "string") {
        return { error: "update_drive_file: 'content' must be a string" };
      }
      const fileMeta = await getFileMetadata(accessToken, fileId, { signal: abortSignal });
      return {
        id: fileMeta.id,
        name: fileMeta.name,
        webViewLink: fileMeta.webViewLink,
        content,
      };
    }

    case "rename_drive_file": {
      const fileId = args.fileId;
      const newName = args.newName;
      if (typeof fileId !== "string" || !fileId) {
        return { error: "rename_drive_file: 'fileId' must be a non-empty string" };
      }
      if (typeof newName !== "string" || !newName) {
        return { error: "rename_drive_file: 'newName' must be a non-empty string" };
      }
      const file = await renameFile(accessToken, fileId, newName, { signal: abortSignal });
      await upsertFileInMeta(accessToken, rootFolderId, file, { signal: abortSignal });
      return {
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink,
      };
    }

    case "bulk_rename_drive_files": {
      const files = args.files;
      if (!Array.isArray(files) || files.length === 0) {
        return { error: "bulk_rename_drive_files: 'files' must be a non-empty array" };
      }
      const results: Array<{ id: string; name: string; webViewLink?: string } | { error: string }> = [];
      for (const entry of files) {
        const { fileId, newName } = entry as { fileId?: string; newName?: string };
        if (typeof fileId !== "string" || !fileId || typeof newName !== "string" || !newName) {
          results.push({ error: `Invalid entry: fileId and newName are required` });
          continue;
        }
        try {
          const file = await renameFile(accessToken, fileId, newName, { signal: abortSignal });
          await upsertFileInMeta(accessToken, rootFolderId, file, { signal: abortSignal });
          results.push({ id: file.id, name: file.name, webViewLink: file.webViewLink });
        } catch (err) {
          results.push({ error: `Failed to rename ${fileId}: ${err instanceof Error ? err.message : "unknown error"}` });
        }
      }
      return { results };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
