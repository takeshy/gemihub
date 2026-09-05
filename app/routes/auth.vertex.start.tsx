import { redirect } from "react-router";
import type { Route } from "./+types/auth.vertex.start";
import { getTokens, commitSession, getSession } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import { createVertexOAuthRequest, hasUserVertexOAuthClient, type AnyVertexOAuthTarget } from "~/services/vertex-oauth.server";
import { emailToUid } from "~/services/organizations.server";
import { requireOrgAccess } from "~/services/project-acl.server";

/**
 * GET /auth/vertex/start[?orgId=<id>]
 *
 * Without orgId: connects the SERVICE-WIDE default account that organizations
 * inherit. With orgId: connects that organization's own account. With
 * personal=1: connects the signed-in user's own Google Cloud project, which
 * requires the user to have uploaded their own OAuth client JSON first —
 * the service's client must never be used to mint tokens for a project
 * the service does not own.
 *
 * Connecting Vertex binds a Google Cloud project (and its billing) to the
 * service or to an organization, so both flows are service-administrator only.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId")?.trim() || "";
  const personal = url.searchParams.get("personal") === "1";
  let target: AnyVertexOAuthTarget;
  if (personal) {
    const uid = emailToUid(tokens?.email ?? "");
    if (!uid) throw new Response("A signed-in email is required", { status: 403 });
    if (!(await hasUserVertexOAuthClient(uid))) {
      throw new Response("Upload your Google OAuth client JSON before connecting", { status: 400 });
    }
    target = { scope: "user", uid };
  } else if (orgId) {
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin" && !isSuperAdmin(tokens?.email)) {
      throw new Response("Only an organization administrator can connect Vertex OAuth", { status: 403 });
    }
    target = { scope: "org", orgId };
  } else {
    if (!isSuperAdmin(tokens?.email)) throw new Response("Only a service administrator can connect the default Vertex OAuth", { status: 403 });
    target = { scope: "service" };
  }

  const oauth = await createVertexOAuthRequest(target, request);
  const session = await getSession(request);
  session.set("vertexOAuthState", oauth.state);
  session.set("vertexOAuthCodeVerifier", oauth.codeVerifier);
  session.set("vertexOAuthOrgId", orgId);
  session.set("vertexOAuthUserId", target.scope === "user" ? target.uid : "");
  return redirect(oauth.url, { headers: { "Set-Cookie": await commitSession(session) } });
}
