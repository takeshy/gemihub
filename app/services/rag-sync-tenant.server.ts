/**
 * RAG sync service — enterprise Firestore RAG.
 *
 * Reads GCS files for a project, chunks text content, generates embeddings
 * via Vertex AI, and stores them in the control-plane Firestore vector store.
 *
 * Concurrency: 5 files read in parallel.
 */

import { listObjects, readObject } from "./gcs-storage.server";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { ProjectAccessContext } from "~/types/enterprise";
import { generateEmbeddings, type RagEmbeddingInput } from "./rag-embeddings.server";
import {
  deleteChunksByDocPath,
  deleteChunksBySetting,
  upsertChunks,
  listSyncedDocPaths,
  type RagChunk,
} from "./rag-store.server";

const CONCURRENCY = 5;
const DEFAULT_CHUNK_CHARS = 1500;
const DEFAULT_CHUNK_OVERLAP = 150;
const PDF_CHUNK_MAX_PAGES = 6;

const ELIGIBLE_EXTENSIONS = new Set([
  // Text
  ".md", ".txt", ".csv", ".tsv", ".json", ".xml", ".html", ".yaml", ".yml",
  // Code
  ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".rb", ".go", ".rs",
  ".c", ".cpp", ".h", ".cs", ".php", ".dart", ".sql", ".sh",
]);
const MULTIMODAL_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".mp3": "audio/mp3",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
};
const MULTIMODAL_SIZE_LIMITS: Record<string, number> = {
  ".mp3": 20 * 1024 * 1024,
  ".wav": 100 * 1024 * 1024,
  ".mp4": 200 * 1024 * 1024,
  ".mpeg": 200 * 1024 * 1024,
};

type RagContentKind = "text" | "pdf" | "image" | "audio" | "video";

interface PreparedRagChunk {
  text: string;
  input: RagEmbeddingInput;
  metadata: {
    contentKind: RagContentKind;
    mimeType?: string;
    pageLabel?: string;
  };
}

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot).toLowerCase();
}

function isEligible(fileName: string): boolean {
  const ext = getExtension(fileName);
  if (!ext) return false;
  return ELIGIBLE_EXTENSIONS.has(ext) || ext in MULTIMODAL_MIME_TYPES;
}

function isSystemPath(path: string): boolean {
  return path === "gemihub" || path.startsWith("gemihub/");
}

function matchesExcludePatterns(path: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (!p) continue;
    try {
      if (new RegExp(p).test(path)) return true;
    } catch {
      // ignore invalid regex
    }
  }
  return false;
}

function matchesTargetFolders(path: string, folders: string[]): boolean {
  if (folders.length === 0) return true;
  for (const f of folders) {
    if (!f) continue;
    const prefix = f.endsWith("/") ? f : f + "/";
    if (path.startsWith(prefix) || path === f) return true;
  }
  return false;
}

function makeChunkId(params: {
  orgId: string;
  projectId: string;
  settingName: string;
  docPath: string;
  chunkIndex: number;
}): string {
  const raw = `${params.orgId}\0${params.projectId}\0${params.settingName}\0${params.docPath}\0${params.chunkIndex}`;
  return createHash("sha256").update(raw).digest("base64url");
}

function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_CHARS,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
): string[] {
  const maxChunkChars = Math.max(100, Math.min(5000, Math.trunc(chunkSize)));
  const overlap = Math.max(0, Math.min(maxChunkChars - 1, Math.trunc(chunkOverlap)));
  if (text.length <= maxChunkChars) return [text];

  const chunks: string[] = [];
  // Try paragraph splitting first
  const paragraphs = text.split(/\n\s*\n/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= maxChunkChars) {
      current = current ? current + "\n\n" + para : para;
    } else {
      if (current) chunks.push(current);
      // If a single paragraph is too long, split it brute-force
      if (para.length > maxChunkChars) {
        for (let i = 0; i < para.length; i += maxChunkChars - overlap) {
          chunks.push(para.slice(i, i + maxChunkChars));
        }
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function contentKindFromMimeType(mimeType: string): RagContentKind {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "text";
}

function displayKind(kind: RagContentKind): string {
  switch (kind) {
    case "pdf":
      return "Pdf";
    case "image":
      return "Image";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    default:
      return "Text";
  }
}

async function splitPdfIntoChunks(params: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}): Promise<PreparedRagChunk[]> {
  const pdfDoc = await PDFDocument.load(params.bytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  const chunks: PreparedRagChunk[] = [];

  for (let start = 0; start < totalPages; start += PDF_CHUNK_MAX_PAGES) {
    const end = Math.min(start + PDF_CHUNK_MAX_PAGES, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pages = await chunkDoc.copyPages(
      pdfDoc,
      Array.from({ length: end - start }, (_, i) => start + i),
    );
    for (const page of pages) {
      chunkDoc.addPage(page);
    }

    const chunkBytes = await chunkDoc.save();
    const pageLabel = `pages ${start + 1}-${end} of ${totalPages}`;
    chunks.push({
      text: `[Pdf: ${params.fileName} (${pageLabel})]`,
      input: {
        inlineData: {
          mimeType: params.mimeType,
          data: bytesToBase64(chunkBytes),
        },
      },
      metadata: {
        contentKind: "pdf",
        mimeType: params.mimeType,
        pageLabel,
      },
    });
  }

  return chunks;
}


async function prepareChunksForObject(params: {
  path: string;
  bytes: Uint8Array;
  contentType: string;
  chunkSize?: number;
  chunkOverlap?: number;
}): Promise<PreparedRagChunk[]> {
  const ext = getExtension(params.path);
  const fileName = params.path.split("/").pop() ?? params.path;
  const mimeType = MULTIMODAL_MIME_TYPES[ext];

  if (mimeType) {
    const sizeLimit = MULTIMODAL_SIZE_LIMITS[ext];
    if (sizeLimit && params.bytes.byteLength > sizeLimit) {
      throw new Error(
        `file too large for ${mimeType} embedding (${params.bytes.byteLength} bytes, limit ${sizeLimit} bytes)`,
      );
    }

    if (mimeType === "application/pdf") {
      return splitPdfIntoChunks({ bytes: params.bytes, fileName, mimeType });
    }

    const kind = contentKindFromMimeType(mimeType);
    const data = bytesToBase64(params.bytes);
    const label = `[${displayKind(kind)}: ${fileName}]`;
    return [
      {
        text: label,
        input: { inlineData: { mimeType, data } },
        metadata: { contentKind: kind, mimeType },
      },
    ];
  }

  const text = new TextDecoder("utf-8").decode(params.bytes);
  return chunkText(text, params.chunkSize, params.chunkOverlap).map((chunk) => ({
    text: chunk,
    input: chunk,
    metadata: {
      contentKind: "text",
      mimeType: params.contentType || "text/plain",
    },
  }));
}

export interface RagSyncProgress {
  current: number;
  total: number;
  fileName: string;
  action: "reading" | "chunking" | "embedding" | "storing" | "skipping" | "error";
  message?: string;
}

export interface RagSyncResult {
  uploaded: number; // chunks newly stored
  skipped: number;  // files unchanged
  deleted: number;  // chunks removed for deleted/changed files
  errors: number;
  errorDetails: string[];
}

/**
 * Smart sync: read GCS files, chunk, embed, store in Firestore.
 * Only processes files that have changed (MD5 mismatch) or are new.
 */
export async function smartSyncRag(
  ctx: ProjectAccessContext,
  options: {
    settingName: string;
    targetFolders: string[];
    excludePatterns: string[];
    chunkSize?: number;
    chunkOverlap?: number;
    forceRebuild?: boolean;
    onProgress?: (p: RagSyncProgress) => void;
  },
): Promise<RagSyncResult> {
  const result: RagSyncResult = {
    uploaded: 0,
    skipped: 0,
    deleted: 0,
    errors: 0,
    errorDetails: [],
  };

  if (options.forceRebuild) {
    result.deleted += await deleteChunksBySetting(ctx.orgId, ctx.projectId, options.settingName);
  }

  // 1. List all objects in the project prefix
  const objects: Array<{ path: string; md5: string; contentType: string }> = [];
  let pageToken: string | undefined;
  do {
    const page = await listObjects(ctx, { pageToken, pageSize: 1000 });
    for (const obj of page.objects) {
      if (obj.relativePath.endsWith("/")) continue; // skip dirs
      if (isSystemPath(obj.relativePath)) continue;
      if (!isEligible(obj.relativePath)) continue;
      if (!matchesTargetFolders(obj.relativePath, options.targetFolders)) continue;
      if (matchesExcludePatterns(obj.relativePath, options.excludePatterns)) continue;
      objects.push({
        path: obj.relativePath,
        md5: obj.md5Hash ?? "",
        contentType: obj.contentType,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  // 2. Get currently synced docPaths for this project
  const syncedPaths = new Set(await listSyncedDocPaths(ctx.orgId, ctx.projectId, options.settingName));

  // 3. Process files in parallel batches
  const processedPaths = new Set<string>();

  for (let i = 0; i < objects.length; i += CONCURRENCY) {
    const batch = objects.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (obj) => {
        processedPaths.add(obj.path);
        const fileIndex = i + batch.indexOf(obj) + 1;

        try {
          options.onProgress?.({
            current: fileIndex,
            total: objects.length,
            fileName: obj.path,
            action: "reading",
          });

          const { bytes } = await readObject(ctx, obj.path);

          options.onProgress?.({
            current: fileIndex,
            total: objects.length,
            fileName: obj.path,
            action: "chunking",
          });

          const chunks = await prepareChunksForObject({
            path: obj.path,
            bytes,
            contentType: obj.contentType,
            chunkSize: options.chunkSize,
            chunkOverlap: options.chunkOverlap,
          });
          if (chunks.length === 0) {
            result.skipped++;
            return;
          }

          options.onProgress?.({
            current: fileIndex,
            total: objects.length,
            fileName: obj.path,
            action: "embedding",
          });

          const embeddings = await generateEmbeddings(
            chunks.map((chunk) => chunk.input),
            ctx.tenant,
          );
          const validPairs: { chunk: PreparedRagChunk; embedding: number[] }[] = [];
          for (let ci = 0; ci < chunks.length; ci++) {
            if (embeddings[ci]) {
              validPairs.push({ chunk: chunks[ci], embedding: embeddings[ci]! });
            }
          }

          if (validPairs.length === 0) {
            result.errors++;
            result.errorDetails.push(`${obj.path}: all embeddings failed`);
            return;
          }

          options.onProgress?.({
            current: fileIndex,
            total: objects.length,
            fileName: obj.path,
            action: "storing",
          });

          // Delete old chunks for this doc first (in case file shrank or changed)
          await deleteChunksByDocPath(ctx.orgId, ctx.projectId, options.settingName, obj.path);

          const ragChunks: RagChunk[] = validPairs.map((pair, idx) => ({
            chunkId: makeChunkId({
              orgId: ctx.orgId,
              projectId: ctx.projectId,
              settingName: options.settingName,
              docPath: obj.path,
              chunkIndex: idx,
            }),
            orgId: ctx.orgId,
            projectId: ctx.projectId,
            settingName: options.settingName,
            docPath: obj.path,
            chunkIndex: idx,
            text: pair.chunk.text,
            embedding: pair.embedding,
            metadata: {
              fileName: obj.path.split("/").pop() ?? obj.path,
              contentType: obj.contentType,
              md5Checksum: obj.md5,
              contentKind: pair.chunk.metadata.contentKind,
              mimeType: pair.chunk.metadata.mimeType,
              pageLabel: pair.chunk.metadata.pageLabel,
            },
            updatedAt: Date.now(),
          }));

          await upsertChunks(ragChunks);
          result.uploaded += ragChunks.length;
        } catch (err) {
          result.errors++;
          const msg = err instanceof Error ? err.message : String(err);
          result.errorDetails.push(`${obj.path}: ${msg}`);
          options.onProgress?.({
            current: fileIndex,
            total: objects.length,
            fileName: obj.path,
            action: "error",
            message: msg,
          });
        }
      }),
    );
  }

  // 4. Delete chunks for files that no longer exist
  for (const oldPath of syncedPaths) {
    if (!processedPaths.has(oldPath)) {
      await deleteChunksByDocPath(ctx.orgId, ctx.projectId, options.settingName, oldPath);
      result.deleted++;
    }
  }

  return result;
}

/**
 * Sync a single file to the RAG store. Used by the workflow `rag-sync` node.
 */
export async function syncSingleFileToRag(
  ctx: ProjectAccessContext,
  relativePath: string,
  settingName = "gemihub",
): Promise<{ chunks: number; error?: string }> {
  try {
    if (isSystemPath(relativePath)) {
      return { chunks: 0, error: "system files are not eligible for RAG sync" };
    }

    if (!isEligible(relativePath)) {
      return { chunks: 0, error: "file type is not eligible for RAG sync" };
    }

    const { bytes, object } = await readObject(ctx, relativePath);
    const chunks = await prepareChunksForObject({
      path: relativePath,
      bytes,
      contentType: object.contentType,
    });
    if (chunks.length === 0) return { chunks: 0 };

    const embeddings = await generateEmbeddings(
      chunks.map((chunk) => chunk.input),
      ctx.tenant,
    );
    const validPairs: { chunk: PreparedRagChunk; embedding: number[] }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (embeddings[i]) {
        validPairs.push({ chunk: chunks[i], embedding: embeddings[i]! });
      }
    }

    if (validPairs.length === 0) {
      return { chunks: 0, error: "all embeddings failed" };
    }

    await deleteChunksByDocPath(ctx.orgId, ctx.projectId, settingName, relativePath);

    const fileName = relativePath.split("/").pop() ?? relativePath;
    const ragChunks: RagChunk[] = validPairs.map((pair, idx) => ({
      chunkId: makeChunkId({
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        settingName,
        docPath: relativePath,
        chunkIndex: idx,
      }),
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      settingName,
      docPath: relativePath,
      chunkIndex: idx,
      text: pair.chunk.text,
      embedding: pair.embedding,
      metadata: {
        fileName,
        contentType: object.contentType,
        contentKind: pair.chunk.metadata.contentKind,
        mimeType: pair.chunk.metadata.mimeType,
        pageLabel: pair.chunk.metadata.pageLabel,
      },
      updatedAt: Date.now(),
    }));

    await upsertChunks(ragChunks);
    return { chunks: ragChunks.length };
  } catch (err) {
    return { chunks: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build a RAG context string from similar chunks for injection into the
 * system prompt.
 */
export async function buildRagContext(params: {
  orgId: string;
  projectId: string;
  query: string;
  tenant: ProjectAccessContext["tenant"];
  settingName: string;
  topK?: number;
}): Promise<string | null> {
  const { generateEmbedding } = await import("./rag-embeddings.server");
  const { searchSimilarChunks } = await import("./rag-store.server");

  const embedding = await generateEmbedding(params.query, params.tenant, {
    taskType: "RETRIEVAL_QUERY",
  });
  if (!embedding) return null;

  const results = await searchSimilarChunks(
    params.orgId,
    params.projectId,
    params.settingName,
    embedding,
    params.topK ?? 5,
  );
  if (results.length === 0) return null;

  const lines: string[] = [];
  for (const r of results) {
    const fileName = r.chunk.metadata.fileName;
    lines.push(`--- From ${fileName} ---`);
    lines.push(r.chunk.text);
    lines.push("");
  }

  return lines.join("\n");
}
