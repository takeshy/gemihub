import { createCookieSessionStorage, redirect, type SessionStorage } from "react-router";

const CONTACT_SESSION_SECRET = process.env.HUBWORK_SESSION_SECRET || process.env.SESSION_SECRET || (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("HUBWORK_SESSION_SECRET or SESSION_SECRET must be set in production");
  }
  return "hubwork-dev-secret-DO-NOT-USE-IN-PRODUCTION";
})();

const ACCOUNT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

const sessionStorages = new Map<string, SessionStorage>();

function getSessionStorage(type: string): SessionStorage {
  if (!ACCOUNT_TYPE_PATTERN.test(type)) {
    throw new Error(`Invalid account type name: ${type}`);
  }
  let storage = sessionStorages.get(type);
  if (!storage) {
    storage = createCookieSessionStorage({
      cookie: {
        name: `__hubwork_${type}`,
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
        sameSite: "lax",
        secrets: [CONTACT_SESSION_SECRET],
        secure: process.env.NODE_ENV === "production",
      },
    });
    sessionStorages.set(type, storage);
  }
  return storage;
}

export async function getContactSession(request: Request, type: string) {
  const storage = getSessionStorage(type);
  return storage.getSession(request.headers.get("Cookie"));
}

export async function getContactEmail(request: Request, type: string): Promise<string | null> {
  const session = await getContactSession(request, type);
  return session.get("contactEmail") || null;
}

export async function createContactSession(email: string, type: string, redirectTo: string) {
  const storage = getSessionStorage(type);
  const session = await storage.getSession();
  session.set("contactEmail", email);
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await storage.commitSession(session),
    },
  });
}

export async function destroyContactSession(request: Request, type: string): Promise<string> {
  const storage = getSessionStorage(type);
  const session = await getContactSession(request, type);
  return storage.destroySession(session);
}
