import type { Route } from "./+types/api.drive.temp";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import {
  listTempFiles,
  findTempFile,
  saveTempFile,
  readTempFile,
  applyAllTempFiles,
  deleteTempFiles,
} from "~/services/temp-file.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, tokens);

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  switch (action) {
    case "list": {
      const files = await listTempFiles(
        validTokens.accessToken,
        validTokens.rootFolderId
      );
      return Response.json({ files });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, tokens);

  const body = await request.json();
  const actionType = body.action as string;

  switch (actionType) {
    case "save": {
      const { fileName, fileId, content } = body;
      if (!fileName || !fileId) {
        return Response.json(
          { error: "Missing fileName or fileId" },
          { status: 400 }
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
      return Response.json({ success: true, file });
    }

    case "download": {
      const { fileName } = body;
      if (!fileName) {
        return Response.json({ error: "Missing fileName" }, { status: 400 });
      }
      const tempFile = await findTempFile(
        validTokens.accessToken,
        validTokens.rootFolderId,
        fileName
      );
      if (!tempFile) {
        return Response.json({ found: false });
      }
      return Response.json({ found: true, tempFile });
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
      return Response.json({ results });
    }

    case "delete": {
      const { tempFileIds } = body;
      if (!Array.isArray(tempFileIds)) {
        return Response.json(
          { error: "Missing tempFileIds array" },
          { status: 400 }
        );
      }
      await deleteTempFiles(validTokens.accessToken, tempFileIds);
      return Response.json({ success: true });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
