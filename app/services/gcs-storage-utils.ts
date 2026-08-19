/**
 * Pure helpers for gcs-storage.server.ts. Lives outside `.server.ts` so
 * tests can import without bundling @google-cloud/storage.
 */

import type { ProjectAccessContext } from "~/types/enterprise";

export interface StoredObject {
  /** Path WITHIN the bucket, e.g. "{projectId}/gemihub/notes/foo.md". */
  objectPath: string;
  /** Path WITHIN the project prefix, e.g. "gemihub/notes/foo.md". */
  relativePath: string;
  contentType: string;
  size: number;
  /** Base64 MD5 hash from GCS object metadata. */
  md5Hash: string;
  /** GCS object generation, used for optimistic concurrency. */
  generation: string;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

export interface RawGcsMetadata {
  name?: string;
  contentType?: string;
  size?: string | number;
  md5Hash?: string;
  generation?: string | number;
  updated?: string;
  metadata?: Record<string, string>;
}

/** Compose a bucket-relative object path under the project's prefix. */
export function objectPathOf(ctx: ProjectAccessContext, relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  return `${ctx.gcsPrefix}/${clean}`;
}

export function toStoredObject(meta: RawGcsMetadata, gcsPrefix: string): StoredObject {
  const objectPath = String(meta.name ?? "");
  const prefixWithSlash = `${gcsPrefix}/`;
  const relativePath = objectPath.startsWith(prefixWithSlash)
    ? objectPath.slice(prefixWithSlash.length)
    : objectPath;
  return {
    objectPath,
    relativePath,
    contentType: String(meta.contentType ?? "application/octet-stream"),
    size: typeof meta.size === "string" ? Number(meta.size) : (meta.size ?? 0),
    md5Hash: String(meta.md5Hash ?? ""),
    generation: String(meta.generation ?? "0"),
    updatedAt: meta.updated ? new Date(meta.updated).getTime() : 0,
    createdBy: meta.metadata?.createdBy,
    updatedBy: meta.metadata?.updatedBy,
  };
}

/** Strip the prefix (and trailing slash) from a common-prefix string returned by GCS. */
export function stripCommonPrefix(prefix: string, gcsPrefix: string): string {
  return prefix.startsWith(`${gcsPrefix}/`) ? prefix.slice(gcsPrefix.length + 1) : prefix;
}
