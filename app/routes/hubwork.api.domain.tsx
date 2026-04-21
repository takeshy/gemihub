import { data } from "react-router";
import type { Route } from "./+types/hubwork.api.domain";
import { requireAuth } from "~/services/session.server";
import { provisionDomain, getDomainStatus, removeDomain } from "~/services/hubwork-domain.server";
import { getAccountByDomain, getAccountByRootFolderId } from "~/services/hubwork-accounts.server";
import { validateOrigin } from "~/utils/security";

async function requireOwnedHubworkAccount(request: Request) {
  const tokens = await requireAuth(request);
  const account = await getAccountByRootFolderId(tokens.rootFolderId);
  if (!account) {
    throw new Response("Hubwork account not found", { status: 404 });
  }
  return account;
}

/**
 * GET /hubwork/api/domain?accountId=xxx
 * Check domain provisioning status.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const account = await requireOwnedHubworkAccount(request);
  const status = await getDomainStatus(account.id, account.customDomain);
  return data(status);
}

/**
 * POST /hubwork/api/domain
 * Provision or remove a custom domain.
 */
export async function action({ request }: Route.ActionArgs) {
  validateOrigin(request);
  const account = await requireOwnedHubworkAccount(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "provision": {
      const domain = (formData.get("domain") as string || "").trim().toLowerCase();
      if (!domain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
        return data({ error: "Invalid domain" }, { status: 400 });
      }

      // Block platform domains to prevent hijacking
      const BLOCKED_DOMAINS = ["gemihub.online", "www.gemihub.online"];
      if (BLOCKED_DOMAINS.includes(domain) || domain.endsWith(".gemihub.online")) {
        return data({ error: "This domain is reserved and cannot be used" }, { status: 400 });
      }

      // Check domain is not already in use
      const existing = await getAccountByDomain(domain);
      if (existing && existing.id !== account.id) {
        return data({ error: "Domain is already in use by another account" }, { status: 409 });
      }

      const result = await provisionDomain(account.id, domain);
      return data(result);
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
