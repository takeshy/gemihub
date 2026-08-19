/**
 * Drive implementation of the unified storage interface, wrapping
 * google-drive.server.ts behind path identity via the sync-meta path index
 * (see drive-path-index.server.ts — the Drive layout is flat, so a file's
 * NAME is its relative path).
 *
 * `revision` is the file's md5Checksum (content-hash surrogate): the same
 * primitive the existing Drive sync uses for conflict detection. A write
 * with `ifRevisionMatch` re-reads the head metadata first, so the check is
 * best-effort optimistic concurrency, not a transactional guarantee.
 *
 * Mutations keep `_sync-meta.json` fresh (upsert/remove) so the push/pull
 * flow and this provider agree on the file set.
 */

import { lookup as mimeLookup } from "mime-types";
import {
  createFileBinary,
  deleteFile,
  getFileMetadata,
  readFileBytes,
  renameFile,
  updateFileBinary,
  type DriveFile,
} from "../google-drive.server";
import {
  removeFileFromMeta,
  upsertFileInMeta,
} from "../sync-meta.server";
import { loadDrivePathIndex } from "./drive-path-index.server";
import {
  cleanRelativePath,
  StorageConflictError,
  StorageNotFoundError,
  type ListOptions,
  type ListResult,
  type ObjectMeta,
  type SyncObjectMeta,
  type WriteOptions,
} from "./types";

export interface DriveMount {
  accessToken: string;
  rootFolderId: string;
}

function driveFileToMeta(file: DriveFile): ObjectMeta {
  return {
    relativePath: file.name,
    contentType: file.mimeType || "application/octet-stream",
    size: file.size ? Number(file.size) : 0,
    md5Hash: file.md5Checksum ?? "",
    revision: file.md5Checksum ?? "",
    updatedAt: file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0,
  };
}

function contentTypeFor(path: string, explicit?: string): string {
  if (explicit) return explicit;
  return mimeLookup(path) || "application/octet-stream";
}

async function findByPath(ctx: DriveMount, relativePath: string): Promise<DriveFile | null> {
  const index = await loadDrivePathIndex(ctx.accessToken, ctx.rootFolderId);
  return index.byPath.get(relativePath) ?? null;
}

export async function driveRead(
  ctx: DriveMount,
  relativePath: string,
): Promise<{ meta: ObjectMeta; bytes: Uint8Array }> {
  const entry = await findByPath(ctx, relativePath);
  if (!entry) throw new StorageNotFoundError(relativePath);
  const bytes = await readFileBytes(ctx.accessToken, entry.id);
  return { meta: driveFileToMeta(entry), bytes };
}

export async function driveReadMetadata(
  ctx: DriveMount,
  relativePath: string,
): Promise<ObjectMeta | null> {
  const entry = await findByPath(ctx, relativePath);
  return entry ? driveFileToMeta(entry) : null;
}

export async function driveWrite(
  ctx: DriveMount,
  relativePath: string,
  bytes: Uint8Array,
  options: WriteOptions = {},
): Promise<ObjectMeta> {
  const path = cleanRelativePath(relativePath);
  const contentType = contentTypeFor(path, options.contentType);
  const existing = await findByPath(ctx, path);
  const expected = options.ifRevisionMatch;

  if (existing) {
    if (expected === 0 || expected === "0") {
      throw new StorageConflictError(path, expected);
    }
    if (expected !== undefined) {
      // Re-read the head so the check isn't against a stale index entry.
      const head = await getFileMetadata(ctx.accessToken, existing.id);
      if ((head.md5Checksum ?? "") !== expected) {
        throw new StorageConflictError(path, expected);
      }
    }
    const updated = await updateFileBinary(
      ctx.accessToken,
      existing.id,
      Buffer.from(bytes),
      contentType,
    );
    await upsertFileInMeta(ctx.accessToken, ctx.rootFolderId, { ...updated, name: path });
    return driveFileToMeta({ ...updated, name: path });
  }

  if (expected !== undefined && expected !== 0 && expected !== "0") {
    // Caller expected an existing revision but the object is gone.
    throw new StorageConflictError(path, expected);
  }
  const created = await createFileBinary(
    ctx.accessToken,
    path,
    Buffer.from(bytes),
    ctx.rootFolderId,
    contentType,
  );
  await upsertFileInMeta(ctx.accessToken, ctx.rootFolderId, { ...created, name: path });
  return driveFileToMeta({ ...created, name: path });
}

export async function driveDelete(
  ctx: DriveMount,
  relativePath: string,
  options: { ifRevisionMatch?: string } = {},
): Promise<void> {
  const entry = await findByPath(ctx, relativePath);
  if (!entry) throw new StorageNotFoundError(relativePath);
  if (options.ifRevisionMatch !== undefined && (entry.md5Checksum ?? "") !== options.ifRevisionMatch) {
    throw new StorageConflictError(relativePath, options.ifRevisionMatch);
  }
  // Hard delete + meta removal. Trash semantics (rename into "trash/") are a
  // client-side flow in this repo; callers wanting soft delete should rename.
  await deleteFile(ctx.accessToken, entry.id);
  await removeFileFromMeta(ctx.accessToken, ctx.rootFolderId, entry.id);
}

export async function driveRename(
  ctx: DriveMount,
  from: string,
  to: string,
): Promise<ObjectMeta> {
  const toPath = cleanRelativePath(to);
  if (from === toPath) {
    const meta = await driveReadMetadata(ctx, from);
    if (!meta) throw new StorageNotFoundError(from);
    return meta;
  }
  const index = await loadDrivePathIndex(ctx.accessToken, ctx.rootFolderId);
  const entry = index.byPath.get(from);
  if (!entry) throw new StorageNotFoundError(from);
  if (index.byPath.has(toPath)) {
    throw new StorageConflictError(toPath, 0);
  }
  // Flat layout: renaming the file's NAME is the whole move.
  const renamed = await renameFile(ctx.accessToken, entry.id, toPath);
  await upsertFileInMeta(ctx.accessToken, ctx.rootFolderId, { ...renamed, name: toPath });
  return driveFileToMeta({ ...renamed, name: toPath });
}

export async function driveList(
  ctx: DriveMount,
  options: ListOptions,
): Promise<ListResult> {
  const index = await loadDrivePathIndex(ctx.accessToken, ctx.rootFolderId);
  const prefix = options.relativePrefix
    ? `${options.relativePrefix.replace(/^\/+/, "").replace(/\/+$/, "")}/`
    : "";
  const objects: ObjectMeta[] = [];
  const prefixes = new Set<string>();
  for (const [path, file] of index.byPath) {
    if (prefix && !path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (options.delimiter === "/") {
      const slash = rest.indexOf("/");
      if (slash !== -1) {
        prefixes.add(`${prefix}${rest.slice(0, slash + 1)}`);
        continue;
      }
    }
    objects.push(driveFileToMeta(file));
  }
  objects.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    objects,
    commonPrefixes: [...prefixes].sort(),
  };
}

export async function driveListForSync(
  ctx: DriveMount,
  relativePrefix?: string,
): Promise<SyncObjectMeta[]> {
  const index = await loadDrivePathIndex(ctx.accessToken, ctx.rootFolderId);
  const prefix = relativePrefix ? `${relativePrefix.replace(/^\/+/, "").replace(/\/+$/, "")}/` : "";
  const out: SyncObjectMeta[] = [];
  for (const [path, file] of index.byPath) {
    if (prefix && !path.startsWith(prefix)) continue;
    out.push({
      relativePath: path,
      md5Hash: file.md5Checksum ?? "",
      revision: file.md5Checksum ?? "",
      updatedAt: file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0,
    });
  }
  return out;
}
