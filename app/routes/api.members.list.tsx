/**
 * GET /api/members/list?orgId=<id>[&projectId=<id>]
 *
 * - Without projectId → list org members (requires org membership)
 * - With projectId    → list project members (requires project viewer+)
 *
 * Response: { members: Array<{ uid, email, role, isExternal? }> }
 */

import type { Route } from "./+types/api.members.list";
import {
  ProjectAccessError,
  requireOrgAccess,
  requireProjectAccess,
} from "~/services/project-acl.server";
import { listOrgMembers } from "~/services/organizations.server";
import { listProjectMembers } from "~/services/projects.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const projectId = url.searchParams.get("projectId");
  if (!orgId) {
    return Response.json({ error: "missing orgId" }, { status: 400 });
  }

  try {
    if (projectId) {
      const ctx = await requireProjectAccess(request, projectId, "viewer", { orgId });
      const members = await listProjectMembers(ctx.orgId, ctx.projectId);
      return Response.json({ members });
    }
    await requireOrgAccess(request, orgId);
    const members = await listOrgMembers(orgId);
    return Response.json({ members });
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
