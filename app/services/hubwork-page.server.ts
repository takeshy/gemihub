import { resolveHubworkAccount } from "~/services/hubwork-account-resolver.server";
import { mountContextForHubworkAccount } from "~/services/storage/account-mount.server";
import { resolveHubworkPage } from "~/services/hubwork-site.server";
import { hasProFeatures } from "~/types/hubwork";

const SECURITY_HEADERS: HeadersInit = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/**
 * Serve the root page of a Hubwork site — Pro accounts from their own Drive,
 * Business organizations from their GCS project.
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

  if (!hasProFeatures(account)) {
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
