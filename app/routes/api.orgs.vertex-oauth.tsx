import type { Route } from "./+types/api.orgs.vertex-oauth";
import { auditFromRoute } from "~/services/audit-log.server";
import { requireOrgAccess } from "~/services/project-acl.server";
import {
  disconnectOrganizationVertexOAuth,
  getOrganizationVertexOAuthStatus,
  saveOrganizationVertexOAuthClient,
} from "~/services/vertex-oauth.server";

const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function expectedRedirectUri(request: Request): string {
  if (process.env.VERTEX_OAUTH_REDIRECT_URI) return process.env.VERTEX_OAUTH_REDIRECT_URI;
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${url.host}/auth/vertex/callback`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  const access = await requireOrgAccess(request, orgId);
  if (access.role !== "owner" && access.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json({ oauthStatus: await getOrganizationVertexOAuthStatus(orgId) });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "DELETE" && request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const body = await request.json().catch(() => null) as {
    orgId?: unknown;
    clientId?: unknown;
    clientSecret?: unknown;
    projectId?: unknown;
    redirectUris?: unknown;
  } | null;
  if (!body || typeof body.orgId !== "string") return Response.json({ error: "orgId is required" }, { status: 400 });
  const access = await requireOrgAccess(request, body.orgId);
  if (access.role !== "owner" && access.role !== "admin") return Response.json({ error: "only organization administrators can configure Vertex OAuth" }, { status: 403 });

  if (request.method === "POST") {
    if (
      typeof body.clientId !== "string" || !body.clientId.trim().endsWith(".apps.googleusercontent.com") ||
      typeof body.clientSecret !== "string" || body.clientSecret.trim().length < 8 ||
      typeof body.projectId !== "string" || !PROJECT_ID_RE.test(body.projectId.trim()) ||
      !Array.isArray(body.redirectUris) || !body.redirectUris.every((value) => typeof value === "string")
    ) {
      return Response.json({ error: "有効なウェブアプリ用OAuthクライアントJSONを選択してください" }, { status: 400 });
    }
    const redirectUri = expectedRedirectUri(request);
    if (!body.redirectUris.includes(redirectUri)) {
      return Response.json({ error: `OAuthクライアントにリダイレクトURI ${redirectUri} を追加してください` }, { status: 400 });
    }
    await saveOrganizationVertexOAuthClient(body.orgId, {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      projectId: body.projectId,
    });
    auditFromRoute({ orgId: body.orgId, uid: access.uid, email: access.email, action: "settings.update", resourceType: "organization", resourceId: body.orgId, metadata: { scope: "vertex_oauth_client", projectId: body.projectId }, request, statusCode: 200 });
    return Response.json({ ok: true, projectId: body.projectId });
  }

  await disconnectOrganizationVertexOAuth(body.orgId);
  auditFromRoute({ orgId: body.orgId, uid: access.uid, email: access.email, action: "settings.update", resourceType: "organization", resourceId: body.orgId, metadata: { scope: "vertex_oauth", connected: false }, request, statusCode: 200 });
  return Response.json({ ok: true });
}
