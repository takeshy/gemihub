import type { Route } from "./+types/api.projects.delete";
import {
  ProjectAccessError,
  requireOrgAccess,
} from "~/services/project-acl.server";
import { deleteProject } from "~/services/projects.server";
import { getTokens } from "~/services/session.server";
import { auditFromRoute } from "~/services/audit-log.server";

interface DeleteBody {
  orgId?: unknown;
  projectId?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.projectId !== "string"
  ) {
    return Response.json(
      { error: "missing or invalid orgId / projectId" },
      { status: 400 },
    );
  }
  const orgId = body.orgId;
  const projectId = body.projectId;

  let access;
  try {
    access = await requireOrgAccess(request, orgId);
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  if (access.role !== "owner" && access.role !== "admin") {
    return Response.json(
      { error: "only org owners/admins can delete projects" },
      { status: 403 },
    );
  }

  try {
    await deleteProject(orgId, projectId);
    auditFromRoute({
      orgId,
      projectId,
      uid: access.uid,
      email: access.email,
      action: "project.delete",
      resourceType: "project",
      resourceId: projectId,
      request,
      statusCode: 200,
    });
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditFromRoute({
      orgId,
      projectId,
      uid: access.uid,
      email: access.email,
      action: "project.delete",
      resourceType: "project",
      resourceId: projectId,
      metadata: { error: message },
      request,
      statusCode: 400,
      errorMessage: message,
    });
    return Response.json(
      { error: message },
      { status: 400 },
    );
  }
}
