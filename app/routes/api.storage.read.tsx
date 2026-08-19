/**
 * GET /api/storage/read?mount=<mount>&path=<relativePath>&format=json|raw|metadata
 *
 *   mount: "drive" | "project:{id}"
 *   - format=json (default): { object, content, encoding }
 *     Text content is UTF-8; binary content is base64, selected from both the
 *     object MIME type and file extension.
 *   - format=raw: streams the bytes with Content-Type from the object.
 *   - format=metadata: { object: ObjectMeta } without downloading content.
 */

import type { Route } from "./+types/api.storage.read";
import { readObject, readObjectMetadata } from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import {
  badRequestResponse,
  errorResponse,
  requireQueryParam,
} from "~/services/storage-route-utils.server";
import { shouldTreatAsBinaryFile } from "~/services/sync-client-utils";

// Types safe to render inline on the app origin: no script execution surface.
// Deliberately excludes text/html, application/xhtml+xml, and image/svg+xml.
const SAFE_INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const mount = requireQueryParam(url, "mount");
    const path = requireQueryParam(url, "path");
    const format = url.searchParams.get("format") ?? "json";

    const ctx = await resolveMount(request, mount, "viewer");
    if (format === "metadata") {
      const object = await readObjectMetadata(ctx, path);
      if (!object) {
        return new Response("Not found", { status: 404 });
      }
      return Response.json({ object });
    }

    const { meta: object, bytes } = await readObject(ctx, path);

    if (format === "raw") {
      const fileName = object.relativePath.split("/").pop() || object.relativePath || "download";
      // Stored-XSS guard: these bytes are user-uploaded and this route serves
      // them on the app origin (session cookies in scope). Only render inline
      // for types that cannot execute script (notably NOT text/html or
      // image/svg+xml); everything else downloads as an attachment. The CSP
      // sandbox neuters anything a browser might still try to execute, and
      // nosniff pins the declared type.
      const contentType = SAFE_INLINE_TYPES.has(object.contentType) ||
        object.contentType.startsWith("audio/") ||
        object.contentType.startsWith("video/")
        ? object.contentType
        : "application/octet-stream";
      const inlineAllowed = contentType !== "application/octet-stream";
      const disposition =
        url.searchParams.get("download") === "1" || !inlineAllowed ? "attachment" : "inline";
      return new Response(bytes as BlobPart, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(object.size),
          "Content-Disposition": `${disposition}; filename="${encodeURIComponent(fileName)}"`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox; default-src 'none'",
        },
      });
    }
    const binary = shouldTreatAsBinaryFile(object.relativePath, object.contentType);
    return Response.json({
      object,
      content: binary
        ? Buffer.from(bytes).toString("base64")
        : new TextDecoder("utf-8").decode(bytes),
      encoding: binary ? "base64" : "utf-8",
    });
  } catch (err) {
    return badRequestResponse(err) ?? errorResponse(err);
  }
}
