// RAG / Gemini File Search manager - ported from obsidian-gemini-helper (Drive-based version)

import { GoogleGenAI } from "@google/genai";
import { readFileBytes } from "./google-drive.server";
import { getFileListFromMeta } from "./sync-meta.server";
import type { RagSetting, RagFileInfo } from "~/types/settings";
import { isRagEligible } from "~/constants/rag";
export { RAG_ELIGIBLE_EXTENSIONS, isRagEligible } from "~/constants/rag";

export interface SyncResult {
  uploaded: string[];
  skipped: string[];
  deleted: string[];
  errors: Array<{ path: string; error: string }>;
  newFiles: Record<string, RagFileInfo>;
  lastFullSync: number;
}

interface FileSearchOperationOptions {
  signal?: AbortSignal;
}

function getMimeTypeForFile(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".tsv")) return "text/tab-separated-values";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".xml")) return "application/xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "text/yaml";
  return "text/plain";
}

/**
 * Calculate SHA-256 checksum of content
 */
export async function calculateChecksum(content: string | Uint8Array | ArrayBuffer): Promise<string> {
  const data = typeof content === "string"
    ? new TextEncoder().encode(content)
    : content instanceof Uint8Array
      ? content
      : new Uint8Array(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get or create a File Search store
 */
export async function getOrCreateStore(
  apiKey: string,
  displayName: string,
  options: FileSearchOperationOptions = {}
): Promise<string> {
  if (options.signal?.aborted) {
    throw new Error("Execution cancelled");
  }
  const ai = new GoogleGenAI({ apiKey });

  // Try to find existing
  try {
    const pager = await ai.fileSearchStores.list();
    for await (const store of pager) {
      if (options.signal?.aborted) {
        throw new Error("Execution cancelled");
      }
      if (store.displayName === displayName && store.name) {
        return store.name;
      }
    }
  } catch {
    // List failed, create new
  }

  const store = await ai.fileSearchStores.create({
    config: { displayName },
  });

  if (!store.name) {
    throw new Error("Failed to create store: no name returned");
  }

  return store.name;
}

/**
 * Upload a Drive file to File Search store
 */
export async function uploadDriveFile(
  apiKey: string,
  accessToken: string,
  fileId: string,
  fileName: string,
  storeName: string,
  options: FileSearchOperationOptions = {}
): Promise<string | null> {
  if (options.signal?.aborted) {
    throw new Error("Execution cancelled");
  }
  const ai = new GoogleGenAI({ apiKey });
  const content = await readFileBytes(accessToken, fileId, options);
  const mimeType = getMimeTypeForFile(fileName);
  const blob = new Blob([content.buffer as ArrayBuffer], { type: mimeType });

  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: storeName,
    config: {
      displayName: fileName,
    },
  });

  return operation?.name ?? null;
}

/**
 * Smart sync: sync Drive files to File Search store with checksum-based diff detection
 */
export async function smartSync(
  apiKey: string,
  accessToken: string,
  ragSetting: RagSetting,
  rootFolderId: string,
  onProgress?: (current: number, total: number, fileName: string, action: "upload" | "skip" | "delete") => void
): Promise<SyncResult> {
  if (!ragSetting.storeName) {
    throw new Error("No store name configured");
  }

  const ai = new GoogleGenAI({ apiKey });
  const result: SyncResult = {
    uploaded: [],
    skipped: [],
    deleted: [],
    errors: [],
    newFiles: { ...ragSetting.files },
    lastFullSync: Date.now(),
  };

  // Get all user files from rootFolder (flat storage)
  const targetFolders = Array.isArray(ragSetting.targetFolders) ? ragSetting.targetFolders : [];
  const excludePatterns = Array.isArray(ragSetting.excludePatterns) ? ragSetting.excludePatterns : [];

  let allFiles: Array<{ id: string; name: string }>;
  try {
    const { files } = await getFileListFromMeta(accessToken, rootFolderId);
    allFiles = files.map((f) => ({ id: f.id, name: f.name }));
  } catch (error) {
    result.errors.push({
      path: rootFolderId,
      error: `Failed to list files: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
    return result;
  }

  // Filter by target folders (virtual path prefixes) if specified
  const allDriveFiles: Array<{ id: string; name: string }> = [];
  for (const f of allFiles) {
    // Target folder filter: each entry is a virtual path prefix (e.g. "notes", "projects/src")
    if (targetFolders.length > 0) {
      const matched = targetFolders.some((prefix) => {
        if (!prefix) return false;
        return f.name === prefix || f.name.startsWith(prefix + "/");
      });
      if (!matched) continue;
    }

    // Apply exclude patterns
    let excluded = false;
    for (const pattern of excludePatterns) {
      if (!pattern) continue;
      try {
        if (new RegExp(pattern).test(f.name)) {
          excluded = true;
          break;
        }
      } catch {
        // Invalid regex
      }
    }
    if (!excluded && isRagEligible(f.name)) {
      allDriveFiles.push(f);
    }
  }

  const currentFilePaths = new Set(allDriveFiles.map((f) => f.name));

  // Delete orphaned entries from sync state and from Gemini store
  const orphanEntries = Object.entries(result.newFiles).filter(([path]) => !currentFilePaths.has(path));
  const totalOperations = allDriveFiles.length + orphanEntries.length;
  let currentOperation = 0;

  for (const [path, info] of orphanEntries) {
    currentOperation++;
    onProgress?.(currentOperation, totalOperations, path, "delete");
    if (info.fileId) {
      try {
        await ai.fileSearchStores.documents.delete({
          name: info.fileId,
          config: { force: true },
        });
      } catch {
        // best-effort
      }
    }
    delete result.newFiles[path];
    result.deleted.push(path);
  }

  // Process files
  const CONCURRENCY_LIMIT = 5;
  const queue = [...allDriveFiles];

  const processFile = async (file: { id: string; name: string }) => {
    currentOperation++;
    try {
      const content = await readFileBytes(accessToken, file.id);
      const checksum = await calculateChecksum(content);
      const existing = ragSetting.files[file.name];

      if (existing && existing.checksum === checksum) {
        onProgress?.(currentOperation, totalOperations, file.name, "skip");
        result.skipped.push(file.name);
        return;
      }

      onProgress?.(currentOperation, totalOperations, file.name, "upload");

      const registered = await registerSingleFile(
        apiKey,
        ragSetting.storeName!,
        file.name,
        content,
        existing?.fileId ?? null
      );

      result.uploaded.push(file.name);
      result.newFiles[file.name] = {
        checksum: registered.checksum,
        uploadedAt: Date.now(),
        fileId: registered.fileId,
        status: "registered",
      };
    } catch (error) {
      result.errors.push({
        path: file.name,
        error: error instanceof Error ? error.message : "Upload failed",
      });
      // Keep the file as pending so it can be retried
      result.newFiles[file.name] = {
        checksum: "",
        uploadedAt: Date.now(),
        fileId: null,
        status: "pending",
      };
    }
  };

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY_LIMIT);
    await Promise.all(batch.map(processFile));
  }

  return result;
}

/**
 * Delete a File Search store
 */
export async function deleteStore(apiKey: string, storeName: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey });
  await ai.fileSearchStores.delete({ name: storeName, config: { force: true } });
}

/**
 * Register a single file's content into a File Search store.
 * If an existing document is tracked, it is deleted first.
 * Throws on failure (caller should catch).
 */
export async function registerSingleFile(
  apiKey: string,
  storeName: string,
  fileName: string,
  content: string | Uint8Array | ArrayBuffer,
  existingFileId: string | null
): Promise<{ checksum: string; fileId: string | null }> {
  const ai = new GoogleGenAI({ apiKey });

  // Delete previous document if re-uploading
  if (existingFileId) {
    try {
      await ai.fileSearchStores.documents.delete({
        name: existingFileId,
        config: { force: true },
      });
    } catch {
      // Ignore deletion failures
    }
  }

  const checksum = await calculateChecksum(content);
  const mimeType = getMimeTypeForFile(fileName);
  const blobData = content instanceof Uint8Array ? content.buffer as ArrayBuffer : content;
  const blob = new Blob([blobData], { type: mimeType });

  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: storeName,
    config: { displayName: fileName },
  });

  return { checksum, fileId: operation?.name ?? null };
}

/**
 * Delete a single file's document from a RAG store.
 * Returns true if deletion succeeded, false on failure.
 * Never throws.
 */
export async function deleteSingleFileFromRag(
  apiKey: string,
  documentId: string
): Promise<boolean> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    await ai.fileSearchStores.documents.delete({
      name: documentId,
      config: { force: true },
    });
    return true;
  } catch {
    return false;
  }
}
