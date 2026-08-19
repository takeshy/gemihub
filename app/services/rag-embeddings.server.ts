/**
 * Vertex AI embedding generation for enterprise RAG.
 *
 * Uses organization OAuth when connected, with Application Default Credentials
 * as fallback, and the organization Vertex project. The embedding model
 * defaults to gemini-embedding-2 (2048 dims); override via env
 * RAG_EMBEDDING_MODEL.
 *
 * Gemini Embedding 2 uses the Vertex AI embedContent API and supports global,
 * us, and eu model locations.
 */

import { type Content } from "@google/genai";
import type { TenantInfo } from "~/types/enterprise";
import { createVertexClient } from "./vertex-ai.server";

const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL ?? "gemini-embedding-2";
const EMBEDDING_DIM = 2048;

type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export type RagEmbeddingInput =
  | string
  | {
      text?: string;
      inlineData: {
        mimeType: string;
        data: string;
      };
    };

function getEmbeddingLocation(tenant: TenantInfo): string {
  return EMBEDDING_MODEL === "gemini-embedding-2"
    ? process.env.RAG_EMBEDDING_LOCATION ?? tenant.vertexLocation ?? "global"
    : tenant.vertexLocation ?? tenant.region;
}

function firstEmbeddingValues(response: unknown): number[] | null {
  const body = response as {
    embeddings?: Array<{ values?: number[] }>;
    embedding?: { values?: number[] };
  };
  return body.embeddings?.[0]?.values ?? body.embedding?.values ?? null;
}

function isExpectedDimension(vec: number[] | null): vec is number[] {
  if (!vec) return false;
  if (vec.length !== EMBEDDING_DIM) {
    console.error(
      `[rag-embeddings] unexpected embedding dimension: got ${vec.length}, expected ${EMBEDDING_DIM}`,
    );
    return false;
  }
  return true;
}

function toEmbeddingContents(input: RagEmbeddingInput): string | Content[] {
  if (typeof input === "string") return input;

  const parts: NonNullable<Content["parts"]> = [];
  if (input.text) parts.push({ text: input.text });
  parts.push({
    inlineData: {
      mimeType: input.inlineData.mimeType,
      data: input.inlineData.data,
    },
  });

  return [{ role: "user", parts }];
}

/**
 * Generate embeddings for a batch of texts. Returns results in the same
 * order as the input. Individual failures are logged and return `null`.
 */
export async function generateEmbeddings(
  texts: RagEmbeddingInput[],
  tenant: TenantInfo,
  options: { taskType?: EmbeddingTaskType } = {},
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];

  const ai = await createVertexClient({ ...tenant, vertexLocation: getEmbeddingLocation(tenant) });
  const taskType = options.taskType ?? "RETRIEVAL_DOCUMENT";

  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i++) {
    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: toEmbeddingContents(texts[i]),
        config: {
          taskType,
          outputDimensionality: EMBEDDING_DIM,
        },
      });
      const vec = firstEmbeddingValues(response);
      if (isExpectedDimension(vec)) {
        results[i] = vec;
      }
    } catch (err) {
      console.error(
        "[rag-embeddings] item error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return results;
}

/**
 * Generate a single embedding. Convenience wrapper.
 */
export async function generateEmbedding(
  text: string,
  tenant: TenantInfo,
  options: { taskType?: EmbeddingTaskType } = {},
): Promise<number[] | null> {
  const results = await generateEmbeddings([text], tenant, options);
  return results[0] ?? null;
}

export { EMBEDDING_DIM };
