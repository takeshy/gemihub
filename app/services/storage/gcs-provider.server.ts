/**
 * GCS implementation of the unified storage interface — a thin adapter over
 * gcs-storage.server.ts. `revision` maps to the GCS object `generation`;
 * GcsPreconditionFailedError / GcsObjectNotFoundError normalize to the
 * provider-neutral Storage* errors.
 */

import {
  deleteObject,
  GcsObjectNotFoundError,
  GcsPreconditionFailedError,
  listObjects,
  listObjectsForSync,
  readObject,
  readObjectMetadata,
  renameObject,
  writeObject,
} from "../gcs-storage.server";
import type { StoredObject } from "../gcs-storage-utils";
import type { ProjectAccessContext } from "~/types/enterprise";
import {
  StorageConflictError,
  StorageNotFoundError,
  type ListOptions,
  type ListResult,
  type ObjectMeta,
  type SyncObjectMeta,
  type WriteOptions,
} from "./types";

export function gcsObjectToMeta(object: StoredObject): ObjectMeta {
  return {
    relativePath: object.relativePath,
    contentType: object.contentType,
    size: object.size,
    md5Hash: object.md5Hash,
    revision: object.generation,
    updatedAt: object.updatedAt,
    createdBy: object.createdBy,
    updatedBy: object.updatedBy,
  };
}

function normalizeError(err: unknown, relativePath: string): never {
  if (err instanceof GcsObjectNotFoundError) {
    throw new StorageNotFoundError(relativePath);
  }
  if (err instanceof GcsPreconditionFailedError) {
    throw new StorageConflictError(relativePath, err.expectedGeneration);
  }
  throw err;
}

export async function gcsRead(
  ctx: ProjectAccessContext,
  relativePath: string,
): Promise<{ meta: ObjectMeta; bytes: Uint8Array }> {
  try {
    const { object, bytes } = await readObject(ctx, relativePath);
    return { meta: gcsObjectToMeta(object), bytes };
  } catch (err) {
    normalizeError(err, relativePath);
  }
}

export async function gcsReadMetadata(
  ctx: ProjectAccessContext,
  relativePath: string,
): Promise<ObjectMeta | null> {
  const object = await readObjectMetadata(ctx, relativePath);
  return object ? gcsObjectToMeta(object) : null;
}

export async function gcsWrite(
  ctx: ProjectAccessContext,
  relativePath: string,
  bytes: Uint8Array,
  options: WriteOptions = {},
): Promise<ObjectMeta> {
  try {
    const object = await writeObject(
      ctx,
      relativePath,
      bytes,
      options.contentType ?? "application/octet-stream",
      {
        ifGenerationMatch: options.ifRevisionMatch,
        customMetadata: options.customMetadata,
        createdBy: options.createdBy,
        updatedBy: options.updatedBy,
      },
    );
    return gcsObjectToMeta(object);
  } catch (err) {
    normalizeError(err, relativePath);
  }
}

export async function gcsDelete(
  ctx: ProjectAccessContext,
  relativePath: string,
  options: { ifRevisionMatch?: string } = {},
): Promise<void> {
  try {
    await deleteObject(ctx, relativePath, {
      ifGenerationMatch: options.ifRevisionMatch,
    });
  } catch (err) {
    normalizeError(err, relativePath);
  }
}

export async function gcsList(
  ctx: ProjectAccessContext,
  options: ListOptions,
): Promise<ListResult> {
  const result = await listObjects(ctx, options);
  return {
    objects: result.objects.map(gcsObjectToMeta),
    commonPrefixes: result.commonPrefixes,
    nextPageToken: result.nextPageToken,
  };
}

export async function gcsRename(
  ctx: ProjectAccessContext,
  from: string,
  to: string,
): Promise<ObjectMeta> {
  try {
    return gcsObjectToMeta(await renameObject(ctx, from, to));
  } catch (err) {
    normalizeError(err, from);
  }
}

export async function gcsListForSync(
  ctx: ProjectAccessContext,
  relativePrefix?: string,
): Promise<SyncObjectMeta[]> {
  const rows = await listObjectsForSync(ctx, relativePrefix);
  return rows.map((row) => ({
    relativePath: row.relativePath,
    md5Hash: row.md5Hash,
    revision: row.generation,
    updatedAt: row.updatedAt,
  }));
}
