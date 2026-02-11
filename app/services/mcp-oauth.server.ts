// MCP OAuth service - handles RFC 9728 discovery, token exchange, and refresh

import type { OAuthConfig, OAuthTokens } from "~/types/settings";
import { validateMcpServerUrl } from "./url-validator.server";

export interface OAuthDiscoveryResult {
  config: OAuthConfig;
  registrationUrl?: string;
}

interface ProtectedResourceMetadata {
  authorization_servers?: string[];
  resource?: string;
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

/**
 * Discover OAuth configuration from an MCP server URL using RFC 9728.
 *
 * Flow:
 * 1. POST to the serverUrl (MCP initialize) — check for 401 + WWW-Authenticate
 * 2. Fetch `/.well-known/oauth-protected-resource` from the server origin
 * 3. Fetch authorization server metadata from `/.well-known/oauth-authorization-server`
 */
export async function discoverOAuth(serverUrl: string): Promise<OAuthDiscoveryResult | null> {
  const url = new URL(serverUrl);
  const origin = url.origin;

  // Step 1: Try fetching protected resource metadata
  let protectedResource: ProtectedResourceMetadata | null = null;

  // Try WWW-Authenticate header from a direct POST first
  try {
    const probeRes = await fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "gemihub-oauth-probe", version: "1.0.0" },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (probeRes.status === 401) {
      const wwwAuth = probeRes.headers.get("www-authenticate") || "";
      const metadataMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
      if (metadataMatch) {
        try {
          validateMcpServerUrl(metadataMatch[1]);
          const metaRes = await fetch(metadataMatch[1], {
            signal: AbortSignal.timeout(10_000),
          });
          if (metaRes.ok) {
            protectedResource = await metaRes.json();
          }
        } catch {
          // Fall through to well-known
        }
      }
    } else {
      // Server didn't return 401 — no OAuth needed
      return null;
    }
  } catch {
    // Connection failed, try well-known fallback
  }

  // Step 2: Fallback to well-known protected resource metadata
  if (!protectedResource) {
    try {
      const wellKnownUrl = `${origin}/.well-known/oauth-protected-resource`;
      const res = await fetch(wellKnownUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        protectedResource = await res.json();
      }
    } catch {
      // No protected resource metadata found
    }
  }

  if (!protectedResource?.authorization_servers?.length) {
    return null;
  }

  // Step 3: Fetch authorization server metadata
  const authServerUrl = protectedResource.authorization_servers[0];
  let authServerMeta: AuthorizationServerMetadata | null = null;

  try {
    // Validate auth server URL for SSRF before fetching
    validateMcpServerUrl(authServerUrl);
    // Try well-known at the auth server
    const asUrl = new URL(authServerUrl);
    const wellKnownAsUrl = `${asUrl.origin}/.well-known/oauth-authorization-server`;
    const res = await fetch(wellKnownAsUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      authServerMeta = await res.json();
    }
  } catch {
    // Could not fetch auth server metadata
  }

  if (!authServerMeta) {
    // Try the auth server URL directly as metadata
    try {
      validateMcpServerUrl(authServerUrl);
      const res = await fetch(authServerUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        authServerMeta = await res.json();
      }
    } catch {
      return null;
    }
  }

  if (!authServerMeta?.authorization_endpoint || !authServerMeta?.token_endpoint) {
    return null;
  }

  return {
    config: {
      clientId: "", // Will be set after dynamic registration or user input
      authorizationUrl: authServerMeta.authorization_endpoint,
      tokenUrl: authServerMeta.token_endpoint,
      scopes: authServerMeta.scopes_supported || [],
    },
    registrationUrl: authServerMeta.registration_endpoint,
  };
}

/**
 * Dynamically register an OAuth client with the authorization server.
 */
export async function registerOAuthClient(
  registrationUrl: string,
  redirectUri: string,
  clientName: string
): Promise<{ clientId: string; clientSecret?: string }> {
  validateMcpServerUrl(registrationUrl);
  const res = await fetch(registrationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth client registration failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

/**
 * Exchange an authorization code for tokens using PKCE.
 */
export async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });

  if (config.clientSecret) {
    params.set("client_secret", config.clientSecret);
  }

  validateMcpServerUrl(config.tokenUrl);
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type || "Bearer",
  };
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  if (config.clientSecret) {
    params.set("client_secret", config.clientSecret);
  }

  validateMcpServerUrl(config.tokenUrl);
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type || "Bearer",
  };
}

/**
 * Check whether tokens are expired (with a 5-minute buffer).
 */
export function isTokenExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) return false;
  return Date.now() >= tokens.expiresAt - 5 * 60 * 1000;
}
