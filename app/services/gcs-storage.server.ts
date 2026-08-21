/**
 * GCS storage wrapper. Replaces `google-drive.server.ts`.
 *
 * Every call requires a `ProjectAccessContext` (from `requireProjectAccess`),
 * which carries the GCS bucket name and per-project prefix. All orgs share
 * a single GCP project; ADC is used for authentication.
 */

import {
  Storage,
  type File,
  type GetFilesOptions,
  type SaveOptions,
} from "@google-cloud/storage";
import type { ProjectAccessContext, TenantInfo } from "~/types/enterprise";
import {
  objectPathOf,
  stripCommonPrefix,
  toStoredObject,
  type RawGcsMetadata,
  type StoredObject,
} from "./gcs-storage-utils";
import { isSyncExcludedPath } from "./sync-client-utils";

export { objectPathOf, type StoredObject };

export interface ListOptions {
  /** Path under the project prefix, e.g. "gemihub/notes". Empty = project root. */
  relativePrefix?: string;
  delimiter?: "/";
  pageToken?: string;
  pageSize?: number;
}

export interface WriteOptions {
  /**
   * If set, GCS will reject the write if the current object generation
   * differs. Use `0` to require that the object does not yet exist.
   */
  ifGenerationMatch?: string | 0;
  customMetadata?: Record<string, string>;
  createdBy?: string;
  updatedBy?: string;
}

export interface SyncObjectMeta {
  relativePath: string;
  md5Hash: string;
  generation: string;
  updatedAt: number;
}

export class GcsPreconditionFailedError extends Error {
  constructor(
    public readonly objectPath: string,
    public readonly expectedGeneration: string | 0,
  ) {
    super(`GCS precondition failed for ${objectPath} (expected generation=${expectedGeneration})`);
    this.name = "GcsPreconditionFailedError";
  }
}

export class GcsObjectNotFoundError extends Error {
  constructor(public readonly objectPath: string) {
    super(`GCS object not found: ${objectPath}`);
    this.name = "GcsObjectNotFoundError";
  }
}

const _storageCache = new Map<string, Storage>();

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? "";

async function getStorageForTenant(tenant: TenantInfo): Promise<Storage> {
  const key = tenant.gcsBucket;
  const cached = _storageCache.get(key);
  if (cached) return cached;
  // Implicit ADC through Storage's bundled google-auth-library works here.
  const storage = new Storage({
    ...(GCP_PROJECT_ID ? { projectId: GCP_PROJECT_ID } : {}),
  });
  _storageCache.set(key, storage);
  return storage;
}

export function _resetStorageCacheForTests(): void {
  _storageCache.clear();
}

function fileFor(storage: Storage, ctx: ProjectAccessContext, relativePath: string): File {
  return storage.bucket(ctx.tenant.gcsBucket).file(objectPathOf(ctx, relativePath));
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: number }).code;
  return code === 404;
}

function isPreconditionFailed(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: number }).code;
  return code === 412;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function readObject(
  ctx: ProjectAccessContext,
  relativePath: string,
): Promise<{ object: StoredObject; bytes: Uint8Array }> {
  const storage = await getStorageForTenant(ctx.tenant);
  const file = fileFor(storage, ctx, relativePath);
  try {
    const [bytes] = await file.download();
    const [meta] = await file.getMetadata();
    return { object: toStoredObject(meta as RawGcsMetadata, ctx.gcsPrefix), bytes };
  } catch (err) {
    if (isNotFound(err)) throw new GcsObjectNotFoundError(objectPathOf(ctx, relativePath));
    throw err;
  }
}

export async function readObjectMetadata(
  ctx: ProjectAccessContext,
  relativePath: string,
): Promise<StoredObject | null> {
  const storage = await getStorageForTenant(ctx.tenant);
  const file = fileFor(storage, ctx, relativePath);
  try {
    const [meta] = await file.getMetadata();
    return toStoredObject(meta as RawGcsMetadata, ctx.gcsPrefix);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function writeObject(
  ctx: ProjectAccessContext,
  relativePath: string,
  body: Uint8Array | string,
  contentType: string,
  options?: WriteOptions,
): Promise<StoredObject> {
  if (ctx.organizationReadOnly) {
    throw new Error("organization is read-only during the cancellation retention period");
  }
  const storage = await getStorageForTenant(ctx.tenant);
  const file = fileFor(storage, ctx, relativePath);
  const customMetadata: Record<string, string> = { ...(options?.customMetadata ?? {}) };
  if (options?.createdBy) customMetadata.createdBy = options.createdBy;
  if (options?.updatedBy) customMetadata.updatedBy = options.updatedBy;

  const saveOptions: SaveOptions = {
    contentType,
    resumable: false,
    metadata: { contentType, metadata: customMetadata },
  };
  if (options?.ifGenerationMatch !== undefined) {
    saveOptions.preconditionOpts = {
      ifGenerationMatch:
        options.ifGenerationMatch === 0 ? 0 : Number(options.ifGenerationMatch),
    };
  }
  const buffer = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  // Organization storage quota (100 GB included + purchased 500 GB units).
  {
    const { assertStorageQuota } = await import("./storage-quota.server");
    await assertStorageQuota(ctx, buffer.length);
  }
  try {
    await file.save(buffer, saveOptions);
  } catch (err) {
    if (isPreconditionFailed(err)) {
      throw new GcsPreconditionFailedError(
        objectPathOf(ctx, relativePath),
        options?.ifGenerationMatch ?? "?",
      );
    }
    throw err;
  }
  const [meta] = await file.getMetadata();
  return toStoredObject(meta as RawGcsMetadata, ctx.gcsPrefix);
}

export async function deleteObject(
  ctx: ProjectAccessContext,
  relativePath: string,
  options?: { ifGenerationMatch?: string },
): Promise<void> {
  if (ctx.organizationReadOnly) {
    throw new Error("organization is read-only during the cancellation retention period");
  }
  const storage = await getStorageForTenant(ctx.tenant);
  const file = fileFor(storage, ctx, relativePath);
  try {
    await file.delete({
      ignoreNotFound: false,
      ...(options?.ifGenerationMatch
        ? { preconditionOpts: { ifGenerationMatch: Number(options.ifGenerationMatch) } }
        : {}),
    });
  } catch (err) {
    if (isNotFound(err)) throw new GcsObjectNotFoundError(objectPathOf(ctx, relativePath));
    if (isPreconditionFailed(err)) {
      throw new GcsPreconditionFailedError(
        objectPathOf(ctx, relativePath),
        options?.ifGenerationMatch ?? "?",
      );
    }
    throw err;
  }
}

export interface ListResult {
  objects: StoredObject[];
  commonPrefixes: string[];
  nextPageToken?: string;
}

export async function listObjects(
  ctx: ProjectAccessContext,
  options: ListOptions,
): Promise<ListResult> {
  const storage = await getStorageForTenant(ctx.tenant);
  const prefix = options.relativePrefix
    ? `${ctx.gcsPrefix}/${options.relativePrefix.replace(/^\/+/, "")}`
    : `${ctx.gcsPrefix}/`;

  const query: GetFilesOptions = {
    prefix,
    autoPaginate: false,
    delimiter: options.delimiter,
    pageToken: options.pageToken,
    maxResults: options.pageSize,
  };
  // bucket.getFiles with autoPaginate: false returns [files, nextQuery, apiResponse]
  const [files, nextQuery, apiResponse] = (await storage
    .bucket(ctx.tenant.gcsBucket)
    .getFiles(query)) as unknown as [File[], GetFilesOptions | null, { prefixes?: string[] }];

  const objects: StoredObject[] = files.map((f) =>
    toStoredObject(f.metadata as RawGcsMetadata, ctx.gcsPrefix),
  );
  const commonPrefixes = (apiResponse?.prefixes ?? []).map((p) =>
    stripCommonPrefix(p, ctx.gcsPrefix),
  );
  return {
    objects,
    commonPrefixes,
    nextPageToken: nextQuery?.pageToken,
  };
}

/**
 * Rename an object — GCS doesn't support in-place rename, so we use the
 * native copy + delete sequence (server-side copy is a single API call,
 * no bytes transit our server). Returns the new object's metadata.
 *
 * Throws GcsObjectNotFoundError if the source is missing.
 *
 * Note: the `preconditionOpts.ifGenerationMatch` on `File.copy()` applies
 * to the *destination* (refusing to clobber an existing dst with that
 * generation). Source-generation matching for safe-rename-during-edit
 * isn't surfaced by the SDK; rename is a tree-level operation where this
 * race is acceptable. If you need it, do a metadata read first.
 */
export async function renameObject(
  ctx: ProjectAccessContext,
  fromRelativePath: string,
  toRelativePath: string,
): Promise<StoredObject> {
  if (fromRelativePath === toRelativePath) {
    const existing = await readObjectMetadata(ctx, fromRelativePath);
    if (!existing) throw new GcsObjectNotFoundError(objectPathOf(ctx, fromRelativePath));
    return existing;
  }
  const storage = await getStorageForTenant(ctx.tenant);
  const bucket = storage.bucket(ctx.tenant.gcsBucket);
  const src = bucket.file(objectPathOf(ctx, fromRelativePath));
  const dst = bucket.file(objectPathOf(ctx, toRelativePath));
  try {
    await src.copy(dst);
  } catch (err) {
    if (isNotFound(err)) throw new GcsObjectNotFoundError(objectPathOf(ctx, fromRelativePath));
    throw err;
  }
  // Source delete is best-effort — if it fails, the rename has succeeded
  // semantically and the orphan can be GC'd later.
  await src.delete().catch(() => {});
  const [meta] = await dst.getMetadata();
  return toStoredObject(meta as RawGcsMetadata, ctx.gcsPrefix);
}

/**
 * Move objects between two authorized app projects. Copies are completed
 * before any source object is deleted, so a partial copy failure never loses
 * the original data.
 */
export async function moveObjectsBetweenProjects(
  sourceCtx: ProjectAccessContext,
  targetCtx: ProjectAccessContext,
  moves: Array<{ from: string; to: string }>,
  options: { keepSource?: boolean } = {},
): Promise<StoredObject[]> {
  if (targetCtx.organizationReadOnly || (!options.keepSource && sourceCtx.organizationReadOnly)) {
    throw new Error("organization is read-only during the cancellation retention period");
  }
  const sourceStorage = await getStorageForTenant(sourceCtx.tenant);
  const targetStorage = sourceCtx.tenant.gcsBucket === targetCtx.tenant.gcsBucket
    ? sourceStorage
    : await getStorageForTenant(targetCtx.tenant);
  const sourceBucket = sourceStorage.bucket(sourceCtx.tenant.gcsBucket);
  const targetBucket = targetStorage.bucket(targetCtx.tenant.gcsBucket);
  const copied: Array<{ source: File; target: File; object: StoredObject }> = [];

  try {
    for (const move of moves) {
      const source = sourceBucket.file(objectPathOf(sourceCtx, move.from));
      const target = targetBucket.file(objectPathOf(targetCtx, move.to));
      await source.copy(target);
      const [metadata] = await target.getMetadata();
      copied.push({
        source,
        target,
        object: toStoredObject(metadata as RawGcsMetadata, targetCtx.gcsPrefix),
      });
    }
  } catch (err) {
    // Remove only copies created by this failed operation; originals remain.
    await Promise.all(copied.map(({ target }) => target.delete().catch(() => {})));
    if (isNotFound(err)) {
      throw new GcsObjectNotFoundError("cross-project source object");
    }
    throw err;
  }

  // keepSource = a copy: every destination exists, leave the originals alone.
  if (!options.keepSource) {
    await Promise.all(copied.map(({ source }) => source.delete()));
  }
  return copied.map(({ object }) => object);
}

/** Used by sync diff: only the metadata required to compare hashes. Walks all pages. */
export async function listObjectsForSync(
  ctx: ProjectAccessContext,
  relativePrefix?: string,
): Promise<SyncObjectMeta[]> {
  const out: SyncObjectMeta[] = [];
  let pageToken: string | undefined;
  do {
    const result = await listObjects(ctx, {
      relativePrefix,
      pageToken,
      pageSize: 1000,
    });
    for (const obj of result.objects) {
      if (isSyncExcludedPath(obj.relativePath)) continue;
      out.push({
        relativePath: obj.relativePath,
        md5Hash: obj.md5Hash,
        generation: obj.generation,
        updatedAt: obj.updatedAt,
      });
    }
    pageToken = result.nextPageToken;
  } while (pageToken);
  return out;
}
