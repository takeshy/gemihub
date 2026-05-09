import type { Route } from "./+types/api.obsidian.token";
import { refreshAccessToken } from "~/services/google-auth.server";
import { getAccountByEmail, getAccountByRootFolderId } from "~/services/hubwork-accounts.server";
import { isActivePremiumAccount } from "~/types/hubwork";

async function getGoogleAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const about = await res.json();
  return typeof about.user?.emailAddress === "string" ? about.user.emailAddress : null;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { refreshToken?: string; rootFolderId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { refreshToken } = body;
  if (!refreshToken || typeof refreshToken !== "string") {
    return Response.json({ error: "refreshToken is required" }, { status: 400 });
  }

  try {
    const { accessToken, expiryTime } = await refreshAccessToken(refreshToken);
    let account = body.rootFolderId
      ? await getAccountByRootFolderId(body.rootFolderId)
      : null;
    if (!account) {
      const email = await getGoogleAccountEmail(accessToken);
      if (email) {
        account = await getAccountByEmail(email);
      }
    }
    if (!account || !isActivePremiumAccount(account)) {
      return Response.json(
        { error: "Premium plan is required" },
        { status: 403 }
      );
    }

    const expiresIn = Math.floor((expiryTime - Date.now()) / 1000);
    return Response.json({
      access_token: accessToken,
      expires_in: expiresIn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token refresh failed";
    return Response.json({ error: message }, { status: 401 });
  }
}
