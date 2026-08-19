/**
 * OIDC SSO helpers — Phase 5e-step2.
 *
 * Per-org OIDC configuration lives at organizations/{orgId}.idp. This module
 * handles the auth-code + PKCE flow against arbitrary OIDC providers
 * (Okta, Azure AD, Google Workspace, Auth0, etc.) without going through
 * Identity Platform. JWT validation uses `jose` against the IdP's JWKS.
 *
 * The flow:
 *   1. /auth/oidc/start?orgId=X → discover, build authorize URL, redirect
 *   2. IdP authenticates, redirects to /auth/oidc/callback?code=...&state=...
 *   3. Callback validates state + code_verifier, exchanges code, validates
 *      ID token, extracts email/sub, creates session
 *
 * See docs/enterprise.md §4.
 */

import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Organization } from "~/types/enterprise";

// In-process cache of JWKS sets so we don't refetch on every callback.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  scopes_supported?: string[];
}

const discoveryCache = new Map<string, { doc: DiscoveryDocument; fetchedAt: number }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour

export class OidcConfigError extends Error {
  status = 500 as const;
}

export class OidcStateError extends Error {
  status = 400 as const;
}

export async function fetchDiscoveryDocument(issuer: string): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.doc;

  const trimmed = issuer.replace(/\/+$/, "");
  const url = `${trimmed}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new OidcConfigError(`OIDC discovery failed for ${issuer}: HTTP ${res.status}`);
  }
  const doc = (await res.json()) as DiscoveryDocument;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new OidcConfigError(`OIDC discovery incomplete for ${issuer}`);
  }
  discoveryCache.set(issuer, { doc, fetchedAt: Date.now() });
  return doc;
}

function getJwks(issuer: string, jwksUri: string) {
  const cached = jwksCache.get(issuer);
  if (cached) return cached;
  const set = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(issuer, set);
  return set;
}

/** Mint a fresh state + code_verifier pair for a new auth flow. */
export function generatePkce(): { state: string; codeVerifier: string; codeChallenge: string } {
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { state, codeVerifier, codeChallenge };
}

export interface BuildAuthorizeUrlInput {
  org: Organization;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/**
 * Build the authorize URL for the org's IdP. Throws if the org has no OIDC
 * config.
 */
export async function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): Promise<string> {
  const idp = input.org.idp;
  if (!idp || idp.type !== "oidc") {
    throw new OidcConfigError(`organization ${input.org.id} has no OIDC IdP configured`);
  }
  const doc = await fetchDiscoveryDocument(idp.issuer);
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", idp.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface ExchangeCodeInput {
  org: Organization;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

export interface OidcCallbackResult {
  email: string;
  /** `email_verified` claim. False when the IdP omits it. */
  emailVerified: boolean;
  sub: string;
  name?: string;
  rawIdToken: string;
  payload: JWTPayload;
}

/**
 * Exchange authorization code for tokens and validate the ID token. Returns
 * the verified payload + commonly-needed fields (email, sub, name).
 */
export async function exchangeAndVerify(input: ExchangeCodeInput): Promise<OidcCallbackResult> {
  const idp = input.org.idp;
  if (!idp || idp.type !== "oidc") {
    throw new OidcConfigError(`organization ${input.org.id} has no OIDC IdP configured`);
  }
  const doc = await fetchDiscoveryDocument(idp.issuer);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: idp.clientId,
    client_secret: idp.clientSecretRef,
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OidcConfigError(`OIDC token exchange failed: HTTP ${res.status} ${text}`);
  }
  const tokens = (await res.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) {
    throw new OidcConfigError("OIDC token response missing id_token");
  }

  const jwks = getJwks(idp.issuer, doc.jwks_uri);
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: doc.issuer || idp.issuer,
    audience: idp.clientId,
  });

  const email = typeof payload.email === "string" ? payload.email : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const name = typeof payload.name === "string" ? payload.name : undefined;
  // Some IdPs issue tokens for self-asserted, unverified addresses. The claim
  // is surfaced (not enforced here) so domain-based auto-enrollment can demand
  // it while an already-enrolled member can still sign in.
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";
  if (!email) {
    throw new OidcConfigError("OIDC ID token missing email claim — ensure 'email' scope is granted");
  }
  if (!sub) {
    throw new OidcConfigError("OIDC ID token missing sub claim");
  }
  return { email, emailVerified, sub, name, rawIdToken: tokens.id_token, payload };
}

export function emailDomainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}
