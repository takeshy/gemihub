import { redirect } from "react-router";
import type { Route } from "./+types/auth.vertex.start";
import { requireOrgAccess } from "~/services/project-acl.server";
import { commitSession, getSession } from "~/services/session.server";
import { createVertexOAuthRequest } from "~/services/vertex-oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  const access = await requireOrgAccess(request, orgId);
  if (access.role !== "owner" && access.role !== "admin") throw new Response("Only organization administrators can connect Vertex OAuth", { status: 403 });
  const oauth = await createVertexOAuthRequest(orgId, request);
  const session = await getSession(request);
  session.set("vertexOAuthState", oauth.state);
  session.set("vertexOAuthCodeVerifier", oauth.codeVerifier);
  session.set("vertexOAuthOrgId", orgId);
  return redirect(oauth.url, { headers: { "Set-Cookie": await commitSession(session) } });
}
