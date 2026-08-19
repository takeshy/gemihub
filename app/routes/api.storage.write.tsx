/**
 * POST /api/storage/write
 *
 * Body (JSON):
 *   {
 *     mount: string,                      // "drive" | "project:{id}"
 *     path: string,                       // relative to the mount root
 *     content: string,                    // utf-8 text or base64
 *     encoding?: "utf-8" | "base64",      // default "utf-8"
 *     contentType?: string,               // default "text/plain"
 *     ifRevisionMatch?: string | 0,       // for optimistic concurrency
 *     customMetadata?: Record<string,string>
 *   }
 *
 * Response: { object: ObjectMeta }
 */

import type { Route } from "./+types/api.storage.write";
import { writeObject } from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import {
  BadRequestError,
  badRequestResponse,
  errorResponse,
} from "~/services/storage-route-utils.server";
import { auditFromRoute } from "~/services/audit-log.server";
import { requireRateLimit } from "~/services/rate-limiter.server";
import { getTokens } from "~/services/session.server";

interface WriteBody {
  mount?: unknown;
  path?: unknown;
  content?: unknown;
  encoding?: unknown;
  contentType?: unknown;
  ifRevisionMatch?: unknown;
  customMetadata?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }
    const tokens = await getTokens(request);
    const callerEmail = tokens?.email ?? "";
    const body = (await request.json().catch(() => null)) as WriteBody | null;
    if (!body) throw new BadRequestError("invalid JSON body");

    const mount = String(body.mount ?? "");
    const path = String(body.path ?? "");
    if (!mount) throw new BadRequestError("missing mount");
    if (!path) throw new BadRequestError("missing path");
    if (typeof body.content !== "string") throw new BadRequestError("missing content");

    const encoding = body.encoding === "base64" ? "base64" : "utf-8";
    const contentType =
      typeof body.contentType === "string" && body.contentType
        ? body.contentType
        : "text/plain";

    const ifRevisionMatch =
      body.ifRevisionMatch === 0 ||
      body.ifRevisionMatch === "0" ||
      typeof body.ifRevisionMatch === "string"
        ? (body.ifRevisionMatch === "0" || body.ifRevisionMatch === 0
            ? 0
            : (body.ifRevisionMatch as string))
        : undefined;

    const customMetadata =
      body.customMetadata && typeof body.customMetadata === "object"
        ? (body.customMetadata as Record<string, string>)
        : undefined;

    const ctx = await resolveMount(request, mount, "editor");

    // Per-user rate limiting on project-mount writes (Firestore-backed, so
    // only where Firestore is guaranteed available).
    if (ctx.kind === "gcs-project" && ctx.gcs) {
      const rateLimited = await requireRateLimit("storage_write", ctx.gcs.uid);
      if (rateLimited) return rateLimited;
    }

    const bytes =
      encoding === "base64"
        ? new Uint8Array(Buffer.from(body.content, "base64"))
        : new TextEncoder().encode(body.content);

    const object = await writeObject(ctx, path, bytes, {
      ifRevisionMatch,
      contentType,
      customMetadata,
      updatedBy: ctx.gcs?.uid,
    });
    if (ctx.kind === "gcs-project" && ctx.gcs) {
      auditFromRoute({
        orgId: ctx.gcs.orgId,
        projectId: ctx.gcs.projectId,
        uid: ctx.gcs.uid,
        email: callerEmail,
        action: "storage.write",
        resourceType: "storage_object",
        resourceId: path,
        metadata: { contentType, size: bytes.length },
        request,
        statusCode: 200,
      });
    }
    return Response.json({ object });
  } catch (err) {
    return badRequestResponse(err) ?? errorResponse(err);
  }
}
