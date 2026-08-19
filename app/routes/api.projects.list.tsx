/**
 * GET /api/projects/list?orgId=<id>
 *
 * Lists every project the logged-in user can access in the given org.
 *
 * Without orgId: lists every project the user can access across all orgs.
 *
 * Response: { projects: Array<{ id, orgId, name, gcsPrefix, allowedModels, role }> }
 */

import type { Route } from "./+types/api.projects.list";
import {
  emailToUid,
  getOrgMember,
  listAllOrganizations,
} from "~/services/organizations.server";
import {
  getProjectMember,
  listProjectsForUser,
  listProjectsInOrg,
  orgRoleAutoProjectRole,
} from "~/services/projects.server";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }
  const uid = emailToUid(tokens.email);
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const serviceAdmin = isSuperAdmin(tokens.email);

  let projects;
  if (serviceAdmin && orgId) {
    projects = await listProjectsInOrg(orgId);
  } else if (serviceAdmin) {
    const orgs = await listAllOrganizations();
    projects = (await Promise.all(orgs.map((org) => listProjectsInOrg(org.id)))).flat();
  } else if (orgId) {
    // Caller wants a specific org.
    const all = await listProjectsForUser(uid);
    projects = all.filter((p) => p.orgId === orgId);
  } else {
    projects = await listProjectsForUser(uid);
  }

  const items = await Promise.all(
    projects.map(async (p) => {
      const direct = await getProjectMember(p.orgId, p.id, uid);
      let role: "admin" | "editor" | "viewer" | null = serviceAdmin ? "admin" : direct?.role ?? null;
      if (!role) {
        const orgMember = await getOrgMember(p.orgId, uid);
        if (orgMember) role = orgRoleAutoProjectRole(orgMember.role, p.id);
      }
      return {
        id: p.id,
        orgId: p.orgId,
        name: p.name,
        gcsPrefix: p.gcsPrefix,
        allowedModels: p.allowedModels,
        visibility: p.visibility,
        role,
      };
    }),
  );
  return Response.json({ projects: items });
}
