/**
 * Business-plan organization provisioning.
 *
 * Buying the Business plan makes the purchaser the Owner of a new
 * organization with one default shared project. A completed Stripe payment
 * acts as a second authorization for org creation (alongside
 * SUPER_ADMIN_EMAILS-driven creation in /admin/enterprise).
 *
 * Called from the Stripe webhook — must never throw (Stripe retries the
 * whole event); failures are logged and provisioning is retried on the next
 * webhook delivery or manually via /admin/enterprise.
 */

import { createHash } from "node:crypto";
import type { TenantInfo } from "~/types/enterprise";
import {
  createOrganization,
  emailToUid,
  getOrganization,
  getOrgMember,
  listOrganizationsForUser,
  setOrganizationAiSettings,
} from "./organizations.server";
import { createProject, getProject } from "./projects.server";
import { getAccountById, updateAccount } from "./hubwork-accounts.server";
import { writeAuditLog } from "./audit-log.server";

const ORG_ID_RE = /^[a-z0-9]{6,16}$/;

function deriveOrgId(accountSlug: string | undefined, uid: string): string {
  const fromSlug = (accountSlug ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (ORG_ID_RE.test(fromSlug)) return fromSlug;
  if (fromSlug.length > 16) return fromSlug.slice(0, 16);
  // Too short (or empty): derive a stable id from the uid.
  const hash = createHash("sha256").update(uid).digest("hex").slice(0, 10);
  const candidate = `${fromSlug}${hash}`.slice(0, 16);
  return ORG_ID_RE.test(candidate) ? candidate : `org${hash}`.slice(0, 16);
}

export async function provisionBusinessOrganization(params: {
  accountId: string;
  email: string;
  accountSlug?: string;
  forceNewOrganization?: boolean;
}): Promise<{ orgId: string; projectId: string } | null> {
  const email = params.email.trim().toLowerCase();
  if (!email) return null;
  try {
    const uid = emailToUid(email);

    // The account already records the organization this purchase provisioned,
    // so reuse it — even under forceNewOrganization.
    // `checkout.session.completed` is delivered at least once and Stripe
    // retries on any non-2xx or timeout; without this a redelivery would skip
    // the reuse scan below, find the slug-derived id taken, fall through to a
    // hash id and create a SECOND organization for one purchase (the first one
    // then orphaned by the updateAccount at the end). It also pins the account
    // to the org whose web/** the published domain already serves, instead of
    // letting a re-subscribe pick a different one out of the scan below.
    const account = await getAccountById(params.accountId);
    let org = account?.orgId ? await getOrganization(account.orgId) : null;

    // Otherwise reuse an organization the buyer ADMINISTERS rather than
    // creating a second one. Reusing any membership would provision the plan
    // they paid for inside somebody else's organization when they happen to be
    // a plain member there.
    if (!org && !params.forceNewOrganization) {
      const existing = await listOrganizationsForUser(uid);
      for (const candidate of existing) {
        const membership = await getOrgMember(candidate.id, uid);
        if (membership?.role === "owner" || membership?.role === "admin") {
          org = candidate;
          break;
        }
      }
    }

    if (!org) {
      let orgId = deriveOrgId(params.accountSlug, uid);
      if (await getOrganization(orgId)) {
        // Slug-derived id is taken by someone else — fall back to a uid hash.
        orgId = deriveOrgId(undefined, `${uid}:${params.accountId}`);
        if (await getOrganization(orgId)) {
          console.error(`[business-provisioning] org id collision for ${params.accountId}`);
          return null;
        }
      }
      const tenant: TenantInfo = {
        gcsBucket: process.env.GCS_BUCKET_NAME ?? `gemihub-${orgId}`,
        region: process.env.DEFAULT_TENANT_REGION ?? "global",
      };
      org = await createOrganization({
        orgId,
        name: params.accountSlug || email.split("@")[0] || orgId,
        ownerUid: uid,
        ownerEmail: email,
        tenantProject: tenant,
      });
      // Business plan ($50/mo per organization) includes a Vertex budget;
      // owners can top it up in $10 units or adjust it later.
      const { BUSINESS_INCLUDED_AI_BUDGET_USD } = await import("./ai-budget.server");
      // The AI budget window follows the subscription cycle, so a mid-month
      // start does not hand out the tail of this month plus the whole next one.
      const { setOrgBudgetAnchorDay } = await import("./organizations.server");
      await setOrgBudgetAnchorDay(org.id, new Date().getUTCDate());
      await setOrganizationAiSettings(org.id, {
        ...org.aiSettings,
        monthlyBudgetUsd: BUSINESS_INCLUDED_AI_BUDGET_USD,
      });
      writeAuditLog({
        orgId: org.id,
        uid,
        email,
        action: "org.create",
        resourceType: "organization",
        resourceId: org.id,
        metadata: { source: "stripe-business-checkout", accountId: params.accountId },
        statusCode: 200,
      });
    }

    const project =
      (await getProject(org.id, "default")) ??
      (await createProject({
        orgId: org.id,
        projectId: "default",
        name: "Default",
        createdByUid: uid,
        createdByEmail: email,
      }));

    await updateAccount(params.accountId, { orgId: org.id, projectId: project.id });
    return { orgId: org.id, projectId: project.id };
  } catch (err) {
    console.error("[business-provisioning] failed:", err);
    return null;
  }
}
