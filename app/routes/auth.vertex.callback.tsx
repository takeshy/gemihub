import { redirect } from "react-router";
import type { Route } from "./+types/auth.vertex.callback";
import { auditFromRoute } from "~/services/audit-log.server";
import { commitSession, getSession, getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import {
  exchangeVertexOAuthCode,
  saveVertexOAuthToken,
  type VertexOAuthTarget,
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
  if (!code || !state || state !== expectedState || !verifier || orgId === undefined) {
    throw new Response("Invalid Vertex OAuth callback", { status: 400 });
  }

  const tokens = await getTokens(request);
  if (!isSuperAdmin(tokens?.email)) {
    throw new Response("Only a service administrator can connect Vertex OAuth", { status: 403 });
  }
  const target: VertexOAuthTarget = orgId ? { scope: "org", orgId } : { scope: "service" };

  const token = await exchangeVertexOAuthCode(target, request, code, verifier);
  await saveVertexOAuthToken(target, token.refreshToken, token.email);
  session.unset("vertexOAuthState");
  session.unset("vertexOAuthCodeVerifier");
  session.unset("vertexOAuthOrgId");
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
  return redirect("/admin/enterprise?vertexOAuth=connected", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
