import { resolveHubworkAccount } from "~/services/hubwork-account-resolver.server";
import { mountContextForHubworkAccount } from "~/services/storage/account-mount.server";
import { resolveHubworkPage } from "~/services/hubwork-site.server";

const SECURITY_HEADERS: HeadersInit = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/**
 * Serve the root page of a Hubwork site from its Business org GCS project.
 * Returns a Response if the request matches a hubwork account, or null otherwise.
 */
export async function serveHubworkRootPage(
  request: Request
): Promise<Response | null> {
  let account;
  try {
    account = await resolveHubworkAccount(request);
  } catch {
    return null;
  }

  if (account.plan !== "business" && account.plan !== "granted") {
    return null;
  }

  let mountCtx;
  try {
    mountCtx = await mountContextForHubworkAccount(account);
  } catch {
    mountCtx = null;
  }
  if (!mountCtx) {
    return new Response("Account not configured. Owner must log in to GemiHub first.", { status: 503 });
  }

  const result = await resolveHubworkPage(mountCtx, "index");
  if (!result) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(new Uint8Array(result.content), {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=300, s-maxage=180",
      ...SECURITY_HEADERS,
    },
  });
}
