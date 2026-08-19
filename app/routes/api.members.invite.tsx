/**
 * POST /api/members/invite
 *
 * Body: { orgId, email, role: "admin"|"member", expiryDays? }
 *
 * Authorization: organization administrators only. The legacy "owner" role
 * is accepted for callers as an administrator during data migration.
 *
 * Side effect: persists a pending invite to organizations/{orgId}/invites/
 * and dispatches a notification (SMTP if configured, else stderr log).
 *
 * Response: { invite: OrgInvite, inviteUrl }
 */

import type { Route } from "./+types/api.members.invite";
import {
  ProjectAccessError,
  requireOrgAccess,
} from "~/services/project-acl.server";
import { getOrganization } from "~/services/organizations.server";
import { createInvite } from "~/services/invites.server";
import { inviteUrlFor, sendInviteEmail } from "~/services/notify.server";
import { getValidTokens } from "~/services/google-auth.server";
import { requireAuth } from "~/services/session.server";
import type { OrgRole } from "~/types/enterprise";
import { google } from "googleapis";

const ORG_ROLES: ReadonlySet<string> = new Set(["admin", "member"]);

interface InviteBody {
  orgId?: unknown;
  email?: unknown;
  role?: unknown;
  expiryDays?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const body = (await request.json().catch(() => null)) as InviteBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.email !== "string" ||
    typeof body.role !== "string" ||
    !ORG_ROLES.has(body.role)
  ) {
    return Response.json(
      { error: "missing or invalid orgId / email / role" },
      { status: 400 },
    );
  }

  let access;
  try {
    access = await requireOrgAccess(request, body.orgId);
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  if (access.role !== "owner" && access.role !== "admin") {
    return Response.json(
      { error: "only organization administrators can invite members" },
      { status: 403 },
    );
  }
  const expiryDays =
    typeof body.expiryDays === "number" && body.expiryDays > 0
      ? Math.min(90, Math.floor(body.expiryDays))
      : undefined;

  const invite = await createInvite({
    orgId: body.orgId,
    email: body.email,
    role: body.role as OrgRole,
    invitedByUid: access.uid,
    invitedByEmail: access.email,
    expiryDays,
  });

  const org = await getOrganization(body.orgId);
  const inviteUrl = inviteUrlFor(request, invite.token);
  try {
    const sessionTokens = await requireAuth(request);
    const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, sessionTokens);
    if (!validTokens.accessToken) {
      throw new Error("Google OAuth access token is not available for invitation email delivery");
    }
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: validTokens.accessToken });
    await sendInviteEmail({
      invite,
      inviteUrl,
      orgDisplayName: org?.name ?? body.orgId,
      gmailClient: google.gmail({ version: "v1", auth: oauth2Client }),
    });
    return Response.json(
      { invite, inviteUrl, emailSent: true },
      setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : undefined,
    );
  } catch (err) {
    console.warn("[api.members.invite] notify failed:", err);
    return Response.json(
      {
        invite,
        inviteUrl,
        emailSent: false,
        warning: "招待は作成されましたが、メールを送信できませんでした。Google連携を確認してください。",
      },
      { status: 502 },
    );
  }
}
