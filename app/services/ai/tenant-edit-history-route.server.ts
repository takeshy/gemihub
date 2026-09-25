import {
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import {
  getHistoryForTenant,
  clearHistoryForTenant,
  getStatsForTenant,
  pruneForTenant,
} from "~/services/edit-history-tenant.server";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";

export async function tenantLoader(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const orgId = url.searchParams.get("orgId") || undefined;
  const filePath = url.searchParams.get("filePath");

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  if (!filePath) {
    return Response.json({ error: "Missing filePath" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer", { orgId });
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
  const { projectId, orgId, filePath } = body as { projectId?: string; orgId?: string; filePath?: string };

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  if (!filePath) {
    return Response.json({ error: "Missing filePath" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "editor", { orgId: orgId || undefined });
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  await clearHistoryForTenant(ctx, filePath);
  return Response.json({ success: true });
}

/** POST /api/settings/edit-history-prune with { projectId, orgId? }. */
export async function tenantPruneAction(request: Request, projectId: string, orgId?: string) {
  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "editor", { orgId });
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  try {
    const settings = await getSettingsForTenant(ctx);
    return Response.json(await pruneForTenant(ctx, settings.editHistory));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Prune failed" },
      { status: 500 }
    );
  }
}

/** GET /api/settings/edit-history-stats?projectId=…&orgId=… */
export async function tenantStatsLoader(request: Request, projectId: string, orgId?: string) {
  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer", { orgId });
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  try {
    return Response.json(await getStatsForTenant(ctx));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get stats" },
      { status: 500 }
    );
  }
}
