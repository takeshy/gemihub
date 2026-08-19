/**
 * POST /api/orgs/create
 *
 * Body: { orgId: string, name: string, ownerEmail: string, region?: string }
 *
 *   - orgId: 6–16 lowercase alphanumeric
 *   - ownerEmail: email address of the organization's initial administrator
 *   - region: GCS bucket + Vertex AI region; defaults to DEFAULT_TENANT_REGION env
 *
 * Creates the organization immediately with its tenant configuration.
 * Only a service super admin may create an organization.
 */

import type { Route } from "./+types/api.orgs.create";
import type { TenantInfo } from "~/types/enterprise";
import {
  createOrganization,
  emailToUid,
} from "~/services/organizations.server";
import { getTokens } from "~/services/session.server";
import { auditFromRoute } from "~/services/audit-log.server";
import { isSuperAdmin } from "~/services/super-admin.server";

interface CreateBody {
  orgId?: unknown;
  name?: unknown;
  ownerEmail?: unknown;
  region?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }
  if (!isSuperAdmin(tokens.email)) {
    return Response.json(
      { error: "only a service administrator can create organizations" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.name !== "string" ||
    typeof body.ownerEmail !== "string"
  ) {
    return Response.json(
      { error: "missing or invalid orgId/name/ownerEmail" },
      { status: 400 },
    );
  }
  const orgId = body.orgId;
  const name = body.name;
  const ownerEmail = body.ownerEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(ownerEmail)) {
    return Response.json({ error: "invalid ownerEmail" }, { status: 400 });
  }
  const region =
    typeof body.region === "string" && body.region
      ? body.region
      : process.env.DEFAULT_TENANT_REGION ?? "global";
  const gcsBucket = process.env.GCS_BUCKET_NAME ?? `gemihub-${orgId}`;
  const creatorUid = emailToUid(tokens.email);
  const ownerUid = emailToUid(ownerEmail);

  const tenant: TenantInfo = { gcsBucket, region };

  let org;
  try {
    org = await createOrganization({
      orgId,
      name,
      ownerUid,
      ownerEmail,
      tenantProject: tenant,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "failed to create organization" },
      { status: 400 },
    );
  }

  auditFromRoute({
    orgId,
    uid: creatorUid,
    email: tokens.email,
    action: "org.create",
    resourceType: "organization",
    resourceId: orgId,
    metadata: { name, region, ownerEmail },
    request,
    statusCode: 200,
  });

  return Response.json({
    organization: { id: org.id, name: org.name, ownerEmail },
    tenant,
  });
}
