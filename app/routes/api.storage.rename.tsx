/**
 * POST /api/storage/rename
 *
 * Body: { mount, from, to }
 *
 * GCS has no in-place rename (copy + delete under the hood); the flat Drive
 * layout renames the file's NAME (which is its path). Returns the new
 * object's metadata.
 *
 * Authorization: project.editor for project mounts.
 */

import type { Route } from "./+types/api.storage.rename";
import { renameObject } from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import {
  BadRequestError,
  badRequestResponse,
  errorResponse,
} from "~/services/storage-route-utils.server";

interface RenameBody {
  mount?: unknown;
  from?: unknown;
  to?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as RenameBody | null;
    if (!body) throw new BadRequestError("invalid JSON body");
    const mount = String(body.mount ?? "");
    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    if (!mount) throw new BadRequestError("missing mount");
    if (!from) throw new BadRequestError("missing from");
    if (!to) throw new BadRequestError("missing to");

    const ctx = await resolveMount(request, mount, "editor");
    const object = await renameObject(ctx, from, to);
    return Response.json({ object });
  } catch (err) {
    return badRequestResponse(err) ?? errorResponse(err);
  }
}
