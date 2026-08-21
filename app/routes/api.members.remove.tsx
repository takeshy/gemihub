/**
 * POST /api/members/remove
 *
 * Body:
 *   - { orgId, uid }                  → remove org member
 *   - { orgId, projectId, uid }       → remove project member
 *
 * Authorization: organization admin for org-scoped, project admin for project-scoped.
 *
 * Response: { ok: true } | { error }
 */

import type { Route } from "./+types/api.members.remove";
import {
  ProjectAccessError,
  requireOrgAccess,
  requireProjectAccess,
} from "~/services/project-acl.server";
import { getOrgMember, removeOrgMember } from "~/services/organizations.server";
import {
  removeAllProjectMembershipsInOrg,
  removeProjectMember,
} from "~/services/projects.server";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import { auditFromRoute } from "~/services/audit-log.server";
import { getAccountByOrganization } from "~/services/hubwork-accounts.server";

interface RemoveBody {
  orgId?: unknown;
  projectId?: unknown;
  uid?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  const callerEmail = tokens?.email ?? "";
  const body = (await request.json().catch(() => null)) as RemoveBody | null;
  if (!body || typeof body.orgId !== "string" || typeof body.uid !== "string") {
    return Response.json({ error: "missing or invalid orgId / uid" }, { status: 400 });
  }
  const orgId = body.orgId;
  const uid = body.uid;
  const isProjectScope = typeof body.projectId === "string" && body.projectId.length > 0;
  const projectId = isProjectScope ? (body.projectId as string) : null;

  try {
    if (projectId) {
      const ctx = await requireProjectAccess(request, projectId, "admin", { orgId });
      await removeProjectMember(ctx.orgId, ctx.projectId, uid);
      auditFromRoute({
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        uid: ctx.uid,
        email: callerEmail,
        action: "member.remove",
        resourceType: "project_member",
        resourceId: uid,
        request,
        statusCode: 200,
      });
      return Response.json({ ok: true });
    }
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin") {
      return Response.json(
        { error: "only organization administrators can remove members" },
        { status: 403 },
      );
    }
    // Owner protection: an org admin (or an owner removing themself as the
    // last owner) must not be able to strip the org of its owner. Only a
    // service administrator may remove an owner.
    const target = await getOrgMember(orgId, uid);
    const billingAccount = target?.role === "owner"
      ? await getAccountByOrganization(orgId)
      : null;
    if (target?.role === "owner" && billingAccount?.billingStatus !== "canceled") {
      return Response.json(
        { error: "the subscription owner cannot leave while the Business contract is active; transfer or cancel the contract first" },
        { status: 409 },
      );
    }
    if (target?.role === "owner" && !isSuperAdmin(callerEmail)) {
      return Response.json(
        { error: "only a service administrator can remove an owner" },
        { status: 403 },
      );
    }
    // Org membership is the access gate, so drop the now-orphaned project
    // memberships too — otherwise re-adding the user would silently restore
    // their old project roles.
    await removeAllProjectMembershipsInOrg(orgId, uid);
    await removeOrgMember(orgId, uid);
    auditFromRoute({
      orgId,
      uid: access.uid,
      email: access.email,
      action: "member.remove",
      resourceType: "org_member",
      resourceId: uid,
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
