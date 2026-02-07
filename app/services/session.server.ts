import { createCookieSessionStorage, redirect } from "react-router";
import type { ApiPlan } from "~/types/settings";

const rawSessionSecret = process.env.SESSION_SECRET;
if (!rawSessionSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = rawSessionSecret || "dev-secret-change-in-production";

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
  accessToken: string;
  refreshToken: string;
  expiryTime: number;
  rootFolderId: string;
  geminiApiKey?: string;
  apiPlan?: ApiPlan;
  selectedModel?: string;
}

export async function getTokens(request: Request): Promise<SessionTokens | null> {
  const session = await getSession(request);
  const accessToken = session.get("accessToken");
  const refreshToken = session.get("refreshToken");
  const expiryTime = session.get("expiryTime");
  const rootFolderId = session.get("rootFolderId");
  const geminiApiKey = session.get("geminiApiKey");

  if (!accessToken || !refreshToken) {
    return null;
  }

  const apiPlan = session.get("apiPlan") as ApiPlan | undefined;
  const selectedModel = session.get("selectedModel") as string | undefined;

  return { accessToken, refreshToken, expiryTime, rootFolderId, geminiApiKey, apiPlan, selectedModel };
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
    session.set("geminiApiKey", tokens.geminiApiKey);
  }
  if (tokens.apiPlan !== undefined) {
    session.set("apiPlan", tokens.apiPlan);
  }
  if (tokens.selectedModel !== undefined) {
    session.set("selectedModel", tokens.selectedModel);
  }
  return session;
}

export async function setGeminiApiKey(request: Request, apiKey: string) {
  const session = await getSession(request);
  session.set("geminiApiKey", apiKey);
  return session;
}

export async function requireAuth(request: Request): Promise<SessionTokens> {
  const tokens = await getTokens(request);
  if (!tokens) {
    throw redirect("/auth/google");
  }
  return tokens;
}
