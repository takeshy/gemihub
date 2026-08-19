/**
 * GET /api/orgs/list
 *
 * Lists every organization the logged-in user is a member of.
 *
 * Response: { organizations: Array<{ id, name, role }>, isSuperOwner }
 */

import type { Route } from "./+types/api.orgs.list";
import {
  emailToUid,
  getOrgMember,
  listAllOrganizations,
  listOrganizationsForUser,
} from "~/services/organizations.server";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }
  const uid = emailToUid(tokens.email);
  const serviceAdmin = isSuperAdmin(tokens.email);
  const orgs = serviceAdmin ? await listAllOrganizations() : await listOrganizationsForUser(uid);
  const items = await Promise.all(
    orgs.map(async (o) => {
      const m = await getOrgMember(o.id, uid);
      return {
        id: o.id,
        name: o.name,
        role: m?.role ?? (serviceAdmin ? "admin" : null),
      };
    }),
  );
  return Response.json({ organizations: items, isSuperOwner: serviceAdmin });
}
