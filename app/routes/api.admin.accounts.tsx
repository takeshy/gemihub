/**
 * Service-administrator account management (Hubwork billing/publishing records).
 *
 *   GET    /api/admin/accounts             → every account
 *   POST   /api/admin/accounts             → { email } creates a `granted` account
 *   POST   /api/admin/accounts             → { accountId, ...fields } updates one
 *   DELETE /api/admin/accounts             → { accountId } deletes it (and its domain)
 *
 * Replaces the separate /hubwork/admin console: one console, one allowlist
 * (SUPER_ADMIN_EMAILS).
 */

import type { Route } from "./+types/api.admin.accounts";
import {
  createAccount,
  deleteAccount,
  getAccountByEmail,
  getAccountById,
  getAllAccounts,
  updateAccount,
} from "~/services/hubwork-accounts.server";
import { removeDomain } from "~/services/hubwork-domain.server";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import type {
  HubworkAccountPlan,
  HubworkAccountStatus,
  HubworkBillingStatus,
  HubworkDomainStatus,
} from "~/types/hubwork";
import { validateOrigin } from "~/utils/security";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLANS: HubworkAccountPlan[] = ["lite", "business", "granted"];
const BILLING_STATUSES: HubworkBillingStatus[] = ["active", "past_due", "canceled"];
const ACCOUNT_STATUSES: HubworkAccountStatus[] = ["enabled", "disabled"];
const DOMAIN_STATUSES: HubworkDomainStatus[] = ["none", "pending_dns", "provisioning_cert", "active", "failed"];

async function requireServiceAdmin(request: Request): Promise<string> {
  const tokens = await getTokens(request);
  if (!tokens?.email) throw new Response("not authenticated", { status: 401 });
  if (!isSuperAdmin(tokens.email)) {
    throw new Response("service administrator only", { status: 403 });
  }
  return tokens.email;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireServiceAdmin(request);
  return Response.json({ accounts: await getAllAccounts() });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  validateOrigin(request);
  await requireServiceAdmin(request);

  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    email?: unknown;
    plan?: unknown;
    billingStatus?: unknown;
    accountStatus?: unknown;
    domainStatus?: unknown;
  } | null;
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  if (request.method === "DELETE") {
    if (typeof body.accountId !== "string" || !body.accountId) {
      return Response.json({ error: "accountId is required" }, { status: 400 });
    }
    const account = await getAccountById(body.accountId);
    if (account?.customDomain) {
      try {
        await removeDomain(account.id, account.customDomain);
      } catch (error) {
        // Losing the certificate/DNS record is not worth blocking the delete;
        // it is reported so an operator can clean it up.
        console.warn(`[admin.accounts] failed to remove the custom domain for ${account.id}:`, error);
      }
    }
    await deleteAccount(body.accountId);
    return Response.json({ ok: true });
  }

  // Create: an admin-granted free account, identified by email only.
  if (!body.accountId) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) return Response.json({ error: "valid email is required" }, { status: 400 });
    if (await getAccountByEmail(email)) {
      return Response.json({ error: "an account with this email already exists" }, { status: 409 });
    }
    const account = await createAccount({
      email,
      refreshToken: "",
      rootFolderName: "",
      rootFolderId: "",
      plan: "granted",
    });
    return Response.json({ ok: true, account });
  }

  if (typeof body.accountId !== "string") {
    return Response.json({ error: "accountId must be a string" }, { status: 400 });
  }
  const updates: Parameters<typeof updateAccount>[1] = {};
  if (body.plan !== undefined) {
    if (!PLANS.includes(body.plan as HubworkAccountPlan)) {
      return Response.json({ error: `invalid plan: ${String(body.plan)}` }, { status: 400 });
    }
    updates.plan = body.plan as HubworkAccountPlan;
  }
  if (body.billingStatus !== undefined) {
    if (!BILLING_STATUSES.includes(body.billingStatus as HubworkBillingStatus)) {
      return Response.json({ error: `invalid billingStatus: ${String(body.billingStatus)}` }, { status: 400 });
    }
    updates.billingStatus = body.billingStatus as HubworkBillingStatus;
  }
  if (body.accountStatus !== undefined) {
    if (!ACCOUNT_STATUSES.includes(body.accountStatus as HubworkAccountStatus)) {
      return Response.json({ error: `invalid accountStatus: ${String(body.accountStatus)}` }, { status: 400 });
    }
    updates.accountStatus = body.accountStatus as HubworkAccountStatus;
  }
  if (body.domainStatus !== undefined) {
    if (!DOMAIN_STATUSES.includes(body.domainStatus as HubworkDomainStatus)) {
      return Response.json({ error: `invalid domainStatus: ${String(body.domainStatus)}` }, { status: 400 });
    }
    updates.domainStatus = body.domainStatus as HubworkDomainStatus;
  }
  if (body.email !== undefined) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) return Response.json({ error: "valid email is required" }, { status: 400 });
    updates.email = email;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }
  await updateAccount(body.accountId, updates);
  return Response.json({ ok: true, account: await getAccountById(body.accountId) });
}
