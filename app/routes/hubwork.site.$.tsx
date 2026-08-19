import type { Route } from "./+types/hubwork.site.$";
import { resolveHubworkAccount } from "~/services/hubwork-account-resolver.server";
import { mountContextForHubworkAccount } from "~/services/storage/account-mount.server";
import { resolveHubworkPage } from "~/services/hubwork-site.server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/**
 * Catch-all route for Hubwork sites.
 * Only activates on Hubwork domains (resolved via Host header).
 * Serves `web/**` through the storage provider with CDN caching — the
 * account's mount decides whether the bytes come from the owner's Drive or
 * the Business organization's project storage.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  let account;
  try {
    account = await resolveHubworkAccount(request);
  } catch {
    throw new Response("Not Found", { status: 404 });
  }

  // Page hosting requires the Business plan
  if (account.plan !== "business" && account.plan !== "granted") {
    throw new Response("Not Found", { status: 404 });
  }

  let mountCtx;
  try {
    mountCtx = await mountContextForHubworkAccount(account);
  } catch {
    mountCtx = null;
  }
  if (!mountCtx) {
    throw new Response("Account not configured. Owner must log in to GemiHub first.", { status: 503 });
  }

  let rawPath = (params["*"] || "").replace(/^\/+|\/+$/g, "");
  // __gemihub_root is an internal rewrite from server.js for "/" on hubwork domains
  if (rawPath === "__gemihub_root") rawPath = "";
  // Reject path traversal attempts
  if (rawPath.includes("..") || rawPath.includes("\0")) {
    throw new Response("Not Found", { status: 404 });
  }
  const path = rawPath || "index";

  const result = await resolveHubworkPage(mountCtx, path);
  if (!result) {
    throw new Response("Not Found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Cache-Control": "public, max-age=300, s-maxage=180",
    ...SECURITY_HEADERS,
  };

  // When a custom domain is active, exclude the gemihub.net URL from Google
  // to avoid duplicate-content dilution. Relies on Cloud CDN keying by host.
  const requestHost = request.headers.get("host")?.split(":")[0] || "";
  if (
    account.customDomain &&
    account.domainStatus === "active" &&
    requestHost !== account.customDomain
  ) {
    headers["X-Robots-Tag"] = "noindex, nofollow";
  }

  return new Response(new Uint8Array(result.content), { headers });
}
