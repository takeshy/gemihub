import type { Route } from "./+types/api.workflow.request-history";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  listRequestRecords,
  loadRequestRecord,
  saveRequestRecord,
  deleteRequestRecord,
} from "~/services/workflow-request-history.server";
import { getSettings } from "~/services/user-settings.server";
import { getEncryptionParams } from "~/types/settings";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  const workflowId = url.searchParams.get("workflowId");

  if (fileId) {
    const result = await loadRequestRecord(validTokens.accessToken, fileId);
    if ("encrypted" in result) {
      return Response.json(
        { encrypted: true, encryptedContent: result.encryptedContent },
        { headers: responseHeaders }
      );
    }
    return Response.json({ record: result }, { headers: responseHeaders });
  }

  const records = await listRequestRecords(
    validTokens.accessToken,
    validTokens.rootFolderId,
    workflowId || undefined
  );
  return Response.json({ records }, { headers: responseHeaders });
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const body = await request.json();
  const { action: act, fileId, record } = body;

  if (act === "save" && record) {
    let encryption;
    try {
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      encryption = getEncryptionParams(settings, "workflow");
    } catch { /* ignore settings load failure */ }

    const id = await saveRequestRecord(
      validTokens.accessToken,
      validTokens.rootFolderId,
      record,
      encryption
    );
    return Response.json({ success: true, fileId: id }, { headers: responseHeaders });
  }

  if (act === "delete" && fileId) {
    await deleteRequestRecord(validTokens.accessToken, validTokens.rootFolderId, fileId);
    return Response.json({ success: true }, { headers: responseHeaders });
  }

  return Response.json({ error: "Invalid action" }, { status: 400, headers: responseHeaders });
}
