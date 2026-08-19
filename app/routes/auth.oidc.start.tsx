/**
 * GET /auth/oidc/start?orgId=<id>[&returnTo=<url>]
 *
 * Phase 5e-step2: kicks off the OIDC SSO flow for the named org.
 *   1. Look up the org's IdP config
 *   2. Discover the IdP's authorize endpoint
 *   3. Mint state + PKCE pair, save to a short-lived cookie
 *   4. Redirect the user to the IdP
 */

import { redirect } from "react-router";
import type { Route } from "./+types/auth.oidc.start";
import { getOrganization } from "~/services/organizations.server";
import {
  buildAuthorizeUrl,
  generatePkce,
  OidcConfigError,
} from "~/services/oidc-auth.server";
import { commitSession, getSession } from "~/services/session.server";

function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}/auth/oidc/callback`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const returnTo = url.searchParams.get("returnTo") || "/";

  if (!orgId) {
    throw new Response("missing orgId", { status: 400 });
  }
  const org = await getOrganization(orgId);
  if (!org) {
    throw new Response(`organization not found: ${orgId}`, { status: 404 });
  }
  if (!org.idp || org.idp.type !== "oidc") {
    throw new Response(
      `organization ${orgId} has no OIDC IdP configured. Use plain Google OAuth at /auth/google.`,
      { status: 400 },
    );
  }

  const { state, codeVerifier, codeChallenge } = generatePkce();
  const session = await getSession(request);
  session.set("oidcState", state);
  session.set("oidcCodeVerifier", codeVerifier);
  session.set("oidcOrgId", orgId);
  session.set("oidcReturnTo", returnTo);
  const setCookieHeader = await commitSession(session);

  try {
    const authorizeUrl = await buildAuthorizeUrl({
      org,
      redirectUri: callbackUrl(request),
      state,
      codeChallenge,
    });
    return redirect(authorizeUrl, { headers: { "Set-Cookie": setCookieHeader } });
  } catch (err) {
    if (err instanceof OidcConfigError) {
      throw new Response(err.message, { status: err.status });
    }
    throw err;
  }
}
