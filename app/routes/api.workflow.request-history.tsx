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
import { createLogContext, emitLog } from "~/services/logger.server";

export async function loader({ request }: Route.LoaderArgs) {
  {
    const requestUrl = new URL(request.url);
    if (requestUrl.searchParams.get("projectId")) {
      const { tenantLoader } = await import("~/services/ai/tenant-workflow-request-history-route.server");
      return tenantLoader(request);
    }
  }
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const logCtx = createLogContext(request, "/api/workflow/request-history", validTokens.rootFolderId);

  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  const workflowId = url.searchParams.get("workflowId");
  logCtx.action = fileId ? "load" : "list";

  if (fileId) {
    const result = await loadRequestRecord(validTokens.accessToken, fileId);
    emitLog(logCtx, 200);
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
  emitLog(logCtx, 200);
  return Response.json({ records }, { headers: responseHeaders });
}

export async function action({ request }: Route.ActionArgs) {
  {
    const peek = (await request.clone().json().catch(() => null)) as { projectId?: unknown } | null;
    if (peek && typeof peek.projectId === "string" && peek.projectId) {
      const { tenantAction } = await import("~/services/ai/tenant-workflow-request-history-route.server");
      return tenantAction(request);
    }
  }
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const logCtx = createLogContext(request, "/api/workflow/request-history", validTokens.rootFolderId);

  const body = await request.json();
  const { action: act, fileId, record } = body;
  logCtx.action = act;

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
    emitLog(logCtx, 200);
    return Response.json({ success: true, fileId: id }, { headers: responseHeaders });
  }

  if (act === "delete" && fileId) {
    await deleteRequestRecord(validTokens.accessToken, validTokens.rootFolderId, fileId);
    emitLog(logCtx, 200);
    return Response.json({ success: true }, { headers: responseHeaders });
  }

  emitLog(logCtx, 400, { error: "Invalid action" });
  return Response.json({ error: "Invalid action" }, { status: 400, headers: responseHeaders });
}
