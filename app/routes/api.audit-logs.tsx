/**
 * GET /api/audit-logs?orgId=&limit=
 *
 * Returns recent audit logs for an organization. Requires:
 *   - caller to be an org owner/admin, OR
 *   - caller to be a super admin.
 *
 * Query params:
 *   orgId  (required)
 *   limit  (optional, default 50, max 200)
 */

import type { Route } from "./+types/api.audit-logs";
import { getTokens } from "~/services/session.server";
import { emailToUid, getOrgMember } from "~/services/organizations.server";
import { listAuditLogs } from "~/services/audit-log.server";
import { isSuperAdmin } from "~/services/super-admin.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) {
    return Response.json({ error: "missing orgId" }, { status: 400 });
  }

  const uid = emailToUid(tokens.email);
  const isAdmin = isSuperAdmin(tokens.email);

  if (!isAdmin) {
    const member = await getOrgMember(orgId, uid);
    if (!member || (member.role !== "owner" && member.role !== "admin")) {
      return Response.json(
        { error: "only org owners, admins, or super admins can view audit logs" },
        { status: 403 },
      );
    }
  }

  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(rawLimit, 1), 200);

  const logs = await listAuditLogs(orgId, { limit });
  return Response.json({ logs });
}
