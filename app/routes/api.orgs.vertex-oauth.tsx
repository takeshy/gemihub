/**
 * GET    /api/orgs/vertex-oauth?orgId=<id>   → status (org, plus the service default)
 * GET    /api/orgs/vertex-oauth              → status of the service default
 * POST   /api/orgs/vertex-oauth              → configure an OAuth client, or switch source
 * DELETE /api/orgs/vertex-oauth              → disconnect
 *
 * Omit `orgId` in the body to act on the SERVICE-WIDE default connection that
 * organizations inherit; pass it to act on that organization alone.
 *
 * Connecting Vertex binds a Google Cloud project (and its billing), so every
 * mutation here is service-administrator only.
 */

import type { Route } from "./+types/api.orgs.vertex-oauth";
import { auditFromRoute } from "~/services/audit-log.server";
import { requireOrgAccess } from "~/services/project-acl.server";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import {
  disconnectVertexOAuth,
  getOrganizationVertexOAuthStatus,
  getServiceVertexOAuthStatus,
  parseVertexOAuthClientInput,
  saveVertexOAuthClient,
  setOrganizationVertexOAuthSource,
  type VertexOAuthTarget,
} from "~/services/vertex-oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) {
    const tokens = await getTokens(request);
    if (!isSuperAdmin(tokens?.email)) return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ oauthStatus: await getServiceVertexOAuthStatus() });
  }
  const access = await requireOrgAccess(request, orgId);
  if (access.role !== "owner" && access.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json({ oauthStatus: await getOrganizationVertexOAuthStatus(orgId) });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "DELETE" && request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const body = await request.json().catch(() => null) as {
    orgId?: unknown;
    source?: unknown;
    clientId?: unknown;
    clientSecret?: unknown;
    projectId?: unknown;
    redirectUris?: unknown;
  } | null;
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });
  if (body.orgId !== undefined && typeof body.orgId !== "string") {
    return Response.json({ error: "orgId must be a string" }, { status: 400 });
  }
  const orgId = (body.orgId as string | undefined)?.trim() || "";

  const tokens = await getTokens(request);
  if (orgId) {
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin" && !isSuperAdmin(tokens?.email)) {
      return Response.json({ error: "only an organization administrator can configure Vertex OAuth" }, { status: 403 });
    }
  } else if (!isSuperAdmin(tokens?.email)) {
    return Response.json({ error: "only a service administrator can configure the default Vertex OAuth" }, { status: 403 });
  }
  const actor = { uid: tokens?.email ?? "", email: tokens?.email ?? "" };
  const target: VertexOAuthTarget = orgId ? { scope: "org", orgId } : { scope: "service" };
  const auditOrgId = orgId || "service";

  if (request.method === "POST") {
    // Source switch: which connection this organization runs on.
    if (body.source !== undefined) {
      if (!orgId) return Response.json({ error: "orgId is required to switch source" }, { status: 400 });
      if (body.source !== "default" && body.source !== "own") {
        return Response.json({ error: `invalid source: ${String(body.source)}` }, { status: 400 });
      }
      await setOrganizationVertexOAuthSource(orgId, body.source);
      auditFromRoute({ orgId, uid: actor.uid, email: actor.email, action: "settings.update", resourceType: "organization", resourceId: orgId, metadata: { scope: "vertex_oauth_source", source: body.source }, request, statusCode: 200 });
      return Response.json({ ok: true, source: body.source });
    }

    const parsed = parseVertexOAuthClientInput(body, request);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    await saveVertexOAuthClient(target, parsed.input);
    auditFromRoute({ orgId: auditOrgId, uid: actor.uid, email: actor.email, action: "settings.update", resourceType: "organization", resourceId: auditOrgId, metadata: { scope: "vertex_oauth_client", projectId: parsed.input.projectId }, request, statusCode: 200 });
    return Response.json({ ok: true, projectId: parsed.input.projectId });
  }

  await disconnectVertexOAuth(target);
  auditFromRoute({ orgId: auditOrgId, uid: actor.uid, email: actor.email, action: "settings.update", resourceType: "organization", resourceId: auditOrgId, metadata: { scope: "vertex_oauth", connected: false }, request, statusCode: 200 });
  return Response.json({ ok: true });
}
