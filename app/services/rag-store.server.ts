/**
 * Firestore vector store for enterprise RAG.
 *
 * Documents are stored in the control-plane Firestore under the
 * `ragChunks` collection. Each chunk carries orgId + projectId + settingName
 * for filtering and an `embedding` field (VectorValue, 2048 dims) for
 * similarity search.
 *
 * Required Firestore composite index:
 *   Collection: ragChunks
 *   Fields:
 *     - orgId       (Ascending)
 *     - projectId   (Ascending)
 *     - settingName (Ascending)
 *     - embedding   (Vector, 2048 dimensions, COSINE)
 *
 * Create via gcloud:
 *   gcloud firestore indexes composite create \
 *     --collection-group=ragChunks \
 *     --field-config field-path=orgId,order=ascending \
 *     --field-config field-path=projectId,order=ascending \
 *     --field-config field-path=settingName,order=ascending \
 *     --field-config field-path=embedding,vector-config='{\"dimension\":\"2048\",\"flat\":\"{}\"}'
 *
 * Or visit the error URL that Firestore returns on first query.
 */

import { FieldValue, type QueryDocumentSnapshot } from "@google-cloud/firestore";
import { getFirestore } from "./firestore.server";

const COLLECTION = "ragChunks";
const DISTANCE_RESULT_FIELD = "distance";

export interface RagChunk {
  chunkId: string;
  orgId: string;
  projectId: string;
  settingName: string;
  docPath: string; // GCS object path relative to the project root
  chunkIndex: number;
  text: string;
  embedding: number[];
  metadata: {
    fileName: string;
    contentType: string;
    md5Checksum?: string;
    contentKind?: "text" | "pdf" | "image" | "audio" | "video";
    mimeType?: string;
    pageLabel?: string;
  };
  updatedAt: number;
}

interface ChunkDoc {
  orgId: string;
  projectId: string;
  settingName: string;
  docPath: string;
  chunkIndex: number;
  text: string;
  embedding: ReturnType<typeof FieldValue.vector>;
  metadata: RagChunk["metadata"];
  updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
}

function col() {
  return getFirestore().collection(COLLECTION);
}

function toDoc(chunk: Omit<RagChunk, "chunkId">): ChunkDoc {
  return {
    orgId: chunk.orgId,
    projectId: chunk.projectId,
    settingName: chunk.settingName,
    docPath: chunk.docPath,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    embedding: FieldValue.vector(chunk.embedding),
    metadata: chunk.metadata,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Upsert a batch of chunks. Uses batched writes (max 500 per batch).
 */
export async function upsertChunks(chunks: RagChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  const db = getFirestore();
  const batchSize = 500;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = db.batch();
    for (const chunk of chunks.slice(i, i + batchSize)) {
      const ref = col().doc(chunk.chunkId);
      batch.set(ref, toDoc(chunk), { merge: true });
    }
    await batch.commit();
  }
}

/**
 * Delete chunks by their chunkIds.
 */
export async function deleteChunks(chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;
  const db = getFirestore();
  const batchSize = 500;

  for (let i = 0; i < chunkIds.length; i += batchSize) {
    const batch = db.batch();
    for (const id of chunkIds.slice(i, i + batchSize)) {
      batch.delete(col().doc(id));
    }
    await batch.commit();
  }
}

/**
 * Delete all chunks for a given docPath within an org.
 */
export async function deleteChunksByDocPath(
  orgId: string,
  projectId: string,
  settingName: string,
  docPath: string,
): Promise<void> {
  const snap = await col()
    .where("orgId", "==", orgId)
    .where("projectId", "==", projectId)
    .where("settingName", "==", settingName)
    .where("docPath", "==", docPath)
    .get();
  if (snap.empty) return;
  const batch = getFirestore().batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
}

export async function deleteChunksBySetting(
  orgId: string,
  projectId: string,
  settingName: string,
): Promise<number> {
  const snap = await col()
    .where("orgId", "==", orgId)
    .where("projectId", "==", projectId)
    .where("settingName", "==", settingName)
    .select()
    .get();
  if (snap.empty) return 0;

  const db = getFirestore();
  const batchSize = 500;
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + batchSize)) {
      batch.delete(doc.ref);
      deleted++;
    }
    await batch.commit();
  }
  return deleted;
}

/**
 * Search for chunks similar to the query embedding.
 * Returns top-K chunks ordered by cosine similarity.
 *
 * Requires the composite index (orgId + projectId + settingName + embedding). If missing, Firestore
 * throws with an index-creation URL.
 */
export async function searchSimilarChunks(
  orgId: string,
  projectId: string,
  settingName: string,
  queryEmbedding: number[],
  topK: number,
): Promise<Array<{ chunk: RagChunk; distance: number }>> {
  const q = col()
    .where("orgId", "==", orgId)
    .where("projectId", "==", projectId)
    .where("settingName", "==", settingName)
    .findNearest({
      vectorField: "embedding",
      queryVector: queryEmbedding,
      limit: topK,
      distanceMeasure: "COSINE",
      distanceResultField: DISTANCE_RESULT_FIELD,
    });

  const snap = await q.get();
  const results: Array<{ chunk: RagChunk; distance: number }> = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    const embedding: number[] =
      (d.embedding as { toArray?: () => number[] })?.toArray?.() ??
      (Array.isArray(d.embedding) ? d.embedding : []);
    const distanceValue =
      typeof d[DISTANCE_RESULT_FIELD] === "number"
        ? (d[DISTANCE_RESULT_FIELD] as number)
        : (d as { _distance?: number })._distance;

    results.push({
      chunk: {
        chunkId: doc.id,
        orgId: d.orgId,
        projectId: d.projectId,
        settingName: d.settingName,
        docPath: d.docPath,
        chunkIndex: d.chunkIndex,
        text: d.text,
        embedding,
        metadata: d.metadata,
        updatedAt:
          d.updatedAt?.toMillis?.() ??
          (typeof d.updatedAt === "number" ? d.updatedAt : Date.now()),
      },
      distance: distanceValue ?? Number.NaN,
    });
  }

  return results;
}

/**
 * List all docPaths that have chunks for a project.
 */
export async function listSyncedDocPaths(
  orgId: string,
  projectId: string,
  settingName: string,
): Promise<string[]> {
  const snap = await col()
    .where("orgId", "==", orgId)
    .where("projectId", "==", projectId)
    .where("settingName", "==", settingName)
    .select("docPath")
    .get();
  const paths = new Set<string>();
  for (const doc of snap.docs) {
    paths.add(doc.data().docPath as string);
  }
  return Array.from(paths);
}

export async function listIndexedFiles(
  orgId: string,
  projectId: string,
  settingName: string,
): Promise<Array<{ docPath: string; chunks: number; updatedAt: number }>> {
  const snap = await col()
    .where("orgId", "==", orgId)
    .where("projectId", "==", projectId)
    .where("settingName", "==", settingName)
    .select("docPath", "updatedAt")
    .get();

  const byPath = new Map<string, { docPath: string; chunks: number; updatedAt: number }>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const docPath = String(data.docPath ?? "");
    if (!docPath) continue;
    const updatedAt =
      data.updatedAt?.toMillis?.() ??
      (typeof data.updatedAt === "number" ? data.updatedAt : 0);
    const existing = byPath.get(docPath);
    if (existing) {
      existing.chunks++;
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
    } else {
      byPath.set(docPath, { docPath, chunks: 1, updatedAt });
    }
  }
  return Array.from(byPath.values()).sort((a, b) => a.docPath.localeCompare(b.docPath));
}

function fromSnapshotDoc(doc: QueryDocumentSnapshot): RagChunk {
  const d = doc.data();
  const embedding: number[] =
    (d.embedding as { toArray?: () => number[] })?.toArray?.() ??
    (Array.isArray(d.embedding) ? d.embedding : []);

  return {
    chunkId: doc.id,
    orgId: d.orgId,
    projectId: d.projectId,
    settingName: d.settingName,
    docPath: d.docPath,
    chunkIndex: d.chunkIndex,
    text: d.text,
    embedding,
    metadata: d.metadata,
    updatedAt:
      d.updatedAt?.toMillis?.() ??
      (typeof d.updatedAt === "number" ? d.updatedAt : Date.now()),
  };
}

/**
 * Load chunks around a hit from the same document.
 */
export async function getAdjacentChunks(
  orgId: string,
  projectId: string,
  settingName: string,
  docPath: string,
  chunkIndex: number,
  before: number,
  after: number,
): Promise<{ before: RagChunk[]; after: RagChunk[] }> {
  if (before <= 0 && after <= 0) return { before: [], after: [] };

  const snap = await col()
    .where("orgId", "==", orgId)
    .where("projectId", "==", projectId)
    .where("settingName", "==", settingName)
    .where("docPath", "==", docPath)
    .get();

  const chunks = snap.docs
    .map(fromSnapshotDoc)
    .filter((chunk) => chunk.chunkIndex !== chunkIndex)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    before: chunks
      .filter((chunk) => chunk.chunkIndex < chunkIndex)
      .slice(-Math.max(0, before)),
    after: chunks
      .filter((chunk) => chunk.chunkIndex > chunkIndex)
      .slice(0, Math.max(0, after)),
  };
}
