import type { Route } from "./+types/api.drive.temp";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import {
  listTempFiles,
  findTempFile,
  saveTempFile,
  applyAllTempFiles,
  deleteTempFiles,
  addTempEditEntry,
} from "~/services/temp-file.server";
import { saveTempEditFile, cleanupExpired } from "~/services/temp-edit-file.server";
import {
  upsertFileInMeta,
} from "~/services/sync-meta.server";
import { getFileMetadata } from "~/services/google-drive.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  switch (action) {
    case "list": {
      const files = await listTempFiles(
        validTokens.accessToken,
        validTokens.rootFolderId
      );
      return Response.json({ files }, { headers: responseHeaders });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400, headers: responseHeaders });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const body = await request.json();
  const actionType = body.action as string;

  switch (actionType) {
    case "save": {
      const { fileName, fileId, content } = body;
      if (!fileName || !fileId) {
        return Response.json(
          { error: "Missing fileName or fileId" },
          { status: 400, headers: responseHeaders }
        );
      }
      const file = await saveTempFile(
        validTokens.accessToken,
        validTokens.rootFolderId,
        fileName,
        {
          fileId,
          content: content ?? "",
          savedAt: new Date().toISOString(),
        }
      );
      return Response.json({ success: true, file }, { headers: responseHeaders });
    }

    case "download": {
      const { fileName } = body;
      if (!fileName) {
        return Response.json({ error: "Missing fileName" }, { status: 400, headers: responseHeaders });
      }
      const tempFile = await findTempFile(
        validTokens.accessToken,
        validTokens.rootFolderId,
        fileName
      );
      if (!tempFile) {
        return Response.json({ found: false }, { headers: responseHeaders });
      }
      return Response.json({ found: true, tempFile }, { headers: responseHeaders });
    }

    case "applyAll": {
      const settings = await getSettings(
        validTokens.accessToken,
        validTokens.rootFolderId
      );
      const results = await applyAllTempFiles(
        validTokens.accessToken,
        validTokens.rootFolderId,
        settings.editHistory
      );

      // Update remoteMeta (_sync-meta.json) so diff won't see false conflicts
      for (const r of results) {
        try {
          const fileMeta = await getFileMetadata(validTokens.accessToken, r.fileId);
          await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, fileMeta);
        } catch { /* ignore individual meta update failures */ }
      }

      return Response.json({ results }, { headers: responseHeaders });
    }

    case "delete": {
      const { tempFileIds } = body;
      if (!Array.isArray(tempFileIds)) {
        return Response.json(
          { error: "Missing tempFileIds array" },
          { status: 400, headers: responseHeaders }
        );
      }
      await deleteTempFiles(validTokens.accessToken, tempFileIds);
      return Response.json({ success: true }, { headers: responseHeaders });
    }

    case "generateEditUrl": {
      const { fileId, fileName, content } = body;
      if (!fileId || !fileName) {
        return Response.json(
          { error: "Missing fileId or fileName" },
          { status: 400, headers: responseHeaders }
        );
      }

      // Also save to Drive temp (combines save + generateEditUrl into one call)
      await saveTempFile(
        validTokens.accessToken,
        validTokens.rootFolderId,
        fileName,
        { fileId, content: content ?? "", savedAt: new Date().toISOString() }
      );

      const uuid = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      saveTempEditFile(uuid, fileId, fileName, content ?? "");
      await addTempEditEntry(validTokens.accessToken, validTokens.rootFolderId, {
        uuid,
        fileId,
        fileName,
        createdAt,
      });
      // Clean up expired local files (async, non-blocking)
      cleanupExpired().catch(() => {});
      return Response.json({ uuid }, { headers: responseHeaders });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400, headers: responseHeaders });
  }
}
