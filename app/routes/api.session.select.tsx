/**
 * POST /api/session/select
 *
 * Body: { orgId?: string | null, projectId?: string | null }
 *
 * Switch the user's currently selected org and/or project. Pass null to clear.
 *
 * The chosen org must be one the user is a member of, and the project must
 * exist within it. Otherwise → 403.
 */

import type { Route } from "./+types/api.session.select";
import { getOrgMember } from "~/services/organizations.server";
import { ProjectAccessError, requireProjectAccess } from "~/services/project-acl.server";
import { getTokens, setCurrentSelection } from "~/services/session.server";
import { emailToUid } from "~/services/organizations.server";

interface SelectBody {
  orgId?: string | null;
  projectId?: string | null;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }
  const uid = emailToUid(tokens.email);

  const body = (await request.json().catch(() => null)) as SelectBody | null;
  if (!body) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Validate the org/project selection before committing it to the session.
  const orgIdToSet = body.orgId === null ? null : body.orgId;
  const projectIdToSet = body.projectId === null ? null : body.projectId;
  const effectiveOrg = orgIdToSet === null ? undefined : (orgIdToSet ?? tokens.currentOrgId);

  if (orgIdToSet) {
    const member = await getOrgMember(orgIdToSet, uid);
    if (!member) {
      return Response.json(
        { error: `not a member of organization ${orgIdToSet}` },
        { status: 403 },
      );
    }
  }
  if (projectIdToSet && effectiveOrg) {
    try {
      await requireProjectAccess(request, projectIdToSet, "viewer", { orgId: effectiveOrg });
    } catch (error) {
      if (error instanceof ProjectAccessError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  } else if (projectIdToSet && !effectiveOrg) {
    return Response.json(
      { error: "cannot select a project without an org" },
      { status: 400 },
    );
  }

  const cookie = await setCurrentSelection(request, {
    orgId: orgIdToSet,
    projectId: projectIdToSet,
  });
  return Response.json(
    {
      currentOrgId: orgIdToSet === null ? null : (orgIdToSet ?? tokens.currentOrgId ?? null),
      currentProjectId:
        projectIdToSet === null ? null : (projectIdToSet ?? tokens.currentProjectId ?? null),
    },
    { headers: { "Set-Cookie": cookie } },
  );
}
