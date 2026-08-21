import { data } from "react-router";
import type { Route } from "./+types/hubwork.api.domain";
import { requireAuth } from "~/services/session.server";
import { provisionDomain, getDomainStatus, removeDomain } from "~/services/hubwork-domain.server";
import { getAccountByDomain, getAccountByOrganization } from "~/services/hubwork-accounts.server";
import { emailToUid, getOrgMember } from "~/services/organizations.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import { validateOrigin } from "~/utils/security";

async function requireManagedOrganizationAccount(request: Request) {
  const tokens = await requireAuth(request);
  if (!tokens.currentOrgId || !tokens.email) {
    throw new Response("Select an organization first", { status: 400 });
  }
  const membership = await getOrgMember(tokens.currentOrgId, emailToUid(tokens.email));
  if (!isSuperAdmin(tokens.email) && membership?.role !== "owner" && membership?.role !== "admin") {
    throw new Response("Organization owner or admin access required", { status: 403 });
  }
  const account = await getAccountByOrganization(tokens.currentOrgId);
  if (!account) {
    throw new Response("Hubwork account not found for the selected organization", { status: 404 });
  }
  return account;
}

/**
 * Check the selected organization's domain provisioning status.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const account = await requireManagedOrganizationAccount(request);
  const status = await getDomainStatus(account.id, account.customDomain);
  return data(status);
}

/**
 * POST /hubwork/api/domain
 * Provision or remove a custom domain.
 */
export async function action({ request }: Route.ActionArgs) {
  validateOrigin(request);
  const account = await requireManagedOrganizationAccount(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "provision": {
      const domain = (formData.get("domain") as string || "").trim().toLowerCase();
      if (!domain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
        return data({ error: "Invalid domain" }, { status: 400 });
      }

      // Block platform domains to prevent hijacking. Both `.net` (current) and
      // `.online` (legacy 301-redirect window) suffixes are reserved.
      const BLOCKED_DOMAINS = [
        "gemihub.net",
        "www.gemihub.net",
        "gemihub.online",
        "www.gemihub.online",
      ];
      if (
        BLOCKED_DOMAINS.includes(domain) ||
        domain.endsWith(".gemihub.net") ||
        domain.endsWith(".gemihub.online")
      ) {
        return data({ error: "This domain is reserved and cannot be used" }, { status: 400 });
      }

      // Check domain is not already in use
      const existing = await getAccountByDomain(domain);
      if (existing && existing.id !== account.id) {
        return data({ error: "Domain is already in use by another organization" }, { status: 409 });
      }

      try {
        const result = await provisionDomain(account.id, domain);
        return data(result);
      } catch (e: unknown) {
        const err = e as { message?: string; code?: number; errors?: unknown; response?: { data?: unknown } };
        console.error("[hubwork] provisionDomain failed:", err.message, err.code, err.response?.data ?? err.errors);
        return data(
          {
            error: err.message || "Domain provisioning failed",
            code: err.code,
            details: err.response?.data ?? err.errors,
          },
          { status: 500 }
        );
      }
    }

    case "remove": {
      await removeDomain(account.id, account.customDomain);
      return data({ ok: true });
    }

    case "status": {
      const status = await getDomainStatus(account.id, account.customDomain);
      return data(status);
    }

    default:
      return data({ error: `Unknown intent: ${intent}` }, { status: 400 });
  }
}
