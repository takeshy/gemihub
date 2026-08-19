import { redirect } from "react-router";
import type { Route } from "./+types/auth.vertex.start";
import { getTokens, commitSession, getSession } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import { createVertexOAuthRequest, type VertexOAuthTarget } from "~/services/vertex-oauth.server";

/**
 * GET /auth/vertex/start[?orgId=<id>]
 *
 * Without orgId: connects the SERVICE-WIDE default account that organizations
 * inherit. With orgId: connects that organization's own account.
 *
 * Connecting Vertex binds a Google Cloud project (and its billing) to the
 * service or to an organization, so both flows are service-administrator only.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!isSuperAdmin(tokens?.email)) {
    throw new Response("Only a service administrator can connect Vertex OAuth", { status: 403 });
  }
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim() || "";
  const target: VertexOAuthTarget = orgId ? { scope: "org", orgId } : { scope: "service" };

  const oauth = await createVertexOAuthRequest(target, request);
  const session = await getSession(request);
  session.set("vertexOAuthState", oauth.state);
  session.set("vertexOAuthCodeVerifier", oauth.codeVerifier);
  session.set("vertexOAuthOrgId", orgId);
  return redirect(oauth.url, { headers: { "Set-Cookie": await commitSession(session) } });
}
