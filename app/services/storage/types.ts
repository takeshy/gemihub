/**
 * Unified storage abstraction (Phase 2).
 *
 * A session always has a Drive mount (the user's own Google Drive, the
 * default); an organization member additionally gets a GCS project mount
 * while a project is selected. Storage identity is the relative path in
 * both worlds — this repo's Drive layout is already flat (the Drive file
 * NAME is the relative path; folders are virtual), so no path→hierarchy
 * mapping is needed.
 *
 * Optimistic concurrency is abstracted to `revision: string`:
 *   - GCS: object `generation` (enforced via ifGenerationMatch)
 *   - Drive: `md5Checksum` of the current head content (content-hash
 *     surrogate — matches this repo's existing sync conflict primitive;
 *     upgrading to headRevisionId is a later hardening step)
 * Mismatches normalize to StorageConflictError (HTTP 412 equivalent);
 * missing objects to StorageNotFoundError (404).
 */

import type { ProjectAccessContext } from "~/types/enterprise";

export type MountKind = "gcs-project" | "drive";

export interface MountContext {
  kind: MountKind;
  /** Cache/sync namespace: `gcs:{orgId}/{projectId}` | `drive:{rootFolderId}` */
  mountKey: string;
  canWrite: boolean;
  /** Set when kind === "gcs-project". */
  gcs?: ProjectAccessContext;
  /** Set when kind === "drive". */
  drive?: { accessToken: string; rootFolderId: string };
}

export interface ObjectMeta {
  /** Path relative to the mount root, e.g. "notes/foo.md". */
  relativePath: string;
  contentType: string;
  size: number;
  /** Content hash. GCS: base64 MD5; Drive: hex md5Checksum. */
  md5Hash: string;
  /** Opaque optimistic-concurrency token. See module doc. */
  revision: string;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

export interface SyncObjectMeta {
  relativePath: string;
  md5Hash: string;
  revision: string;
  updatedAt: number;
}

export interface ListResult {
  objects: ObjectMeta[];
  /** Immediate subfolder prefixes (with trailing slash) when delimiter="/". */
  commonPrefixes: string[];
  nextPageToken?: string;
}

export interface ListOptions {
  relativePrefix?: string;
  delimiter?: "/";
  pageToken?: string;
  pageSize?: number;
}

export interface WriteOptions {
  /**
   * Reject the write if the current revision differs. Use "0" (or 0) to
   * require that the object does not exist yet.
   */
  ifRevisionMatch?: string | 0;
  contentType?: string;
  customMetadata?: Record<string, string>;
  createdBy?: string;
  updatedBy?: string;
}

export class StorageConflictError extends Error {
  readonly status = 412;
  constructor(
    public readonly relativePath: string,
    public readonly expectedRevision: string | 0,
  ) {
    super(`storage precondition failed for ${relativePath} (expected revision=${expectedRevision})`);
    this.name = "StorageConflictError";
  }
}

export class StorageNotFoundError extends Error {
  readonly status = 404;
  constructor(public readonly relativePath: string) {
    super(`storage object not found: ${relativePath}`);
    this.name = "StorageNotFoundError";
  }
}

/** Normalize a client-supplied relative path; throws on traversal attempts. */
export function cleanRelativePath(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid object path");
  const clean = value.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!clean || clean.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("invalid object path");
  }
  return clean;
}
