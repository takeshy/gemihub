import { redirect } from "react-router";
import type { Route } from "./+types/auth.vertex.callback";
import { auditFromRoute } from "~/services/audit-log.server";
import { commitSession, getSession, getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import { emailToUid } from "~/services/organizations.server";
import { requireOrgAccess } from "~/services/project-acl.server";
import {
  exchangeVertexOAuthCode,
  saveVertexOAuthToken,
  type AnyVertexOAuthTarget,
} from "~/services/vertex-oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) throw new Response(`OAuth error: ${url.searchParams.get("error")}`, { status: 400 });
  const session = await getSession(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = session.get("vertexOAuthState") as string | undefined;
  const verifier = session.get("vertexOAuthCodeVerifier") as string | undefined;
  // Empty string = the service-wide default connection (see auth.vertex.start).
  const orgId = session.get("vertexOAuthOrgId") as string | undefined;
  const userId = session.get("vertexOAuthUserId") as string | undefined;
  if (!code || !state || state !== expectedState || !verifier || orgId === undefined || userId === undefined) {
    throw new Response("Invalid Vertex OAuth callback", { status: 400 });
  }

  const tokens = await getTokens(request);
  let target: AnyVertexOAuthTarget;
  if (userId) {
    if (emailToUid(tokens?.email ?? "") !== userId) throw new Response("Vertex OAuth user changed", { status: 403 });
    target = { scope: "user", uid: userId };
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

  const token = await exchangeVertexOAuthCode(target, request, code, verifier);
  await saveVertexOAuthToken(target, token.refreshToken, token.email);
  session.unset("vertexOAuthState");
  session.unset("vertexOAuthCodeVerifier");
  session.unset("vertexOAuthOrgId");
  session.unset("vertexOAuthUserId");
  auditFromRoute({
    orgId: orgId || "service",
    uid: tokens?.email ?? "",
    email: tokens?.email ?? "",
    action: "settings.update",
    resourceType: "organization",
    resourceId: orgId || "service",
    metadata: { scope: orgId ? "vertex_oauth" : "vertex_oauth_default", connectedEmail: token.email },
    request,
    statusCode: 302,
  });
  const destination = userId ? "/settings?tab=general&vertexOAuth=connected" : orgId ? "/settings?tab=enterprise&vertexOAuth=connected" : "/admin/enterprise?vertexOAuth=connected";
  return redirect(destination, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
