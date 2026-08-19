/**
 * GET /api/storage/list?mount=<mount>&prefix=<relativePrefix>
 *                      &delimiter=/&pageToken=<>&pageSize=<>
 *
 * Without delimiter: flat list of every object under the prefix.
 * With delimiter=/ : tree-style listing — `objects` are immediate files
 *                    and `commonPrefixes` are immediate subfolders.
 *
 * Response: { objects: ObjectMeta[], commonPrefixes: string[], nextPageToken?: string }
 */

import type { Route } from "./+types/api.storage.list";
import { listObjects } from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import {
  badRequestResponse,
  errorResponse,
  requireQueryParam,
} from "~/services/storage-route-utils.server";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const mount = requireQueryParam(url, "mount");
    const relativePrefix = url.searchParams.get("prefix") ?? undefined;
    const delimiterRaw = url.searchParams.get("delimiter");
    const delimiter = delimiterRaw === "/" ? ("/" as const) : undefined;
    const pageToken = url.searchParams.get("pageToken") ?? undefined;
    const pageSizeRaw = url.searchParams.get("pageSize");
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;

    const ctx = await resolveMount(request, mount, "viewer");
    const result = await listObjects(ctx, {
      relativePrefix,
      delimiter,
      pageToken,
      pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
    });
    return Response.json(result);
  } catch (err) {
    return badRequestResponse(err) ?? errorResponse(err);
  }
}
