import { google } from "googleapis";
import crypto from "node:crypto";
import { getSession, commitSession, destroySession, setTokens, type SessionTokens } from "./session.server";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
];

function getOAuth2Client(request?: Request) {
  const url = request ? new URL(request.url) : null;
  const proto = request?.headers.get("x-forwarded-proto") || url?.protocol.replace(":", "");
  const redirectUri = url
    ? `${proto}://${url.host}/auth/google/callback`
    : process.env.GOOGLE_REDIRECT_URI;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

/**
 * Generate OAuth URL with CSRF state parameter.
 * Returns the URL and a Set-Cookie header to persist the state in the session.
 */
export async function getAuthUrl(request: Request): Promise<{ url: string; setCookieHeader: string }> {
  const state = crypto.randomUUID();
  const session = await getSession(request);
  session.set("oauthState", state);
  const setCookieHeader = await commitSession(session);

  const oauth2Client = getOAuth2Client(request);
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
  return { url, setCookieHeader };
}

export async function exchangeCode(code: string, request: Request): Promise<{
  accessToken: string;
  refreshToken: string;
  expiryTime: number;
}> {
  const oauth2Client = getOAuth2Client(request);
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to exchange authorization code for tokens");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryTime: tokens.expiry_date || Date.now() + 3600 * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiryTime: number;
}> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error("Failed to refresh access token");
  }

  return {
    accessToken: credentials.access_token,
    expiryTime: credentials.expiry_date || Date.now() + 3600 * 1000,
  };
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns updated session tokens and a Set-Cookie header if tokens were refreshed.
 */
export async function getValidTokens(
  request: Request,
  tokens: SessionTokens
): Promise<{ tokens: SessionTokens; setCookieHeader?: string }> {
  // Check if token expires within 5 minutes
  const FIVE_MINUTES = 5 * 60 * 1000;
  if (tokens.expiryTime - Date.now() > FIVE_MINUTES) {
    return { tokens };
  }

  // Refresh the token
  let refreshed: { accessToken: string; expiryTime: number };
  try {
    refreshed = await refreshAccessToken(tokens.refreshToken);
  } catch {
    // Token revoked or expired — destroy session and return 401
    const session = await getSession(request);
    const setCookieHeader = await destroySession(session);
    throw new Response(JSON.stringify({ error: "Session expired" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Set-Cookie": setCookieHeader },
    });
  }
  const newTokens: SessionTokens = {
    ...tokens,
    accessToken: refreshed.accessToken,
    expiryTime: refreshed.expiryTime,
  };

  const session = await setTokens(request, newTokens);
  const setCookieHeader = await commitSession(session);

  return { tokens: newTokens, setCookieHeader };
}
