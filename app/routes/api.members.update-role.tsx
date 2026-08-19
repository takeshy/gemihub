/**
 * POST /api/members/update-role
 *
 * Body:
 *   - { orgId, uid, role: "admin"|"member" }                        → org role
 *   - { orgId, projectId, uid, role: "admin"|"editor"|"viewer" }    → project role
 *
 * Authorization: organization admin for org-scoped, project admin for project-scoped.
 *
 * Response: { ok: true } | { error }
 */

import type { Route } from "./+types/api.members.update-role";
import {
  ProjectAccessError,
  requireOrgAccess,
  requireProjectAccess,
} from "~/services/project-acl.server";
import { addOrgMember, getOrgMember } from "~/services/organizations.server";
import {
  getProjectMember,
  updateProjectMemberRole,
} from "~/services/projects.server";
import type { OrgRole, ProjectRole } from "~/types/enterprise";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import { auditFromRoute } from "~/services/audit-log.server";

interface UpdateBody {
  orgId?: unknown;
  projectId?: unknown;
  uid?: unknown;
  role?: unknown;
}

const ORG_ROLES: ReadonlySet<string> = new Set(["admin", "member"]);
const PROJECT_ROLES: ReadonlySet<string> = new Set(["admin", "editor", "viewer"]);

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  const callerEmail = tokens?.email ?? "";
  const body = (await request.json().catch(() => null)) as UpdateBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.uid !== "string" ||
    typeof body.role !== "string"
  ) {
    return Response.json(
      { error: "missing or invalid orgId / uid / role" },
      { status: 400 },
    );
  }
  const orgId = body.orgId;
  const uid = body.uid;
  const isProjectScope = typeof body.projectId === "string" && body.projectId.length > 0;
  const projectId = isProjectScope ? (body.projectId as string) : null;

  try {
    if (projectId) {
      if (!PROJECT_ROLES.has(body.role)) {
        return Response.json({ error: `invalid project role: ${body.role}` }, { status: 400 });
      }
      const ctx = await requireProjectAccess(request, projectId, "admin", { orgId });
      const target = await getProjectMember(ctx.orgId, ctx.projectId, uid);
      if (!target) {
        return Response.json({ error: `${uid} is not a member of this project` }, { status: 404 });
      }
      await updateProjectMemberRole(ctx.orgId, ctx.projectId, uid, body.role as ProjectRole);
      auditFromRoute({
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        uid: ctx.uid,
        email: callerEmail,
        action: "member.update_role",
        resourceType: "project_member",
        resourceId: uid,
        metadata: { targetEmail: target.email, oldRole: target.role, newRole: body.role },
        request,
        statusCode: 200,
      });
      return Response.json({ ok: true });
    }

    if (!ORG_ROLES.has(body.role)) {
      return Response.json({ error: `invalid org role: ${body.role}` }, { status: 400 });
    }
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin") {
      return Response.json(
        { error: "only organization administrators can change member roles" },
        { status: 403 },
      );
    }
    const target = await getOrgMember(orgId, uid);
    if (!target) {
      return Response.json({ error: `${uid} is not a member of this org` }, { status: 404 });
    }
    // Owner protection: ORG_ROLES never assigns "owner", so any change to an
    // owner is a demotion. Only a service administrator may do that —
    // otherwise an org admin could strip the owner's control.
    if (target.role === "owner" && !isSuperAdmin(callerEmail)) {
      return Response.json(
        { error: "only a service administrator can change an owner's role" },
        { status: 403 },
      );
    }
    // Org members are stored as a single doc per uid → upsert by re-add.
    await addOrgMember({ orgId, uid, email: target.email, role: body.role as OrgRole });
    auditFromRoute({
      orgId,
      uid: access.uid,
      email: access.email,
      action: "member.update_role",
      resourceType: "org_member",
      resourceId: uid,
      metadata: { targetEmail: target.email, oldRole: target.role, newRole: body.role },
      request,
      statusCode: 200,
    });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
