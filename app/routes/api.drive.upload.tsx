import type { Route } from "./+types/api.drive.upload";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { createFileBinary } from "~/services/google-drive.server";
import { upsertFileInMeta } from "~/services/sync-meta.server";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file (Drive multipart limit)

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const formData = await request.formData();
  const folderId = formData.get("folderId") as string | null;
  const namePrefix = formData.get("namePrefix") as string | null;
  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400, headers: responseHeaders });
  }

  const targetFolderId = folderId || validTokens.rootFolderId;

  const results: { name: string; file?: unknown; error?: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      results.push({
        name: file.name,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB per file.`,
      });
      continue;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const uploadName = namePrefix ? `${namePrefix}/${file.name}` : file.name;
      const driveFile = await createFileBinary(
        validTokens.accessToken,
        uploadName,
        buffer,
        targetFolderId,
        file.type || "application/octet-stream"
      );
      await upsertFileInMeta(validTokens.accessToken, targetFolderId, driveFile);
      results.push({ name: file.name, file: driveFile });
    } catch (e) {
      results.push({
        name: file.name,
        error: e instanceof Error ? e.message : "Upload failed",
      });
    }
  }

  return Response.json({ results }, { headers: responseHeaders });
}
