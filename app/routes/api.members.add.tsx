/**
 * POST /api/members/add
 *
 * Body:
 *   - { orgId, email, role: "admin"|"member" } → add org member
 *   - { orgId, projectId, email, role: "admin"|"editor"|"viewer", isExternal? }
 *     → add project member
 *
 * Authorization:
 *   - org member add: caller must be an organization administrator
 *   - project member add: caller must be project admin (or organization admin via auto-promotion)
 *
 * Note: this is a synchronous "I know this user's email" path. Email-based
 * invitations with a verification link land in Phase 5e (`inviteOrgMember`).
 *
 * Response: { ok: true } | { error }
 */

import type { Route } from "./+types/api.members.add";
import {
  addOrgMember,
  emailToUid,
  getOrgMember,
} from "~/services/organizations.server";
import { addProjectMember } from "~/services/projects.server";
import type { OrgRole, ProjectRole } from "~/types/enterprise";
import {
  ProjectAccessError,
  requireOrgAccess,
  requireProjectAccess,
} from "~/services/project-acl.server";
import { getTokens } from "~/services/session.server";
import { auditFromRoute } from "~/services/audit-log.server";
import { shareHubworkSpreadsheetsWithMember } from "~/services/hubwork-spreadsheet-sharing.server";

interface AddBody {
  orgId?: unknown;
  projectId?: unknown;
  email?: unknown;
  role?: unknown;
  isExternal?: unknown;
}

const ORG_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member"]);
const PROJECT_ROLES: ReadonlySet<string> = new Set(["admin", "editor", "viewer"]);

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  const callerEmail = tokens?.email ?? "";
  const body = (await request.json().catch(() => null)) as AddBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.email !== "string" ||
    typeof body.role !== "string"
  ) {
    return Response.json(
      { error: "missing or invalid orgId / email / role" },
      { status: 400 },
    );
  }
  const orgId = body.orgId;
  const email = body.email;
  const uid = emailToUid(email);
  const isProjectScope = typeof body.projectId === "string" && body.projectId.length > 0;
  const projectId = isProjectScope ? (body.projectId as string) : null;

  try {
    if (projectId) {
      if (!PROJECT_ROLES.has(body.role)) {
        return Response.json({ error: `invalid project role: ${body.role}` }, { status: 400 });
      }
      const ctx = await requireProjectAccess(request, projectId, "admin", { orgId });
      const isExternal = body.isExternal === true ? true : !(await getOrgMember(orgId, uid));
      await addProjectMember({
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        uid,
        email,
        role: body.role as ProjectRole,
        isExternal,
      });
      await shareHubworkSpreadsheetsWithMember({
        request,
        ctx,
        email,
        role: body.role as ProjectRole,
      });
      auditFromRoute({
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        uid: ctx.uid,
        email: callerEmail,
        action: "member.add",
        resourceType: "project_member",
        resourceId: uid,
        metadata: { addedEmail: email, role: body.role, isExternal },
        request,
        statusCode: 200,
      });
      return Response.json({ ok: true });
    }

    // Org-scoped add
    if (!ORG_ROLES.has(body.role)) {
      return Response.json({ error: `invalid org role: ${body.role}` }, { status: 400 });
    }
    const access = await requireOrgAccess(request, orgId);
    const { isSuperAdmin } = await import("~/services/super-admin.server");
    if (body.role === "owner" && !isSuperAdmin(tokens?.email)) {
      return Response.json(
        { error: "only SuperOwner can add an Owner" },
        { status: 403 },
      );
    }
    if (access.role !== "owner" && access.role !== "admin") {
      return Response.json(
        { error: "only organization administrators can add members" },
        { status: 403 },
      );
    }
    await addOrgMember({ orgId, uid, email, role: body.role as OrgRole });
    auditFromRoute({
      orgId,
      uid: access.uid,
      email: access.email,
      action: "member.add",
      resourceType: "org_member",
      resourceId: uid,
      metadata: { addedEmail: email, role: body.role },
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
