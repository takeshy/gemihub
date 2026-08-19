/**
 * POST /api/storage/move-between-mounts
 *
 * Body: {
 *   sourceMount: string,               // "drive" | "project:{id}"
 *   targetMount: string,               // "drive" | "project:{id}"
 *   moves: Array<{ from: string, to: string }>
 * }
 *
 * Moves files across storage mounts. Within GCS (two projects of the same
 * org) this is a native server-side copy; Drive ↔ GCS is an explicit byte
 * transfer (read → write → delete source). Destinations must not exist.
 *
 * The primary use is the My Drive shelf: bring a file into an org project,
 * or take one back out. Editor access is required on both sides (moving
 * removes data from the source).
 *
 * Response: { ok: true, objects: ObjectMeta[] }
 */

import type { Route } from "./+types/api.storage.move-between-mounts";
import { moveObjectsBetweenProjects } from "~/services/gcs-storage.server";
import { gcsObjectToMeta } from "~/services/storage/gcs-provider.server";
import {
  deleteObject,
  readObject,
  readObjectMetadata,
  writeObject,
} from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import { cleanRelativePath, type ObjectMeta } from "~/services/storage/types";
import { isProjectInternalPath } from "~/services/sync-client-utils";
import {
  BadRequestError,
  badRequestResponse,
  errorResponse,
} from "~/services/storage-route-utils.server";

interface MoveBody {
  sourceMount?: unknown;
  targetMount?: unknown;
  moves?: unknown;
}

const MAX_FILES_PER_MOVE = 500;

function cleanPath(value: unknown): string {
  let clean: string;
  try {
    clean = cleanRelativePath(value);
  } catch {
    throw new BadRequestError("invalid object path");
  }
  if (clean === "gemihub" || clean.startsWith("gemihub/") || isProjectInternalPath(clean)) {
    throw new BadRequestError("internal project files cannot be moved");
  }
  return clean;
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as MoveBody | null;
    if (!body) throw new BadRequestError("invalid JSON body");
    const sourceMount = String(body.sourceMount ?? "");
    const targetMount = String(body.targetMount ?? "");
    if (!sourceMount || !targetMount || sourceMount === targetMount) {
      throw new BadRequestError("source and target mounts must be different");
    }
    if (!Array.isArray(body.moves) || body.moves.length === 0 || body.moves.length > MAX_FILES_PER_MOVE) {
      throw new BadRequestError(`moves must contain 1-${MAX_FILES_PER_MOVE} files`);
    }
    const moves = body.moves.map((entry) => {
      if (!entry || typeof entry !== "object") throw new BadRequestError("invalid move entry");
      const value = entry as { from?: unknown; to?: unknown };
      return { from: cleanPath(value.from), to: cleanPath(value.to) };
    });
    if (new Set(moves.map((move) => move.to)).size !== moves.length) {
      throw new BadRequestError("duplicate destination paths");
    }

    // Moving removes data from the source, so editor access on both sides.
    const sourceCtx = await resolveMount(request, sourceMount, "editor");
    const targetCtx = await resolveMount(request, targetMount, "editor");

    if (
      sourceCtx.kind === "gcs-project" &&
      targetCtx.kind === "gcs-project" &&
      sourceCtx.gcs &&
      targetCtx.gcs &&
      sourceCtx.gcs.orgId !== targetCtx.gcs.orgId
    ) {
      throw new BadRequestError("projects must belong to the same organization");
    }

    const existingTargets = await Promise.all(
      moves.map((move) => readObjectMetadata(targetCtx, move.to)),
    );
    const conflictIndex = existingTargets.findIndex(Boolean);
    if (conflictIndex >= 0) {
      return Response.json(
        { error: `destination already exists: ${moves[conflictIndex].to}` },
        { status: 409 },
      );
    }

    // GCS → GCS: native server-side copy (no byte round-trip).
    if (sourceCtx.kind === "gcs-project" && targetCtx.kind === "gcs-project" && sourceCtx.gcs && targetCtx.gcs) {
      const objects = await moveObjectsBetweenProjects(sourceCtx.gcs, targetCtx.gcs, moves);
      return Response.json({ ok: true, objects: objects.map(gcsObjectToMeta) });
    }

    // Cross-provider (Drive ↔ GCS): explicit byte transfer. Copy EVERYTHING
    // first and only then delete the sources — same all-or-nothing shape as
    // the GCS→GCS path. A failure half-way must not leave some files deleted
    // from the source and others untouched, with the caller unable to tell
    // which is which.
    const objects: ObjectMeta[] = [];
    try {
      for (const move of moves) {
        const { meta, bytes } = await readObject(sourceCtx, move.from);
        objects.push(
          await writeObject(targetCtx, move.to, bytes, {
            ifRevisionMatch: 0,
            contentType: meta.contentType,
            updatedBy: targetCtx.gcs?.uid,
          }),
        );
      }
    } catch (err) {
      // Nothing was deleted yet: drop the partial copies so the move is a
      // no-op from the caller's point of view.
      await Promise.all(
        objects.map((object) =>
          deleteObject(targetCtx, object.relativePath).catch(() => {}),
        ),
      );
      throw err;
    }
    // Best-effort source cleanup; a failure here leaves a duplicate, never a
    // lost file, so it is reported rather than rolled back.
    const notDeleted: string[] = [];
    for (const move of moves) {
      try {
        await deleteObject(sourceCtx, move.from);
      } catch {
        notDeleted.push(move.from);
      }
    }
    return Response.json({
      ok: true,
      objects,
      ...(notDeleted.length > 0 ? { sourcesNotDeleted: notDeleted } : {}),
    });
  } catch (err) {
    return badRequestResponse(err) ?? errorResponse(err);
  }
}
