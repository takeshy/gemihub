// RAG / Gemini File Search manager - ported from obsidian-gemini-helper (Drive-based version)

import { GoogleGenAI, type CustomMetadata } from "@google/genai";
import { readFileBytes } from "./google-drive.server";
import { getFileListFromMeta } from "./sync-meta.server";
import type { RagSetting, RagFileInfo } from "~/types/settings";
import { isRagEligible } from "~/constants/rag";
export { RAG_ELIGIBLE_EXTENSIONS, isRagEligible } from "~/constants/rag";

export const FILE_SEARCH_EMBEDDING_MODEL = "models/gemini-embedding-2";
const FILE_SEARCH_STORES_PAGE_SIZE = 20;
const FILE_SEARCH_STORE_PREFIX = "fileSearchStores/";

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

export function normalizeFileSearchStoreName(storeName: string | null | undefined): string | null {
  const trimmed = storeName?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith(FILE_SEARCH_STORE_PREFIX) ? trimmed : `${FILE_SEARCH_STORE_PREFIX}${trimmed}`;
}

function getMimeTypeForFile(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
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

function getExtension(fileName: string): string {
  const baseName = fileName.split("/").pop() ?? fileName;
  const dot = baseName.lastIndexOf(".");
  return dot >= 0 ? baseName.slice(dot + 1).toLowerCase() : "";
}

function buildFileMetadata(fileName: string, mimeType: string): CustomMetadata[] {
  const baseName = fileName.split("/").pop() || fileName;
  const metadata: CustomMetadata[] = [
    { key: "file_path", stringValue: fileName },
    { key: "file_name", stringValue: baseName },
    { key: "mime_type", stringValue: mimeType },
  ];
  const extension = getExtension(fileName);
  if (extension) {
    metadata.push({ key: "extension", stringValue: extension });
  }
  return metadata;
}

interface RawFileSearchStore {
  name?: string;
  displayName?: string;
  display_name?: string;
  embeddingModel?: string;
  embedding_model?: string;
}

function rawStoreDisplayName(store: RawFileSearchStore): string | undefined {
  return store.displayName ?? store.display_name;
}

function rawStoreEmbeddingModel(store: RawFileSearchStore): string | undefined {
  return store.embeddingModel ?? store.embedding_model;
}

async function fileSearchRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const joiner = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${path}${joiner}key=${encodeURIComponent(apiKey)}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini File Search API error ${res.status}: ${text || res.statusText}`);
  }
  return await res.json() as T;
}

async function listRawFileSearchStores(apiKey: string): Promise<RawFileSearchStore[]> {
  const stores: RawFileSearchStore[] = [];
  let pageToken = "";
  do {
    const response = await fileSearchRequest<{ fileSearchStores?: RawFileSearchStore[]; nextPageToken?: string }>(
      apiKey,
      `fileSearchStores?pageSize=${FILE_SEARCH_STORES_PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
    );
    stores.push(...(response.fileSearchStores ?? []));
    pageToken = response.nextPageToken ?? "";
  } while (pageToken);
  return stores;
}

async function createMultimodalStore(apiKey: string, displayName: string): Promise<string> {
  const store = await fileSearchRequest<RawFileSearchStore>(apiKey, "fileSearchStores", {
    method: "POST",
    body: JSON.stringify({
      display_name: displayName,
      embedding_model: FILE_SEARCH_EMBEDDING_MODEL,
    }),
  });
  if (!store.name) {
    throw new Error("Failed to create store: no name returned");
  }
  const normalized = normalizeFileSearchStoreName(store.name);
  if (!normalized) {
    throw new Error("Failed to create store: invalid name returned");
  }
  return normalized;
}

async function waitForUploadOperation(
  ai: GoogleGenAI,
  operation: unknown,
  options: FileSearchOperationOptions = {}
): Promise<string | null> {
  let current = operation as {
    done?: boolean;
    name?: string;
    error?: unknown;
    response?: { documentName?: string; document_name?: string };
  } | null | undefined;

  while (current && !current.done) {
    if (options.signal?.aborted) {
      throw new Error("Execution cancelled");
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    current = await (ai.operations.get as (params: { operation: unknown }) => Promise<unknown>)({ operation: current }) as typeof current;
  }

  if (current?.error) {
    throw new Error(`File indexing failed: ${JSON.stringify(current.error)}`);
  }

  return current?.response?.documentName ?? current?.response?.document_name ?? current?.name ?? null;
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
  const stores = await listRawFileSearchStores(apiKey);
  for (const store of stores) {
    if (options.signal?.aborted) {
      throw new Error("Execution cancelled");
    }
    if (
      rawStoreDisplayName(store) === displayName &&
      rawStoreEmbeddingModel(store) === FILE_SEARCH_EMBEDDING_MODEL &&
      store.name
    ) {
      const normalized = normalizeFileSearchStoreName(store.name);
      if (normalized) {
        return normalized;
      }
    }
  }

  if (options.signal?.aborted) {
    throw new Error("Execution cancelled");
  }
  return await createMultimodalStore(apiKey, displayName);
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
  const normalizedStoreName = normalizeFileSearchStoreName(storeName);
  if (!normalizedStoreName) {
    throw new Error("No File Search Store configured");
  }
  const ai = new GoogleGenAI({ apiKey });
  const content = await readFileBytes(accessToken, fileId, options);
  const mimeType = getMimeTypeForFile(fileName);
  const blobData = (content.buffer as ArrayBuffer).slice(content.byteOffset, content.byteOffset + content.byteLength);
  const blob = new Blob([blobData], { type: mimeType });

  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: normalizedStoreName,
    config: {
      displayName: fileName,
      mimeType,
      customMetadata: buildFileMetadata(fileName, mimeType),
    },
  });

  return await waitForUploadOperation(ai, operation, options);
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
  if (!ragSetting.storeName || ragSetting.embeddingModel !== FILE_SEARCH_EMBEDDING_MODEL) {
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

  // Pre-compile exclude pattern regexes
  const compiledExcludePatterns: RegExp[] = [];
  for (const pattern of excludePatterns) {
    if (!pattern) continue;
    try {
      compiledExcludePatterns.push(new RegExp(pattern));
    } catch {
      // Invalid regex pattern, skip
    }
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

    // Apply exclude patterns (pre-compiled)
    let excluded = false;
    for (const regex of compiledExcludePatterns) {
      if (regex.test(f.name)) {
        excluded = true;
        break;
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
  const normalized = normalizeFileSearchStoreName(storeName);
  if (!normalized) return;
  const ai = new GoogleGenAI({ apiKey });
  await ai.fileSearchStores.delete({ name: normalized, config: { force: true } });
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
  const normalizedStoreName = normalizeFileSearchStoreName(storeName);
  if (!normalizedStoreName) {
    throw new Error("No File Search Store configured");
  }

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
  const blobData = content instanceof Uint8Array
    ? (content.buffer as ArrayBuffer).slice(content.byteOffset, content.byteOffset + content.byteLength)
    : content;
  const blob = new Blob([blobData], { type: mimeType });

  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: normalizedStoreName,
    config: {
      displayName: fileName,
      mimeType,
      customMetadata: buildFileMetadata(fileName, mimeType),
    },
  });

  return { checksum, fileId: await waitForUploadOperation(ai, operation) };
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
