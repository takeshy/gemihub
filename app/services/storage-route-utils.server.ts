/**
 * Shared response helpers for the api.storage.* routes.
 * Normalizes ProjectAccessError / MountResolutionError / StorageNotFoundError /
 * StorageConflictError into HTTP responses with stable shapes.
 */

import { ProjectAccessError } from "./project-acl.server";
import { StorageQuotaExceededError } from "./storage-quota.server";
import { MountResolutionError } from "./storage/resolve-mount.server";
import { StorageConflictError, StorageNotFoundError } from "./storage/types";

export function errorResponse(err: unknown): Response {
  if (
    err instanceof ProjectAccessError ||
    err instanceof MountResolutionError ||
    err instanceof StorageQuotaExceededError
  ) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof StorageNotFoundError) {
    return Response.json(
      { error: "not_found", path: err.relativePath },
      { status: 404 },
    );
  }
  if (err instanceof StorageConflictError) {
    return Response.json(
      {
        error: "precondition_failed",
        path: err.relativePath,
        expectedRevision: err.expectedRevision,
      },
      { status: 412 },
    );
  }
  console.error("[api.storage]", err);
  return Response.json({ error: "internal_error" }, { status: 500 });
}

export function requireQueryParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) {
    throw new BadRequestError(`missing query parameter: ${name}`);
  }
  return value;
}

export class BadRequestError extends Error {
  status = 400;
}

export function badRequestResponse(err: unknown): Response | null {
  if (err instanceof BadRequestError) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  return null;
}
