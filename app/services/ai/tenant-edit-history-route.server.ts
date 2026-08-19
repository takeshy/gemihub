import {
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import {
  getHistoryForTenant,
  clearHistoryForTenant,
} from "~/services/edit-history-tenant.server";

export async function tenantLoader(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const filePath = url.searchParams.get("filePath");

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  if (!filePath) {
    return Response.json({ error: "Missing filePath" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer");
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const entries = await getHistoryForTenant(ctx, filePath);
  return Response.json({ entries });
}

export async function tenantAction(request: Request) {
  if (request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { projectId, filePath } = body as { projectId?: string; filePath?: string };

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  if (!filePath) {
    return Response.json({ error: "Missing filePath" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "editor");
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  await clearHistoryForTenant(ctx, filePath);
  return Response.json({ success: true });
}
