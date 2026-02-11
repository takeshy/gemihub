// Drive tools for Gemini Function Calling in chat

import {
  readFile,
  readFileRaw,
  getFileMetadata,
  searchFiles,
  createFile,
  updateFile,
} from "./google-drive.server";
import { getFileListFromMeta, upsertFileInMeta } from "./sync-meta.server";
import type { ToolDefinition } from "~/types/settings";

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

export interface DriveToolMediaResult {
  __mediaData: {
    mimeType: string;
    base64: string;
    fileName: string;
  };
}

/**
 * Set of drive tool names that are search/list related.
 * Used for filtering when driveToolMode === "noSearch".
 */
export const DRIVE_SEARCH_TOOL_NAMES = new Set([
  "search_drive_files",
  "list_drive_files",
]);

/**
 * Drive tool definitions for Gemini Function Calling
 */
export const DRIVE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_drive_file",
    description: "Read the content of a file from Google Drive by its file ID",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID",
        },
      },
      required: ["fileId"],
    },
  },
  {
    name: "search_drive_files",
    description: "Search for files in Google Drive by name or content",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        searchContent: {
          type: "boolean",
          description: "Whether to search file content (true) or just names (false). Default: false",
        },
        folder: {
          type: "string",
          description: "Virtual folder path to filter results (e.g. 'notes' or 'projects/src'). If omitted, searches all files",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_drive_files",
    description: "List files in Google Drive. Files are organized in a virtual folder structure using path separators in file names (e.g. 'notes/todo.md'). Use the folder parameter to list files under a specific path.",
    parameters: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Virtual folder path to list (e.g. 'notes' or 'projects/src'). If omitted, lists all files and top-level virtual folders",
        },
      },
    },
  },
  {
    name: "create_drive_file",
    description: "Create a new file in Google Drive. Use path separators in the name to place it in a virtual folder (e.g. 'notes/todo.md')",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The file name, optionally including virtual folder path (e.g. 'notes/todo.md')",
        },
        content: {
          type: "string",
          description: "The file content",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "update_drive_file",
    description: "Update the content of an existing file in Google Drive",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID",
        },
        content: {
          type: "string",
          description: "The new file content",
        },
      },
      required: ["fileId", "content"],
    },
  },
];

/**
 * Execute a Drive tool call
 */
export async function executeDriveTool(
  toolName: string,
  args: Record<string, unknown>,
  accessToken: string,
  rootFolderId: string
): Promise<unknown> {
  switch (toolName) {
    case "read_drive_file": {
      const fileId = args.fileId;
      if (typeof fileId !== "string" || !fileId) {
        return { error: "read_drive_file: 'fileId' must be a non-empty string" };
      }
      const metadata = await getFileMetadata(accessToken, fileId);
      if (isGeminiSupportedMedia(metadata.mimeType)) {
        const fileSize = metadata.size ? parseInt(metadata.size, 10) : 0;
        if (fileSize > MAX_INLINE_DATA_BYTES) {
          return { error: `File is too large (${Math.round(fileSize / 1024 / 1024)}MB). Maximum supported size is 20MB.` };
        }
        const rawRes = await readFileRaw(accessToken, fileId);
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
      const content = await readFile(accessToken, fileId);
      return { content };
    }

    case "search_drive_files": {
      const query = args.query;
      if (typeof query !== "string" || !query) {
        return { error: "search_drive_files: 'query' must be a non-empty string" };
      }
      const searchContent = (args.searchContent as boolean) ?? false;
      const folder = args.folder as string | undefined;
      let files = await searchFiles(accessToken, rootFolderId, query, searchContent);
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
      const { files: allFiles } = await getFileListFromMeta(accessToken, rootFolderId);

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
      const name = args.name;
      const content = args.content;
      if (typeof name !== "string" || !name) {
        return { error: "create_drive_file: 'name' must be a non-empty string" };
      }
      if (typeof content !== "string") {
        return { error: "create_drive_file: 'content' must be a string" };
      }
      const file = await createFile(accessToken, name, content, rootFolderId);
      await upsertFileInMeta(accessToken, rootFolderId, file);
      return {
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink,
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
      const file = await updateFile(accessToken, fileId, content);
      await upsertFileInMeta(accessToken, rootFolderId, file);
      return {
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
