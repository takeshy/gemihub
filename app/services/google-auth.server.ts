import { google } from "googleapis";
import crypto from "node:crypto";
import { getSession, commitSession, setTokens, type SessionTokens } from "./session.server";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
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

  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
  return { url, setCookieHeader };
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiryTime: number;
}> {
  const oauth2Client = getOAuth2Client();
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
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  const newTokens: SessionTokens = {
    ...tokens,
    accessToken: refreshed.accessToken,
    expiryTime: refreshed.expiryTime,
  };

  const session = await setTokens(request, newTokens);
  const setCookieHeader = await commitSession(session);

  return { tokens: newTokens, setCookieHeader };
}
