/**
 * POST /api/storage/upload  (multipart/form-data)
 *
 * Form fields:
 *   mount          string                          required, "drive" | "project:{id}"
 *   folderPrefix   string                          optional, e.g. "gemihub/uploads"
 *   files          File or File[]                  required
 *   filePaths      string or string[]              optional, one per file
 *
 * Each file is written to `<folderPrefix>/<filePaths[i] || file.name>` (or just
 * `<filePaths[i] || file.name>` if no prefix). Existing objects are overwritten —
 * callers that need optimistic concurrency should use api.storage.write
 * with `ifRevisionMatch` instead.
 *
 * Response:
 *   {
 *     results: Array<{
 *       name: string,            // original client-side filename
 *       object?: ObjectMeta,     // success
 *       error?: string           // failure
 *     }>
 *   }
 */

import type { Route } from "./+types/api.storage.upload";
import { writeObject } from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import { errorResponse } from "~/services/storage-route-utils.server";

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB practical ceiling

function sanitizePathSegment(segment: string): string {
  // Strip ../ traversal and leading slashes; collapse repeats.
  return segment
    .replace(/\.\.\//g, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "invalid multipart body" },
      { status: 400 },
    );
  }

  const mount = formData.get("mount");
  if (typeof mount !== "string" || !mount) {
    return Response.json({ error: "missing mount" }, { status: 400 });
  }
  const folderPrefixRaw = formData.get("folderPrefix");
  const folderPrefix =
    typeof folderPrefixRaw === "string" ? sanitizePathSegment(folderPrefixRaw) : "";

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "no files provided" }, { status: 400 });
  }
  const filePaths = formData
    .getAll("filePaths")
    .map((value) => (typeof value === "string" ? value : ""));

  let ctx;
  try {
    ctx = await resolveMount(request, mount, "editor");
  } catch (err) {
    return errorResponse(err);
  }

  const results: Array<{ name: string; object?: unknown; error?: string }> = [];
  for (const [index, file] of files.entries()) {
    const safeName = sanitizePathSegment(filePaths[index] || file.name);
    if (!safeName) {
      results.push({
        name: file.name,
        error: "invalid file path",
      });
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      results.push({
        name: safeName,
        error: `file too large (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      });
      continue;
    }
    try {
      const relativePath = folderPrefix ? `${folderPrefix}/${safeName}` : safeName;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const object = await writeObject(ctx, relativePath, bytes, {
        contentType: file.type || "application/octet-stream",
        updatedBy: ctx.gcs?.uid,
      });
      results.push({ name: safeName, object });
    } catch (err) {
      results.push({
        name: safeName,
        error: err instanceof Error ? err.message : "upload failed",
      });
    }
  }

  return Response.json({ results });
}
