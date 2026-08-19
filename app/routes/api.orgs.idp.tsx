/**
 * POST /api/orgs/idp
 *
 * Set or clear the OIDC IdP config for an organization.
 *
 * Body:
 *   - To set:    { orgId, type: "oidc", issuer, clientId, clientSecret, domains: string[] }
 *   - To clear:  { orgId, type: "google" }   (or { orgId, type: null })
 *
 * Authorization: organization administrators only.
 */

import type { Route } from "./+types/api.orgs.idp";
import {
  ProjectAccessError,
  requireOrgAccess,
} from "~/services/project-acl.server";
import { getOrganization, setOrgIdp } from "~/services/organizations.server";

interface SetBody {
  orgId?: unknown;
  type?: unknown;
  issuer?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  domains?: unknown;
}

export async function loader({ request }: Route.LoaderArgs) {
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  try {
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
    const org = await getOrganization(orgId);
    if (!org) return Response.json({ error: "organization not found" }, { status: 404 });
    const idp = org.idp?.type === "oidc"
      ? { type: "oidc", issuer: org.idp.issuer, clientId: org.idp.clientId, domains: org.idp.domains }
      : null;
    return Response.json({ idp });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const body = (await request.json().catch(() => null)) as SetBody | null;
  if (!body || typeof body.orgId !== "string") {
    return Response.json({ error: "missing or invalid orgId" }, { status: 400 });
  }
  const orgId = body.orgId;

  let access;
  try {
    access = await requireOrgAccess(request, orgId);
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  if (access.role !== "owner" && access.role !== "admin") {
    return Response.json(
      { error: "only organization administrators can change the IdP configuration" },
      { status: 403 },
    );
  }

  if (body.type === null || body.type === "google") {
    await setOrgIdp(orgId, null);
    return Response.json({ ok: true, idp: null });
  }
  if (body.type !== "oidc") {
    return Response.json({ error: "unsupported IdP type" }, { status: 400 });
  }
  if (
    typeof body.issuer !== "string" ||
    typeof body.clientId !== "string" ||
    typeof body.clientSecret !== "string"
  ) {
    return Response.json(
      { error: "OIDC config requires issuer, clientId, clientSecret" },
      { status: 400 },
    );
  }
  const domains = Array.isArray(body.domains)
    ? body.domains
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0)
    : [];

  await setOrgIdp(orgId, {
    type: "oidc",
    issuer: body.issuer.trim(),
    clientId: body.clientId.trim(),
    clientSecretRef: body.clientSecret,
    domains,
  });
  // Don't echo the secret back.
  return Response.json({
    ok: true,
    idp: { type: "oidc", issuer: body.issuer, clientId: body.clientId, domains },
  });
}
