/**
 * POST /api/projects/create
 *
 * Body: { orgId: string, projectId: string, name: string, allowedModels?: string[] }
 *
 * Creates an app project under the given org. Requires the caller to be
 * org.owner or org.admin.
 *
 * Response: { project: AppProject }
 */

import type { Route } from "./+types/api.projects.create";
import {
  ProjectAccessError,
  requireProjectAccess,
  requireOrgAccess,
} from "~/services/project-acl.server";
import { createProject } from "~/services/projects.server";
import { getTokens } from "~/services/session.server";
import { auditFromRoute } from "~/services/audit-log.server";
import { initializeProjectGuide } from "~/services/project-guide.server";

interface CreateBody {
  orgId?: unknown;
  projectId?: unknown;
  name?: unknown;
  slug?: unknown;
  allowedModels?: unknown;
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.projectId !== "string" ||
    typeof body.name !== "string"
  ) {
    return Response.json(
      { error: "missing or invalid orgId / projectId / name" },
      { status: 400 },
    );
  }
  const orgId = body.orgId;
  const projectId = body.projectId;
  const name = body.name;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const allowedModels = Array.isArray(body.allowedModels)
    ? body.allowedModels.filter((m): m is string => typeof m === "string")
    : undefined;

  if (slug && !SLUG_RE.test(slug)) {
    return Response.json(
      { error: "subdomain must be lowercase alphanumeric with optional hyphens" },
      { status: 400 },
    );
  }

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
      { error: "only org owners/admins can create projects" },
      { status: 403 },
    );
  }

  try {
    const project = await createProject({
      orgId,
      projectId,
      name,
      createdByUid: access.uid,
      createdByEmail: access.email,
      allowedModels,
    });
    const ctx = await requireProjectAccess(request, project.id, "admin", { orgId });
    await initializeProjectGuide(ctx);
    auditFromRoute({
      orgId,
      projectId,
      uid: access.uid,
      email: access.email,
      action: "project.create",
      resourceType: "project",
      resourceId: projectId,
      metadata: { name, allowedModels },
      request,
      statusCode: 200,
    });
    return Response.json({ project });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditFromRoute({
      orgId,
      projectId,
      uid: access.uid,
      email: access.email,
      action: "project.create",
      resourceType: "project",
      resourceId: projectId,
      metadata: { name, allowedModels, error: message },
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
