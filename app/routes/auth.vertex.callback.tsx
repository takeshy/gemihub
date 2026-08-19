import { redirect } from "react-router";
import type { Route } from "./+types/auth.vertex.callback";
import { auditFromRoute } from "~/services/audit-log.server";
import { requireOrgAccess } from "~/services/project-acl.server";
import { commitSession, getSession } from "~/services/session.server";
import { exchangeVertexOAuthCode, saveOrganizationVertexOAuth } from "~/services/vertex-oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) throw new Response(`OAuth error: ${url.searchParams.get("error")}`, { status: 400 });
  const session = await getSession(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = session.get("vertexOAuthState") as string | undefined;
  const verifier = session.get("vertexOAuthCodeVerifier") as string | undefined;
  const orgId = session.get("vertexOAuthOrgId") as string | undefined;
  if (!code || !state || state !== expectedState || !verifier || !orgId) throw new Response("Invalid Vertex OAuth callback", { status: 400 });
  const access = await requireOrgAccess(request, orgId);
  if (access.role !== "owner" && access.role !== "admin") throw new Response("Only organization administrators can connect Vertex OAuth", { status: 403 });
  const token = await exchangeVertexOAuthCode(orgId, request, code, verifier);
  await saveOrganizationVertexOAuth(orgId, token.refreshToken, token.email);
  session.unset("vertexOAuthState");
  session.unset("vertexOAuthCodeVerifier");
  session.unset("vertexOAuthOrgId");
  auditFromRoute({ orgId, uid: access.uid, email: access.email, action: "settings.update", resourceType: "organization", resourceId: orgId, metadata: { scope: "vertex_oauth", connectedEmail: token.email }, request, statusCode: 302 });
  return redirect("/settings?tab=enterprise&vertexOAuth=connected", { headers: { "Set-Cookie": await commitSession(session) } });
}
