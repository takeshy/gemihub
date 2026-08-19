import { createCookieSessionStorage, redirect } from "react-router";
import crypto from "node:crypto";
import type { ApiPlan } from "~/types/settings";

const rawSessionSecret = process.env.SESSION_SECRET;
if (!rawSessionSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = rawSessionSecret || "dev-secret-change-in-production";

// --- API key encryption helpers (AES-256-GCM) ---

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptApiKey(plaintext: string): string {
  const key = deriveKey(SESSION_SECRET);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptApiKey(encoded: string): string {
  const key = deriveKey(SESSION_SECRET);
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
    sameSite: "lax",
    secrets: [SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function commitSession(session: Awaited<ReturnType<typeof getSession>>) {
  return sessionStorage.commitSession(session);
}

export async function destroySession(session: Awaited<ReturnType<typeof getSession>>) {
  return sessionStorage.destroySession(session);
}

export interface SessionTokens {
  /**
   * Empty string for sessions created without a Google Drive grant (org
   * OIDC/email login). Drive-coupled call sites must gate on
   * `accessToken !== ""` or branch on `authMethod`.
   */
  accessToken: string;
  refreshToken: string;
  expiryTime: number;
  /** Empty string for sessions without a Drive root folder. */
  rootFolderId: string;
  geminiApiKey?: string;
  apiPlan?: ApiPlan;
  selectedModel?: string;
  email?: string;
  grantedScopes?: string;
  /** Currently selected organization (org members only). */
  currentOrgId?: string;
  /** Currently selected org project under currentOrgId. */
  currentProjectId?: string;
  /**
   * How the session was authenticated. "google" = Google OAuth (with or
   * without Drive scope); "oidc" = federated via per-org IdP; "email" =
   * org email login. Used to route sign-out / refresh.
   */
  authMethod?: "google" | "oidc" | "email";
  /** OIDC sub claim — stable per-IdP identifier. Set only for OIDC sessions. */
  oidcSub?: string;
}

export async function getTokens(request: Request): Promise<SessionTokens | null> {
  const session = await getSession(request);
  const accessToken = session.get("accessToken");
  const refreshToken = session.get("refreshToken");
  const expiryTime = session.get("expiryTime");
  const rootFolderId = session.get("rootFolderId");
  const encryptedKey = session.get("geminiApiKey") as string | undefined;
  const sessionEmail = session.get("email") as string | undefined;
  const authMethod = session.get("authMethod") as "google" | "oidc" | "email" | undefined;

  // An org OIDC/email session is identified by `email` + `authMethod` even
  // when accessToken/refreshToken are empty (no Google Drive grant). Google
  // sessions still require the OAuth tokens.
  const tokenlessSession = (authMethod === "oidc" || authMethod === "email") && !!sessionEmail;
  if (!tokenlessSession && (!accessToken || !refreshToken)) {
    return null;
  }

  let geminiApiKey: string | undefined;
  if (encryptedKey) {
    try {
      geminiApiKey = decryptApiKey(encryptedKey);
    } catch {
      // If decryption fails (e.g. secret changed), treat as unset
      geminiApiKey = undefined;
    }
  }

  const apiPlan = session.get("apiPlan") as ApiPlan | undefined;
  const selectedModel = session.get("selectedModel") as string | undefined;
  const grantedScopes = session.get("grantedScopes") as string | undefined;
  const currentOrgId = session.get("currentOrgId") as string | undefined;
  const currentProjectId = session.get("currentProjectId") as string | undefined;
  const oidcSub = session.get("oidcSub") as string | undefined;

  return {
    accessToken: accessToken ?? "",
    refreshToken: refreshToken ?? "",
    expiryTime: expiryTime ?? 0,
    rootFolderId: rootFolderId ?? "",
    geminiApiKey,
    apiPlan,
    selectedModel,
    email: sessionEmail,
    grantedScopes,
    currentOrgId,
    currentProjectId,
    authMethod,
    oidcSub,
  };
}

export async function setTokens(
  request: Request,
  tokens: SessionTokens
) {
  const session = await getSession(request);
  session.set("accessToken", tokens.accessToken);
  session.set("refreshToken", tokens.refreshToken);
  session.set("expiryTime", tokens.expiryTime);
  session.set("rootFolderId", tokens.rootFolderId);
  if (tokens.geminiApiKey !== undefined) {
    session.set("geminiApiKey", tokens.geminiApiKey ? encryptApiKey(tokens.geminiApiKey) : "");
  }
  if (tokens.apiPlan !== undefined) {
    session.set("apiPlan", tokens.apiPlan);
  }
  if (tokens.selectedModel !== undefined) {
    session.set("selectedModel", tokens.selectedModel);
  }
  if (tokens.email !== undefined) {
    session.set("email", tokens.email);
  }
  if (tokens.grantedScopes !== undefined) {
    session.set("grantedScopes", tokens.grantedScopes);
  }
  if (tokens.currentOrgId !== undefined) {
    session.set("currentOrgId", tokens.currentOrgId);
  }
  if (tokens.currentProjectId !== undefined) {
    session.set("currentProjectId", tokens.currentProjectId);
  }
  if (tokens.authMethod !== undefined) {
    session.set("authMethod", tokens.authMethod);
  }
  if (tokens.oidcSub !== undefined) {
    session.set("oidcSub", tokens.oidcSub);
  }
  return session;
}

/**
 * Update the currently selected org / project. Pass null to clear.
 * Returns the cookie header — caller must include it in the response.
 */
export async function setCurrentSelection(
  request: Request,
  selection: { orgId?: string | null; projectId?: string | null },
): Promise<string> {
  const session = await getSession(request);
  if (selection.orgId === null) session.unset("currentOrgId");
  else if (selection.orgId !== undefined) session.set("currentOrgId", selection.orgId);
  if (selection.projectId === null) session.unset("currentProjectId");
  else if (selection.projectId !== undefined) session.set("currentProjectId", selection.projectId);
  return commitSession(session);
}

export async function setGeminiApiKey(request: Request, apiKey: string) {
  const session = await getSession(request);
  session.set("geminiApiKey", apiKey ? encryptApiKey(apiKey) : "");
  return session;
}

/**
 * Sanitize a post-login `returnTo` value.
 *
 * Only same-origin absolute paths are allowed: anything else (an absolute URL,
 * a protocol-relative `//evil.example`, a backslash variant that some browsers
 * normalize to `//`) would turn the login flow into an open redirect.
 */
export function safeReturnTo(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value === "") return fallback;
  if (!value.startsWith("/")) return fallback;
  // "//host" and "/\host" are treated as protocol-relative URLs by browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

export async function requireAuth(request: Request): Promise<SessionTokens> {
  const tokens = await getTokens(request);
  if (!tokens) {
    throw redirect("/auth/google");
  }
  return tokens;
}
