import crypto from "node:crypto";
import { google } from "googleapis";
import { getFirestore, ORGANIZATIONS } from "./firestore.server";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

interface StoredVertexOAuth {
  encryptedRefreshToken: string;
  connectedEmail: string;
  connectedAt: number;
}

interface StoredVertexOAuthClient {
  clientId: string;
  encryptedClientSecret: string;
  projectId: string;
  configuredAt: number;
}

export interface VertexOAuthStatus {
  connected: boolean;
  connectedEmail: string | null;
  connectedAt: number | null;
  clientConfigured: boolean;
  projectId: string | null;
}

function encryptionKey(): Buffer {
  const secret = process.env.ORG_VERTEX_OAUTH_SECRET
    || process.env.HUBWORK_OAUTH_TOKEN_SECRET
    || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ORG_VERTEX_OAUTH_SECRET or SESSION_SECRET must be configured");
    }
    return crypto.createHash("sha256").update("dev-org-vertex-oauth-secret").digest();
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(refreshToken: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decrypt(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("invalid Vertex OAuth token format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function orgRef(orgId: string) {
  return getFirestore().collection(ORGANIZATIONS).doc(orgId);
}

function redirectUri(request?: Request): string {
  if (process.env.VERTEX_OAUTH_REDIRECT_URI) return process.env.VERTEX_OAUTH_REDIRECT_URI;
  if (!request) throw new Error("VERTEX_OAUTH_REDIRECT_URI is required");
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${url.host}/auth/vertex/callback`;
}

async function storedClient(orgId: string): Promise<StoredVertexOAuthClient | null> {
  const snap = await orgRef(orgId).get();
  const value = snap.data()?.vertexOAuthClient as StoredVertexOAuthClient | null | undefined;
  return value?.clientId && value?.encryptedClientSecret ? value : null;
}

async function oauthClient(orgId: string, request?: Request) {
  const configured = await storedClient(orgId);
  return new google.auth.OAuth2(
    configured?.clientId || process.env.GOOGLE_CLIENT_ID,
    configured ? decrypt(configured.encryptedClientSecret) : process.env.GOOGLE_CLIENT_SECRET,
    request ? redirectUri(request) : process.env.VERTEX_OAUTH_REDIRECT_URI,
  );
}

export async function createVertexOAuthRequest(orgId: string, request: Request) {
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const url = (await oauthClient(orgId, request)).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [CLOUD_PLATFORM_SCOPE, EMAIL_SCOPE],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as import("googleapis").Auth.CodeChallengeMethod,
  });
  return { url, state, codeVerifier };
}

export async function exchangeVertexOAuthCode(orgId: string, request: Request, code: string, codeVerifier: string) {
  const { tokens } = await (await oauthClient(orgId, request)).getToken({ code, codeVerifier });
  if (!tokens.refresh_token || !tokens.access_token) {
    throw new Error("Google did not return an offline refresh token; revoke the previous grant and reconnect");
  }
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await response.json().catch(() => ({})) as { email?: string };
  if (!response.ok || !profile.email) throw new Error("failed to identify the connected Google account");
  return { refreshToken: tokens.refresh_token, email: profile.email };
}

export async function saveOrganizationVertexOAuth(orgId: string, refreshToken: string, connectedEmail: string) {
  const vertexOAuth: StoredVertexOAuth = {
    encryptedRefreshToken: encrypt(refreshToken),
    connectedEmail: connectedEmail.trim().toLowerCase(),
    connectedAt: Date.now(),
  };
  await orgRef(orgId).set({ vertexOAuth }, { merge: true });
}

export async function saveOrganizationVertexOAuthClient(
  orgId: string,
  input: { clientId: string; clientSecret: string; projectId: string },
) {
  const vertexOAuthClient: StoredVertexOAuthClient = {
    clientId: input.clientId.trim(),
    encryptedClientSecret: encrypt(input.clientSecret),
    projectId: input.projectId.trim(),
    configuredAt: Date.now(),
  };
  // A refresh token is bound to the client that issued it. Loading a different
  // client therefore requires a fresh Google consent flow.
  await orgRef(orgId).set({ vertexOAuthClient, vertexOAuth: null }, { merge: true });
}

export async function clearOrganizationVertexOAuth(orgId: string) {
  // `update` rejects with NOT_FOUND when the org document is missing, which
  // would turn a disconnect into a 500. Disconnecting must be idempotent, and
  // the write side already uses set/merge.
  await orgRef(orgId).set({ vertexOAuth: null }, { merge: true });
}

export async function disconnectOrganizationVertexOAuth(orgId: string) {
  const value = await stored(orgId);
  if (value) {
    try {
      const refreshToken = decrypt(value.encryptedRefreshToken);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (error) {
      console.warn("Failed to revoke the organization Vertex OAuth token", { orgId, error });
    }
  }
  await clearOrganizationVertexOAuth(orgId);
}

async function stored(orgId: string): Promise<StoredVertexOAuth | null> {
  const snap = await orgRef(orgId).get();
  const value = snap.data()?.vertexOAuth as StoredVertexOAuth | null | undefined;
  return value?.encryptedRefreshToken ? value : null;
}

export async function getOrganizationVertexOAuthStatus(orgId: string): Promise<VertexOAuthStatus> {
  const [value, client] = await Promise.all([stored(orgId), storedClient(orgId)]);
  return {
    connected: Boolean(value),
    connectedEmail: value?.connectedEmail ?? null,
    connectedAt: value?.connectedAt ?? null,
    clientConfigured: Boolean(client),
    projectId: client?.projectId ?? null,
  };
}

/** Plain structural object intentionally avoids @google/genai's nested auth-library type mismatch. */
export async function getOrganizationVertexGoogleAuthOptions(orgId?: string) {
  if (!orgId) return null;
  const [value, client] = await Promise.all([stored(orgId), storedClient(orgId)]);
  if (!value) return null;
  return {
    credentials: {
      type: "authorized_user" as const,
      client_id: client?.clientId || process.env.GOOGLE_CLIENT_ID,
      client_secret: client ? decrypt(client.encryptedClientSecret) : process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: decrypt(value.encryptedRefreshToken),
    },
    scopes: [CLOUD_PLATFORM_SCOPE],
  };
}
