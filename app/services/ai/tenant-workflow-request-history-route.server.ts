import {
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import {
  listRequestRecordsForTenant,
  loadRequestRecordForTenant,
  saveRequestRecordForTenant,
  deleteRequestRecordForTenant,
} from "~/services/workflow-request-history-tenant.server";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";
import { getEncryptionParams } from "~/types/settings";
import { createLogContext, emitLog } from "~/services/logger.server";

export async function tenantLoader(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const logCtx = createLogContext(request, "/api/workflow/request-history", "");

  if (!projectId) {
    emitLog(logCtx, 400, { error: "Missing projectId" });
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer");
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      emitLog(logCtx, err.status, { error: err.message });
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const fileId = url.searchParams.get("fileId");
  const workflowId = url.searchParams.get("workflowId");
  logCtx.action = fileId ? "load" : "list";

  if (fileId) {
    const result = await loadRequestRecordForTenant(ctx, fileId);
    emitLog(logCtx, 200);
    if (!result) {
      return Response.json({ error: "Record not found" }, { status: 404 });
    }
    if ("encrypted" in result) {
      return Response.json({
        encrypted: true,
        encryptedContent: result.encryptedContent,
      });
    }
    return Response.json({ record: result });
  }

  const records = await listRequestRecordsForTenant(ctx, workflowId || undefined);
  emitLog(logCtx, 200);
  return Response.json({ records });
}

export async function tenantAction(request: Request) {
  const logCtx = createLogContext(request, "/api/workflow/request-history", "");
  const body = await request.json();
  const { projectId, action: act, fileId, record } = body as {
    projectId?: string;
    action?: string;
    fileId?: string;
    record?: import("~/engine/types").WorkflowRequestRecord;
  };
  logCtx.action = act;

  if (!projectId) {
    emitLog(logCtx, 400, { error: "Missing projectId" });
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "editor");
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      emitLog(logCtx, err.status, { error: err.message });
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  if (act === "save" && record) {
    let encryption;
    try {
      const settings = await getSettingsForTenant(ctx);
      encryption = getEncryptionParams(settings, "workflow");
    } catch { /* proceed without encryption */ }

    const id = await saveRequestRecordForTenant(ctx, record, encryption);
    emitLog(logCtx, 200);
    return Response.json({ success: true, fileId: id });
  }

  if (act === "delete" && fileId) {
    await deleteRequestRecordForTenant(ctx, fileId);
    emitLog(logCtx, 200);
    return Response.json({ success: true });
  }

  emitLog(logCtx, 400, { error: "Invalid action" });
  return Response.json({ error: "Invalid action" }, { status: 400 });
}
