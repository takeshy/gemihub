/**
 * POST /api/storage/delete
 *
 * Body (JSON):
 *   {
 *     mount: string,                     // "drive" | "project:{id}"
 *     path: string,
 *     ifRevisionMatch?: string           // for optimistic concurrency
 *   }
 *
 * Response: { ok: true }
 */

import type { Route } from "./+types/api.storage.delete";
import { deleteObject } from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import {
  BadRequestError,
  badRequestResponse,
  errorResponse,
} from "~/services/storage-route-utils.server";
import { auditFromRoute } from "~/services/audit-log.server";
import { getTokens } from "~/services/session.server";

interface DeleteBody {
  mount?: unknown;
  path?: unknown;
  ifRevisionMatch?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST" && request.method !== "DELETE") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }
    const tokens = await getTokens(request);
    const callerEmail = tokens?.email ?? "";
    const body = (await request.json().catch(() => null)) as DeleteBody | null;
    if (!body) throw new BadRequestError("invalid JSON body");

    const mount = String(body.mount ?? "");
    const path = String(body.path ?? "");
    if (!mount) throw new BadRequestError("missing mount");
    if (!path) throw new BadRequestError("missing path");

    const ifRevisionMatch =
      typeof body.ifRevisionMatch === "string" ? body.ifRevisionMatch : undefined;

    const ctx = await resolveMount(request, mount, "editor");
    await deleteObject(ctx, path, { ifRevisionMatch });
    if (ctx.kind === "gcs-project" && ctx.gcs) {
      auditFromRoute({
        orgId: ctx.gcs.orgId,
        projectId: ctx.gcs.projectId,
        uid: ctx.gcs.uid,
        email: callerEmail,
        action: "storage.delete",
        resourceType: "storage_object",
        resourceId: path,
        request,
        statusCode: 200,
      });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return badRequestResponse(err) ?? errorResponse(err);
  }
}
