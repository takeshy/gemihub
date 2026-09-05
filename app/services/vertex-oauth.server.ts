import crypto from "node:crypto";
import { google } from "googleapis";
import { getFirestore, ORGANIZATIONS, SERVICE_CONFIG, USERS } from "./firestore.server";

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

/**
 * Where an organization's Vertex credential comes from.
 *
 *   "default" — the service-wide connection configured in /admin/enterprise.
 *   "own"     — a connection configured for this organization alone.
 *
 * Unset means "default", except for organizations that already had their own
 * connection before this setting existed (they keep using it).
 */
export type VertexOAuthSource = "default" | "own";

export interface OrganizationVertexOAuthStatus extends VertexOAuthStatus {
  source: VertexOAuthSource;
  /** The service default, so the admin UI can show what "default" resolves to. */
  serviceDefault: VertexOAuthStatus;
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

function userRef(uid: string) {
  return getFirestore().collection(USERS).doc(uid);
}

/** Single document holding the service-wide (default) Vertex connection. */
function serviceRef() {
  return getFirestore().collection(SERVICE_CONFIG).doc("vertex-oauth");
}

interface VertexOAuthRecord {
  client: StoredVertexOAuthClient | null;
  token: StoredVertexOAuth | null;
}

function readRecord(data: Record<string, unknown> | undefined): VertexOAuthRecord {
  const client = data?.vertexOAuthClient as StoredVertexOAuthClient | null | undefined;
  const token = data?.vertexOAuth as StoredVertexOAuth | null | undefined;
  return {
    client: client?.clientId && client?.encryptedClientSecret ? client : null,
    token: token?.encryptedRefreshToken ? token : null,
  };
}

async function serviceRecord(): Promise<VertexOAuthRecord> {
  const snap = await serviceRef().get();
  return readRecord(snap.data());
}

async function orgRecord(orgId: string): Promise<{ record: VertexOAuthRecord; source: VertexOAuthSource }> {
  const snap = await orgRef(orgId).get();
  const data = snap.data();
  const record = readRecord(data);
  const stored = data?.vertexOAuthSource as VertexOAuthSource | undefined;
  // No explicit choice: an organization that already has its own connection
  // keeps it; everyone else inherits the service default.
  const source: VertexOAuthSource =
    stored === "own" || stored === "default"
      ? stored
      : record.client || record.token
        ? "own"
        : "default";
  return { record, source };
}

/** The record actually used for an organization, honouring its source. */
async function effectiveRecord(orgId: string): Promise<VertexOAuthRecord> {
  const { record, source } = await orgRecord(orgId);
  return source === "own" ? record : await serviceRecord();
}

function statusOf(record: VertexOAuthRecord): VertexOAuthStatus {
  return {
    connected: Boolean(record.token),
    connectedEmail: record.token?.connectedEmail ?? null,
    connectedAt: record.token?.connectedAt ?? null,
    clientConfigured: Boolean(record.client || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)),
    projectId: record.client?.projectId ?? null,
  };
}

export function redirectUri(request?: Request): string {
  if (process.env.VERTEX_OAUTH_REDIRECT_URI) return process.env.VERTEX_OAUTH_REDIRECT_URI;
  if (!request) throw new Error("VERTEX_OAUTH_REDIRECT_URI is required");
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${url.host}/auth/vertex/callback`;
}

const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export interface VertexOAuthClientInput {
  clientId: string;
  clientSecret: string;
  projectId: string;
}

/**
 * Validate the fields the browser extracts from a Google "Web application"
 * OAuth client JSON. Shared by the org/service and personal routes so both
 * enforce the same shape and the same redirect-URI registration check.
 */
export function parseVertexOAuthClientInput(
  body: { clientId?: unknown; clientSecret?: unknown; projectId?: unknown; redirectUris?: unknown },
  request: Request,
): { ok: true; input: VertexOAuthClientInput } | { ok: false; error: string } {
  if (
    typeof body.clientId !== "string" || !body.clientId.trim().endsWith(".apps.googleusercontent.com") ||
    typeof body.clientSecret !== "string" || body.clientSecret.trim().length < 8 ||
    typeof body.projectId !== "string" || !PROJECT_ID_RE.test(body.projectId.trim()) ||
    !Array.isArray(body.redirectUris) || !body.redirectUris.every((value) => typeof value === "string")
  ) {
    return { ok: false, error: "有効なウェブアプリ用OAuthクライアントJSONを選択してください" };
  }
  const uri = redirectUri(request);
  if (!body.redirectUris.includes(uri)) {
    return { ok: false, error: `OAuthクライアントにリダイレクトURI ${uri} を追加してください` };
  }
  return { ok: true, input: { clientId: body.clientId, clientSecret: body.clientSecret, projectId: body.projectId } };
}

/** Target of an OAuth flow: the service default, or one organization. */
export type VertexOAuthTarget = { scope: "service" } | { scope: "org"; orgId: string };
export type PersonalVertexOAuthTarget = { scope: "user"; uid: string };
export type AnyVertexOAuthTarget = VertexOAuthTarget | PersonalVertexOAuthTarget;

function targetRef(target: AnyVertexOAuthTarget) {
  if (target.scope === "service") return serviceRef();
  return target.scope === "org" ? orgRef(target.orgId) : userRef(target.uid);
}

async function targetRecord(target: AnyVertexOAuthTarget): Promise<VertexOAuthRecord> {
  if (target.scope === "service") return serviceRecord();
  if (target.scope === "org") return (await orgRecord(target.orgId)).record;
  const snap = await userRef(target.uid).get();
  return readRecord(snap.data());
}

async function targetClient(target: AnyVertexOAuthTarget): Promise<StoredVertexOAuthClient | null> {
  return (await targetRecord(target)).client;
}

async function oauthClient(target: AnyVertexOAuthTarget, request?: Request) {
  const configured = await targetClient(target);
  return new google.auth.OAuth2(
    configured?.clientId || process.env.GOOGLE_CLIENT_ID,
    configured ? decrypt(configured.encryptedClientSecret) : process.env.GOOGLE_CLIENT_SECRET,
    request ? redirectUri(request) : process.env.VERTEX_OAUTH_REDIRECT_URI,
  );
}

export async function createVertexOAuthRequest(target: AnyVertexOAuthTarget, request: Request) {
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const url = (await oauthClient(target, request)).generateAuthUrl({
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

export async function exchangeVertexOAuthCode(
  target: AnyVertexOAuthTarget,
  request: Request,
  code: string,
  codeVerifier: string,
) {
  const { tokens } = await (await oauthClient(target, request)).getToken({ code, codeVerifier });
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
  await saveVertexOAuthToken({ scope: "org", orgId }, refreshToken, connectedEmail);
}

/** Store the connected Google account for either scope. */
export async function saveVertexOAuthToken(
  target: AnyVertexOAuthTarget,
  refreshToken: string,
  connectedEmail: string,
) {
  const vertexOAuth: StoredVertexOAuth = {
    encryptedRefreshToken: encrypt(refreshToken),
    connectedEmail: connectedEmail.trim().toLowerCase(),
    connectedAt: Date.now(),
  };
  const ref = targetRef(target);
  await ref.set({ vertexOAuth }, { merge: true });
}

export async function saveOrganizationVertexOAuthClient(
  orgId: string,
  input: VertexOAuthClientInput,
) {
  await saveVertexOAuthClient({ scope: "org", orgId }, input);
}

/**
 * Store the OAuth client for either scope. A refresh token is bound to the
 * client that issued it, so loading a different client drops the existing
 * connection and requires a fresh Google consent flow.
 */
export async function saveVertexOAuthClient(
  target: AnyVertexOAuthTarget,
  input: VertexOAuthClientInput,
) {
  const vertexOAuthClient: StoredVertexOAuthClient = {
    clientId: input.clientId.trim(),
    encryptedClientSecret: encrypt(input.clientSecret),
    projectId: input.projectId.trim(),
    configuredAt: Date.now(),
  };
  const payload: Record<string, unknown> = { vertexOAuthClient, vertexOAuth: null };
  // Configuring a client for one organization means it wants its own
  // connection; without this the org would keep resolving to the default.
  if (target.scope === "org") payload.vertexOAuthSource = "own";
  await targetRef(target).set(payload, { merge: true });
}

/** Switch an organization between the service default and its own connection. */
export async function setOrganizationVertexOAuthSource(orgId: string, source: VertexOAuthSource) {
  await orgRef(orgId).set({ vertexOAuthSource: source }, { merge: true });
}

export async function clearOrganizationVertexOAuth(orgId: string) {
  // `update` rejects with NOT_FOUND when the document is missing, which would
  // turn a disconnect into a 500. Disconnecting must be idempotent, and the
  // write side already uses set/merge.
  await orgRef(orgId).set({ vertexOAuth: null }, { merge: true });
}

export async function disconnectOrganizationVertexOAuth(orgId: string) {
  await disconnectVertexOAuth({ scope: "org", orgId });
}

/** Revoke (best effort) and forget the connection for either scope. */
export async function disconnectVertexOAuth(target: AnyVertexOAuthTarget) {
  const record = await targetRecord(target);
  if (record.token) {
    try {
      const refreshToken = decrypt(record.token.encryptedRefreshToken);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (error) {
      console.warn("Failed to revoke the Vertex OAuth token", { target, error });
    }
  }
  const ref = targetRef(target);
  await ref.set({ vertexOAuth: null }, { merge: true });
}

/** Status of the service-wide default connection. */
export async function getServiceVertexOAuthStatus(): Promise<VertexOAuthStatus> {
  return statusOf(await serviceRecord());
}

/**
 * A personal connection runs against the user's OWN Google Cloud project, so
 * it must use an OAuth client the user uploaded (as the desktop app does);
 * the service-wide client from the environment never counts as configured.
 */
export async function getUserVertexOAuthStatus(uid: string): Promise<VertexOAuthStatus> {
  const record = await targetRecord({ scope: "user", uid });
  return { ...statusOf(record), clientConfigured: Boolean(record.client) };
}

export async function hasUserVertexOAuthClient(uid: string): Promise<boolean> {
  return Boolean((await targetRecord({ scope: "user", uid })).client);
}

export async function getUserVertexGoogleAuthOptions(uid: string) {
  const record = await targetRecord({ scope: "user", uid });
  if (!record.token) return null;
  return {
    credentials: {
      type: "authorized_user" as const,
      client_id: record.client?.clientId || process.env.GOOGLE_CLIENT_ID,
      client_secret: record.client ? decrypt(record.client.encryptedClientSecret) : process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: decrypt(record.token.encryptedRefreshToken),
    },
    scopes: [CLOUD_PLATFORM_SCOPE],
  };
}

export async function getOrganizationVertexOAuthStatus(
  orgId: string,
): Promise<OrganizationVertexOAuthStatus> {
  const [{ record, source }, service] = await Promise.all([orgRecord(orgId), serviceRecord()]);
  const effective = source === "own" ? record : service;
  return { ...statusOf(effective), source, serviceDefault: statusOf(service) };
}

/**
 * Plain structural object intentionally avoids @google/genai's nested
 * auth-library type mismatch. Resolves through the organization's source, so
 * an org on "default" runs on the service-wide connection.
 */
export async function getOrganizationVertexGoogleAuthOptions(orgId?: string) {
  if (!orgId) return null;
  const record = await effectiveRecord(orgId);
  if (!record.token) return null;
  return {
    credentials: {
      type: "authorized_user" as const,
      client_id: record.client?.clientId || process.env.GOOGLE_CLIENT_ID,
      client_secret: record.client ? decrypt(record.client.encryptedClientSecret) : process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: decrypt(record.token.encryptedRefreshToken),
    },
    scopes: [CLOUD_PLATFORM_SCOPE],
  };
}

/**
 * GCP project backing an organization's Vertex calls: its own aiSettings value
 * wins, then the project of whichever OAuth client it resolves to.
 */
export async function getOrganizationVertexProjectId(orgId?: string): Promise<string | null> {
  if (!orgId) return null;
  const record = await effectiveRecord(orgId);
  return record.client?.projectId ?? null;
}
