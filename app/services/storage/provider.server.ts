/**
 * Provider dispatch: unified storage operations over a MountContext.
 * Routes and services call these; the mount kind picks the backend.
 */

import {
  gcsDelete,
  gcsList,
  gcsListForSync,
  gcsRead,
  gcsReadMetadata,
  gcsRename,
  gcsWrite,
} from "./gcs-provider.server";
import {
  driveDelete,
  driveList,
  driveListForSync,
  driveRead,
  driveReadMetadata,
  driveRename,
  driveWrite,
} from "./drive-provider.server";
import type {
  ListOptions,
  ListResult,
  MountContext,
  ObjectMeta,
  SyncObjectMeta,
  WriteOptions,
} from "./types";

function unsupported(ctx: MountContext): never {
  throw new Error(`storage mount has no backend context: ${ctx.kind}`);
}

export async function readObject(
  ctx: MountContext,
  relativePath: string,
): Promise<{ meta: ObjectMeta; bytes: Uint8Array }> {
  if (ctx.kind === "gcs-project" && ctx.gcs) return gcsRead(ctx.gcs, relativePath);
  if (ctx.kind === "drive" && ctx.drive) return driveRead(ctx.drive, relativePath);
  unsupported(ctx);
}

export async function readObjectMetadata(
  ctx: MountContext,
  relativePath: string,
): Promise<ObjectMeta | null> {
  if (ctx.kind === "gcs-project" && ctx.gcs) return gcsReadMetadata(ctx.gcs, relativePath);
  if (ctx.kind === "drive" && ctx.drive) return driveReadMetadata(ctx.drive, relativePath);
  unsupported(ctx);
}

export async function writeObject(
  ctx: MountContext,
  relativePath: string,
  bytes: Uint8Array,
  options: WriteOptions = {},
): Promise<ObjectMeta> {
  if (ctx.kind === "gcs-project" && ctx.gcs) return gcsWrite(ctx.gcs, relativePath, bytes, options);
  if (ctx.kind === "drive" && ctx.drive) return driveWrite(ctx.drive, relativePath, bytes, options);
  unsupported(ctx);
}

export async function deleteObject(
  ctx: MountContext,
  relativePath: string,
  options: { ifRevisionMatch?: string } = {},
): Promise<void> {
  if (ctx.kind === "gcs-project" && ctx.gcs) return gcsDelete(ctx.gcs, relativePath, options);
  if (ctx.kind === "drive" && ctx.drive) return driveDelete(ctx.drive, relativePath, options);
  unsupported(ctx);
}

export async function listObjects(
  ctx: MountContext,
  options: ListOptions = {},
): Promise<ListResult> {
  if (ctx.kind === "gcs-project" && ctx.gcs) return gcsList(ctx.gcs, options);
  if (ctx.kind === "drive" && ctx.drive) return driveList(ctx.drive, options);
  unsupported(ctx);
}

export async function renameObject(
  ctx: MountContext,
  from: string,
  to: string,
): Promise<ObjectMeta> {
  if (ctx.kind === "gcs-project" && ctx.gcs) return gcsRename(ctx.gcs, from, to);
  if (ctx.kind === "drive" && ctx.drive) return driveRename(ctx.drive, from, to);
  unsupported(ctx);
}

export async function listObjectsForSync(
  ctx: MountContext,
  relativePrefix?: string,
): Promise<SyncObjectMeta[]> {
  if (ctx.kind === "gcs-project" && ctx.gcs) return gcsListForSync(ctx.gcs, relativePrefix);
  if (ctx.kind === "drive" && ctx.drive) return driveListForSync(ctx.drive, relativePrefix);
  unsupported(ctx);
}
