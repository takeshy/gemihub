/**
 * GET /auth/oidc/callback?code=...&state=...
 *
 * Phase 5e-step2: handles the IdP redirect after federated login.
 *   1. Verify state matches the cookie
 *   2. Exchange code → tokens, validate id_token signature + claims
 *   3. Auto-enroll the user as an org member if their email's domain is on
 *      the org's allow list (and they aren't already a member)
 *   4. Create a session: { email, oidcSub, currentOrgId, authMethod: "oidc" }
 *   5. Redirect to the original returnTo
 */

import { redirect } from "react-router";
import type { Route } from "./+types/auth.oidc.callback";
import {
  addOrgMember,
  emailToUid,
  getOrgMember,
  getOrganization,
} from "~/services/organizations.server";
import {
  emailDomainOf,
  exchangeAndVerify,
  OidcConfigError,
} from "~/services/oidc-auth.server";
import {
  commitSession,
  getSession,
  safeReturnTo,
  setTokens,
} from "~/services/session.server";

function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}/auth/oidc/callback`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    throw new Response(`OIDC IdP returned error: ${error}`, { status: 400 });
  }
  if (!code || !state) {
    throw new Response("missing code or state", { status: 400 });
  }

  const stateSession = await getSession(request);
  const expectedState = stateSession.get("oidcState");
  const codeVerifier = stateSession.get("oidcCodeVerifier");
  const orgId = stateSession.get("oidcOrgId") as string | undefined;
  const returnTo = safeReturnTo(stateSession.get("oidcReturnTo"));
  if (state !== expectedState || !codeVerifier || !orgId) {
    throw new Response("invalid OIDC state", { status: 400 });
  }

  const org = await getOrganization(orgId);
  if (!org) {
    throw new Response(`organization not found: ${orgId}`, { status: 404 });
  }

  let result;
  try {
    result = await exchangeAndVerify({
      org,
      redirectUri: callbackUrl(request),
      code,
      codeVerifier,
    });
  } catch (err) {
    if (err instanceof OidcConfigError) {
      throw new Response(err.message, { status: err.status });
    }
    if (err instanceof Error) {
      throw new Response(`OIDC token validation failed: ${err.message}`, { status: 400 });
    }
    throw err;
  }

  const uid = emailToUid(result.email);

  // Auto-enroll if the email domain is on the org's allow list. Otherwise
  // refuse — admins must add the member manually first.
  const idp = org.idp;
  const domains = idp?.type === "oidc" ? (idp.domains ?? []) : [];
  const domain = emailDomainOf(result.email);
  const existing = await getOrgMember(orgId, uid);
  if (!existing) {
    if (!domain || !domains.includes(domain)) {
      throw new Response(
        `${result.email} is not a member of ${orgId} and the email domain "${domain}" is not on the org's allow list. Ask an admin to invite you.`,
        { status: 403 },
      );
    }
    await addOrgMember({ orgId, uid, email: result.email, role: "member" });
  }

  const session = await setTokens(request, {
    accessToken: "",
    refreshToken: "",
    expiryTime: 0,
    rootFolderId: "",
    email: result.email,
    authMethod: "oidc",
    oidcSub: result.sub,
    currentOrgId: orgId,
  });
  return redirect(returnTo, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
