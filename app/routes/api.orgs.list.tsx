/**
 * GET /api/orgs/list
 *
 * Lists every organization the logged-in user can reach: org memberships plus
 * the orgs behind projects they collaborate on (external collaborators hold
 * no org membership, and `role` is null for them).
 *
 * Response: { organizations: Array<{ id, name, role }>, isSuperOwner }
 */

import type { Route } from "./+types/api.orgs.list";
import {
  emailToUid,
  getOrgMember,
  listAllOrganizations,
} from "~/services/organizations.server";
import { listAccessibleOrganizationsForUser } from "~/services/projects.server";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }
  const uid = emailToUid(tokens.email);
  const serviceAdmin = isSuperAdmin(tokens.email);
  try {
    const orgs = serviceAdmin
      ? await listAllOrganizations()
      : await listAccessibleOrganizationsForUser(uid);
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
  } catch (error) {
    // Firestore rejects the collection-group queries behind this route until
    // the required indexes exist, and its message carries the console URL that
    // creates them. Surface it instead of a bare 500 HTML page.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api.orgs.list] organization lookup failed:", message);
    return Response.json({ error: message }, { status: 503 });
  }
}
