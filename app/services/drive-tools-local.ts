/**
 * Local Drive tool execution for Gemini Function Calling.
 * Browser-side equivalent of executeDriveTool() in drive-tools.server.ts.
 * Uses drive-local.ts for all IndexedDB operations.
 */

import {
  readFileLocal,
  readFileBinaryLocal,
  searchFilesLocal,
  writeFileLocal,
  renameFileLocal,
  findFileByNameLocal,
  getRemoteMetaFiles,
} from "./drive-local";
import { getCachedRemoteMeta } from "./indexeddb-cache";
import type { DriveEvent } from "~/engine/local-executor";

const GEMINI_MEDIA_PREFIXES = ["image/", "audio/", "video/"];
const GEMINI_MEDIA_EXACT = new Set(["application/pdf"]);
const MAX_INLINE_DATA_BYTES = 20 * 1024 * 1024; // 20MB — matches server limit

function isGeminiSupportedMedia(mimeType: string): boolean {
  return (
    GEMINI_MEDIA_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    GEMINI_MEDIA_EXACT.has(mimeType)
  );
}

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json", "application/xml", "application/javascript",
  "application/x-yaml", "application/x-sh", "application/sql",
  "application/graphql", "application/ld+json", "application/xhtml+xml",
  "application/x-httpd-php",
]);

function isTextualMimeType(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) || TEXT_MIME_EXACT.has(mimeType);
}

interface LocalDriveToolCallbacks {
  onDriveEvent?: (event: DriveEvent) => void;
}

const SCHEMA_FILE_PATH = "web/__gemihub/schema.md";

/**
 * Apply schema.md to the spreadsheet whenever it is written. The skill
 * declares a `migrate_spreadsheet_schema` tool for this, but the LLM
 * frequently forgets to call it after editing schema.md, leaving the
 * sheet structure out of sync. Triggering migration server-side as a
 * side effect of the file write makes it impossible to skip.
 *
 * Returned to the caller so the LLM sees the migration outcome (created
 * / updated / unchanged sheets, or an error) without an extra round-trip.
 */
async function autoMigrateSchemaIfNeeded(
  fileName: string,
  content: string,
  abortSignal?: AbortSignal,
): Promise<unknown | undefined> {
  if (fileName !== SCHEMA_FILE_PATH) return undefined;
  try {
    const res = await fetch("/api/settings/hubwork-migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: content }),
      signal: abortSignal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data as { error?: string }).error || `HTTP ${res.status}`;
      console.error("[drive-tools-local] Auto schema migration failed:", message);
      return { error: message };
    }
    return data;
  } catch (err) {
    if (abortSignal?.aborted) return undefined;
    const message = err instanceof Error ? err.message : "Schema migration failed";
    console.error("[drive-tools-local] Auto schema migration threw:", message);
    return { error: message };
  }
}

/**
 * Execute a Drive tool call locally using IndexedDB cache.
 * Returns the same result format as the server-side executeDriveTool.
 */
export async function executeLocalDriveTool(
  toolName: string,
  args: Record<string, unknown>,
  callbacks?: LocalDriveToolCallbacks,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  if (abortSignal?.aborted) throw new Error("Execution cancelled");

  switch (toolName) {
    case "read_drive_file": {
      const fileId = args.fileId;
      if (typeof fileId !== "string" || !fileId) {
        return { error: "read_drive_file: 'fileId' must be a non-empty string" };
      }

      // Check mime type from remote meta
      const meta = await getCachedRemoteMeta();
      const fileMeta = meta?.files[fileId];
      const mimeType = fileMeta?.mimeType || "text/plain";

      if (isGeminiSupportedMedia(mimeType)) {
        try {
          const base64 = await readFileBinaryLocal(fileId);
          // Check size limit (base64 is ~4/3 of raw bytes)
          const estimatedBytes = Math.ceil(base64.length * 3 / 4);
          if (estimatedBytes > MAX_INLINE_DATA_BYTES) {
            return { error: `File is too large (${Math.round(estimatedBytes / 1024 / 1024)}MB). Maximum supported size is 20MB.` };
          }
          return {
            __mediaData: {
              mimeType,
              base64,
              fileName: fileMeta?.name || fileId,
            },
          };
        } catch {
          return { error: `Failed to read binary file: ${fileId}` };
        }
      }

      if (!isTextualMimeType(mimeType) && mimeType !== "text/plain") {
        return { error: `Cannot read file of type '${mimeType}'. Supported formats: text files, images, audio, video, and PDF.` };
      }

      try {
        const content = await readFileLocal(fileId);
        return { content };
      } catch {
        return { error: `File not found in local cache: ${fileId}` };
      }
    }

    case "search_drive_files": {
      const query = args.query;
      if (typeof query !== "string" || !query) {
        return { error: "search_drive_files: 'query' must be a non-empty string" };
      }
      const searchContent = (args.searchContent as boolean) ?? false;
      const folder = args.folder as string | undefined;

      const files = await searchFilesLocal(query, searchContent, folder);
      return {
        files: files.map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
        })),
      };
    }

    case "list_drive_files": {
      const folder = args.folder as string | undefined;
      const allFiles = await getRemoteMetaFiles();

      // Filter and extract virtual structure (matching server logic)
      const prefix = folder ? folder + "/" : "";
      const filteredFiles: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }> = [];
      const virtualFolders = new Set<string>();

      for (const [fileId, f] of Object.entries(allFiles)) {
        if (folder && !f.name.startsWith(prefix)) continue;
        const relativeName = folder ? f.name.slice(prefix.length) : f.name;
        const slashIndex = relativeName.indexOf("/");

        if (slashIndex === -1) {
          filteredFiles.push({
            id: fileId,
            name: relativeName,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
          });
        } else {
          virtualFolders.add(relativeName.slice(0, slashIndex));
        }
      }

      return {
        files: filteredFiles,
        folders: Array.from(virtualFolders).sort().map(name => ({ name })),
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
      const name = rawName;

      // Refuse to silently overwrite. The LLM must consciously call
      // update_drive_file with the existing fileId — this surfaces the
      // edit in the tools panel as an "update", and lets schema.md /
      // sheet migrations fire on the right code path.
      const existing = await findFileByNameLocal(name);
      if (existing) {
        return {
          error: `create_drive_file: a file already exists at '${name}' (fileId=${existing.id}). Use update_drive_file with that fileId instead — create_drive_file is for new paths only.`,
          existingFileId: existing.id,
        };
      }

      const result = await writeFileLocal(name, content);

      callbacks?.onDriveEvent?.({
        type: "created",
        fileId: result.fileId,
        fileName: name,
        content,
        md5Checksum: "",
        modifiedTime: new Date().toISOString(),
      });

      const schemaMigration = await autoMigrateSchemaIfNeeded(name, content, abortSignal);

      return {
        id: result.fileId,
        name,
        content,
        ...(schemaMigration !== undefined ? { schemaMigration } : {}),
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

      const meta = await getCachedRemoteMeta();
      const fileMeta = meta?.files[fileId];
      const fileName = fileMeta?.name || fileId;

      await writeFileLocal(fileName, content, { existingFileId: fileId });

      callbacks?.onDriveEvent?.({
        type: "updated",
        fileId,
        fileName,
        content,
      });

      const schemaMigration = await autoMigrateSchemaIfNeeded(fileName, content, abortSignal);

      return {
        id: fileId,
        name: fileName,
        content,
        ...(schemaMigration !== undefined ? { schemaMigration } : {}),
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
      await renameFileLocal(fileId, newName);
      return { id: fileId, name: newName };
    }

    case "bulk_rename_drive_files": {
      const files = args.files;
      if (!Array.isArray(files) || files.length === 0) {
        return { error: "bulk_rename_drive_files: 'files' must be a non-empty array" };
      }
      const results: Array<{ id: string; name: string } | { error: string }> = [];
      for (const entry of files) {
        const { fileId, newName } = entry as { fileId?: string; newName?: string };
        if (typeof fileId !== "string" || !fileId || typeof newName !== "string" || !newName) {
          results.push({ error: "Invalid entry: fileId and newName are required" });
          continue;
        }
        try {
          await renameFileLocal(fileId, newName);
          results.push({ id: fileId, name: newName });
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
